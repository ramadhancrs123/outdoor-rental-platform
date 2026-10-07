import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileText, Search, ShieldCheck, Truck, Wrench, Building2, ReceiptText } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getFinanceAccountSummary, getFinanceCapabilities, getKeuanganContext, listFinanceSuppliers, recordExpense, recordExpenseWithFinanceCashout, reconcileExpenseCashoutCommand, reconcileExpenseCommand, type RecordExpenseInput, type SupplierOption } from "@/features/keuangan";
import { FinanceCashout } from "@/components/keuangan/finance-cashout";
import { listPurchases } from "@/features/pemasok";
import { listMaintenanceQueue, semanticMaintenanceLabel } from "@/features/perawatan";
import { paths } from "@/routes/paths";
import { AmountDisplay, FinanceShell, FinanceStateScreen, SourcePreview } from "@/components/keuangan/finance-ui";

const sourceTypes: Array<[RecordExpenseInput["sourceType"], string, string]> = [
  ["purchase", "Pembelian", "Terkait pembelian inventaris"],
  ["maintenance", "Perawatan", "Terkait pekerjaan perawatan"],
  ["operational", "Operasional", "Biaya operasional usaha"],
  ["other", "Lainnya", "Kategori lain"],
  ["manual", "Manual", "Pencatatan manual"],
];

export function ExpenseCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<"form" | "processing" | "success" | "unknown">("form");
  const [sourceType, setSourceType] = useState<RecordPaymentSource>( "operational");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [form, setForm] = useState<RecordExpenseInput>({ sourceType: "operational", kategoriBiaya: "Operasional", deskripsi: "", amount: 0, tanggalPengeluaran: new Date().toISOString().slice(0, 10), pemasokId: null, sourceId: null, buktiStoragePath: null, catatan: "" });
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);
  const [accountAllocations, setAccountAllocations] = useState<Record<string, string>>({});
  const commandRef = useRef<string | null>(null);
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const cashoutRequired = sourceType === "operational" || sourceType === "other" || sourceType === "manual";
  const financeAccounts = useQuery({
    queryKey: ["keuangan", "expense-cashout-accounts", context.data?.usahaId],
    queryFn: () => getFinanceAccountSummary(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId) && cashoutRequired && step === 3,
    staleTime: 5_000,
  });
  const suppliers = useQuery({ queryKey: ["keuangan", "suppliers", context.data?.usahaId, supplierSearch], queryFn: () => listFinanceSuppliers(context.data!.usahaId, supplierSearch), enabled: Boolean(context.data?.usahaId), staleTime: 15_000 });
  const purchases = useQuery({
    queryKey: ["keuangan", "expense-sources", "purchase", context.data?.usahaId, sourceSearch],
    queryFn: () => listPurchases(context.data!.usahaId, { search: sourceSearch, status: "all", page: 1, pageSize: 20 }),
    enabled: Boolean(context.data?.usahaId) && sourceType === "purchase",
    staleTime: 15_000,
  });
  const maintenances = useQuery({
    queryKey: ["keuangan", "expense-sources", "maintenance", context.data?.usahaId, sourceSearch],
    queryFn: () => listMaintenanceQueue(context.data!.usahaId, { search: sourceSearch }),
    enabled: Boolean(context.data?.usahaId) && sourceType === "maintenance",
    staleTime: 15_000,
  });
  const capabilities = getFinanceCapabilities();

  const sourceRequiresId = sourceType === "purchase" || sourceType === "maintenance";
  const detailReady = Boolean(form.kategoriBiaya.trim()) && Boolean(form.deskripsi.trim()) && Number(form.amount) > 0 && Boolean(form.tanggalPengeluaran);
  const confirmReady = detailReady && (!sourceRequiresId || Boolean(form.sourceId));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Finance belum siap.");
      if (!commandRef.current) commandRef.current = createClientId();
      const input: RecordExpenseInput = {
        ...form,
        pemasokId: supplier?.id ?? null,
        sourceType,
        allocations: cashoutRequired
          ? Object.entries(accountAllocations)
            .map(([akunKeuanganId, amount]) => ({ akunKeuanganId, amount: Number(amount) }))
            .filter((item) => Number.isFinite(item.amount) && item.amount > 0)
          : undefined,
      };
      return cashoutRequired
        ? recordExpenseWithFinanceCashout(context.data.usahaId, input, { idempotencyKey: commandRef.current, requestId: createClientId() })
        : recordExpense(context.data.usahaId, input, { idempotencyKey: commandRef.current, requestId: createClientId() });
    },
    onMutate: () => { setMode("processing"); setFeedback(""); },
    onSuccess: async (data) => {
      setResult({ id: data.pengeluaran_id ?? "", number: data.nomor_pengeluaran ?? "Pengeluaran baru" });
      setMode("success");
      commandRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: async (error) => {
      if (!context.data || !commandRef.current) { setMode("unknown"); return; }
      try {
        const reconciliation = cashoutRequired
          ? await reconcileExpenseCashoutCommand(context.data.usahaId, commandRef.current)
          : await reconcileExpenseCommand(context.data.usahaId, commandRef.current);
        if (reconciliation.state === "committed" && reconciliation.response) {
          setResult({ id: reconciliation.response.pengeluaran_id ?? "", number: reconciliation.response.nomor_pengeluaran ?? "Pengeluaran baru" });
          setMode("success");
          commandRef.current = null;
          return;
        }
      } catch {
        // Keep unknown outcome. No blind retry.
      }
      setFeedback(error instanceof Error ? error.message : "Status pengeluaran belum dapat dipastikan. Sistem sedang memeriksa kembali status pencatatan.");
      setMode("unknown");
    },
  });

  if (mode === "processing") return <FinanceStateScreen icon={Wrench} tone="warning" title="Memproses Pengeluaran" description="Sistem sedang mencatat pengeluaran dan transaksi keuangan. Jangan kirim tindakan yang sama lagi." primary={<div className="space-y-3 text-left">{["Validasi data", "Menyimpan pengeluaran", "Membuat transaksi keuangan", "Finalisasi"].map((x, i) => <div key={x} className="flex items-center gap-3 text-sm"><span className="grid size-7 place-items-center rounded-full border bg-card text-muted-foreground">{i < 2 ? <Check className="size-3.5 text-emerald-600" /> : <span className="size-2 rounded-full bg-muted-foreground/30" />}</span><span>{x}</span></div>)}</div>} />;
  if (mode === "success") return <FinanceStateScreen icon={Check} tone="success" title="Pengeluaran Berhasil Dicatat" description="Pengeluaran dan transaksi keuangan telah tercatat. Source domain tetap mempertahankan ownership-nya." primary={<Button className="h-12 rounded-xl" onClick={() => result?.id ? navigate(paths.keuangan + "/pengeluaran/" + result.id) : navigate(paths.keuangan + "/pengeluaran")}>Lihat Detail Pengeluaran <ArrowRight /></Button>} secondary={<Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate(paths.keuangan + "/pengeluaran")}>Kembali ke Pengeluaran</Button>} />;
  if (mode === "unknown") return <FinanceStateScreen icon={CircleAlert} tone="warning" title="Status Transaksi Belum Dapat Dipastikan" description={feedback || "Sistem sedang memeriksa kembali status pencatatan."} primary={<Button className="h-12 rounded-xl" onClick={() => { setMode("form"); setStep(3); }}>Cek Status</Button>} secondary={<Button variant="outline" className="h-12 rounded-xl" onClick={() => { setMode("form"); setStep(3); }}>Kembali ke Tinjauan</Button>} />;
  if (context.isPending) return <FinanceShell title="Catat Pengeluaran"><Card><CardContent className="min-h-72 animate-pulse" /></Card></FinanceShell>;
  if (context.error) return <FinanceShell title="Catat Pengeluaran"><Alert variant="destructive"><AlertTitle>Finance belum siap</AlertTitle><AlertDescription>{context.error.message}</AlertDescription></Alert></FinanceShell>;

  return <FinanceShell title="Catat Pengeluaran" subtitle="Catat pengeluaran tanpa mengambil alih pengelolaan Pembelian, Perawatan, atau Pemasok." action={<Link to={paths.keuangan + "/pengeluaran"} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />Kembali</Link>}>
    <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="grid grid-cols-3">{["Sumber", "Detail", "Konfirmasi"].map((label, i) => { const value=(i+1) as 1|2|3; return <div key={label} className="relative text-center">{i<2 ? <span className="absolute left-1/2 top-3 h-px w-full bg-border" /> : null}<span className={value<=step ? "relative z-10 mx-auto grid size-7 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold" : "relative z-10 mx-auto grid size-7 place-items-center rounded-full border bg-card text-muted-foreground text-xs font-semibold"}>{value<step ? <Check className="size-3.5" /> : value}</span><p className={value<=step ? "mt-2 text-[11px] font-semibold" : "mt-2 text-[11px] text-muted-foreground"}>{label}</p></div>; })}</div></div>

    {step===1 ? <div className="space-y-4">
      <section><h2 className="text-base font-semibold">Jenis Sumber Pengeluaran</h2><p className="mt-1 text-xs text-muted-foreground">Pengeluaran dari Pembelian dan Perawatan memerlukan sumber. Operasional, Lainnya, dan Manual tidak memerlukannya.</p></section>
      <div className="grid gap-2">{sourceTypes.map(([key,label,desc]) => { const Icon=key==="purchase"?Truck:key==="maintenance"?Wrench:key==="operational"?Building2:key==="other"?ReceiptText:FileText; return <button key={key} type="button" onClick={() => { setSourceType(key); setSourceSearch(""); setAccountAllocations({}); setForm((c)=>({...c,sourceType:key,sourceId:null})); }} className={sourceType===key ? "flex items-center gap-3 rounded-2xl border border-primary bg-primary/[0.035] p-4 text-left ring-1 ring-primary/20" : "flex items-center gap-3 rounded-2xl border bg-card p-4 text-left hover:bg-muted/40"}><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5"/></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{desc}</p></div>{sourceType===key ? <Check className="size-4 text-primary"/> : null}</button>; })}</div>
      {(sourceType==="purchase"||sourceType==="maintenance") ? <><Card className="shadow-sm"><CardContent className="space-y-3 p-4">
        <div><p className="text-xs font-semibold">Pilih sumber {sourceType==="purchase" ? "Pembelian" : "Perawatan"}</p><p className="mt-1 text-[11px] text-muted-foreground">Pilih dari data yang sudah tercatat. Anda tidak perlu memasukkan ID teknis.</p></div>
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={sourceSearch} onChange={(e)=>setSourceSearch(e.target.value)} placeholder={sourceType==="purchase" ? "Cari nomor pembelian atau pemasok…" : "Cari kode unit, jenis, atau pelaksana…"} className="h-11 rounded-xl pl-9"/></div>
        {sourceType==="purchase" ? <div className="grid gap-2">
          {(purchases.data?.purchases ?? []).map((item)=> <button key={item.pembelian_id} type="button" onClick={()=>setForm((c)=>({...c,sourceId:item.pembelian_id}))} className={form.sourceId===item.pembelian_id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left ring-1 ring-primary/20" : "rounded-xl border p-3 text-left hover:bg-muted/40"}>
            <p className="text-sm font-semibold">{item.nomor_pembelian}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.pemasok_nama ?? "Pemasok tidak tercatat"} · {item.tanggal_pembelian}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{item.line_count} item · {item.status}</p>
          </button>)}
          {!purchases.isPending && (purchases.data?.purchases ?? []).length===0 ? <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Pembelian tidak ditemukan.</p> : null}
        </div> : <div className="grid gap-2">
          {(maintenances.data ?? []).map((item)=> <button key={item.perawatan_id} type="button" onClick={()=>setForm((c)=>({...c,sourceId:item.perawatan_id}))} className={form.sourceId===item.perawatan_id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left ring-1 ring-primary/20" : "rounded-xl border p-3 text-left hover:bg-muted/40"}>
            <p className="text-sm font-semibold">{item.kode_unit} · {item.barang_nama ?? "Barang"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{semanticMaintenanceLabel(item.jenis_perawatan)} · {semanticMaintenanceLabel(item.status)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{item.pelaksana ?? "Pelaksana belum dicatat"}</p>
          </button>)}
          {!maintenances.isPending && (maintenances.data ?? []).length===0 ? <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Perawatan tidak ditemukan.</p> : null}
        </div>}
      </CardContent></Card>
      <Card className="shadow-sm"><CardContent className="space-y-3 p-4"><label className="text-xs font-semibold">Pemasok <span className="font-normal text-muted-foreground">(opsional)</span></label><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={supplierSearch} onChange={(e)=>setSupplierSearch(e.target.value)} placeholder="Cari pemasok…" className="h-11 rounded-xl pl-9"/></div><div className="grid gap-2">{(suppliers.data??[]).slice(0,5).map((item)=> <button key={item.id} type="button" onClick={()=>setSupplier(item)} className={supplier?.id===item.id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left text-sm font-semibold" : "rounded-xl border p-3 text-left text-sm hover:bg-muted/40"}>{item.name}</button>)}</div>{supplier ? <p className="text-xs text-primary">Pemasok dipilih: {supplier.name}</p> : null}</CardContent></Card></> : null}
      <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={!(!sourceRequiresId || Boolean(form.sourceId))} onClick={()=>setStep(2)}>Lanjutkan <ArrowRight/></Button></StickyFinanceAction>
    </div> : null}

    {step===2 ? <div className="space-y-4">
      <section><h2 className="text-base font-semibold">Detail Pengeluaran</h2><p className="mt-1 text-xs text-muted-foreground">Nominal, tanggal, deskripsi, bukti, dan catatan.</p></section>
      <Card className="shadow-sm"><CardContent className="space-y-4 p-4"><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-category">Kategori Biaya</label><Input id="expense-category" value={form.kategoriBiaya} onChange={(e)=>setForm((c)=>({...c,kategoriBiaya:e.target.value}))} className="h-12 rounded-xl" placeholder="Operasional"/></div><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-description">Deskripsi</label><Input id="expense-description" value={form.deskripsi} onChange={(e)=>setForm((c)=>({...c,deskripsi:e.target.value}))} className="h-12 rounded-xl" placeholder="Uang digunakan untuk apa?" /></div><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-amount">Nominal</label><div className="flex items-center rounded-xl border px-3"><span className="text-sm font-semibold text-muted-foreground">Rp</span><Input id="expense-amount" type="number" min="1" value={form.amount||""} onChange={(e)=>setForm((c)=>({...c,amount:Number(e.target.value)}))} className="h-12 border-0 text-right text-lg font-bold shadow-none focus-visible:ring-0"/></div></div><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-date">Tanggal Pengeluaran</label><Input id="expense-date" type="date" value={form.tanggalPengeluaran??""} onChange={(e)=>setForm((c)=>({...c,tanggalPengeluaran:e.target.value}))} className="h-12 rounded-xl"/></div><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-evidence">Bukti</label><Button type="button" variant="outline" className="h-12 w-full justify-between rounded-xl"><span>{form.buktiStoragePath ? "Bukti tersedia" : "Unggah Bukti"}</span><FileText className="size-4"/></Button><p className="text-[11px] text-muted-foreground">Bukti disimpan sebagai data internal. Lokasi penyimpanan tidak ditampilkan sebagai informasi utama.</p></div><div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="expense-note">Catatan</label><Input id="expense-note" value={form.catatan??""} onChange={(e)=>setForm((c)=>({...c,catatan:e.target.value}))} className="h-12 rounded-xl" placeholder="Catatan tambahan (opsional)"/></div></CardContent></Card>
      <div className="flex gap-2"><Button variant="ghost" className="h-11" onClick={()=>setStep(1)}>Sebelumnya</Button><Button className="h-11 flex-1 rounded-xl" disabled={!detailReady} onClick={()=>setStep(3)}>Lanjutkan <ArrowRight/></Button></div>
      <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={!detailReady} onClick={()=>setStep(3)}>Lanjutkan <ArrowRight/></Button></StickyFinanceAction>
    </div> : null}

    {step===3 ? <div className="space-y-4">
      <section><h2 className="text-base font-semibold">Tinjauan Pengeluaran</h2><p className="mt-1 text-xs text-muted-foreground">Pastikan sumber dan nominal benar sebelum dicatat.</p></section>
      <Card className="shadow-sm"><CardContent className="space-y-4 p-4">{sourceRequiresId && form.sourceId ? <SourcePreview type={sourceType==="purchase"?"Pembelian":"Perawatan"} number={form.sourceId} meta="Hubungan Sumber" /> : null}<div className="grid gap-3 rounded-2xl bg-muted/40 p-4 sm:grid-cols-2"><ReviewRow label="Jenis Sumber" value={sourceTypes.find(([key])=>key===sourceType)?.[1]??sourceType}/><ReviewRow label="Kategori" value={form.kategoriBiaya}/><ReviewRow label="Tanggal" value={form.tanggalPengeluaran??"-"}/><ReviewRow label="Pemasok" value={supplier?.name??"Tidak ditautkan"}/></div><AmountDisplay amount={form.amount} label="Total Pengeluaran" direction="expense"/><div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Deskripsi</p><p className="mt-1 text-sm font-medium">{form.deskripsi}</p></div></CardContent></Card>
      <Alert className="border-primary/10 bg-primary/[0.03]"><ShieldCheck className="size-4"/><AlertTitle>Pengeluaran → Transaksi Keuangan</AlertTitle><AlertDescription>Pengeluaran akan dicatat sebagai fakta Keuangan. Pembelian/Perawatan tetap menjadi sumber pengeluaran, bukan pembayaran.</AlertDescription></Alert>
      {cashoutRequired && financeAccounts.error ? <Alert variant="destructive"><CircleAlert className="size-4"/><AlertTitle>Akun uang belum dapat dimuat</AlertTitle><AlertDescription>{financeAccounts.error instanceof Error ? financeAccounts.error.message : "Saldo akun uang belum dapat diverifikasi."}</AlertDescription></Alert> : null}
      {cashoutRequired ? <FinanceCashout
        accounts={financeAccounts.data?.accounts ?? []}
        amount={Number(form.amount) || 0}
        allocations={accountAllocations}
        onAllocationsChange={setAccountAllocations}
        onProceed={() => mutation.mutate()}
        disabled={!confirmReady || !capabilities.mutation || financeAccounts.isPending || Boolean(financeAccounts.error)}
        isPending={mutation.isPending}
        setupHref={paths.keuangan + "/akun"}
      /> : <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={!confirmReady || mutation.isPending || !capabilities.mutation} onClick={()=>mutation.mutate()}>{mutation.isPending?"Mencatat Pengeluaran…":"Catat Pengeluaran"} <Check/></Button></StickyFinanceAction>}
    </div> : null}
  </FinanceShell>;
}

type RecordPaymentSource = "purchase" | "maintenance" | "operational" | "other" | "manual";
function ReviewRow({label,value}:{label:string;value:string}){return <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;}
function StickyFinanceAction({children}:{children:React.ReactNode}){return <div className="sticky bottom-3 z-30 rounded-2xl border bg-background/95 p-2 shadow-[0_14px_44px_rgba(20,40,30,.16)] backdrop-blur-md lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">{children}</div>;}
ExpenseCreate.displayName = "ExpenseCreate";
