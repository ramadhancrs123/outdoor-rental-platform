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
  registerInventoryUnit,
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
  tanggalDiperoleh: new Date().toISOString().slice(0, 10),
  sumberPembelianDetailId: null,
  catatanInternal: "",
};

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
  const [reconciling, setReconciling] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

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
  const readyToReview = Boolean(
    context.data?.usahaId &&
    form.barangId &&
    form.kodeUnit.trim() &&
    capabilities.mutation,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!commandRef.current) commandRef.current = createClientId();
      return registerInventoryUnit(context.data.usahaId, form, {
        idempotencyKey: commandRef.current,
        requestId: createClientId(),
      });
    },
    onMutate: () => {
      setMode("processing");
      setFeedback("");
    },
    onSuccess: async (result) => {
      setCreatedId(result.unit_barang_id);
      commandRef.current = null;
      setMode("success");
      await queryClient.invalidateQueries({ queryKey: ["inventaris"] });
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
        "register_inventory_unit",
        commandRef.current,
      );
      if (result.state === "committed" && result.response) {
        setCreatedId(result.response.unit_barang_id);
        commandRef.current = null;
        setFeedback("");
        setMode("success");
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
              <h1 className="text-2xl font-bold tracking-tight">Unit berhasil didaftarkan</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Unit telah masuk sebagai physical truth dan berstatus <strong>Siap Disewakan</strong> berdasarkan konfirmasi admin saat pendaftaran.
              </p>
            </div>
            <div className="w-full max-w-md rounded-2xl border bg-muted/20 p-4 text-left">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Barang</p><p className="mt-1 font-semibold">{selectedProduct?.nama ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Kode Unit</p><p className="mt-1 font-semibold">{form.kodeUnit || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Lokasi</p><p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Belum ditentukan"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="secondary" className="mt-1 rounded-full">Siap Disewakan</Badge></div>
              </div>
            </div>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              Pemeriksaan terstruktur dilakukan setelah unit kembali dari penyewaan. Bila ada kebutuhan perawatan, admin dapat meneruskannya ke modul Perawatan.
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
            Registrasikan benda fisik yang sudah diperiksa manual sebelum masuk Inventaris. Setelah sukses, unit masuk sebagai Siap Disewakan.
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
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, barangId: value, varianBarangId: null }))
                  }
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
                  onValueChange={(value) => update("varianBarangId", value === "none" ? null : value)}
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

              <div className={formStep === 1 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-code" className="text-xs font-semibold">Kode unit</label>
                <Input
                  id="inventory-code"
                  value={form.kodeUnit}
                  onChange={(event) => update("kodeUnit", event.target.value)}
                  placeholder="Contoh: TD4P-001"
                  className="h-11 rounded-xl"
                  autoComplete="off"
                />
              </div>

              <div className={formStep === 1 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-serial" className="text-xs font-semibold">
                  Serial number <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  id="inventory-serial"
                  value={form.serialNumber ?? ""}
                  onChange={(event) => update("serialNumber", event.target.value)}
                  placeholder="Nomor seri produsen"
                  className="h-11 rounded-xl"
                  autoComplete="off"
                />
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
                <div>
                  <p className="text-xs font-semibold">Pembelian terkait <span className="font-normal text-muted-foreground">(opsional)</span></p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Pilih pembelian dan rincian barang yang menjadi asal unit. Anda tidak perlu memasukkan ID teknis.</p>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Cari nomor pembelian atau pemasok…" className="h-11 rounded-xl pl-9" />
                </div>
                <div className="grid gap-2">
                  {(purchases.data?.purchases ?? []).map((purchase) => (
                    <button key={purchase.pembelian_id} type="button" onClick={() => { setSelectedPurchaseId(purchase.pembelian_id); update("sumberPembelianDetailId", null); }} className={selectedPurchaseId === purchase.pembelian_id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left ring-1 ring-primary/20" : "rounded-xl border p-3 text-left hover:bg-muted/40"}>
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
                        <button key={line.detail_pembelian_id} type="button" onClick={() => update("sumberPembelianDetailId", line.detail_pembelian_id)} className={form.sumberPembelianDetailId === line.detail_pembelian_id ? "rounded-lg border border-primary bg-background p-3 text-left ring-1 ring-primary/20" : "rounded-lg border bg-background p-3 text-left hover:bg-muted"}>
                          <p className="text-sm font-medium">{line.barang_nama ?? line.deskripsi ?? "Barang pembelian"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{line.varian_nama ?? "Tanpa varian"} · {line.jumlah} unit</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
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
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Kode unit</p>
                  <p className="mt-1 font-semibold">{form.kodeUnit}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Serial</p>
                  <p className="mt-1 font-semibold">{form.serialNumber || "Belum dicatat"}</p>
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
              <Button className="h-12 rounded-xl" onClick={() => setMode("review")}>
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
              disabled={mutation.isPending || !capabilities.mutation}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Mendaftarkan Unit…" : "Daftarkan Unit"}
              <PackagePlus />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
