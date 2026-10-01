import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  getPemasokContext,
  getProcurementCapabilities,
  getPurchaseForEdit,
  listActiveSuppliers,
  reconcileProcurementMutation,
  listPurchaseCatalogOptions,
  listPurchaseVariantOptions,
  createPurchaseDraft,
  updatePurchaseDraft,
  type CreatePurchaseDraftInput,
  type PurchaseDraftLineInput,
  type ProcurementMutationState,
  type PurchaseDetail,
} from "@/features/pemasok";
import { ProcurementCommandState, ProcurementSteps } from "@/components/pemasok/procurement-ui";
import { formatPurchaseMoney } from "@/features/pemasok";
import { paths } from "@/routes/paths";

const emptyLine = (): PurchaseDraftLineInput => ({ barangId: "", varianBarangId: null, deskripsi: "", jumlah: "1", unitPrice: "0" });
const emptyForm: CreatePurchaseDraftInput = {
  pemasokId: null,
  nomorPembelian: "",
  tanggalPembelian: new Date().toISOString().slice(0, 10),
  lines: [emptyLine()],
  catatan: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Draft pembelian gagal disimpan.";
}

export function PurchaseCreate() {
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);

  const [mode, setMode] = useState<ProcurementMutationState>("idle");
  const [form, setForm] = useState<CreatePurchaseDraftInput>(emptyForm);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [savedPurchaseId, setSavedPurchaseId] = useState<string | null>(editing ? id ?? null : null);

  const context = useQuery({ queryKey: ["pembelian", "context"], queryFn: getPemasokContext, staleTime: 60_000 });
  const purchase = useQuery({
    queryKey: ["pembelian", "edit", context.data?.usahaId, id],
    queryFn: () => getPurchaseForEdit(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 30_000,
    retry: false,
  });
  const suppliers = useQuery({
    queryKey: ["pembelian", "supplier-options", context.data?.usahaId],
    queryFn: () => listActiveSuppliers(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });
  const catalog = useQuery({
    queryKey: ["pembelian", "catalog-options", context.data?.usahaId],
    queryFn: () => listPurchaseCatalogOptions(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });
  const variants = useQuery({
    queryKey: ["pembelian", "variant-options", context.data?.usahaId],
    queryFn: () => listPurchaseVariantOptions(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const capabilities = getProcurementCapabilities();

  useEffect(() => {
    if (!purchase.data || expectedUpdatedAt !== "") return;
    setExpectedUpdatedAt(purchase.data.updated_at);
    setForm(fromDetail(purchase.data));
  }, [purchase.data, expectedUpdatedAt]);

  const totalPreview = useMemo(
    () => (form.lines ?? []).reduce((sum, line) => sum + Number(line.jumlah || 0) * Number(line.unitPrice || 0), 0),
    [form.lines],
  );

  const ready = Boolean(
    form.nomorPembelian.trim() &&
    form.tanggalPembelian &&
    (form.lines ?? []).length > 0 &&
    (form.lines ?? []).every((line) => line.barangId || line.varianBarangId) &&
    (form.lines ?? []).every((line) => Number(line.jumlah) > 0 && Number(line.unitPrice) >= 0),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Usaha belum siap.");
      commandRef.current ??= crypto.randomUUID();
      setFeedback("");
      if (editing) {
        return updatePurchaseDraft(
          context.data.usahaId,
          id!,
          { ...form, expectedUpdatedAt },
          { idempotencyKey: commandRef.current, requestId: crypto.randomUUID() },
        );
      }
      return createPurchaseDraft(
        context.data.usahaId,
        form,
        { idempotencyKey: commandRef.current, requestId: crypto.randomUUID() },
      );
    },
    onMutate: () => setMode("processing"),
    onSuccess: async (result) => {
      setSavedPurchaseId(result.pembelian_id);
      setExpectedUpdatedAt(result.updated_at);
      commandRef.current = null;
      setMode("success");
      await queryClient.invalidateQueries({ queryKey: ["pembelian"] });
    },
    onError: (error) => {
      const message = errorMessage(error);
      setFeedback(message);
      if (message.startsWith("UNKNOWN_OUTCOME:")) setMode("unknown");
      else if (message.startsWith("STALE_DATA:")) setMode("stale");
      else setMode("error");
    },
  });

  const updateLine = (index: number, patch: Partial<PurchaseDraftLineInput>) => {
    setForm((current) => ({
      ...current,
      lines: (current.lines ?? []).map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    }));
  };

  const addLine = () => setForm((current) => ({ ...current, lines: [...(current.lines ?? []), emptyLine()] }));
  const removeLine = (index: number) => setForm((current) => ({
    ...current,
    lines: (current.lines ?? []).filter((_, lineIndex) => lineIndex !== index),
  }));

  const reconcile = async () => {
    if (!context.data?.usahaId || !commandRef.current) return;
    try {
      const result = await reconcileProcurementMutation(
        context.data.usahaId,
        editing ? "update_purchase_draft" : "create_purchase",
        commandRef.current,
      );
      if (result.state === "committed" && result.response && "pembelian_id" in result.response) {
        setSavedPurchaseId(result.response.pembelian_id);
        commandRef.current = null;
        setMode("success");
      } else if (result.state === "not_found") {
        commandRef.current = null;
        setFeedback("Perubahan belum ditemukan. Status terbaru dapat diperiksa sebelum mencoba kembali.");
        setMode("idle");
      } else {
        setFeedback("Hasil tindakan belum dapat dipastikan. Jangan kirim tindakan yang sama lagi.");
      }
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  };

  const reloadLatest = async () => {
    if (!editing) {
      setMode("idle");
      setFeedback("Periksa kembali data sebelum menyimpan.");
      return;
    }
    await purchase.refetch();
    setExpectedUpdatedAt("");
    setFeedback("");
    setMode("idle");
  };

  if (context.isPending || (editing && purchase.isPending)) {
    return <div className="space-y-4"><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-96 animate-pulse rounded-2xl bg-muted" /></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pembelian belum siap</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  if (editing && (purchase.error || !purchase.data)) {
    return <Alert variant="destructive"><AlertTitle>Draft pembelian tidak dapat dibuka</AlertTitle><AlertDescription>{errorMessage(purchase.error ?? new Error("Pembelian tidak ditemukan."))}</AlertDescription></Alert>;
  }

  if (mode === "processing") {
    return <ProcurementCommandState state="processing" title="Menyimpan Draft Pembelian..." message="Server sedang memvalidasi supplier, katalog, jumlah, harga, total, tenant, idempotency, dan audit." />;
  }

  if (mode === "success") {
    return (
      <div className="mx-auto w-full max-w-md space-y-2 pb-10">
        <ProcurementCommandState
          state="success"
          title={editing ? "Draft Pembelian Berhasil Diperbarui" : "Draft Pembelian Dibuat"}
          message="Draft pembelian telah disimpan. Draft ini belum berarti barang sudah diterima, masuk inventaris, atau dibayar."
        />
        <Card className="rounded-2xl">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Nomor</span><span className="font-semibold">{form.nomorPembelian}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Total preview</span><span className="font-bold">{formatPurchaseMoney(totalPreview, "IDR")}</span></div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2 pt-2">
          <Button className="h-12 rounded-xl" onClick={() => savedPurchaseId ? navigate(paths.pembelian + "/" + savedPurchaseId) : navigate(paths.pembelian)}>Lihat Detail Pembelian <ArrowRight /></Button>
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate(paths.pembelian)}>Buat Draft Baru</Button>
        </div>
      </div>
    );
  }

  const lineStep = mode === "review" ? 3 : 1;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-24 lg:pb-10">
      <header className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke pembelian"><Link to={paths.pembelian}><ArrowLeft /></Link></Button>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Pembelian</p>
          <h1 className="text-[22px] font-bold tracking-tight">{editing ? "Ubah Draf Pembelian" : "Buat Draft Pembelian"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{context.data.usahaNama}</p>
        </div>
      </header>

      <ProcurementSteps current={mode === "review" ? 2 : lineStep === 1 ? 1 : 2} labels={["Isi", "Tinjau", "Simpan"]} />

      {mode === "unknown" || mode === "stale" || mode === "error" ? (
        <ProcurementCommandState
          state={mode}
          message={feedback}
          onRetry={mode === "stale" ? reloadLatest : () => setMode("idle")}
          onReconcile={mode === "unknown" ? reconcile : undefined}
        />
      ) : null}

      {mode === "review" ? (
        <Review
          form={form}
          totalPreview={totalPreview}
          suppliers={suppliers.data ?? []}
          catalog={catalog.data ?? []}
          variants={variants.data ?? []}
          onBack={() => setMode("idle")}
          onCommit={() => mutation.mutate()}
          busy={mutation.isPending}
          mutationEnabled={capabilities.mutation}
        />
      ) : (
        <>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Informasi Pembelian</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="purchase-supplier" className="text-sm font-medium">Pemasok <span className="text-destructive">*</span></label>
                <Select value={form.pemasokId ?? ""} onValueChange={(value) => setForm((current) => ({ ...current, pemasokId: value || null }))}>
                  <SelectTrigger id="purchase-supplier" className="h-11 rounded-xl"><SelectValue placeholder="Pilih pemasok aktif" /></SelectTrigger>
                  <SelectContent>
                    {(suppliers.data ?? []).map((supplier) => <SelectItem key={supplier.pemasok_id} value={supplier.pemasok_id}>{supplier.nama}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(suppliers.data ?? []).length === 0 ? (
                  <div className="rounded-xl border border-dashed p-3 text-sm">
                    <p className="font-medium">Belum ada pemasok aktif.</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Buat master pemasok terlebih dahulu. Setelah disimpan sebagai aktif, pemasok akan muncul di pilihan pembelian.</p>
                    <Button asChild variant="outline" size="sm" className="mt-3 rounded-xl"><Link to={paths.pemasok + "/create"}><Plus />Tambah Pemasok</Link></Button>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium" htmlFor="purchase-number">Nomor Pembelian <span className="text-destructive">*</span><Input id="purchase-number" value={form.nomorPembelian} onChange={(event) => setForm((current) => ({ ...current, nomorPembelian: event.target.value }))} className="h-11 rounded-xl" placeholder="PB-2026-004" /></label>
                <label className="grid gap-2 text-sm font-medium" htmlFor="purchase-date">Tanggal Pembelian <span className="text-destructive">*</span><Input id="purchase-date" type="date" value={form.tanggalPembelian} onChange={(event) => setForm((current) => ({ ...current, tanggalPembelian: event.target.value }))} className="h-11 rounded-xl" /></label>
              </div>

              <label className="grid gap-2 text-sm font-medium" htmlFor="purchase-note">Catatan (Opsional)<Textarea id="purchase-note" value={form.catatan ?? ""} onChange={(event) => setForm((current) => ({ ...current, catatan: event.target.value }))} rows={4} className="rounded-xl" placeholder="Catatan pembelian..." /></label>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div><CardTitle className="text-base">Item Pembelian</CardTitle><p className="text-sm text-muted-foreground">Tambahkan barang atau varian yang dibeli.</p></div>
              <Button type="button" variant="outline" className="rounded-xl" onClick={addLine}><Plus />Tambah Item</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {(form.lines ?? []).map((line, index) => {
                const availableVariants = (variants.data ?? []).filter((variant) => variant.barang_id === line.barangId);
                const selectedProduct = (catalog.data ?? []).find((item) => item.barang_id === line.barangId);
                const subtotal = Number(line.jumlah || 0) * Number(line.unitPrice || 0);

                return (
                  <Card key={index} className="rounded-2xl border shadow-none">
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Item {index + 1}</p>
                        <Button type="button" size="icon" variant="ghost" className="rounded-xl text-destructive" disabled={(form.lines ?? []).length === 1} onClick={() => removeLine(index)} aria-label={"Hapus item " + (index + 1)}><Trash2 /></Button>
                      </div>

                      <label className="grid gap-2 text-sm font-medium">Barang <span className="text-destructive">*</span>
                        <Select value={line.barangId ?? ""} onValueChange={(value) => updateLine(index, { barangId: value, varianBarangId: null })}>
                          <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih barang" /></SelectTrigger>
                          <SelectContent>{(catalog.data ?? []).map((item) => <SelectItem key={item.barang_id} value={item.barang_id}>{item.nama}</SelectItem>)}</SelectContent>
                        </Select>
                        {!selectedProduct && line.barangId ? <span className="text-xs text-destructive">Barang tidak lagi tersedia.</span> : null}
                      </label>

                      <label className="grid gap-2 text-sm font-medium">Varian
                        <Select value={line.varianBarangId ?? "none"} onValueChange={(value) => updateLine(index, { varianBarangId: value === "none" ? null : value })} disabled={!line.barangId}>
                          <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder={line.barangId ? "Pilih varian bila ada" : "Pilih barang dulu"} /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Tanpa Varian</SelectItem>{availableVariants.map((variant) => <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>{variant.nama}</SelectItem>)}</SelectContent>
                        </Select>
                      </label>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-2 text-sm font-medium">Jumlah <span className="text-destructive">*</span>
                          <div className="flex items-center rounded-xl border bg-background">
                            <button type="button" className="grid h-11 w-10 place-items-center text-muted-foreground" onClick={() => updateLine(index, { jumlah: String(Math.max(1, Number(line.jumlah || 1) - 1)) })} aria-label="Kurangi jumlah">−</button>
                            <Input value={line.jumlah} onChange={(event) => updateLine(index, { jumlah: event.target.value })} className="h-11 border-x text-center" inputMode="decimal" />
                            <button type="button" className="grid h-11 w-10 place-items-center text-muted-foreground" onClick={() => updateLine(index, { jumlah: String(Number(line.jumlah || 0) + 1) })} aria-label="Tambah jumlah">+</button>
                          </div>
                        </label>
                        <label className="grid gap-2 text-sm font-medium">Harga Beli / Unit <span className="text-destructive">*</span>
                          <div className="flex"><Input type="number" min="0" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} className="h-11 rounded-l-xl rounded-r-none" /><span className="grid min-w-14 place-items-center rounded-r-xl border border-l-0 bg-muted text-xs text-muted-foreground">IDR</span></div>
                        </label>
                      </div>

                      <label className="grid gap-2 text-sm font-medium">Deskripsi (Opsional)<Textarea rows={2} value={line.deskripsi ?? ""} onChange={(event) => updateLine(index, { deskripsi: event.target.value })} className="rounded-xl" placeholder="Deskripsi item..." /></label>

                      <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2.5">
                        <span className="text-xs text-muted-foreground">Subtotal Preview</span>
                        <span className="text-sm font-bold">{formatPurchaseMoney(subtotal, "IDR")}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-end justify-between"><div><p className="text-xs text-muted-foreground">Total (Preview)</p><p className="text-[28px] font-bold tracking-tight">{formatPurchaseMoney(totalPreview, "IDR")}</p></div><p className="text-right text-xs text-muted-foreground">Client preview</p></div>
              <Alert className="border-sky-500/20 bg-sky-50/50"><AlertDescription className="text-xs">Total final akan dikonfirmasi oleh server saat disimpan.</AlertDescription></Alert>
            </CardContent>
          </Card>

          <div className="sticky bottom-2 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur">
            <Button className="h-12 w-full rounded-xl" disabled={!ready || !form.pemasokId} onClick={() => setMode("review")}>Lanjut ke Tinjau <ArrowRight /></Button>
          </div>
        </>
      )}
    </div>
  );
}

function Review({
  form,
  totalPreview,
  suppliers,
  catalog,
  variants,
  onBack,
  onCommit,
  busy,
  mutationEnabled,
}: {
  form: CreatePurchaseDraftInput;
  totalPreview: number;
  suppliers: Array<{ pemasok_id: string; nama: string }>;
  catalog: Array<{ barang_id: string; nama: string }>;
  variants: Array<{ varian_barang_id: string; barang_id: string; nama: string }>;
  onBack: () => void;
  onCommit: () => void;
  busy: boolean;
  mutationEnabled: boolean;
}) {
  const supplierName = suppliers.find((supplier) => supplier.pemasok_id === form.pemasokId)?.nama ?? "Tidak ditautkan";
  return (
    <>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Tinjau Draft Pembelian</CardTitle><p className="text-sm text-muted-foreground">Pastikan data berikut sudah benar.</p></CardHeader>
        <CardContent className="space-y-3">
          <ReviewRow label="Pemasok" value={supplierName} />
          <ReviewRow label="Nomor Pembelian" value={form.nomorPembelian} />
          <ReviewRow label="Tanggal" value={form.tanggalPembelian} />
          <ReviewRow label="Catatan" value={form.catatan || "-"} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Daftar Item</CardTitle><Button variant="outline" size="sm" className="rounded-xl" onClick={onBack}><ChevronDown className="size-4 rotate-90" />Ubah</Button></CardHeader>
        <CardContent className="space-y-2">
          {(form.lines ?? []).map((line, index) => {
            const productName = catalog.find((item) => item.barang_id === line.barangId)?.nama ?? "Barang";
            const variantName = line.varianBarangId
              ? variants.find((variant) => variant.varian_barang_id === line.varianBarangId)?.nama ?? "Varian tidak ditemukan"
              : "Tanpa varian";
            return (
              <div key={index} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-xs font-bold">{index + 1}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{productName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{variantName} · {line.jumlah} × {formatPurchaseMoney(Number(line.unitPrice || 0), "IDR")}</p>
                </div>
                <p className="shrink-0 text-sm font-bold">{formatPurchaseMoney(Number(line.jumlah || 0) * Number(line.unitPrice || 0), "IDR")}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-4"><p className="text-xs text-muted-foreground">Total (Preview)</p><p className="mt-1 text-[28px] font-bold">{formatPurchaseMoney(totalPreview, "IDR")}</p><p className="mt-1 text-xs text-muted-foreground">Total final dihitung dan divalidasi server.</p></CardContent>
      </Card>

      <div className="sticky bottom-2 z-20 flex gap-2 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur">
        <Button variant="outline" className="h-12 flex-1 rounded-xl" onClick={onBack}>Kembali</Button>
        <Button className="h-12 flex-1 rounded-xl" disabled={!mutationEnabled || busy} onClick={onCommit}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Simpan Draft</Button>
      </div>
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 rounded-xl border p-3 sm:grid-cols-[140px_1fr]"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm font-medium">{value}</p></div>;
}

function fromDetail(detail: PurchaseDetail): CreatePurchaseDraftInput {
  return {
    pemasokId: detail.pemasok_id,
    nomorPembelian: detail.nomor_pembelian,
    tanggalPembelian: detail.tanggal_pembelian,
    catatan: detail.catatan ?? "",
    lines: detail.lines.map((line) => ({
      barangId: line.barang_id,
      varianBarangId: line.varian_barang_id,
      deskripsi: line.deskripsi,
      jumlah: String(line.jumlah),
      unitPrice: String(line.unit_price),
    })),
  };
}
