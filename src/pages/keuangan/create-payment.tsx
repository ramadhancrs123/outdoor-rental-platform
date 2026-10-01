import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Search, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getFinanceCapabilities,
  getKeuanganContext,
  recordPayment,
  reconcilePaymentCommand,
  searchFinanceSources,
  type FinanceSourceOption,
  type RecordPaymentInput,
} from "@/features/keuangan";
import { paths } from "@/routes/paths";
import { AmountDisplay, FinanceShell, FinanceStateScreen, SourcePreview } from "@/components/keuangan/finance-ui";

type Step = 1 | 2 | 3;
type Mode = "form" | "processing" | "success" | "conflict" | "unknown";

const paymentKinds: Array<[RecordPaymentInput["jenis"], string]> = [
  ["dp", "DP"],
  ["pelunasan", "Pelunasan"],
  ["pembayaran_tambahan", "Pembayaran Tambahan"],
];

const methods: Array<[RecordPaymentInput["metode"], string]> = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank Transfer"],
  ["qris_manual", "QRIS Manual"],
  ["other", "Lainnya"],
];

export function PaymentCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("form");
  const [sourceType, setSourceType] = useState<"reservation" | "rental">("reservation");
  const [sourceSearch, setSourceSearch] = useState("");
  const [selected, setSelected] = useState<FinanceSourceOption | null>(null);
  const [form, setForm] = useState<RecordPaymentInput>({ jenis: "dp", metode: "bank_transfer", amount: 0, dibayarAt: null, referenceText: "", catatan: "" });
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const commandRef = useRef<string | null>(null);

  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const sources = useQuery({
    queryKey: ["keuangan", "payment-sources", context.data?.usahaId, sourceType, sourceSearch],
    queryFn: () => searchFinanceSources(context.data!.usahaId, sourceType, sourceSearch),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });
  const capabilities = getFinanceCapabilities();

  const canContinueSource = Boolean(selected);
  const canContinueDetail = Number(form.amount) > 0 && Boolean(form.dibayarAt) && Boolean(selected);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !selected) throw new Error("Sumber pembayaran belum dipilih.");
      if (!commandRef.current) commandRef.current = crypto.randomUUID();
      return recordPayment(context.data.usahaId, {
        ...form,
        reservasiId: sourceType === "reservation" ? selected.id : null,
        penyewaanId: sourceType === "rental" ? selected.id : null,
        amount: Number(form.amount),
      }, { idempotencyKey: commandRef.current, requestId: crypto.randomUUID() });
    },
    onMutate: () => { setFeedback(""); setMode("processing"); },
    onSuccess: async (data) => {
      setResult({ id: data.pembayaran_id ?? "", number: data.nomor_pembayaran ?? "Pembayaran baru" });
      setMode("success");
      commandRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: async (error) => {
      if (!context.data || !commandRef.current) { setMode("unknown"); return; }
      try {
        const reconciliation = await reconcilePaymentCommand(context.data.usahaId, commandRef.current);
        if (reconciliation.state === "committed" && reconciliation.response) {
          setResult({ id: reconciliation.response.pembayaran_id ?? "", number: reconciliation.response.nomor_pembayaran ?? "Pembayaran baru" });
          setMode("success");
          commandRef.current = null;
          return;
        }
        if (reconciliation.state === "not_found") {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (message.includes("source") || message.includes("reservasi") || message.includes("penyewaan") || message.includes("available")) {
            setFeedback("Sumber tidak dapat digunakan untuk pencatatan pembayaran. Pilih sumber lain yang masih valid.");
            setMode("conflict");
            commandRef.current = null;
            return;
          }
        }
      } catch {
        // Keep unknown outcome state. Never blind retry.
      }
      setFeedback("Permintaan telah dikirim, namun hasil transaksi belum dapat dipastikan. Sistem akan membaca kembali data sumber sebelum ada pengiriman ulang.");
      setMode("unknown");
    },
  });

  if (mode === "processing") {
    return <FinanceStateScreen icon={Clock3} tone="warning" title="Memproses Pembayaran" description="Mohon jangan menutup halaman ini. Sistem sedang mencatat pembayaran dan transaksi keuangan." primary={<div className="space-y-3 text-left">{["Validasi data", "Menyimpan pembayaran", "Membuat transaksi keuangan", "Finalisasi"].map((label, index) => <div key={label} className="flex items-center gap-3 text-sm"><span className={index < 2 ? "grid size-7 place-items-center rounded-full bg-emerald-50 text-emerald-700" : "grid size-7 place-items-center rounded-full border bg-card text-muted-foreground"}>{index < 2 ? <Check className="size-3.5" /> : <span className="size-2 rounded-full bg-muted-foreground/30" />}</span><span>{label}</span></div>)}</div>} />;
  }

  if (mode === "success") {
    return <FinanceStateScreen icon={Check} tone="success" title="Pembayaran Berhasil Dicatat" description="Pembayaran telah dicatat dan transaksi keuangan dibuat. Status domain lain tetap mengikuti owner masing-masing." primary={<Button className="h-12 rounded-xl" onClick={() => result?.id ? navigate(paths.keuangan + "/pembayaran/" + result.id) : navigate(paths.keuangan + "/pembayaran")}>Lihat Detail Pembayaran <ArrowRight /></Button>} secondary={<Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate(paths.keuangan + "/pembayaran")}>Kembali ke Pembayaran</Button>} />;
  }

  if (mode === "conflict") {
    return <FinanceStateScreen icon={CircleAlert} tone="danger" title="Sumber Tidak Dapat Digunakan" description={feedback || "Sumber yang dipilih tidak dapat digunakan untuk pencatatan pembayaran. Pilih sumber lain atau periksa kembali status sumber."} primary={<Button className="h-12 rounded-xl" onClick={() => { setMode("form"); setStep(1); setSelected(null); }}>Pilih Sumber Lain</Button>} secondary={<Button variant="outline" className="h-12 rounded-xl" onClick={() => setMode("form")}>Kembali</Button>} />;
  }

  if (mode === "unknown") {
    return <FinanceStateScreen icon={CircleAlert} tone="warning" title="Status Transaksi Belum Dapat Dipastikan" description={feedback || "Sistem sedang memeriksa kembali status pencatatan."} primary={<Button className="h-12 rounded-xl" onClick={() => { setMode("form"); setStep(3); }}>Cek Status</Button>} secondary={<Button variant="outline" className="h-12 rounded-xl" onClick={() => { setMode("form"); setStep(3); }}>Kembali ke Tinjauan</Button>} />;
  }

  if (context.isPending) return <FinanceShell title="Catat Pembayaran"><Card><CardContent className="min-h-72 animate-pulse" /></Card></FinanceShell>;
  if (context.error) return <FinanceShell title="Catat Pembayaran"><Alert variant="destructive"><AlertTitle>Finance belum siap</AlertTitle><AlertDescription>{context.error.message}</AlertDescription></Alert></FinanceShell>;

  return (
    <FinanceShell
      title="Catat Pembayaran"
      subtitle={<>Pencatatan fakta pembayaran. <strong className="font-semibold text-foreground">DP</strong> bukan Deposit.</>}
      action={<Link to={paths.keuangan + "/pembayaran"} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Kembali</Link>}
    >
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-3">
          {[["Sumber", 1], ["Detail", 2], ["Konfirmasi", 3]].map(([label, rawValue], index) => { const value = Number(rawValue); return <div key={String(label)} className="relative text-center">{index < 2 ? <span className={value < step ? "absolute left-1/2 top-3 h-px w-full bg-primary" : "absolute left-1/2 top-3 h-px w-full bg-border"} /> : null}<span className={value === step || value < step ? "relative z-10 mx-auto grid size-7 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-sm" : "relative z-10 mx-auto grid size-7 place-items-center rounded-full border bg-card text-muted-foreground text-xs font-semibold"}>{value < step ? <Check className="size-3.5" /> : value}</span><p className={value <= step ? "mt-2 text-[11px] font-semibold" : "mt-2 text-[11px] text-muted-foreground"}>{String(label)}</p></div>; })}
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <section className="space-y-1"><h2 className="text-base font-semibold">Pilih Sumber Pembayaran</h2><p className="text-xs text-muted-foreground">Pembayaran harus terkait tepat satu sumber: Reservasi atau Penyewaan.</p></section>
          <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-card p-1.5 shadow-sm">
            {(["reservation", "rental"] as const).map((type) => <button key={type} type="button" onClick={() => { setSourceType(type); setSelected(null); }} className={cn("min-h-11 rounded-xl px-4 text-sm font-semibold", sourceType === type ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}>{type === "reservation" ? "Reservasi" : "Penyewaan"}</button>)}
          </div>
          <Card className="shadow-sm"><CardContent className="space-y-3 p-4"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder={"Cari nomor " + (sourceType === "reservation" ? "reservasi" : "penyewaan") + "…"} className="h-11 pl-9" /></div><div className="grid gap-2">{(sources.data ?? []).map((source) => <button key={source.id} type="button" onClick={() => setSelected(source)} className={cn("w-full rounded-2xl border p-3 text-left transition", selected?.id === source.id ? "border-primary bg-primary/[0.035] ring-1 ring-primary/20" : "hover:bg-muted/40")}><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">{sourceType === "reservation" ? <CalendarIcon /> : <UserRound className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{source.number}</p><p className="text-xs text-muted-foreground">{source.renterName ?? "Penyewa tidak tersedia"}</p><p className="mt-1 text-[11px] text-muted-foreground">{source.period ?? source.meta}</p></div><ArrowRight className="size-4 text-muted-foreground" /></div></button>)}{sources.isPending ? <p className="py-6 text-center text-xs text-muted-foreground">Mencari sumber…</p> : null}{!sources.isPending && sources.data?.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Tidak ada source yang cocok.</p> : null}</div></CardContent></Card>
          {selected ? <SourcePreview type={selected.type === "reservation" ? "Reservasi" : "Penyewaan"} number={selected.number} renter={selected.renterName} period={selected.period} meta={selected.meta} /> : null}
          <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={!canContinueSource} onClick={() => setStep(2)}>Lanjutkan <ArrowRight /></Button></StickyFinanceAction>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <section className="space-y-1"><h2 className="text-base font-semibold">Detail Pembayaran</h2><p className="text-xs text-muted-foreground">Masukkan data pembayaran yang akan dicatat.</p></section>
          {selected ? <SourcePreview type={selected.type === "reservation" ? "Reservasi" : "Penyewaan"} number={selected.number} renter={selected.renterName} period={selected.period} meta={selected.meta} /> : null}
          <Card className="shadow-sm"><CardContent className="space-y-4 p-4">
            <FieldSelect label="Jenis Pembayaran" value={form.jenis} options={paymentKinds} onChange={(v) => setForm((c) => ({ ...c, jenis: v as RecordPaymentInput["jenis"] }))} />
            <FieldSelect label="Metode Pembayaran" value={form.metode} options={methods} onChange={(v) => setForm((c) => ({ ...c, metode: v as RecordPaymentInput["metode"] }))} />
            <div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="finance-payment-amount">Nominal Pembayaran</label><div className="flex items-center rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring/60"><span className="text-sm font-semibold text-muted-foreground">Rp</span><Input id="finance-payment-amount" type="number" min="1" value={form.amount || ""} onChange={(e) => setForm((c) => ({ ...c, amount: Number(e.target.value) }))} className="h-12 border-0 shadow-none text-right text-lg font-bold focus-visible:ring-0" placeholder="150.000" /></div></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="finance-payment-date">Waktu Pembayaran</label><Input id="finance-payment-date" type="datetime-local" value={form.dibayarAt ?? ""} onChange={(e) => setForm((c) => ({ ...c, dibayarAt: e.target.value || null }))} className="h-12 rounded-xl" /></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="finance-payment-ref">Reference <span className="font-normal text-muted-foreground">(opsional)</span></label><Input id="finance-payment-ref" value={form.referenceText ?? ""} onChange={(e) => setForm((c) => ({ ...c, referenceText: e.target.value }))} placeholder="TRF-982736" className="h-12 rounded-xl" /></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold" htmlFor="finance-payment-note">Catatan <span className="font-normal text-muted-foreground">(opsional)</span></label><Input id="finance-payment-note" value={form.catatan ?? ""} onChange={(e) => setForm((c) => ({ ...c, catatan: e.target.value }))} placeholder="Pembayaran sesuai kesepakatan." className="h-12 rounded-xl" /></div>
          </CardContent></Card>
          <div className="flex gap-2"><Button variant="ghost" className="h-11" onClick={() => setStep(1)}>Sebelumnya</Button><Button className="h-11 flex-1 rounded-xl" disabled={!canContinueDetail} onClick={() => setStep(3)}>Lanjutkan <ArrowRight /></Button></div>
          <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={!canContinueDetail} onClick={() => setStep(3)}>Lanjutkan <ArrowRight /></Button></StickyFinanceAction>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <section className="space-y-1"><h2 className="text-base font-semibold">Tinjauan Pembayaran</h2><p className="text-xs text-muted-foreground">Periksa data sebelum menyimpan.</p></section>
          <Card className="shadow-sm"><CardContent className="space-y-4 p-4">{selected ? <SourcePreview type={selected.type === "reservation" ? "Reservasi" : "Penyewaan"} number={selected.number} renter={selected.renterName} period={selected.period} meta={selected.meta} /> : null}<div className="grid gap-3 rounded-2xl bg-muted/40 p-4 sm:grid-cols-2"><ReviewRow label="Jenis Pembayaran" value={paymentKinds.find(([key]) => key === form.jenis)?.[1] ?? form.jenis} /><ReviewRow label="Metode" value={methods.find(([key]) => key === form.metode)?.[1] ?? form.metode} /><ReviewRow label="Waktu Pembayaran" value={form.dibayarAt ?? "-"} /><ReviewRow label="Reference" value={form.referenceText || "-"} /></div><SeparatorLine /><AmountDisplay amount={form.amount} label="Total Pembayaran" /></CardContent></Card>
          <Alert className="border-primary/10 bg-primary/[0.03]"><ShieldCheck className="size-4" /><AlertTitle>Pembayaran → Transaksi Keuangan</AlertTitle><AlertDescription>Pencatatan pembayaran akan menyimpan pembayaran dan transaksi keuangan. Status Reservasi atau Penyewaan tetap dikelola pada menu masing-masing.</AlertDescription></Alert>
          <StickyFinanceAction><Button className="h-12 w-full rounded-xl" disabled={mutation.isPending || !capabilities.mutation} onClick={() => mutation.mutate()}>{mutation.isPending ? "Mencatat Pembayaran…" : "Catat Pembayaran"} <Check /></Button></StickyFinanceAction>
        </div>
      ) : null}

      <div className="flex items-center justify-center gap-2 pt-4 text-[10px] text-muted-foreground"><ShieldCheck className="size-3.5" />Untuk Usaha aktif</div>
    </FinanceShell>
  );
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><label className="text-xs font-semibold">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full rounded-xl border bg-card px-3 text-sm font-medium">{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function SeparatorLine() { return <div className="h-px bg-border" />; }
function StickyFinanceAction({ children }: { children: React.ReactNode }) { return <div className="sticky bottom-3 z-30 rounded-2xl border bg-background/95 p-2 shadow-[0_14px_44px_rgba(20,40,30,.16)] backdrop-blur-md lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">{children}</div>; }
function CalendarIcon() { return <span className="text-sm" aria-hidden="true">◫</span>; }

PaymentCreate.displayName = "PaymentCreate";
