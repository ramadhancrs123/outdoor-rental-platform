import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Loader2,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DEFAULT_CATALOG_FILTERS, getCatalogProduct, listCatalogProducts } from "@/features/katalog";
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

const steps = ["Penyewa", "Periode", "Barang", "Review"];

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

  const selectedProduct = useMemo(
    () =>
      products.data?.products?.find((product) => product.barang_id === productId) ?? null,
    [productId, products.data?.products],
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

  const requestedQuantity = Number(quantity);
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
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity harus lebih dari 0.");

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
  const canMoveFromProduct =
    Boolean(selectedProduct && selectedTariff) &&
    selectedTariff?.currency_code === "IDR" &&
    Number.isFinite(requestedQuantity) &&
    requestedQuantity > 0;

  if (context.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat konteks Usaha…</div>;
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Walk-in belum dapat dibuka</AlertTitle>
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
          Buat Transaksi Walk-in
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Buat draft rental tanpa membuat Reservation. Validasi ketersediaan final tetap
          dilakukan oleh trusted command saat draft disimpan.
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
                    ? "Hasil command belum pasti. Jangan buat penyewa kedua sebelum status diperiksa."
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
            <CardTitle>Periode rental</CardTitle>
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
            {startAt && endAt && canMoveFromPeriod ? (
              <div className="flex items-center gap-2 rounded-2xl border bg-muted/30 p-4 text-sm">
                <Clock3 className="size-4 text-muted-foreground" />
                <span>Periode valid dan siap dicek terhadap kapasitas fisik saat review.</span>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Isi waktu mulai dan kembali. Waktu kembali harus setelah waktu mulai.
              </div>
            )}
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
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Barang</span>
                <Select
                  value={productId}
                  onValueChange={(value) => {
                    setProductId(value);
                    setVariantId("");
                  }}
                >
                  <SelectTrigger aria-label="Pilih barang"><SelectValue placeholder="Pilih barang…" /></SelectTrigger>
                  <SelectContent>
                    {(products.data?.products ?? [])
                      .filter((product) => product.status === "active")
                      .map((product) => (
                        <SelectItem key={product.barang_id} value={product.barang_id}>
                          {product.nama}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>

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
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Varian</span>
                  <Select value={variantId || "__base__"} onValueChange={(value) => setVariantId(value === "__base__" ? "" : value)}>
                    <SelectTrigger aria-label="Pilih varian">
                      <SelectValue placeholder="Gunakan barang utama / pilih varian…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__base__">Gunakan barang utama</SelectItem>
                      {productDetail.data?.variants
                        .filter((variant) => variant.status === "active")
                        .map((variant) => (
                          <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>
                            {variant.nama}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
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
                </div>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Jumlah unit</span>
                  <Input
                    inputMode="decimal"
                    min={1}
                    step={1}
                    type="number"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    aria-label="Jumlah unit"
                  />
                </label>
              </div>

              {productId && availability.isPending ? (
                <div
                  className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"
                  aria-live="polite"
                  aria-busy="true"
                >
                  Memeriksa kesiapan fisik unit…
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

              {productId && availability.data ? (
                <div
                  aria-live="polite"
                  className={[
                    "flex items-start gap-3 rounded-2xl border p-4",
                    availability.data.physicalCheck === "pass"
                      ? "bg-emerald-50/50"
                      : "bg-amber-50/60",
                  ].join(" ")}
                >
                  {availability.data.physicalCheck === "pass" ? (
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                  ) : (
                    <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
                  )}
                  <div>
                    <p className="font-semibold">
                      {availability.data.readyPhysicalUnits} unit READY secara fisik
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Permintaan saat ini {availability.data.requestedUnits} unit. Commitments
                      pada periode rental tetap diperiksa ulang oleh server saat membuat draft.
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
            <CardTitle>Review transaksi</CardTitle>
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
                <div className="text-muted-foreground">Tarif / unit</div>
                <div className="text-right font-medium">
                  {selectedTariff ? formatCatalogMoney(selectedTariff.nominal, selectedTariff.currency_code) : "—"}
                </div>
                <div className="text-muted-foreground">Subtotal</div>
                <div className="text-right text-lg font-bold">
                  {selectedTariff
                    ? formatCatalogMoney(Number(selectedTariff.nominal) * requestedQuantity, selectedTariff.currency_code)
                    : "—"}
                </div>
              </div>
            </div>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Catatan rental</span>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" />
            </label>

            {rentalCommandState === "conflict" ? (
              <Alert variant="destructive">
                <AlertTitle>Kapasitas atau state rental berubah</AlertTitle>
                <AlertDescription>
                  Server menolak command karena kondisi terbaru tidak lagi memenuhi kontrak rental.
                  Perbarui pilihan barang / quantity lalu coba lagi.
                </AlertDescription>
              </Alert>
            ) : null}

            {rentalCommandState === "error" && createRentalMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Draft rental belum dibuat</AlertTitle>
                <AlertDescription>{readCommandMessage(createRentalMutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            {rentalCommandState === "unknown" ? (
              <Alert>
                <AlertTitle>Hasil command belum pasti</AlertTitle>
                <AlertDescription>
                  Jangan tekan tombol buat ulang. Periksa dulu apakah draft rental sudah terbentuk.
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void reconcileRental()}
                    >
                      <RefreshCw /> Periksa status command
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
                    <>Buat Draft Rental <ArrowRight /></>
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
                    ? "Hasil command belum pasti. Periksa status terlebih dahulu."
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
