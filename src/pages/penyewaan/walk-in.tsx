import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createDirectRental,
  getPenyewaanContext,
  previewDirectRentalAvailability,
  reconcileDirectRentalCreation,
} from "@/features/penyewaan";
import {
  createRenter,
  listRenters,
  reconcileRenterCreation,
} from "@/features/penyewa/service";
import { DEFAULT_CATALOG_FILTERS, calculateRentalLineSubtotal, calculateTariffPeriods, formatTariffPeriods, getCatalogProduct, listCatalogProductCovers, listCatalogProducts, listCatalogReadyStock } from "@/features/katalog";
import { isActiveCatalogTariff, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

type CommandState = "idle" | "processing" | "unknown" | "conflict" | "error";

function readCommandMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownOutcome(error: unknown) {
  const message = readCommandMessage(error).toLowerCase();
  return (
    message.includes("unknown_outcome") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("network")
  );
}

function isBusinessConflict(error: unknown) {
  return readCommandMessage(error).toLowerCase().includes("business_conflict");
}

const steps = ["Penyewa", "Periode", "Barang", "Tinjau"];

export function RentalWalkIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const renterIdFromQuery = searchParams.get("renter_id");
  const context = useQuery({
    queryKey: ["penyewaan", "context"],
    queryFn: getPenyewaanContext,
    staleTime: 60_000,
  });

  const [step, setStep] = useState(1);
  const [renterSearch, setRenterSearch] = useState("");
  const [selectedRenterId, setSelectedRenterId] = useState(renterIdFromQuery ?? "");
  const [newRenterOpen, setNewRenterOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [rentalCommandKey, setRentalCommandKey] = useState(() => crypto.randomUUID());
  const [renterCommandKey, setRenterCommandKey] = useState(() => crypto.randomUUID());
  const [rentalCommandState, setRentalCommandState] = useState<CommandState>("idle");

  const renters = useQuery({
    queryKey: ["penyewaan", "walk-in", "renters", context.data?.usahaId, renterSearch],
    queryFn: () =>
      listRenters(
        {
          akunAdminId: context.data!.akunAdminId,
          usahaId: context.data!.usahaId,
          usahaNama: context.data!.usahaNama,
        },
        renterSearch,
        "active",
      ),
    enabled: Boolean(context.data?.usahaId),
  });

  const products = useQuery({
    queryKey: ["penyewaan", "walk-in", "products", context.data?.usahaId],
    queryFn: () =>
      listCatalogProducts(
        context.data!.usahaId,
        DEFAULT_CATALOG_FILTERS,
      ),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });

  const categories = useMemo(() => {
    const byId = new Map<string, { id: string; nama: string }>();
    for (const product of products.data?.products ?? []) {
      if (product.status !== "active" || !product.kategori) continue;
      byId.set(product.kategori.kategori_barang_id, {
        id: product.kategori.kategori_barang_id,
        nama: product.kategori.nama,
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  }, [products.data?.products]);

  const activeProducts = useMemo(
    () =>
      (products.data?.products ?? []).filter(
        (product) =>
          product.status === "active" &&
          (categoryId === "all" || product.kategori_barang_id === categoryId),
      ),
    [categoryId, products.data?.products],
  );

  const productIds = useMemo(
    () => activeProducts.map((product) => product.barang_id),
    [activeProducts],
  );

  const productCovers = useQuery({
    queryKey: ["penyewaan", "walk-in", "product-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogProductCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length),
    staleTime: 60_000,
  });

  const readyStock = useQuery({
    queryKey: ["penyewaan", "walk-in", "ready-stock", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogReadyStock(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length),
    staleTime: 10_000,
  });

  const coverByProduct = useMemo(
    () => new Map((productCovers.data ?? []).map((item) => [item.barang_id, item.url])),
    [productCovers.data],
  );

  const selectedProduct = useMemo(
    () =>
      activeProducts.find((product) => product.barang_id === productId) ?? null,
    [activeProducts, productId],
  );

  const productDetail = useQuery({
    queryKey: ["penyewaan", "walk-in", "product-detail", context.data?.usahaId, productId],
    queryFn: () => getCatalogProduct(context.data!.usahaId, productId),
    enabled: Boolean(context.data?.usahaId && productId),
    staleTime: 60_000,
  });

  const selectedVariant = useMemo(
    () =>
      productDetail.data?.variants.find(
        (variant) => variant.varian_barang_id === variantId,
      ) ?? null,
    [productDetail.data?.variants, variantId],
  );

  const selectedTariff = useMemo(() => {
    const tariffs = productDetail.data?.tariffs ?? [];
    const active = tariffs.filter((tariff) => isActiveCatalogTariff(tariff));
    if (variantId) {
      return (
        active.find((tariff) => tariff.varian_barang_id === variantId) ??
        active.find((tariff) => tariff.barang_id === productId && tariff.varian_barang_id === null) ??
        null
      );
    }
    return active.find((tariff) => tariff.barang_id === productId && tariff.varian_barang_id === null)
      ?? productDetail.data?.active_tariff
      ?? selectedProduct?.active_tariff
      ?? null;
  }, [productDetail.data?.active_tariff, productDetail.data?.tariffs, productId, selectedProduct?.active_tariff, variantId]);

  const billingPeriods = selectedTariff && startAt && endAt
    ? calculateTariffPeriods(startAt, endAt, selectedTariff)
    : 0;
  const requestedQuantity = Number(quantity);
  const estimatedLineSubtotal = selectedTariff && billingPeriods > 0
    ? calculateRentalLineSubtotal(requestedQuantity, Number(selectedTariff.nominal), billingPeriods)
    : 0;
  const selectedReadyStock =
    variantId
      ? readyStock.data?.byVariant[variantId] ?? 0
      : readyStock.data?.byProduct[productId] ?? 0;
  const availability = useQuery({
    queryKey: [
      "penyewaan",
      "walk-in",
      "availability-preview",
      context.data?.usahaId,
      productId,
      variantId,
      requestedQuantity,
    ],
    queryFn: () =>
      previewDirectRentalAvailability(context.data!.usahaId, {
        barangId: productId,
        varianBarangId: variantId || null,
        requestedUnits: requestedQuantity,
      }),
    enabled:
      Boolean(context.data?.usahaId && productId) &&
      Number.isFinite(requestedQuantity) &&
      requestedQuantity > 0,
  });

  const selectedRenter = renters.data?.find(
    (renter) => renter.penyewa_id === selectedRenterId,
  );

  const createRenterMutation = useMutation({
    mutationFn: () =>
      createRenter(
        context.data!.usahaId,
        {
          nama_lengkap: newName,
          nomor_telepon: newPhone,
        },
        {
          idempotencyKey: renterCommandKey,
        },
      ),
    onSuccess: (result) => {
      setSelectedRenterId(result.penyewa_id);
      setNewRenterOpen(false);
      setNewName("");
      setNewPhone("");
      setRenterCommandKey(crypto.randomUUID());
      void renters.refetch();
    },
  });

  const createRentalMutation = useMutation({
    mutationFn: () => {
      if (!selectedRenterId) throw new Error("Pilih penyewa.");
      if (!selectedTariff) throw new Error("Tarif aktif belum tersedia untuk kombinasi barang yang dipilih.");
      const start = new Date(startAt);
      const end = new Date(endAt);
      const qty = Number(quantity);
      if (
        !startAt ||
        !endAt ||
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        end <= start
      ) {
        throw new Error("Jadwal rental harus lengkap dan valid.");
      }
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Jumlah harus lebih dari 0.");

      setRentalCommandState("processing");
      return createDirectRental(
        context.data!.usahaId,
        {
          penyewa_id: selectedRenterId,
          jadwal_mulai: start.toISOString(),
          jadwal_kembali: end.toISOString(),
          catatan: note || null,
          lines: [
            {
              barang_id: selectedProduct?.barang_id ?? null,
              varian_barang_id: variantId || null,
              jumlah: qty,
              unit_price: Number(selectedTariff.nominal),
              currency_code: "IDR",
              tarif_sewa_id: selectedTariff.tarif_sewa_id,
              duration_periods: billingPeriods,
              subtotal: calculateRentalLineSubtotal(qty, Number(selectedTariff.nominal), billingPeriods),
            },
          ],
        },
        {
          idempotencyKey: rentalCommandKey,
        },
      );
    },
    onSuccess: (result) => {
      setRentalCommandState("idle");
      navigate(paths.penyewaan + "/" + result.penyewaan_id);
    },
    onError: (error) => {
      if (isUnknownOutcome(error)) setRentalCommandState("unknown");
      else if (isBusinessConflict(error)) setRentalCommandState("conflict");
      else setRentalCommandState("error");
    },
  });

  const reconcileRenter = async () => {
    if (!context.data) return;
    const result = await reconcileRenterCreation(context.data.usahaId, renterCommandKey);
    if (result.state === "committed" && result.response?.penyewa_id) {
      setSelectedRenterId(result.response.penyewa_id);
      setNewRenterOpen(false);
      setRenterCommandKey(crypto.randomUUID());
      void renters.refetch();
    }
  };

  const reconcileRental = async () => {
    if (!context.data) return;
    const result = await reconcileDirectRentalCreation(context.data.usahaId, rentalCommandKey);
    if (result.state === "committed" && result.response?.penyewaan_id) {
      navigate(paths.penyewaan + "/" + result.response.penyewaan_id);
      return;
    }
    if (result.state === "not_found") {
      setRentalCommandKey(crypto.randomUUID());
      setRentalCommandState("idle");
      return;
    }
    setRentalCommandState("unknown");
  };

  const canMoveFromRenter = Boolean(selectedRenterId);
  const canMoveFromPeriod =
    Boolean(startAt && endAt) &&
    !Number.isNaN(new Date(startAt).getTime()) &&
    !Number.isNaN(new Date(endAt).getTime()) &&
    new Date(endAt) > new Date(startAt);
  const quantityIsValid = Number.isInteger(requestedQuantity) && requestedQuantity > 0;
  const availabilityRefreshing = availability.isPending || availability.isFetching;
  const quantityFitsStock =
    Boolean(availability.data) &&
    requestedQuantity <= (availability.data?.readyPhysicalUnits ?? 0);
  const canMoveFromProduct =
    Boolean(selectedProduct && selectedTariff) &&
    selectedTariff?.currency_code === "IDR" &&
    billingPeriods > 0 &&
    quantityIsValid &&
    !availabilityRefreshing &&
    !availability.isError &&
    quantityFitsStock;

  if (context.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat konteks Usaha…</div>;
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Penyewaan Langsung belum dapat dibuka</AlertTitle>
        <AlertDescription>
          {context.error?.message ?? "Konteks Usaha tidak tersedia."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-28">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.penyewaan}>
            <ArrowLeft /> Kembali
          </Link>
        </Button>
        <Badge variant="outline" className="rounded-full">
          Walk-in
        </Badge>
      </div>

      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Penyewaan</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Buat Penyewaan Langsung
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Buat draf penyewaan langsung tanpa membuat Reservasi. Ketersediaan akhir tetap
          diperiksa oleh sistem saat draf disimpan.
        </p>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="grid grid-cols-4 gap-1.5 p-2.5 sm:gap-2 sm:p-4">
          {steps.map((label, index) => {
            const current = index + 1;
            const active = current === step;
            const done = current < step;
            return (
              <div
                key={label}
                className="min-w-0"
                aria-current={active ? "step" : undefined}
              >
                <div className="flex min-h-16 flex-col items-center justify-center gap-1 text-center sm:min-h-0 sm:flex-row sm:justify-start sm:gap-2">
                  <div
                    className={[
                      "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {done ? <Check className="size-4" /> : current}
                  </div>
                  <div className="min-w-0">
                    <p className={active ? "text-[11px] font-semibold leading-tight sm:text-sm" : "text-[11px] leading-tight text-muted-foreground sm:text-sm"}>
                      {label}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {step === 1 ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Penyewa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedRenter ? (
              <div className="flex items-start justify-between gap-4 rounded-2xl border bg-muted/30 p-4">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Penyewa dipilih</p>
                  <p className="mt-1 font-semibold">{selectedRenter.nama_lengkap}</p>
                  <p className="text-sm text-muted-foreground">{selectedRenter.nomor_telepon}</p>
                </div>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setSelectedRenterId("")}>
                  Ganti
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input
                  value={renterSearch}
                  onChange={(event) => setRenterSearch(event.target.value)}
                  placeholder="Cari nama atau nomor telepon"
                  aria-label="Cari penyewa"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setNewRenterOpen(true)}
                >
                  <UserPlus /> Tambah penyewa
                </Button>
              </div>
            )}

            {!selectedRenterId && renters.isPending ? (
              <div className="grid gap-2 sm:grid-cols-2" aria-label="Memuat daftar penyewa" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border p-4">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="mt-2 h-4 w-1/2" />
                  </div>
                ))}
              </div>
            ) : null}

            {!selectedRenterId && !renters.isPending ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(renters.data ?? []).slice(0, 8).map((renter) => (
                  <button
                    key={renter.penyewa_id}
                    type="button"
                    className="min-h-16 rounded-2xl border p-4 text-left outline-none transition hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelectedRenterId(renter.penyewa_id)}
                  >
                    <p className="font-semibold">{renter.nama_lengkap}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{renter.nomor_telepon}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {!selectedRenterId && !renters.isPending && renters.data?.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {renterSearch.trim() ? "Penyewa tidak ditemukan." : "Belum ada penyewa aktif."}
                </p>
                <p className="mt-1">
                  {renterSearch.trim()
                    ? "Periksa nama atau nomor telepon, atau tambahkan penyewa baru tanpa meninggalkan transaksi."
                    : "Tambahkan penyewa baru untuk melanjutkan transaksi ini."}
                </p>
              </div>
            ) : null}

            {renters.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Daftar penyewa gagal dimuat</AlertTitle>
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{readCommandMessage(renters.error)}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void renters.refetch()}>
                    Muat ulang
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {createRenterMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Pembuatan penyewa belum selesai</AlertTitle>
                <AlertDescription>
                  {isUnknownOutcome(createRenterMutation.error)
                    ? "Hasil tindakan belum pasti. Jangan membuat penyewa kedua sebelum status diperiksa."
                    : readCommandMessage(createRenterMutation.error)}
                  {isUnknownOutcome(createRenterMutation.error) ? (
                    <div className="mt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void reconcileRenter()}>
                        Periksa status penyewa
                      </Button>
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={!canMoveFromRenter} onClick={() => setStep(2)}>
                Lanjut ke periode <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Periode Penyewaan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Mulai</span>
                <Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Kembali</span>
                <Input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-start gap-2 rounded-2xl border bg-muted/30 p-3 text-sm">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">Batas toleransi pengembalian</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {context.data.defaultToleranceHours} jam setelah waktu kembali yang dijadwalkan.
                  </p>
                </div>
              </div>
              {startAt && endAt && canMoveFromPeriod ? (
                <div className="flex items-start gap-2 rounded-2xl border bg-muted/30 p-3 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">Periode valid</p>
                    <p className="mt-0.5 text-muted-foreground">Sistem menghitung periode tarif dari durasi yang dipilih.</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">
                  Isi waktu mulai dan kembali. Waktu kembali harus setelah waktu mulai.
                </div>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(1)}>Kembali</Button>
              <Button disabled={!canMoveFromPeriod} onClick={() => setStep(3)}>
                Lanjut ke barang <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Barang yang disewa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {products.isPending ? (
              <div className="space-y-3" aria-label="Memuat katalog" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                  <Skeleton className="h-24 w-full rounded-2xl" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3">
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                  <div>
                    <p className="text-sm font-medium">Pilih barang</p>
                    <p className="text-xs text-muted-foreground">Pilih barang yang tersedia untuk periode ini.</p>
                  </div>
                  <label className="grid gap-1.5 text-sm font-medium" htmlFor="walkin-category">
                    <span>Kategori</span>
                    <select
                      id="walkin-category"
                      value={categoryId}
                      onChange={(event) => {
                        setCategoryId(event.target.value);
                        setProductId("");
                        setVariantId("");
                      }}
                      className="h-11 w-full rounded-xl border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="all">Semua kategori</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.nama}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {activeProducts.map((product) => {
                    const selected = product.barang_id === productId;
                    const cover = coverByProduct.get(product.barang_id);
                    const stock = readyStock.data?.byProduct[product.barang_id] ?? 0;
                    return (
                      <button
                        key={product.barang_id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setProductId(product.barang_id);
                          setVariantId("");
                        }}
                        className={[
                          "flex min-h-20 items-center gap-3 rounded-2xl border p-3 text-left transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected ? "border-primary bg-primary/[0.03] ring-1 ring-primary/20" : "hover:bg-accent/20",
                        ].join(" ")}
                      >
                        <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-20">
                          {cover ? (
                            <img src={cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full place-items-center text-muted-foreground"><Package className="size-6 sm:size-7" /></div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{product.nama}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.kategori?.nama ?? "Tanpa kategori"}</p>
                            </div>
                            <Badge variant={selected ? "default" : "secondary"} className="shrink-0 rounded-full">
                              {readyStock.isPending ? "…" : `${stock} siap`}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                            {product.ringkasan_publik ?? product.deskripsi ?? "Pilih barang ini."}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {!products.isPending && activeProducts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada barang aktif yang dapat disewakan.</div>
                ) : null}
              </div>

              {products.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Katalog gagal dimuat</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{readCommandMessage(products.error)}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void products.refetch()}>
                      Muat ulang
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {productId && productDetail.isPending ? (
                <div className="space-y-2" aria-label="Memuat varian dan tarif" aria-busy="true">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : null}

              {productId && productDetail.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Detail barang gagal dimuat</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{readCommandMessage(productDetail.error)}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void productDetail.refetch()}>
                      Muat ulang
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {productDetail.data?.variants.some((variant) => variant.status === "active") ? (
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">Pilih varian</p>
                    <p className="text-xs text-muted-foreground">Pilih kartu varian bila barang memiliki pilihan berbeda.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      aria-pressed={variantId === ""}
                      onClick={() => setVariantId("")}
                      className={[
                        "flex items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        variantId === "" ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20" : "hover:bg-accent/20"
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3">
                        <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-16">
                          {coverByProduct.get(productId) ? <img src={coverByProduct.get(productId) ?? ""} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><Package className="size-5" /></div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2"><p className="font-semibold">Barang utama</p><Badge variant={variantId === "" ? "default" : "secondary"} className="rounded-full">{readyStock.data?.byProduct[productId] ?? 0} unit siap</Badge></div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Gunakan stok barang utama.</p>
                        </div>
                      </div>
                    </button>
                    {(productDetail.data?.variants ?? []).filter((variant) => variant.status === "active").map((variant) => {
                      const selected = variant.varian_barang_id === variantId;
                      const stock = readyStock.data?.byVariant[variant.varian_barang_id] ?? 0;
                      return (
                        <button
                          key={variant.varian_barang_id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setVariantId(variant.varian_barang_id)}
                          className={[
                            "flex items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20" : "hover:bg-accent/20"
                          ].join(" ")}
                        >
                          <div className="flex items-start gap-3">
                            <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-16">
                              {coverByProduct.get(productId) ? <img src={coverByProduct.get(productId) ?? ""} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><Package className="size-5" /></div>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2"><p className="font-semibold">{variant.nama}</p><Badge variant={selected ? "default" : "secondary"} className="rounded-full">{readyStock.isPending ? "…" : `${stock} unit siap`}</Badge></div>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{variant.deskripsi ?? variant.kode_internal ?? "Pilihan varian barang."}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Tarif aktif</p>
                  <p className="mt-1 font-semibold">
                    {selectedTariff ? formatCatalogMoney(selectedTariff.nominal, selectedTariff.currency_code) : "Belum tersedia"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedTariff ? formatTariffDuration(selectedTariff) : "Pilih barang dan varian yang memiliki tarif aktif."}
                  </p>
                  {productId ? <p className="mt-2 text-xs font-medium text-muted-foreground">Stok siap saat ini · {readyStock.isPending ? "Memuat…" : `${selectedReadyStock} unit`}</p> : null}
                </div>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Jumlah unit</span>
                  <Input
                    inputMode="numeric"
                    min={1}
                    step={1}
                    type="number"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    aria-label="Jumlah unit"
                  />
                </label>
              </div>
              {quantity && !quantityIsValid ? (
                <Alert variant="destructive">
                  <AlertTitle>Jumlah unit tidak valid</AlertTitle>
                  <AlertDescription>Masukkan jumlah unit berupa bilangan bulat, minimal 1.</AlertDescription>
                </Alert>
              ) : null}

              {productId && availabilityRefreshing ? (
                <div
                  className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"
                  aria-live="polite"
                  aria-busy="true"
                >
                  Memeriksa stok siap terbaru…
                </div>
              ) : null}

              {productId && availability.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Kesiapan fisik belum dapat diperiksa</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{readCommandMessage(availability.error)}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void availability.refetch()}>
                      Periksa lagi
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {productId && availability.data && requestedQuantity > availability.data.readyPhysicalUnits ? (
                <Alert variant="destructive" aria-live="assertive">
                  <CircleAlert className="size-4" />
                  <AlertTitle>Jumlah melebihi unit siap disewakan</AlertTitle>
                  <AlertDescription>
                    Tersedia {availability.data.readyPhysicalUnits} unit Siap Disewakan, tetapi Anda meminta {availability.data.requestedUnits} unit. Kurangi jumlah sebelum melanjutkan.
                  </AlertDescription>
                </Alert>
              ) : null}

              {productId && availability.data && requestedQuantity <= availability.data.readyPhysicalUnits ? (
                <div
                  aria-live="polite"
                  className="flex items-start gap-3 rounded-2xl border bg-emerald-50/50 p-4"
                >
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="font-semibold">
                      {availability.data.readyPhysicalUnits} unit siap disewakan
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Permintaan {availability.data.requestedUnits} unit masih dalam batas stok siap. Ketersediaan pada periode rental tetap diperiksa ulang oleh server saat draft disimpan.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(2)}>Kembali</Button>
              <Button disabled={!canMoveFromProduct} onClick={() => setStep(4)}>
                Lanjut ke review <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Tinjauan Transaksi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Penyewa</p>
                <p className="mt-1 font-semibold">{selectedRenter?.nama_lengkap ?? "—"}</p>
                <p className="text-sm text-muted-foreground">{selectedRenter?.nomor_telepon ?? "—"}</p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Periode</p>
                <p className="mt-1 font-semibold">{startAt || "—"}</p>
                <p className="text-sm text-muted-foreground">→ {endAt || "—"}</p>
              </div>
            </div>

            <div className="rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{selectedProduct?.nama ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{selectedVariant?.nama ?? "Barang utama"}</p>
                </div>
                <Badge variant="secondary" className="rounded-full">{quantity} unit</Badge>
              </div>
              <div className="mt-4 grid gap-2 border-t pt-4 text-sm sm:grid-cols-2">
                <div className="text-muted-foreground">Tarif / periode</div>
                <div className="text-right font-medium">
                  {selectedTariff ? formatCatalogMoney(selectedTariff.nominal, selectedTariff.currency_code) : "—"}
                </div>
                <div className="text-muted-foreground">Durasi ditagihkan</div>
                <div className="text-right font-medium">
                  {selectedTariff && billingPeriods > 0 ? formatTariffPeriods(billingPeriods, selectedTariff) : "—"}
                </div>
                <div className="text-muted-foreground">Jumlah unit</div>
                <div className="text-right font-medium">{requestedQuantity || "—"} unit</div>
                <div className="text-muted-foreground">Total sewa</div>
                <div className="text-right text-lg font-bold">
                  {selectedTariff && billingPeriods > 0
                    ? formatCatalogMoney(estimatedLineSubtotal, selectedTariff.currency_code)
                    : "—"}
                </div>
              </div>
              <div className="rounded-2xl border bg-muted/25 p-3 text-sm">
                <p className="font-medium">Batas toleransi pengembalian</p>
                <p className="mt-1 text-muted-foreground">
                  {context.data.defaultToleranceHours} jam setelah waktu kembali yang dijadwalkan.
                </p>
              </div>
            </div>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Catatan Penyewaan</span>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" />
            </label>

            {rentalCommandState === "conflict" ? (
              <Alert variant="destructive">
                <AlertTitle>Kapasitas atau status penyewaan berubah</AlertTitle>
                <AlertDescription>
                  Sistem menolak tindakan karena kondisi terbaru tidak lagi memenuhi aturan penyewaan.
                  Perbarui pilihan barang / quantity lalu coba lagi.
                </AlertDescription>
              </Alert>
            ) : null}

            {rentalCommandState === "error" && createRentalMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Draf penyewaan belum dibuat</AlertTitle>
                <AlertDescription>{readCommandMessage(createRentalMutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            {rentalCommandState === "unknown" ? (
              <Alert>
                <AlertTitle>Hasil tindakan belum pasti</AlertTitle>
                <AlertDescription>
                  Jangan tekan tombol buat ulang. Periksa dulu apakah draft rental sudah terbentuk.
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void reconcileRental()}
                    >
                      <RefreshCw /> Periksa status tindakan
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <div
              className="sticky bottom-2 z-20 -mx-1 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0"
              style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
            >
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  variant="outline"
                  className="w-full rounded-xl sm:w-auto"
                  disabled={createRentalMutation.isPending}
                  onClick={() => setStep(3)}
                >
                  Kembali
                </Button>
                <Button
                  className="w-full rounded-xl sm:w-auto"
                  disabled={createRentalMutation.isPending || rentalCommandState === "unknown" || !canMoveFromProduct}
                  onClick={() => createRentalMutation.mutate()}
                >
                  {createRentalMutation.isPending || rentalCommandState === "processing" ? (
                    <><Loader2 className="animate-spin" /> Membuat draft…</>
                  ) : (
                    <>Buat Draf Penyewaan <ArrowRight /></>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={newRenterOpen} onOpenChange={setNewRenterOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah penyewa baru</DialogTitle>
            <DialogDescription>
              Penyewa dibuat sebagai identity record terlebih dahulu, lalu otomatis dipilih untuk transaksi ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Nama lengkap</span>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                autoComplete="name"
                aria-label="Nama lengkap penyewa"
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Nomor telepon</span>
              <Input
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                aria-label="Nomor telepon penyewa"
              />
            </label>
            {createRenterMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Penyewa belum dibuat</AlertTitle>
                <AlertDescription>
                  {isUnknownOutcome(createRenterMutation.error)
                    ? "Hasil tindakan belum pasti. Periksa status terlebih dahulu."
                    : readCommandMessage(createRenterMutation.error)}
                  {isUnknownOutcome(createRenterMutation.error) ? (
                    <div className="mt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void reconcileRenter()}>
                        <RefreshCw /> Periksa status
                      </Button>
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              className="w-full rounded-xl"
              disabled={!newName.trim() || !newPhone.trim() || createRenterMutation.isPending}
              onClick={() => createRenterMutation.mutate()}
            >
              {createRenterMutation.isPending ? (
                <><Loader2 className="animate-spin" /> Membuat…</>
              ) : (
                <><UserPlus /> Buat dan pilih penyewa</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
