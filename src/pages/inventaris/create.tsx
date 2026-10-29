import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, PackagePlus, Search, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  UnknownOutcomeNotice,
} from "@/components/inventaris/inventory-ui";
import {
  getInventarisContext,
  getInventoryStateCapabilities,
  listInventoryLocations,
  listInventoryProducts,
  listInventoryVariants,
  reconcileInventoryCommand,
  registerInventoryUnits,
  type InventoryCommandResult,
  type RegisterInventoryUnitInput,
} from "@/features/inventaris";
import { getPurchase, listPurchases } from "@/features/pemasok";
import { paths } from "@/routes/paths";

type CreateMode = "form" | "review" | "processing" | "success" | "error" | "unknown";
type CreateFormStep = 1 | 2;

const initialForm: RegisterInventoryUnitInput = {
  barangId: "",
  varianBarangId: null,
  kodeUnit: "",
  serialNumber: "",
  lokasiId: null,
  tanggalDiperoleh: getLocalDateInputValue(),
  sumberPembelianDetailId: null,
  catatanInternal: "",
};

function getLocalDateInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function stepState(mode: CreateMode, formStep: CreateFormStep) {
  if (mode === "form") return formStep;
  return 3;
}

export function InventoryCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);
  const [form, setForm] = useState<RegisterInventoryUnitInput>(initialForm);
  const [mode, setMode] = useState<CreateMode>("form");
  const [formStep, setFormStep] = useState<CreateFormStep>(1);
  const [feedback, setFeedback] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdUnits, setCreatedUnits] = useState<InventoryCommandResult[]>([]);
  const [reconciling, setReconciling] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"manual" | "purchase">("manual");
  const [jumlahUnit, setJumlahUnit] = useState("1");

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: getInventarisContext,
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["inventaris", "products", context.data?.usahaId],
    queryFn: () => listInventoryProducts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const variants = useQuery({
    queryKey: ["inventaris", "variants", context.data?.usahaId],
    queryFn: () => listInventoryVariants(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const locations = useQuery({
    queryKey: ["inventaris", "locations", context.data?.usahaId],
    queryFn: () => listInventoryLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const purchases = useQuery({
    queryKey: ["inventaris", "purchase-sources", context.data?.usahaId, purchaseSearch],
    queryFn: () => listPurchases(context.data!.usahaId, { search: purchaseSearch, status: "all", page: 1, pageSize: 20 }),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });
  const selectedPurchase = useQuery({
    queryKey: ["inventaris", "purchase-source", context.data?.usahaId, selectedPurchaseId],
    queryFn: () => getPurchase(context.data!.usahaId, selectedPurchaseId!),
    enabled: Boolean(context.data?.usahaId && selectedPurchaseId),
    staleTime: 30_000,
  });

  const capabilities = getInventoryStateCapabilities();
  const selectedProduct = (products.data ?? []).find((product) => product.barang_id === form.barangId);
  const selectedVariant = (variants.data ?? []).find((variant) => variant.varian_barang_id === form.varianBarangId);
  const selectedLocation = (locations.data ?? []).find((location) => location.lokasi_id === form.lokasiId);
  const selectedVariants = (variants.data ?? []).filter((variant) => variant.barang_id === form.barangId);
  const selectedPurchaseLine = selectedPurchase.data?.lines.find(
    (line) => line.detail_pembelian_id === form.sumberPembelianDetailId,
  );
  const selectedPurchaseRegistered = Number(selectedPurchaseLine?.registered_unit_count ?? 0);
  const selectedPurchaseRemaining = Number(selectedPurchaseLine?.remaining_unit_count ?? 0);
  const jumlahUnitValue = Number(jumlahUnit);
  const validJumlahUnit = Number.isInteger(jumlahUnitValue) && jumlahUnitValue >= 1 && jumlahUnitValue <= 250;
  const quantityExceedsPurchaseReference = Boolean(
    sourceMode === "purchase" &&
    selectedPurchaseLine &&
    (selectedPurchaseLine.quantity_needs_review || jumlahUnitValue > selectedPurchaseRemaining),
  );
  const readyToReview = Boolean(
    context.data?.usahaId &&
    form.barangId &&
    validJumlahUnit &&
    (sourceMode === "manual" || Boolean(form.sumberPembelianDetailId)) &&
    capabilities.mutation,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!commandRef.current) commandRef.current = createClientId();
      return registerInventoryUnits(context.data.usahaId, {
        barangId: form.barangId,
        varianBarangId: form.varianBarangId,
        lokasiId: form.lokasiId,
        tanggalDiperoleh: form.tanggalDiperoleh,
        sumberPembelianDetailId: sourceMode === "purchase" ? form.sumberPembelianDetailId : null,
        catatanInternal: form.catatanInternal,
      }, jumlahUnitValue, {
        idempotencyKey: commandRef.current,
        requestId: createClientId(),
      });
    },
    onMutate: () => {
      setMode("processing");
      setFeedback("");
    },
    onSuccess: async (result) => {
      const units = result.units ?? [];
      setCreatedUnits(units);
      setCreatedId(units[0]?.unit_barang_id ?? null);
      setForm((current) => ({ ...current, kodeUnit: units[0]?.kode_unit ?? current.kodeUnit }));
      commandRef.current = null;
      setMode("success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris", "purchase-source"] }),
        queryClient.invalidateQueries({ queryKey: ["pembelian"] }),
      ]);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Pendaftaran unit gagal.";
      setFeedback(message);
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setMode("unknown");
      } else {
        commandRef.current = null;
        setMode("error");
      }
    },
  });

  const update = <K extends keyof RegisterInventoryUnitInput>(
    key: K,
    value: RegisterInventoryUnitInput[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const reconcile = async () => {
    if (!context.data?.usahaId || !commandRef.current) return;
    setReconciling(true);
    try {
      const result = await reconcileInventoryCommand(
        context.data.usahaId,
        "register_inventory_units",
        commandRef.current,
      );
      if (result.state === "committed" && result.response && "units" in result.response) {
        const units = result.response.units ?? [];
        setCreatedUnits(units);
        setCreatedId(units[0]?.unit_barang_id ?? null);
        setForm((current) => ({ ...current, kodeUnit: units[0]?.kode_unit ?? current.kodeUnit }));
        commandRef.current = null;
        setFeedback("");
        setMode("success");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
          queryClient.invalidateQueries({ queryKey: ["inventaris", "purchase-source"] }),
          queryClient.invalidateQueries({ queryKey: ["pembelian"] }),
        ]);
      } else if (result.state === "not_found") {
        commandRef.current = null;
        setFeedback("Hasil pendaftaran tidak ditemukan. Periksa data terbaru sebelum mencoba lagi.");
        setMode("form");
      } else {
        setFeedback("Hasil tindakan belum dapat dipastikan. Jangan kirim tindakan yang sama lagi.");
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Pemeriksaan status tindakan gagal.");
    } finally {
      setReconciling(false);
    }
  };

  if (context.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
        <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Inventaris belum siap</AlertTitle>
        <AlertDescription>{context.error?.message ?? "Konteks Usaha belum tersedia."}</AlertDescription>
      </Alert>
    );
  }

  if (mode === "processing") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={paths.inventaris} className="hover:underline">Inventaris</Link>
          <span>/</span>
          <span>Daftarkan Unit</span>
        </div>
        <Card className="shadow-sm">
          <CardContent className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <PackagePlus className="size-7" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Mendaftarkan Unit</h1>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Tindakan dikirim sebagai transaksi sistem. Jangan kirim tindakan yang sama lagi selama hasil belum jelas.
              </p>
            </div>
            <div className="grid w-full gap-2 text-left text-sm">
              {[
                "Validasi tenant dan katalog",
                "Membuat unit physical truth",
                "Menyimpan riwayat + audit + outbox",
                "Finalisasi idempotency",
              ].map((step) => (
                <div key={step} className="flex items-center gap-3 rounded-xl border p-3">
                  <Check className="size-4 text-primary" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "success") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 pb-10">
        <Card className="overflow-hidden shadow-sm">
          <CardContent className="flex min-h-[28rem] flex-col items-center justify-center gap-5 p-8 text-center sm:p-10">
            <div className="grid size-20 place-items-center rounded-full bg-primary/10 ring-8 ring-primary/[0.04] text-primary">
              <Check className="size-10" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{createdUnits.length > 1 ? createdUnits.length + " unit berhasil didaftarkan" : "Unit berhasil didaftarkan"}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {createdUnits.length} unit fisik telah masuk inventaris. Kode unit dibuat otomatis dan unik oleh sistem.
              </p>
            </div>
            <div className="w-full max-w-md rounded-2xl border bg-muted/20 p-4 text-left">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Barang</p><p className="mt-1 font-semibold">{selectedProduct?.nama ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Jumlah unit</p><p className="mt-1 font-semibold">{createdUnits.length} unit</p></div>
                <div><p className="text-xs text-muted-foreground">Kode unit pertama</p><p className="mt-1 font-semibold">{(createdUnits[0]?.kode_unit ?? form.kodeUnit) || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Lokasi</p><p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Belum ditentukan"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="secondary" className="mt-1 rounded-full">Siap Disewakan</Badge></div>
              </div>
            </div>
            {createdUnits.length > 0 ? (
              <div className="w-full max-w-md rounded-xl border p-3 text-left">
                <p className="text-xs font-semibold text-muted-foreground">Kode unit otomatis</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {createdUnits.slice(0, 8).map((unit) => (
                    <Badge key={unit.unit_barang_id} variant="outline" className="rounded-md font-mono">{unit.kode_unit ?? unit.unit_barang_id.slice(0, 8)}</Badge>
                  ))}
                  {createdUnits.length > 8 ? <Badge variant="secondary" className="rounded-md">+{createdUnits.length - 8} lainnya</Badge> : null}
                </div>
              </div>
            ) : null}
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              Serial number produsen tidak dibuat secara artifisial. Bila tersedia pada barang fisik, nomor tersebut dapat dicatat di detail unit. Pemeriksaan terstruktur tetap dilakukan setelah pengembalian.
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button className="h-11 min-w-44 rounded-xl" onClick={() => createdId && navigate(paths.inventaris + "/" + createdId)}>Lihat Detail Unit</Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => navigate(paths.inventaris)}>Kembali ke Inventaris</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "unknown") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <UnknownOutcomeNotice
          message={feedback}
          onReconcile={() => void reconcile()}
          busy={reconciling}
        />
        <Button variant="ghost" className="rounded-xl" onClick={() => navigate(paths.inventaris)}>
          Keluar tanpa retry
        </Button>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Pendaftaran unit belum berhasil</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button className="rounded-xl" onClick={() => setMode("review")}>
            Kembali ke Tinjauan
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => navigate(paths.inventaris)}>
            Kembali
          </Button>
        </div>
      </div>
    );
  }

  const currentStep = stepState(mode, formStep);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-24 sm:space-y-5">
      <header className="space-y-2">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.inventaris}><ArrowLeft />Kembali ke Inventaris</Link>
        </Button>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{context.data.usahaNama}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Daftarkan Unit</h1>
            <Badge variant="secondary" className="rounded-full">Aman digunakan</Badge>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Daftarkan satu atau beberapa unit fisik sekaligus. Kode unit dibuat otomatis untuk setiap unit; pembelian hanya menjadi referensi opsional.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2" aria-label="Tahap pendaftaran unit">
        {["Identitas", "Lokasi", "Tinjauan"].map((label, index) => {
          const step = index + 1;
          const active = step === currentStep;
          const complete = step < currentStep;
          return (
            <div key={label} className="space-y-1">
              <div className={`h-1.5 rounded-full ${complete || active ? "bg-primary" : "bg-muted"}`} />
              <p className={`text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {step}. {label}
              </p>
            </div>
          );
        })}
      </div>

      {products.error || variants.error || locations.error ? (
        <Alert variant="destructive">
          <AlertTitle>Referensi Inventaris belum lengkap</AlertTitle>
          <AlertDescription>
            Produk, varian, atau lokasi tidak dapat dimuat. Periksa koneksi dan segarkan sebelum melanjutkan.
          </AlertDescription>
        </Alert>
      ) : null}

      {mode === "form" ? (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{formStep === 1 ? "Identitas fisik" : "Lokasi & perolehan"}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formStep === 1
                  ? "Tentukan barang dan identitas unit yang akan diregistrasikan."
                  : "Lengkapi konteks penyimpanan dan asal unit sebelum review."}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className={formStep === 1 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-product" className="text-xs font-semibold">Barang</label>
                <Select
                  value={form.barangId}
                  onValueChange={(value) => {
                    setSourceMode("manual");
                    setSelectedPurchaseId(null);
                    setJumlahUnit("1");
                    setForm((current) => ({ ...current, barangId: value, varianBarangId: null, sumberPembelianDetailId: null }));
                  }}
                >
                  <SelectTrigger id="inventory-product" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="Pilih barang" />
                  </SelectTrigger>
                  <SelectContent>
                    {(products.data ?? []).map((product) => (
                      <SelectItem key={product.barang_id} value={product.barang_id}>{product.nama}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={formStep === 1 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-variant" className="text-xs font-semibold">
                  Varian <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Select
                  value={form.varianBarangId ?? "none"}
                  onValueChange={(value) => {
                    setSourceMode("manual");
                    setSelectedPurchaseId(null);
                    setJumlahUnit("1");
                    setForm((current) => ({ ...current, varianBarangId: value === "none" ? null : value, sumberPembelianDetailId: null }));
                  }}
                  disabled={!form.barangId}
                >
                  <SelectTrigger id="inventory-variant" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder={form.barangId ? "Tanpa varian" : "Pilih barang dulu"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa varian</SelectItem>
                    {selectedVariants.map((variant) => (
                      <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>
                        {variant.nama}{variant.kode_internal ? " · " + variant.kode_internal : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={formStep === 1 ? "space-y-3 sm:col-span-2" : "hidden"}>
                <div className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <PackagePlus className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Identitas unit dibuat otomatis</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Kode unit akan dibuat sistem berdasarkan kategori + barang dan nomor urut Usaha saat pendaftaran disimpan.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl bg-background/80 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Kode unit</p>
                    <p className="mt-0.5 text-sm font-semibold text-primary">Otomatis saat disimpan</p>
                  </div>
                </div>

                <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                  <p className="text-xs font-semibold">Serial number produsen</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Tidak dibuat secara artifisial oleh sistem. Bila unit memiliki serial number fisik, data dapat dilengkapi kemudian pada detail unit.
                  </p>
                </div>
              </div>

              <div className={formStep === 2 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-location" className="text-xs font-semibold">
                  Lokasi awal <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Select
                  value={form.lokasiId ?? "none"}
                  onValueChange={(value) => update("lokasiId", value === "none" ? null : value)}
                >
                  <SelectTrigger id="inventory-location" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="Belum ditentukan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Belum ditentukan</SelectItem>
                    {(locations.data ?? [])
                      .filter((location) => location.status === "active")
                      .map((location) => (
                        <SelectItem key={location.lokasi_id} value={location.lokasi_id}>
                          {location.nama}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={formStep === 2 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-acquired" className="text-xs font-semibold">
                  Tanggal diperoleh <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  id="inventory-acquired"
                  type="date"
                  value={form.tanggalDiperoleh ?? ""}
                  onChange={(event) => update("tanggalDiperoleh", event.target.value || null)}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-source-mode" className="text-xs font-semibold">Asal unit</label>
                <Select
                  value={sourceMode}
                  onValueChange={(value) => {
                    setSourceMode(value === "purchase" ? "purchase" : "manual");
                    setSelectedPurchaseId(null);
                    setPurchaseSearch("");
                    setJumlahUnit("1");
                    update("sumberPembelianDetailId", null);
                  }}
                >
                  <SelectTrigger id="inventory-source-mode" className="h-11 rounded-xl">
                    <SelectValue placeholder="Pilih asal unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Bukan dari pembelian / input manual</SelectItem>
                    <SelectItem value="purchase">Berasal dari pembelian</SelectItem>
                  </SelectContent>
                </Select>
                {sourceMode === "purchase" ? (
                  <div className="space-y-3 rounded-xl border p-3">
                    <div>
                      <p className="text-xs font-semibold">Pilih pembelian</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Jumlah akan terisi otomatis dari jumlah yang belum terhubung ke inventaris. Jumlah tetap dapat disesuaikan bila kondisi fisik berbeda.</p>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Cari nomor pembelian atau pemasok…" className="h-11 rounded-xl pl-9" />
                    </div>
                    <div className="grid gap-2">
                      {(purchases.data?.purchases ?? []).map((purchase) => (
                        <button key={purchase.pembelian_id} type="button" onClick={() => { setSelectedPurchaseId(purchase.pembelian_id); setJumlahUnit("1"); update("sumberPembelianDetailId", null); }} className={selectedPurchaseId === purchase.pembelian_id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left ring-1 ring-primary/20" : "rounded-xl border p-3 text-left hover:bg-muted/40"}>
                          <p className="text-sm font-semibold">{purchase.nomor_pembelian}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{purchase.pemasok_nama ?? "Pemasok tidak tercatat"} · {purchase.tanggal_pembelian}</p>
                        </button>
                      ))}
                      {!purchases.isPending && (purchases.data?.purchases ?? []).length === 0 ? <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Pembelian tidak ditemukan.</p> : null}
                    </div>
                    {selectedPurchase.data ? (
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="text-xs font-semibold">Pilih rincian barang</p>
                        <div className="mt-2 grid gap-2">
                          {selectedPurchase.data.lines.map((line) => (
                            <button
                              key={line.detail_pembelian_id}
                              type="button"
                              onClick={() => {
                                const remaining = Math.max(0, Math.floor(Number(line.jumlah) || 0) - Number(line.registered_unit_count ?? 0));
                                setJumlahUnit(String(remaining));
                                setForm((current) => ({
                                  ...current,
                                  barangId: line.barang_id ?? "",
                                  varianBarangId: line.varian_barang_id,
                                  sumberPembelianDetailId: line.detail_pembelian_id,
                                  tanggalDiperoleh: selectedPurchase.data?.tanggal_pembelian ?? current.tanggalDiperoleh,
                                }));
                              }}
                              className={form.sumberPembelianDetailId === line.detail_pembelian_id ? "rounded-lg border border-primary bg-background p-3 text-left ring-1 ring-primary/20" : "rounded-lg border bg-background p-3 text-left hover:bg-muted"}
                            >
                              <p className="text-sm font-medium">{line.barang_nama ?? line.deskripsi ?? "Barang pembelian"}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {line.varian_nama ?? "Tanpa varian"} · catatan {line.jumlah} unit · {line.registered_unit_count ?? 0} terhubung
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {selectedPurchaseLine ? (
                      <Alert className={quantityExceedsPurchaseReference ? "border-amber-300 bg-amber-50/70 text-amber-950" : ""}>
                        <CircleAlert className="size-4" />
                        <AlertTitle>{quantityExceedsPurchaseReference ? "Periksa kesesuaian jumlah" : "Referensi pembelian"}</AlertTitle>
                        <AlertDescription>
                          Catatan pembelian: {selectedPurchaseLine.jumlah} unit; sudah terhubung: {selectedPurchaseRegistered}; sisa acuan: {selectedPurchaseRemaining}.
                          {selectedPurchaseLine.quantity_needs_review
                            ? " Jumlah pada catatan pembelian perlu diperiksa. Pastikan jumlah fisik benar; peringatan ini tidak mengunci pendaftaran."
                            : quantityExceedsPurchaseReference
                              ? " Jumlah di atas sisa catatan. Pastikan barang fisik memang tersedia; peringatan ini tidak mengunci pendaftaran."
                              : " Jumlah awal diisi otomatis berdasarkan sisa catatan pembelian."}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-xl border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                    Untuk barang dari stok awal, hibah, atau sumber lain, pilih mode ini. Tidak perlu membuat pembelian terlebih dahulu.
                  </p>
                )}
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-quantity" className="text-xs font-semibold">Jumlah unit yang didaftarkan</label>
                <Input
                  id="inventory-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={250}
                  step={1}
                  value={jumlahUnit}
                  onChange={(event) => setJumlahUnit(event.target.value)}
                  className="h-11 rounded-xl"
                />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Setiap unit memperoleh ID dan kode unit unik secara otomatis. Maksimal 250 unit per pendaftaran. Serial number produsen tidak dibuat secara palsu; isi di detail unit bila tersedia secara fisik.
                </p>
                {!validJumlahUnit ? <p className="text-xs text-destructive">Masukkan bilangan bulat antara 1 dan 250.</p> : null}
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-note" className="text-xs font-semibold">
                  Catatan internal <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Textarea
                  id="inventory-note"
                  value={form.catatanInternal ?? ""}
                  onChange={(event) => update("catatanInternal", event.target.value)}
                  placeholder="Catatan operasional unit"
                  className="min-h-24 rounded-xl"
                />
              </div>
            </CardContent>
          </Card>

          <Alert className="border-primary/15 bg-primary/[0.03]">
            <ShieldCheck className="size-4" />
            <AlertTitle>Registrasi adalah konfirmasi kelayakan awal</AlertTitle>
            <AlertDescription>
              Sebelum menekan Daftarkan Unit, admin memastikan benda fisik sudah layak digunakan. Sistem tidak membuat acquisition inspection terpisah; Pemeriksaan terstruktur digunakan setelah return.
            </AlertDescription>
          </Alert>
        </>
      ) : (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Tinjauan Pendaftaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Barang</p>
                  <p className="mt-1 font-semibold">{selectedProduct?.nama ?? "—"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Varian</p>
                  <p className="mt-1 font-semibold">{selectedVariant?.nama ?? "Tanpa varian"}</p>
                </div>
                <div className="rounded-2xl border bg-primary/[0.03] p-4">
                  <p className="text-xs text-muted-foreground">Jumlah unit</p>
                  <p className="mt-1 font-semibold text-primary">{jumlahUnit} unit · kode tiap unit otomatis</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Asal unit</p>
                  <p className="mt-1 font-semibold">{sourceMode === "purchase" ? (selectedPurchaseLine ? "Pembelian terkait" : "Pembelian belum dipilih") : "Input manual / non-pembelian"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Serial number</p>
                  <p className="mt-1 font-semibold">Dicatat kemudian bila tersedia</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Lokasi awal</p>
                  <p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Belum ditentukan"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Tanggal diperoleh</p>
                  <p className="mt-1 font-semibold">{form.tanggalDiperoleh || "Belum dicatat"}</p>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-semibold text-muted-foreground">Status setelah berhasil</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-full">Siap Disewakan</Badge>
                  <span className="text-sm text-muted-foreground">Unit siap digunakan berdasarkan konfirmasi admin saat registrasi.</span>
                </div>
              </div>

              {form.catatanInternal ? (
                <div className="rounded-2xl border p-4">
                  <p className="text-xs text-muted-foreground">Catatan internal</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{form.catatanInternal}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      <div className="sticky bottom-3 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur-md">
        {mode === "form" ? (
          formStep === 1 ? (
            <Button
              className="h-12 w-full rounded-xl"
              disabled={!readyToReview || products.isPending || variants.isPending || locations.isPending}
              onClick={() => setFormStep(2)}
            >
              Lanjutkan
              <ArrowRight />
            </Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-12 rounded-xl" onClick={() => setFormStep(1)}>
                Kembali
              </Button>
              <Button className="h-12 rounded-xl" disabled={!readyToReview} onClick={() => setMode("review")}>
                Tinjauan Pendaftaran
                <ArrowRight />
              </Button>
            </div>
          )
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="h-12 rounded-xl"
              onClick={() => {
                setFormStep(2);
                setMode("form");
              }}
            >
              Kembali Edit
            </Button>
            <Button
              className="h-12 rounded-xl"
              disabled={mutation.isPending || !capabilities.mutation || !readyToReview}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Mendaftarkan Unit…" : "Daftarkan " + jumlahUnit + " Unit"}
              <PackagePlus />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
