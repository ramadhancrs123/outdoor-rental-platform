import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Loader2,
  Package,
  RefreshCw,
  Search,
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
import {
  DEFAULT_CATALOG_FILTERS,
  calculateRentalLineSubtotal,
  calculateTariffPeriods,
  getCatalogPackageDetails,
  getCatalogProduct,
  listCatalogPackages,
  listCatalogProductCovers,
  listCatalogProducts,
  listCatalogReadyStock,
} from "@/features/katalog";
import { isActiveCatalogTariff, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { createClientId } from "@/lib/client-id";
import { cn } from "@/lib/utils";
import {
  calculateDraftItemProductQuantity,
  calculateRentalPeriodPreview,
} from "@/features/penyewaan/utils";
import { RentalPolicyDialog } from "@/components/penyewaan/rental-policy-dialog";
import { paths } from "@/routes/paths";
import { listInventoryPackageAvailability, type InventoryPackageAvailability } from "@/features/inventaris";

type CommandState = "idle" | "processing" | "unknown" | "conflict" | "error";

type DraftRentalLine = {
  key: string;
  kind: "item" | "package";
  label: string;
  description: string;
  input: import("@/features/penyewaan").DirectRentalLineInput;
};

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

function formatElapsedDuration(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(days + " hari");
  if (hours) parts.push(hours + " jam");
  if (minutes || !parts.length) parts.push(minutes + " menit");
  return parts.join(" ");
}

function formatPeriodDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

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
  const [productSearch, setProductSearch] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [draftLines, setDraftLines] = useState<DraftRentalLine[]>([]);
  const [selectionMode, setSelectionMode] = useState<"item" | "package">("item");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [packageQuantity, setPackageQuantity] = useState("1");
  const [packageNote, setPackageNote] = useState("");
  const [rentalCommandKey, setRentalCommandKey] = useState(() => createClientId());
  const [renterCommandKey, setRenterCommandKey] = useState(() => createClientId());
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

  const packages = useQuery({
    queryKey: ["penyewaan", "walk-in", "packages", context.data?.usahaId],
    queryFn: () => listCatalogPackages(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });

  const packageAvailability = useQuery<InventoryPackageAvailability[]>({
    queryKey: ["penyewaan", "walk-in", "package-availability", context.data?.usahaId],
    queryFn: () => listInventoryPackageAvailability(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  const selectedPackage = useMemo(
    () => (packages.data ?? []).find((pkg) => pkg.paket_sewa_id === selectedPackageId) ?? null,
    [packages.data, selectedPackageId],
  );

  const packageDetail = useQuery({
    queryKey: ["penyewaan", "walk-in", "package-detail", context.data?.usahaId, selectedPackageId],
    queryFn: () => getCatalogPackageDetails(context.data!.usahaId, selectedPackageId),
    enabled: Boolean(context.data?.usahaId && selectedPackageId),
    staleTime: 60_000,
  });

  const selectedPackageTariff = useMemo(() => {
    const active = (packageDetail.data?.tariffs ?? []).filter((tariff) => isActiveCatalogTariff(tariff));
    return active.find((tariff) => tariff.paket_sewa_id === selectedPackageId) ?? active[0] ?? null;
  }, [packageDetail.data?.tariffs, selectedPackageId]);

  const selectedPackageAvailability = useMemo(
    () => packageAvailability.data?.find((pkg) => pkg.paket_sewa_id === selectedPackageId) ?? null,
    [packageAvailability.data, selectedPackageId],
  );

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
          (categoryId === "all" || product.kategori_barang_id === categoryId) &&
          product.nama.toLowerCase().includes(productSearch.trim().toLowerCase()),
      ),
    [categoryId, productSearch, products.data?.products],
  );

  const visiblePackages = useMemo(
    () =>
      (packages.data ?? []).filter((pkg) =>
        pkg.nama.toLowerCase().includes(packageSearch.trim().toLowerCase()),
      ),
    [packageSearch, packages.data],
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
  const packageBillingPeriods = selectedPackageTariff && startAt && endAt
    ? calculateTariffPeriods(startAt, endAt, selectedPackageTariff)
    : 0;
  const requestedQuantity = Number(quantity);
  const selectedItemIdentity = "item:" + productId + ":" + (variantId || "base");
  const existingProductQuantity = calculateDraftItemProductQuantity(
    draftLines,
    productId,
    selectedItemIdentity,
  );
  const productReadyStock = readyStock.data?.byProduct[productId] ?? 0;
  const projectedProductQuantity = existingProductQuantity + requestedQuantity;
  const selectedReadyStock =
    variantId
      ? readyStock.data?.byVariant[variantId] ?? 0
      : productReadyStock;
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
      setRenterCommandKey(createClientId());
      void renters.refetch();
    },
  });

  const addDraftLine = () => {
    if (selectionMode === "item") {
      if (!selectedProduct || !selectedTariff || billingPeriods <= 0 || !quantityIsValid) {
        throw new Error("Lengkapi barang, tarif, periode, dan jumlah sebelum menambahkan.");
      }
      if (!availability.data || requestedQuantity > availability.data.readyPhysicalUnits) {
        throw new Error("Jumlah melebihi unit ready saat ini.");
      }
      if (projectedProductQuantity > productReadyStock) {
        throw new Error("Jumlah total barang ini melebihi stok siap yang tersedia.");
      }

      const input = {
        barang_id: selectedProduct.barang_id,
        varian_barang_id: variantId || null,
        tarif_sewa_id: selectedTariff.tarif_sewa_id,
        duration_periods: billingPeriods,
        jumlah: requestedQuantity,
        unit_price: Number(selectedTariff.nominal),
        subtotal: calculateRentalLineSubtotal(
          requestedQuantity,
          Number(selectedTariff.nominal),
          billingPeriods,
        ),
        currency_code: "IDR" as const,
        catatan: null,
      };

      const identity = selectedItemIdentity;
      setDraftLines((current) => {
        const existing = current.find((line) => line.key === identity);
        if (existing) {
          return current.map((line) =>
            line.key === identity
              ? {
                  ...line,
                  input: { ...input },
                  description: (selectedVariant?.nama ?? "Barang utama") + " · " + requestedQuantity + " unit",
                }
              : line,
          );
        }
        return [
          ...current,
          {
            key: identity,
            kind: "item",
            label: selectedProduct.nama,
            description: (selectedVariant?.nama ?? "Barang utama") + " · " + requestedQuantity + " unit",
            input,
          },
        ];
      });
      setQuantity("1");
      return;
    }

    const pkgQty = Number(packageQuantity);
    if (!selectedPackage || !selectedPackageTariff || !Number.isInteger(pkgQty) || pkgQty <= 0 || packageBillingPeriods <= 0) {
      throw new Error("Lengkapi paket, tarif, periode, dan jumlah paket sebelum menambahkan.");
    }
    if (!selectedPackageAvailability || selectedPackageAvailability.status !== "available") {
      throw new Error("Paket belum tersedia karena ada komponen yang tidak mencukupi.");
    }
    if (pkgQty > selectedPackageAvailability.available_package_quantity) {
      throw new Error(
        "Jumlah paket melebihi ketersediaan saat ini (" +
          selectedPackageAvailability.available_package_quantity +
          " paket).",
      );
    }

    const input = {
      paket_sewa_id: selectedPackage.paket_sewa_id,
      tarif_sewa_id: selectedPackageTariff.tarif_sewa_id,
      duration_periods: packageBillingPeriods,
      jumlah: pkgQty,
      unit_price: Number(selectedPackageTariff.nominal),
      subtotal: calculateRentalLineSubtotal(
        pkgQty,
        Number(selectedPackageTariff.nominal),
        packageBillingPeriods,
      ),
      currency_code: "IDR" as const,
      catatan: packageNote.trim() || null,
    };

    const identity = "package:" + selectedPackage.paket_sewa_id;
    setDraftLines((current) => {
      const existing = current.find((line) => line.key === identity);
      if (existing) {
        return current.map((line) =>
          line.key === identity
            ? {
                ...line,
                input: { ...input },
                description: "Paket x" + pkgQty,
              }
            : line,
        );
      }
      return [
        ...current,
        {
          key: identity,
          kind: "package",
          label: selectedPackage.nama,
          description: "Paket x" + pkgQty,
          input,
        },
      ];
    });
    setPackageQuantity("1");
    setPackageNote("");
  };

  const removeDraftLine = (key: string) => {
    setDraftLines((current) => current.filter((line) => line.key !== key));
  };

  const estimatedTotal = draftLines.reduce((sum, line) => sum + Number(line.input.subtotal), 0);

  const createRentalMutation = useMutation({
    mutationFn: () => {
      if (!selectedRenterId) throw new Error("Pilih penyewa.");
      if (!canMoveFromPeriod) throw new Error("Periode rental belum valid.");
      if (!draftLines.length) throw new Error("Tambahkan minimal satu barang atau paket.");
      setRentalCommandState("processing");
      return createDirectRental(
        context.data!.usahaId,
        {
          penyewa_id: selectedRenterId,
          jadwal_mulai: new Date(startAt).toISOString(),
          jadwal_kembali: new Date(endAt).toISOString(),
          catatan: note || null,
          lines: draftLines.map((line) => line.input),
        },
        { idempotencyKey: rentalCommandKey },
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
      setRenterCommandKey(createClientId());
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
      setRentalCommandKey(createClientId());
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
  const periodPreview = canMoveFromPeriod
    ? calculateRentalPeriodPreview(startAt, endAt, context.data?.defaultToleranceHours ?? 10)
    : null;
  const quantityIsValid = Number.isInteger(requestedQuantity) && requestedQuantity > 0;
  const availabilityRefreshing = availability.isPending || availability.isFetching;
  const quantityFitsSelectedStock =
    Boolean(availability.data) &&
    requestedQuantity <= (availability.data?.readyPhysicalUnits ?? 0);
  const quantityFitsProductPool =
    Boolean(readyStock.data) &&
    Number.isFinite(projectedProductQuantity) &&
    projectedProductQuantity <= productReadyStock;
  const canAddItem =
    Boolean(selectedProduct && selectedTariff) &&
    selectedTariff?.currency_code === "IDR" &&
    billingPeriods > 0 &&
    quantityIsValid &&
    !availabilityRefreshing &&
    !availability.isError &&
    quantityFitsSelectedStock &&
    quantityFitsProductPool;
  const packageQtyValid = Number.isInteger(Number(packageQuantity)) && Number(packageQuantity) > 0;
  const canAddPackage =
    Boolean(selectedPackage && selectedPackageTariff) &&
    selectedPackageTariff?.currency_code === "IDR" &&
    packageBillingPeriods > 0 &&
    packageQtyValid &&
    selectedPackageAvailability?.status === "available" &&
    Number(packageQuantity) <= (selectedPackageAvailability?.available_package_quantity ?? 0);
  const canReview = canMoveFromPeriod && draftLines.length > 0;

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
            {startAt && endAt && canMoveFromPeriod && periodPreview ? (
              <div className="space-y-3">
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Ringkasan periode</p>
                      <p className="mt-1 text-base font-semibold">Durasi rental dihitung secara eksplisit</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full">
                      {periodPreview.dailyPeriods} periode harian
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Mulai</p>
                      <p className="mt-1 font-medium">
                        {formatPeriodDateTime(periodPreview.startAt, context.data.timezone)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Kembali terjadwal</p>
                      <p className="mt-1 font-medium">
                        {formatPeriodDateTime(periodPreview.endAt, context.data.timezone)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Durasi aktual yang dipilih</p>
                      <p className="mt-1 font-semibold">
                        {formatElapsedDuration(periodPreview.elapsedSeconds)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {periodPreview.elapsedHours.toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam total
                      </p>
                    </div>
                    <div className="rounded-xl border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Batas toleransi</p>
                      <p className="mt-1 font-semibold">
                        {formatPeriodDateTime(periodPreview.toleranceDeadline, context.data.timezone)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {periodPreview.toleranceHours} jam setelah kembali terjadwal
                      </p>
                    </div>
                  </div>
                </div>

                {periodPreview.isOver24Hours ? (
                  <Alert variant="destructive">
                    <AlertTitle>Durasi melewati 24 jam</AlertTitle>
                    <AlertDescription>
                      Durasi melewati 24 jam sebesar {formatElapsedDuration(periodPreview.excessOver24hSeconds)}.
                      Untuk tarif harian 1 hari, sistem menghitung <strong>{periodPreview.dailyPeriods} periode tarif</strong>.
                      Harga final mengikuti tarif yang dipilih pada langkah Barang/Paket.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="flex items-start gap-2 rounded-2xl border bg-primary/5 p-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-medium">Periode valid</p>
                      <p className="mt-0.5 text-muted-foreground">
                        Untuk tarif harian 1 hari, periode ini akan dihitung sebagai {periodPreview.dailyPeriods} periode tarif.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-2xl border bg-muted/20 p-3 text-sm">
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">Kebijakan toleransi</p>
                      {context.data ? (
                        <RentalPolicyDialog
                          usahaId={context.data.usahaId}
                          currentToleranceHours={context.data.defaultToleranceHours}
                          currentLateFeeEnabled={context.data.lateFeeEnabled}
                          currentLateFeePerHour={context.data.lateFeePerHour}
                          onSaved={() => void context.refetch()}
                          compact
                        />
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-muted-foreground">
                      Toleransi tetap dihitung dari waktu kembali terjadwal dan tidak mengubah jadwal rental.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Isi waktu mulai dan kembali. Setelah valid, sistem akan menampilkan durasi, periode tarif harian, dan batas toleransi secara otomatis.
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
            <CardTitle>Barang dan Paket yang Disewa</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tambahkan banyak line dalam satu transaksi. Satu transaksi boleh mencampur barang satuan dan paket.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Button
                type="button"
                size="sm"
                variant={selectionMode === "item" ? "default" : "outline"}
                className="h-9 shrink-0 rounded-full"
                onClick={() => setSelectionMode("item")}
              >
                Barang
              </Button>
              <Button
                type="button"
                size="sm"
                variant={selectionMode === "package" ? "default" : "outline"}
                className="h-9 shrink-0 rounded-full"
                onClick={() => setSelectionMode("package")}
              >
                Paket
              </Button>
              <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">
                Bisa dicampur dalam satu penyewaan
              </span>
            </div>

            {selectionMode === "item" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Cari barang…"
                    aria-label="Cari barang"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[{ id: "all", nama: "Semua" }, ...categories].map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setCategoryId(category.id);
                        setProductId("");
                        setVariantId("");
                      }}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        categoryId === category.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-accent/40",
                      )}
                    >
                      {category.nama}
                    </button>
                  ))}
                </div>

                <div className="grid gap-2">
                  {activeProducts.map((product) => {
                    const stock = readyStock.data?.byProduct[product.barang_id] ?? 0;
                    const selected = productId === product.barang_id;
                    const cover = coverByProduct.get(product.barang_id);

                    return (
                      <button
                        key={product.barang_id}
                        type="button"
                        className={cn(
                          "flex min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20"
                            : "hover:bg-accent/30",
                        )}
                        onClick={() => {
                          setProductId(product.barang_id);
                          setVariantId("");
                        }}
                      >
                        {cover ? (
                          <img src={cover} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                            <Package className="size-4" aria-hidden="true" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{product.nama}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {product.kategori?.nama ?? "Barang"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                            stock > 0
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {stock > 0 ? String(stock) + " siap" : "Tidak siap"}
                        </span>
                      </button>
                    );
                  })}

                  {!activeProducts.length ? (
                    <div className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
                      Barang tidak ditemukan pada filter ini.
                    </div>
                  ) : null}
                </div>

                {productId ? (
                  <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                    {productDetail.data?.variants.some((variant) => variant.status === "active") ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Varian
                          </p>
                          <span className="text-[11px] text-muted-foreground">Opsional</span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          <button
                            type="button"
                            className={cn(
                              "shrink-0 rounded-lg border px-3 py-2 text-left text-xs",
                              variantId === ""
                                ? "border-primary bg-primary/5 font-semibold"
                                : "bg-background hover:bg-accent/30",
                            )}
                            onClick={() => setVariantId("")}
                          >
                            Barang utama
                          </button>
                          {(productDetail.data?.variants ?? [])
                            .filter((variant) => variant.status === "active")
                            .map((variant) => (
                              <button
                                key={variant.varian_barang_id}
                                type="button"
                                className={cn(
                                  "shrink-0 rounded-lg border px-3 py-2 text-left text-xs",
                                  variantId === variant.varian_barang_id
                                    ? "border-primary bg-primary/5 font-semibold"
                                    : "bg-background hover:bg-accent/30",
                                )}
                                onClick={() => setVariantId(variant.varian_barang_id)}
                              >
                                {variant.nama}
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto] sm:items-end">
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Tarif aktif</p>
                            <p className="truncate text-sm font-semibold">
                              {selectedTariff
                                ? formatCatalogMoney(selectedTariff.nominal, selectedTariff.currency_code) +
                                  " · " +
                                  formatTariffDuration(selectedTariff)
                                : "Belum tersedia"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs text-muted-foreground">Siap</p>
                            <p
                              className={cn(
                                "text-sm font-semibold",
                                selectedReadyStock > 0 ? "text-primary" : "text-muted-foreground",
                              )}
                            >
                              {readyStock.isPending ? "…" : String(selectedReadyStock) + " unit"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <label className="space-y-1 text-xs">
                        <span className="font-medium text-muted-foreground">Jumlah</span>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                          aria-label="Jumlah unit"
                          className="h-10 rounded-xl"
                        />
                      </label>

                      <Button
                        type="button"
                        className="h-10 rounded-xl sm:min-w-28"
                        disabled={!canAddItem}
                        onClick={() => {
                          try {
                            addDraftLine();
                          } catch {
                            setRentalCommandState("error");
                          }
                        }}
                      >
                        Tambahkan
                      </Button>
                    </div>

                    {productId && availability.data && !quantityFitsSelectedStock ? (
                      <p className="text-xs font-medium text-destructive">
                        Stok siap pada pilihan ini {availability.data.readyPhysicalUnits} unit, sementara diminta{" "}
                        {requestedQuantity}.
                      </p>
                    ) : null}
                    {productId && readyStock.data && quantityFitsSelectedStock && !quantityFitsProductPool ? (
                      <p className="text-xs font-medium text-destructive">
                        Total {selectedProduct?.nama ?? "barang"} dalam transaksi akan menjadi{" "}
                        {projectedProductQuantity} unit, sedangkan stok siap seluruh barang hanya {productReadyStock} unit.
                        Varian dan barang utama memakai stok fisik yang sama.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
                    Pilih barang untuk melihat tarif, varian, dan jumlah unit yang siap disewakan.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={packageSearch}
                    onChange={(event) => setPackageSearch(event.target.value)}
                    placeholder="Cari paket…"
                    aria-label="Cari paket"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>

                <div className="grid gap-2">
                  {visiblePackages.map((pkg) => {
                    const availabilityItem = packageAvailability.data?.find(
                      (item) => item.paket_sewa_id === pkg.paket_sewa_id,
                    );
                    const selected = selectedPackageId === pkg.paket_sewa_id;
                    const available = availabilityItem?.status === "available";

                    return (
                      <button
                        key={pkg.paket_sewa_id}
                        type="button"
                        className={cn(
                          "flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20"
                            : "hover:bg-accent/30",
                        )}
                        onClick={() => setSelectedPackageId(pkg.paket_sewa_id)}
                      >
                        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <Package className="size-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{pkg.nama}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {pkg.active_tariff
                              ? formatCatalogMoney(pkg.active_tariff.nominal, pkg.active_tariff.currency_code) +
                                " - " +
                                formatTariffDuration(pkg.active_tariff)
                              : pkg.harga_dasar == null
                                ? "Harga belum ditentukan"
                                : formatCatalogMoney(pkg.harga_dasar, pkg.currency_code)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                            available
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {available
                            ? String(availabilityItem?.available_package_quantity ?? 0) + " siap"
                            : "Belum siap"}
                        </span>
                      </button>
                    );
                  })}

                  {!visiblePackages.length ? (
                    <div className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
                      Paket tidak ditemukan.
                    </div>
                  ) : null}
                </div>

                {selectedPackage ? (
                  <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{selectedPackage.nama}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {selectedPackageAvailability?.available_package_quantity ?? 0} paket siap disewakan
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground">Jumlah</span>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={packageQuantity}
                          onChange={(event) => setPackageQuantity(event.target.value)}
                          className="h-9 w-20 rounded-lg"
                          aria-label="Jumlah paket"
                        />
                      </label>
                    </div>

                    <div className="grid gap-1.5">
                      {(packageDetail.data?.components ?? []).map((component) => {
                        const availabilityComponent = selectedPackageAvailability?.components.find(
                          (item) => item.komponen_paket_id === component.komponen_paket_id,
                        );
                        return (
                          <div
                            key={component.komponen_paket_id}
                            className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">
                                {component.varian?.nama ?? component.barang?.nama ?? "Komponen"}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {component.jumlah} per paket
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              siap {availabilityComponent?.ready_quantity ?? 0}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Input
                        value={packageNote}
                        onChange={(event) => setPackageNote(event.target.value)}
                        placeholder="Catatan paket (opsional)"
                        className="h-10 rounded-xl"
                      />
                      <Button
                        type="button"
                        className="h-10 rounded-xl"
                        disabled={!canAddPackage}
                        onClick={() => {
                          try {
                            addDraftLine();
                          } catch {
                            setRentalCommandState("error");
                          }
                        }}
                      >
                        Tambahkan paket
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
                    Pilih paket untuk melihat komponen dan ketersediaan fisiknya.
                  </div>
                )}
              </div>
            )}

            {draftLines.length ? (
              <Card className="border-primary/20">
                <CardHeader className="px-4 pb-2 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">Isi Penyewaan</CardTitle>
                    <Badge variant="secondary" className="rounded-full">{draftLines.length} line</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {draftLines.map((line) => (
                    <div key={line.key} className="flex items-start justify-between gap-3 rounded-2xl border p-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full">{line.kind === "package" ? "Paket" : "Barang"}</Badge>
                          <p className="font-semibold">{line.label}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{line.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCatalogMoney(line.input.subtotal, line.input.currency_code ?? "IDR")}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => removeDraftLine(line.key)}>
                        Hapus
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t pt-3 text-sm">
                    <span className="text-muted-foreground">Estimasi total sewa</span>
                    <span className="text-lg font-bold">{formatCatalogMoney(estimatedTotal, "IDR")}</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                Belum ada line. Tambahkan Carrier, Jaket, Tenda, atau satu/lebih paket ke transaksi yang sama.
              </div>
            )}

            {rentalCommandState === "error" && createRentalMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Line belum dapat ditambahkan atau draft belum dibuat</AlertTitle>
                <AlertDescription>{readCommandMessage(createRentalMutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-between gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(2)}>Kembali</Button>
              <Button disabled={!canReview} onClick={() => setStep(4)}>
                Review Transaksi <ArrowRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Tinjauan Transaksi</CardTitle>
            <p className="text-sm text-muted-foreground">
              Semua line akan dikirim sebagai satu command. Kapasitas gabungan paket dan barang satuan divalidasi ulang oleh server.
            </p>
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

            <div className="space-y-2">
              {draftLines.map((line) => (
                <div key={line.key} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-full">{line.kind === "package" ? "Paket" : "Barang"}</Badge>
                        <p className="font-semibold">{line.label}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{line.description}</p>
                    </div>
                    <p className="font-semibold">{formatCatalogMoney(line.input.subtotal, line.input.currency_code ?? "IDR")}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">Jumlah</span>
                    <span className="text-right">{line.input.jumlah}</span>
                    <span className="text-muted-foreground">Durasi</span>
                    <span className="text-right">
                      {line.input.duration_periods} periode
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">Total transaksi</p>
                <p className="text-xl font-bold">{formatCatalogMoney(estimatedTotal, "IDR")}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Ketersediaan yang tampil di UI adalah kondisi fisik saat ini. Saat draf disimpan, server memvalidasi seluruh line sebagai satu kapasitas gabungan.
              </p>
            </div>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Catatan Penyewaan</span>
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" />
            </label>

            {rentalCommandState === "conflict" && createRentalMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Kapasitas atau status penyewaan berubah</AlertTitle>
                <AlertDescription>{readCommandMessage(createRentalMutation.error)}</AlertDescription>
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
                  Jangan buat ulang. Periksa dulu apakah draft rental sudah terbentuk.
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => void reconcileRental()}>
                      <RefreshCw /> Periksa status tindakan
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="sticky bottom-2 z-20 -mx-1 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
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
                  disabled={createRentalMutation.isPending || rentalCommandState === "unknown" || !canReview}
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
