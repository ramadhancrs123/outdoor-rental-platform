import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  Filter,
  Loader2,
  Package,
  PackageCheck,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createDirectRental,
  getOperationalRentalWorkspace,
  getRental,
  getPenyewaanContext,
  reconcileDirectRentalCreation,
  type DirectRentalLineInput,
  type OperationalRentalWorkspace,
} from "@/features/penyewaan";
import {
  calculateRentalPeriodPreview,
  formatRentalDateTime,
  formatRentalMoney,
} from "@/features/penyewaan/utils";
import {
  DEFAULT_CATALOG_FILTERS,
  getCatalogPackageDetails,
  getCatalogProduct,
  listCatalogPackages,
  listCatalogProductCovers,
  listCatalogProducts,
  listCatalogReadyStock,
  type CatalogPackage,
  type CatalogProduct,
  calculateRentalLineSubtotal,
  calculateTariffPeriods,
} from "@/features/katalog";
import { isActiveCatalogTariff, formatCatalogMoney } from "@/features/katalog/utils";
import { listInventoryPackageAvailability, listInventoryReadyUnitCovers, type InventoryPackageAvailability } from "@/features/inventaris";
import { createRenter, listRenters, reconcileRenterCreation } from "@/features/penyewa/service";
import {
  listFinanceAccounts,
  recordPayment,
  reconcilePaymentCommand,
  type FinanceAccount,
  type RecordPaymentInput,
} from "@/features/keuangan";
import { localDateTimeToUtcIso, formatDateTimeLocalInTimezone } from "@/features/keuangan/utils";
import { QrPreviewDialog, RentalReceiptDialog } from "@/components/qr-operasional/qr-operasional";
import { RentalPhase2Actions } from "./phase2-actions";
import { buildPenyewaanQrUrl, getQrPenyewaanRecord, getRentalReceiptSupport } from "@/features/qr-operasional";
import { createClientId } from "@/lib/client-id";
import { paths } from "@/routes/paths";
import { cn } from "@/lib/utils";

type DraftRentalLine = {
  key: string;
  kind: "item" | "package";
  label: string;
  description: string;
  input: DirectRentalLineInput;
};

type CatalogDialogState =
  | { open: false }
  | { open: true; mode: "item" | "package"; id: string };

type PaymentMode = "unpaid" | "dp" | "paid";
type CommandState = "idle" | "processing" | "unknown" | "conflict" | "error";

function commandMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isUnknownOutcome(error: unknown) {
  const message = commandMessage(error, "").toLowerCase();
  return message.includes("unknown_outcome") || message.includes("timeout") || message.includes("network") || message.includes("fetch");
}

function isBusinessConflict(error: unknown) {
  return commandMessage(error, "").toLowerCase().includes("business_conflict");
}

function paymentStatus(recorded: number, total: number): "unpaid" | "partial" | "paid" {
  if (recorded <= 0) return "unpaid";
  if (recorded >= total) return "paid";
  return "partial";
}

function statusLabel(status: ReturnType<typeof paymentStatus>) {
  if (status === "paid") return "LUNAS";
  if (status === "partial") return "SEBAGIAN";
  return "BELUM BAYAR";
}

function packageAvailabilityHint(availability: InventoryPackageAvailability | undefined) {
  if (!availability || availability.status === "available") return null;
  const limiting = availability.components.find((component) => component.shortfall_quantity > 0);
  if (!limiting) return "Belum siap";
  return limiting.shortfall_quantity === 1
    ? limiting.nama + " kurang 1"
    : limiting.nama + " kurang " + limiting.shortfall_quantity;
}

function formatDurationLabel(seconds: number) {
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

function formatWorkspaceDateTime(value: string | null | undefined, timezone?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

function getLineIdentity(productId: string, variantId: string) {
  return "item:" + productId + ":" + (variantId || "base");
}

export function RentalWalkIn() {
  const [searchParams] = useSearchParams();
  const renterIdFromQuery = searchParams.get("renter_id");
  const queryClient = useQueryClient();

  const context = useQuery({
    queryKey: ["penyewaan", "context"],
    queryFn: getPenyewaanContext,
    staleTime: 60_000,
  });

  const [selectedRenterId, setSelectedRenterId] = useState(renterIdFromQuery ?? "");
  const [renterPickerOpen, setRenterPickerOpen] = useState(false);
  const [renterPickerSearch, setRenterPickerSearch] = useState("");
  const [newRenterOpen, setNewRenterOpen] = useState(false);
  const [newRenterName, setNewRenterName] = useState("");
  const [newRenterPhone, setNewRenterPhone] = useState("");
  const [renterCommandKey, setRenterCommandKey] = useState(() => createClientId());

  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const [categoryId, setCategoryId] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const [selectionMode, setSelectionMode] = useState<"item" | "package">("item");
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [catalogDialog, setCatalogDialog] = useState<CatalogDialogState>({ open: false });
  const [pickerLines, setPickerLines] = useState<DraftRentalLine[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("1");
  const [selectedPackageQuantity, setSelectedPackageQuantity] = useState("1");
  const [selectedPackageNote, setSelectedPackageNote] = useState("");

  const [draftLines, setDraftLines] = useState<DraftRentalLine[]>([]);
  const [rentalId, setRentalId] = useState("");
  const [rentalCommandKey, setRentalCommandKey] = useState(() => createClientId());
  const [rentalCommandState, setRentalCommandState] = useState<CommandState>("idle");
  const directAfterCreateRef = useRef(false);
  const [operationalFeedback, setOperationalFeedback] = useState<string>("");
  const [unitExceptionOpen, setUnitExceptionOpen] = useState(false);

  const [paymentMode, setPaymentMode] = useState<PaymentMode>("unpaid");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const paymentMethod: RecordPaymentInput["metode"] = "cash";
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentCommandKey, setPaymentCommandKey] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<CommandState>("idle");

  const [qrOpen, setQrOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const renters = useQuery({
    queryKey: ["penyewaan", "walk-in", "renters", context.data?.usahaId, renterPickerSearch],
    queryFn: () =>
      listRenters(
        {
          akunAdminId: context.data!.akunAdminId,
          usahaId: context.data!.usahaId,
          usahaNama: context.data!.usahaNama,
        },
        renterPickerSearch,
        "active",
      ),
    enabled: Boolean(context.data?.usahaId && !rentalId && renterPickerOpen),
    staleTime: 15_000,
  });

  const products = useQuery({
    queryKey: ["penyewaan", "walk-in", "products", context.data?.usahaId],
    queryFn: () => listCatalogProducts(context.data!.usahaId, DEFAULT_CATALOG_FILTERS),
    enabled: Boolean(context.data?.usahaId && !rentalId),
    staleTime: 60_000,
  });

  const packages = useQuery({
    queryKey: ["penyewaan", "walk-in", "packages", context.data?.usahaId],
    queryFn: () => listCatalogPackages(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && !rentalId),
    staleTime: 60_000,
  });

  const packageAvailability = useQuery<InventoryPackageAvailability[]>({
    queryKey: ["penyewaan", "walk-in", "package-availability", context.data?.usahaId],
    queryFn: () => listInventoryPackageAvailability(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && !rentalId),
    staleTime: 10_000,
  });

  const productIds = useMemo(
    () => (products.data?.products ?? []).map((product) => product.barang_id),
    [products.data?.products],
  );

  const productCovers = useQuery({
    queryKey: ["penyewaan", "walk-in", "product-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogProductCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length && !rentalId),
    staleTime: 60_000,
  });

  const unitCovers = useQuery({
    queryKey: ["penyewaan", "walk-in", "ready-unit-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listInventoryReadyUnitCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length && !rentalId),
    staleTime: 15_000,
  });

  const readyStock = useQuery({
    queryKey: ["penyewaan", "walk-in", "ready-stock", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogReadyStock(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length && !rentalId),
    staleTime: 10_000,
  });

  const itemDialogId = catalogDialog.open && catalogDialog.mode === "item" ? catalogDialog.id : "";
  const packageDialogId = catalogDialog.open && catalogDialog.mode === "package" ? catalogDialog.id : "";

  const productDetail = useQuery({
    queryKey: [
      "penyewaan",
      "walk-in",
      "product-detail",
      context.data?.usahaId,
      itemDialogId || null,
    ],
    queryFn: () => getCatalogProduct(context.data!.usahaId, itemDialogId),
    enabled: Boolean(context.data?.usahaId && itemDialogId && !rentalId),
    staleTime: 60_000,
  });

  const selectedPackage = useMemo<CatalogPackage | null>(
    () =>
      packageDialogId
        ? (packages.data ?? []).find((item) => item.paket_sewa_id === packageDialogId) ?? null
        : null,
    [packageDialogId, packages.data],
  );

  const packageDetail = useQuery({
    queryKey: [
      "penyewaan",
      "walk-in",
      "package-detail",
      context.data?.usahaId,
      packageDialogId || null,
    ],
    queryFn: () => getCatalogPackageDetails(context.data!.usahaId, selectedPackage!.paket_sewa_id),
    enabled: Boolean(context.data?.usahaId && packageDialogId && !rentalId),
    staleTime: 60_000,
  });

  const operationalWorkspace = useQuery<OperationalRentalWorkspace>({
    queryKey: ["penyewaan", "operational-workspace", context.data?.usahaId, rentalId],
    queryFn: () => getOperationalRentalWorkspace(context.data!.usahaId, rentalId),
    enabled: Boolean(context.data?.usahaId && rentalId),
    refetchInterval: rentalId ? 5_000 : false,
    staleTime: 2_000,
  });

  const rentalDetail = useQuery({
    queryKey: ["penyewaan", "walk-in", "rental-detail", context.data?.usahaId, rentalId],
    queryFn: () => getRental(context.data!.usahaId, rentalId),
    enabled: Boolean(context.data?.usahaId && rentalId && (unitExceptionOpen || operationalWorkspace.data?.rental.status === "active")),
    staleTime: 5_000,
  });

  const accounts = useQuery<FinanceAccount[]>({
    queryKey: ["keuangan", "accounts", context.data?.usahaId],
    queryFn: () => listFinanceAccounts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && rentalId),
    staleTime: 30_000,
  });

  const rentalQr = useQuery({
    queryKey: ["qr-operasional", "penyewaan", context.data?.usahaId, rentalId],
    queryFn: () => getQrPenyewaanRecord(context.data!.usahaId, rentalId),
    enabled: Boolean(context.data?.usahaId && rentalId),
    staleTime: 5 * 60_000,
  });

  const receiptSupport = useQuery({
    queryKey: ["qr-operasional", "rental-receipt-support", context.data?.usahaId, rentalId, operationalWorkspace.data?.renter.penyewa_id],
    queryFn: () => getRentalReceiptSupport(context.data!.usahaId, rentalId, operationalWorkspace.data!.renter.penyewa_id),
    enabled: Boolean(context.data?.usahaId && rentalId && operationalWorkspace.data?.renter.penyewa_id),
    staleTime: 15_000,
  });

  const coverByProduct = useMemo(
    () => new Map((productCovers.data ?? []).map((item) => [item.barang_id, item.url])),
    [productCovers.data],
  );

  const unitCoverByProduct = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of unitCovers.data ?? []) {
      if (item.barang_id && item.url && !result.has(item.barang_id)) result.set(item.barang_id, item.url);
    }
    return result;
  }, [unitCovers.data]);

  const unitCoverByVariant = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of unitCovers.data ?? []) {
      if (item.varian_barang_id && item.url && !result.has(item.varian_barang_id)) result.set(item.varian_barang_id, item.url);
    }
    return result;
  }, [unitCovers.data]);

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

  const categories = useMemo(() => {
    const map = new Map<string, { id: string; nama: string }>();
    for (const product of products.data?.products ?? []) {
      if (product.status !== "active" || !product.kategori) continue;
      map.set(product.kategori.kategori_barang_id, {
        id: product.kategori.kategori_barang_id,
        nama: product.kategori.nama,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  }, [products.data?.products]);

  const selectedProduct = useMemo<CatalogProduct | null>(
    () => (itemDialogId ? activeProducts.find((product) => product.barang_id === itemDialogId) ?? null : null),
    [activeProducts, itemDialogId],
  );

  useEffect(() => {
    if (!catalogDialog.open || catalogDialog.mode !== "item" || !productDetail.data || selectedVariantId) return;
    const activeVariant = productDetail.data.variants.find((variant) =>
      productDetail.data?.tariffs.some(
        (tariff) =>
          tariff.varian_barang_id === variant.varian_barang_id &&
          isActiveCatalogTariff(tariff),
      ),
    );
    if (activeVariant) setSelectedVariantId(activeVariant.varian_barang_id);
  }, [catalogDialog, productDetail.data, selectedVariantId]);

  const selectedVariant = useMemo(
    () =>
      productDetail.data?.variants.find(
        (variant) => variant.varian_barang_id === selectedVariantId,
      ) ?? null,
    [productDetail.data?.variants, selectedVariantId],
  );

  const rentalTariffAt = useMemo(() => {
    const candidate = new Date(startAt);
    return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  }, [startAt]);

  const selectedTariff = useMemo(() => {
    if (
      !selectedVariantId &&
      selectedProduct?.active_tariff &&
      isActiveCatalogTariff(selectedProduct.active_tariff, rentalTariffAt)
    ) {
      return selectedProduct.active_tariff;
    }
    if (!productDetail.data) return null;
    const active = productDetail.data.tariffs.filter((tariff) => isActiveCatalogTariff(tariff, rentalTariffAt));
    if (selectedVariantId) {
      return (
        active.find((tariff) => tariff.varian_barang_id === selectedVariantId) ??
        active.find((tariff) => tariff.barang_id === itemDialogId && tariff.varian_barang_id === null) ??
        null
      );
    }
    return (
      active.find((tariff) => tariff.barang_id === itemDialogId && tariff.varian_barang_id === null) ??
      productDetail.data.active_tariff ??
      selectedProduct?.active_tariff ??
      null
    );
  }, [itemDialogId, productDetail.data, rentalTariffAt, selectedProduct?.active_tariff, selectedVariantId]);

  const pricedVariantId =
    productDetail.data?.variants.find((variant) =>
      productDetail.data?.tariffs.some(
        (tariff) =>
          tariff.varian_barang_id === variant.varian_barang_id &&
          isActiveCatalogTariff(tariff, rentalTariffAt),
      ),
    )?.varian_barang_id ?? "";
  const effectiveVariantId = selectedVariantId || pricedVariantId;

  const selectedReadyStock =
    effectiveVariantId
      ? readyStock.data?.byVariant[effectiveVariantId] ?? 0
      : readyStock.data?.byProduct[itemDialogId] ?? 0;

  const periodPreview =
    startAt && endAt && context.data
      ? (() => {
          const start = new Date(startAt);
          const end = new Date(endAt);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
          return calculateRentalPeriodPreview(startAt, endAt, context.data.defaultToleranceHours);
        })()
      : null;

  const canMoveFromPeriod =
    Boolean(startAt && endAt) &&
    !Number.isNaN(new Date(startAt).getTime()) &&
    !Number.isNaN(new Date(endAt).getTime()) &&
    new Date(endAt) > new Date(startAt);

  const billingPeriods =
    selectedTariff && canMoveFromPeriod
      ? calculateTariffPeriods(startAt, endAt, selectedTariff)
      : 0;

  const totalRental = draftLines.reduce((sum, line) => sum + Number(line.input.subtotal), 0);
  const selectedQuantityNumber = Number(selectedQuantity);
  const selectedPackageQuantityNumber = Number(selectedPackageQuantity);

  const availabilityPreview = useQuery({
    queryKey: [
      "penyewaan",
      "walk-in",
      "availability-preview",
      context.data?.usahaId,
      itemDialogId,
      effectiveVariantId,
      selectedQuantityNumber,
    ],
    queryFn: async () => {
      const { previewDirectRentalAvailability } = await import("@/features/penyewaan");
      return previewDirectRentalAvailability(context.data!.usahaId, {
        barangId: itemDialogId,
        varianBarangId: effectiveVariantId || null,
        requestedUnits: selectedQuantityNumber,
      });
    },
    enabled:
      Boolean(context.data?.usahaId && itemDialogId) &&
      Number.isInteger(selectedQuantityNumber) &&
      selectedQuantityNumber > 0 &&
      !rentalId,
    staleTime: 10_000,
  });

  const selectedPackageAvailability = useMemo(
    () =>
      selectedPackage
        ? packageAvailability.data?.find((item) => item.paket_sewa_id === selectedPackage.paket_sewa_id) ?? null
        : null,
    [packageAvailability.data, selectedPackage],
  );

  const packageTariff = useMemo(() => {
    if (!packageDetail.data || !selectedPackage) return null;
    const active = packageDetail.data.tariffs.filter((tariff) => isActiveCatalogTariff(tariff, rentalTariffAt));
    return active.find((tariff) => tariff.paket_sewa_id === selectedPackage.paket_sewa_id) ?? active[0] ?? null;
  }, [packageDetail.data, rentalTariffAt, selectedPackage]);

  const packageBillingPeriods =
    packageTariff && canMoveFromPeriod
      ? calculateTariffPeriods(startAt, endAt, packageTariff)
      : 0;

  const canAddItem =
    Boolean(selectedProduct && selectedTariff && canMoveFromPeriod) &&
    Number.isInteger(selectedQuantityNumber) &&
    selectedQuantityNumber > 0 &&
    billingPeriods > 0 &&
    selectedQuantityNumber <= selectedReadyStock;

  const canAddPackage =
    Boolean(selectedPackage && packageTariff && canMoveFromPeriod) &&
    packageTariff?.currency_code === "IDR" &&
    packageBillingPeriods > 0 &&
    Number.isInteger(selectedPackageQuantityNumber) &&
    selectedPackageQuantityNumber > 0 &&
    selectedPackageAvailability?.status === "available" &&
    selectedPackageQuantityNumber <= (selectedPackageAvailability?.available_package_quantity ?? 0);

  const selectedRenter = (renters.data ?? []).find((renter) => renter.penyewa_id === selectedRenterId) ?? null;

  const paymentRecorded = operationalWorkspace.data?.payments.reduce(
    (sum, payment) => sum + Number(payment.amount ?? 0),
    0,
  ) ?? 0;
  const operationalTotal = Number(operationalWorkspace.data?.rental.total_amount ?? 0);
  const paymentRemaining = Math.max(0, operationalTotal - paymentRecorded);
  const currentPaymentStatus = paymentStatus(paymentRecorded, operationalTotal);

  const receiptData = useMemo(() => {
    const workspace = operationalWorkspace.data;
    const support = receiptSupport.data;
    const qr = rentalQr.data;
    if (!workspace || !support || !qr) return null;
    return {
      usaha_nama: support.usaha_nama,
      usaha_alamat: support.usaha_alamat,
      usaha_telepon: support.usaha_telepon,
      usaha_email: support.usaha_email,
      timezone: support.timezone,
      nomor_penyewaan: workspace.rental.nomor_penyewaan,
      penyewa_nama: workspace.renter.nama_lengkap,
      penyewa_telepon: support.penyewa_telepon,
      jadwal_mulai: workspace.rental.jadwal_mulai,
      jadwal_kembali: workspace.rental.jadwal_kembali,
      tolerance_deadline: workspace.rental.tolerance_deadline,
      actual_pickup_at: workspace.rental.actual_pickup_at,
      total_amount: Number(workspace.rental.total_amount),
      currency_code: workspace.rental.currency_code,
      token_qr: qr.token_qr,
      url: buildPenyewaanQrUrl(window.location.origin, qr.token_qr),
      generated_at: new Date().toISOString(),
      lines: workspace.lines.map((line) => ({
        nama: line.paket_nama ?? line.barang_nama ?? "Barang",
        rincian: line.varian_nama,
        jumlah: Number(line.jumlah),
        subtotal: Number(line.subtotal),
        currency_code: line.currency_code,
      })),
      catatan: workspace.rental.catatan,
      pembayaran: {
        tercatat: paymentRecorded,
        sisa: paymentRemaining,
        status: (currentPaymentStatus === "paid" ? "lunas" : currentPaymentStatus === "partial" ? "sebagian" : "belum_dibayar") as "lunas" | "sebagian" | "belum_dibayar",
      },
    };
  }, [currentPaymentStatus, operationalWorkspace.data, paymentRecorded, paymentRemaining, receiptSupport.data, rentalQr.data]);

  useEffect(() => {
    if (!context.data || startAt || rentalId) return;
    setStartAt(formatDateTimeLocalInTimezone(new Date(), context.data.timezone));
  }, [context.data, rentalId, startAt]);

  useEffect(() => {
    if (!accounts.data?.length || paymentAccountId) return;
    setPaymentAccountId(accounts.data[0].akun_keuangan_id);
  }, [accounts.data, paymentAccountId]);

  useEffect(() => {
    if (!rentalId || !operationalWorkspace.data) return;
    const status = paymentStatus(
      operationalWorkspace.data.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
      Number(operationalWorkspace.data.rental.total_amount),
    );
    if (status === "paid") {
      setPaymentMode("paid");
      setPaymentAmount(0);
    }
  }, [operationalWorkspace.data, rentalId]);

  const runActivation = async (targetRentalId: string) => {
    if (!context.data) throw new Error("Konteks Usaha belum tersedia.");
    const { activateRentalOperational } = await import("@/features/penyewaan");
    return activateRentalOperational(context.data.usahaId, targetRentalId, {
      idempotencyKey: "activate-rental-workspace-" + targetRentalId,
      requestId: createClientId(),
      catatan: "Serah-terima dari Rental Workspace.",
    });
  };

  const activateImmediatelyAfterCreate = async (targetRentalId: string) => {
    directAfterCreateRef.current = false;
    setRentalCommandState("processing");
    try {
      await runActivation(targetRentalId);
      setRentalCommandState("idle");
      setOperationalFeedback("Penyewaan langsung aktif. Unit ditetapkan melalui orchestration server dan serah-terima tercatat.");
      await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });
      await queryClient.invalidateQueries({ queryKey: ["penyewaan", "operational-workspace", context.data?.usahaId, targetRentalId] });
    } catch (error) {
      setRentalCommandState("error");
      setOperationalFeedback(
        isUnknownOutcome(error)
          ? "Status sewa langsung belum dapat dipastikan. Muat ulang workspace untuk memverifikasi state server sebelum mencoba lagi."
          : commandMessage(error, "Sewa langsung gagal diselesaikan."),
      );
    }
  };

  const createRenterMutation = useMutation({
    mutationFn: () =>
      createRenter(
        context.data!.usahaId,
        { nama_lengkap: newRenterName, nomor_telepon: newRenterPhone },
        { idempotencyKey: renterCommandKey },
      ),
    onSuccess: (result) => {
      setSelectedRenterId(result.penyewa_id);
      setNewRenterName("");
      setNewRenterPhone("");
      setNewRenterOpen(false);
      setRenterCommandKey(createClientId());
      void renters.refetch();
    },
  });

  const createRentalMutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Usaha belum tersedia.");
      if (!selectedRenterId) throw new Error("Pilih penyewa terlebih dahulu.");
      if (!canMoveFromPeriod) throw new Error("Periode rental belum valid.");
      if (!draftLines.length) throw new Error("Tambahkan minimal satu barang atau paket.");
      setRentalCommandState("processing");
      return createDirectRental(
        context.data.usahaId,
        {
          penyewa_id: selectedRenterId,
          jadwal_mulai: localDateTimeToUtcIso(startAt, context.data.timezone),
          jadwal_kembali: localDateTimeToUtcIso(endAt, context.data.timezone),
          catatan: null,
          lines: draftLines.map((line) => line.input),
        },
        { idempotencyKey: rentalCommandKey, requestId: createClientId() },
      );
    },
    onSuccess: async (result) => {
      const id = result.penyewaan_id;
      if (!id) throw new Error("Rental berhasil dibuat tetapi ID penyewaan tidak dikembalikan.");
      setRentalId(id);
      await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });

      if (directAfterCreateRef.current) {
        directAfterCreateRef.current = false;
        await activateImmediatelyAfterCreate(id);
      } else {
        setRentalCommandState("idle");
      }
    },
    onError: async (error) => {
      if (!context.data) {
        directAfterCreateRef.current = false;
        setRentalCommandState("unknown");
        return;
      }
      if (isUnknownOutcome(error)) {
        try {
          const reconciliation = await reconcileDirectRentalCreation(context.data.usahaId, rentalCommandKey);
          if (reconciliation.state === "committed" && reconciliation.response?.penyewaan_id) {
            const id = reconciliation.response.penyewaan_id;
            setRentalId(id);
            if (directAfterCreateRef.current) {
              directAfterCreateRef.current = false;
              await activateImmediatelyAfterCreate(id);
            } else {
              setRentalCommandState("idle");
            }
            return;
          }
          if (reconciliation.state === "not_found") {
            setRentalCommandKey(createClientId());
            setRentalCommandState("unknown");
            return;
          }
        } catch {
          // Keep explicit unknown state.
        }
        directAfterCreateRef.current = false;
        setRentalCommandState("unknown");
        return;
      }
      directAfterCreateRef.current = false;
      setRentalCommandState(isBusinessConflict(error) ? "conflict" : "error");
    },
  });

  const refreshOperational = async () => {
    await Promise.all([
      operationalWorkspace.refetch(),
      queryClient.invalidateQueries({ queryKey: ["keuangan", "rental-payment-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["penyewaan"] }),
    ]);
  };

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !rentalId) throw new Error("Rental belum disiapkan.");
      if (!paymentAccountId) throw new Error("Pilih akun penerima pembayaran.");
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error("Nominal pembayaran harus lebih dari 0.");
      if (paymentAmount > paymentRemaining) throw new Error("Nominal pembayaran melebihi sisa pembayaran.");
      if (!paymentCommandKey) setPaymentCommandKey(createClientId());
      const key = paymentCommandKey ?? createClientId();
      setPaymentCommandKey(key);
      const jenis: RecordPaymentInput["jenis"] = paymentMode === "paid" ? "pelunasan" : "dp";
      return recordPayment(
        context.data.usahaId,
        {
          penyewaanId: rentalId,
          akunKeuanganId: paymentAccountId,
          jenis,
          metode: paymentMethod,
          amount: paymentAmount,
          dibayarAt: formatDateTimeLocalInTimezone(new Date(), context.data.timezone),
          referenceText: null,
          catatan: null,
        },
        {
          idempotencyKey: key,
          requestId: createClientId(),
          businessTimezone: context.data.timezone,
        },
      );
    },
    onMutate: () => setPaymentState("processing"),
    onSuccess: async () => {
      setPaymentState("idle");
      setPaymentCommandKey(null);
      setPaymentAmount(0);
      await refreshOperational();
    },
    onError: async (error) => {
      if (!context.data || !paymentCommandKey) {
        setPaymentState("unknown");
        return;
      }
      try {
        const reconciliation = await reconcilePaymentCommand(context.data.usahaId, paymentCommandKey);
        if (reconciliation.state === "committed") {
          setPaymentState("idle");
          setPaymentCommandKey(null);
          setPaymentAmount(0);
          await refreshOperational();
          return;
        }
        if (reconciliation.state === "not_found") {
          setPaymentCommandKey(null);
          setPaymentState(isBusinessConflict(error) ? "conflict" : "error");
          return;
        }
      } catch {
        // Preserve unknown outcome.
      }
      setPaymentState("unknown");
    },
  });

  const activationMutation = useMutation({
    mutationFn: async (targetRentalId?: string) => {
      const id = targetRentalId ?? rentalId;
      if (!id) throw new Error("Rental belum disiapkan.");
      return runActivation(id);
    },
    onMutate: () => {
      setOperationalFeedback("");
      setRentalCommandState("processing");
    },
    onSuccess: async () => {
      setRentalCommandState("idle");
      setUnitExceptionOpen(false);
      setOperationalFeedback("Penyewaan berhasil diaktifkan. Unit ditetapkan melalui orchestration server dan serah-terima tercatat.");
      await refreshOperational();
    },
    onError: async (error) => {
      setRentalCommandState("error");
      const message = commandMessage(error, "Serah-terima dan aktivasi rental gagal.");
      if (isUnknownOutcome(error)) {
        setOperationalFeedback("Status serah-terima belum dapat dipastikan. Jangan mengirim ulang mutation secara buta. Muat ulang workspace untuk memverifikasi state server.");
        return;
      }
      setOperationalFeedback(message);
      if (message.toLowerCase().includes("unit") || message.toLowerCase().includes("assignment")) {
        setUnitExceptionOpen(true);
      }
    },
  });

  const canPrepareRental = Boolean(selectedRenterId && canMoveFromPeriod && draftLines.length > 0);

  const handleDirectRental = () => {
    if (!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending) return;
    if (rentalId) {
      activationMutation.mutate(rentalId);
      return;
    }
    directAfterCreateRef.current = true;
    createRentalMutation.mutate();
  };

  const rentalCreated = Boolean(rentalId);
  const isActive = operationalWorkspace.data?.rental.status === "active";
  const totalReadyLabel = isActive
    ? operationalWorkspace.data?.lines.reduce((sum, line) => sum + line.assignments.length, 0) ?? 0
    : 0;

  const selectedProductImage = itemDialogId
    ? (selectedVariantId
      ? unitCoverByVariant.get(selectedVariantId) ?? unitCoverByProduct.get(itemDialogId) ?? coverByProduct.get(itemDialogId)
      : unitCoverByProduct.get(itemDialogId) ?? coverByProduct.get(itemDialogId)) ?? null
    : null;

  const openItemDialog = (product: CatalogProduct) => {
    setSelectedVariantId("");
    setSelectedQuantity("1");
    setCatalogDialog({ open: true, mode: "item", id: product.barang_id });
  };

  const openPackageDialog = (pkg: CatalogPackage) => {
    setSelectedPackageQuantity("1");
    setSelectedPackageNote("");
    setCatalogDialog({ open: true, mode: "package", id: pkg.paket_sewa_id });
  };

  const closeCatalogDialog = () => {
    setCatalogDialog({ open: false });
    setSelectedVariantId("");
    setSelectedQuantity("1");
    setSelectedPackageQuantity("1");
    setSelectedPackageNote("");
  };

  const addCurrentItem = () => {
    if (!selectedProduct || !canAddItem || !catalogDialog.open) return;
    const quantity = Number(selectedQuantity);
    const lineVariantId = effectiveVariantId;
    const lineTariff =
      (lineVariantId
        ? productDetail.data?.tariffs.find(
            (tariff) =>
              tariff.varian_barang_id === lineVariantId &&
              isActiveCatalogTariff(tariff),
          )
        : null) ??
      selectedTariff;
    const lineBillingPeriods =
      lineTariff && canMoveFromPeriod
        ? calculateTariffPeriods(startAt, endAt, lineTariff)
        : billingPeriods;
    if (!lineTariff || !lineBillingPeriods) return;

    const input: DirectRentalLineInput = {
      barang_id: selectedProduct.barang_id,
      varian_barang_id: lineVariantId || null,
      tarif_sewa_id: lineTariff.tarif_sewa_id,
      duration_periods: lineBillingPeriods,
      jumlah: quantity,
      unit_price: Number(lineTariff.nominal),
      subtotal: calculateRentalLineSubtotal(quantity, Number(lineTariff.nominal), lineBillingPeriods),
      currency_code: "IDR",
      catatan: null,
    };

    const identity = getLineIdentity(selectedProduct.barang_id, lineVariantId);
    setPickerLines((current) => {
      const existing = current.find((line) => line.key === identity);
      if (existing) {
        return current.map((line) =>
          line.key === identity
            ? {
                ...line,
                input,
                description: (selectedVariant?.nama ?? "Barang utama") + " · " + quantity + " unit",
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
          description: (selectedVariant?.nama ?? "Barang utama") + " · " + quantity + " unit",
          input,
        },
      ];
    });
    closeCatalogDialog();
  };

  const addCurrentPackage = () => {
    if (!selectedPackage || !packageTariff || !canAddPackage || !catalogDialog.open) return;
    const quantity = Number(selectedPackageQuantity);
    const input: DirectRentalLineInput = {
      paket_sewa_id: selectedPackage.paket_sewa_id,
      tarif_sewa_id: packageTariff.tarif_sewa_id,
      duration_periods: packageBillingPeriods,
      jumlah: quantity,
      unit_price: Number(packageTariff.nominal),
      subtotal: calculateRentalLineSubtotal(quantity, Number(packageTariff.nominal), packageBillingPeriods),
      currency_code: "IDR",
      catatan: selectedPackageNote.trim() || null,
    };
    const identity = "package:" + selectedPackage.paket_sewa_id;
    setPickerLines((current) => {
      const existing = current.find((line) => line.key === identity);
      if (existing) {
        return current.map((line) => (line.key === identity ? { ...line, input, description: "Paket × " + quantity } : line));
      }
      return [
        ...current,
        {
          key: identity,
          kind: "package",
          label: selectedPackage.nama,
          description: "Paket × " + quantity,
          input,
        },
      ];
    });
    closeCatalogDialog();
  };

  const updateLinesQuantity = (
    setter: React.Dispatch<React.SetStateAction<DraftRentalLine[]>>,
    key: string,
    delta: number,
  ) => {
    setter((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = Math.max(1, Number(line.input.jumlah) + delta);
        const subtotal = calculateRentalLineSubtotal(
          next,
          Number(line.input.unit_price),
          Number(line.input.duration_periods),
        );
        return {
          ...line,
          input: { ...line.input, jumlah: next, subtotal },
          description:
            line.kind === "package"
              ? "Paket × " + next
              : line.description.replace(/×?\s*\d+\s*unit/i, "").trim() + " · " + next + " unit",
        };
      }),
    );
  };

  const updateLineQuantity = (key: string, delta: number) =>
    updateLinesQuantity(setDraftLines, key, delta);

  const removeLine = (key: string) => {
    setDraftLines((current) => current.filter((line) => line.key !== key));
  };

  const editLine = (line: DraftRentalLine, picker = false) => {
    if (line.kind !== "item") return;
    const parts = line.key.split(":");
    const productId = parts[1] ?? "";
    const variantId = parts[2] === "base" ? "" : parts.slice(2).join(":");
    setSelectedVariantId(variantId);
    setSelectedQuantity(String(line.input.jumlah));
    setCatalogDialog({ open: true, mode: "item", id: productId });
    if (!picker) setCatalogPickerOpen(true);
  };

  const pickerTotal = pickerLines.reduce((sum, line) => sum + Number(line.input.subtotal), 0);

  const openCatalogPicker = () => {
    setPickerLines(draftLines.map((line) => ({ ...line, input: { ...line.input } })));
    setProductSearch("");
    setCategoryId("all");
    setSelectionMode("item");
    setCatalogDialog({ open: false });
    setCatalogPickerOpen(true);
  };

  const applyCatalogPicker = () => {
    setDraftLines(pickerLines.map((line) => ({ ...line, input: { ...line.input } })));
    setCatalogPickerOpen(false);
    setCatalogDialog({ open: false });
  };

  const reconcileRenter = async () => {
    if (!context.data) return;
    const result = await reconcileRenterCreation(context.data.usahaId, renterCommandKey);
    if (result.state === "committed" && result.response?.penyewa_id) {
      setSelectedRenterId(result.response.penyewa_id);
      setNewRenterOpen(false);
      setRenterCommandKey(createClientId());
      void renters.refetch();
      return;
    }
    setNewRenterOpen(true);
  };

  if (context.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat konteks Usaha…</div>;
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Rental belum dapat dibuka</AlertTitle>
        <AlertDescription>{commandMessage(context.error, "Konteks Usaha tidak tersedia.")}</AlertDescription>
      </Alert>
    );
  }

  const workspace = operationalWorkspace.data;
  const prepared = rentalCreated && Boolean(workspace);
  const showPayment = prepared;
  const showOperations = prepared;
  const showOutput = prepared && isActive;

  const paymentActionLabel =
    currentPaymentStatus === "paid"
      ? "Lunas"
      : paymentMode === "paid"
        ? "Catat Pelunasan"
        : "Catat DP";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 pb-28 lg:space-y-4 lg:pb-10">
      <header className="rounded-2xl border bg-card px-3 py-3 shadow-[0_3px_14px_rgba(23,61,51,.05)] sm:px-4">
        <div className="flex items-center gap-2.5">
          <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-xl" aria-label="Kembali ke penyewaan">
            <Link to={paths.penyewaan}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[17px] font-bold tracking-tight">{prepared ? (workspace?.rental.nomor_penyewaan ?? "Rental") : "Rental Baru"}</h1>
              <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[9px]">{prepared ? "Operasional" : "Penyewaan Langsung"}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{prepared ? workspace?.renter.nama_lengkap : selectedRenter?.nama_lengkap ?? "Pilih penyewa"}</span>
              <span>·</span>
              <span>{prepared ? workspace?.renter.nomor_telepon ?? "—" : selectedRenter?.nomor_telepon ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <div className="rounded-xl bg-muted/35 px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Mulai</p>
            <p className="mt-0.5 truncate text-[10px] font-semibold">
              {prepared && workspace ? formatRentalDateTime(workspace.rental.jadwal_mulai) : startAt || "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted/35 px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Kembali</p>
            <p className="mt-0.5 truncate text-[10px] font-semibold">
              {prepared && workspace ? formatRentalDateTime(workspace.rental.jadwal_kembali) : endAt || "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted/35 px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Durasi / Periode</p>
            <p className="mt-0.5 truncate text-[10px] font-semibold">
              {periodPreview ? formatDurationLabel(periodPreview.elapsedSeconds) + " · " + periodPreview.dailyPeriods + " periode" : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted/35 px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Tolerance</p>
            <p className="mt-0.5 truncate text-[10px] font-semibold">
              {prepared && workspace
                ? formatRentalDateTime(workspace.rental.tolerance_deadline)
                : periodPreview
                  ? formatWorkspaceDateTime(periodPreview.toleranceDeadline, context.data.timezone)
                  : "—"}
            </p>
          </div>
        </div>
      </header>

      <main className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-4">
        <div className="order-1 space-y-3 lg:order-1">
          <section className="rounded-2xl border bg-card">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Konteks Rental</p>
                  <h2 className="mt-0.5 text-[14px] font-bold">Siapa · Kapan</h2>
                </div>
                {prepared ? <Badge variant="outline" className="rounded-full text-[9px]">Terkunci</Badge> : null}
              </div>

              {!rentalCreated ? (
                <>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 flex-1 justify-start rounded-xl px-3 text-left"
                      onClick={() => {
                        setRenterPickerSearch("");
                        setRenterPickerOpen(true);
                      }}
                    >
                      {selectedRenter ? <Users className="size-4" /> : <Search className="size-4" />}
                      <span className="min-w-0 flex-1 truncate">
                        {`${selectedRenter ? selectedRenter.nama_lengkap : "Pilih penyewa / cari nama atau nomor"}${selectedRenter?.nomor_telepon ? " · " + selectedRenter.nomor_telepon : ""}`}
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    </Button>
                    <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setNewRenterOpen(true)}>
                      <UserPlus className="size-4" />
                      Baru
                    </Button>
                  </div>

                  {selectedRenter ? (
                    <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border bg-primary/[0.035] px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold">{selectedRenter.nama_lengkap}</p>
                        <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{selectedRenter.nomor_telepon || "Nomor telepon tidak tersedia"}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-[10px]" onClick={() => setSelectedRenterId("")}>Ganti</Button>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed px-3 py-2 text-[9px] text-muted-foreground">
                      Belum ada penyewa. Pilih penyewa untuk melanjutkan rental.
                    </div>
                  )}

                  <div className="mt-3 border-t pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Periode</p>
                        <p className="mt-0.5 text-[13px] font-bold">Kapan rental berlangsung?</p>
                      </div>
                      {periodPreview ? <Badge variant={periodPreview.isOver24Hours ? "destructive" : "secondary"} className="rounded-full text-[9px]">{periodPreview.dailyPeriods} periode tarif</Badge> : null}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[9px] font-medium text-muted-foreground">Mulai sewa</span>
                        <Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="h-10 rounded-xl text-xs" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[9px] font-medium text-muted-foreground">Kembali</span>
                        <Input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} className="h-10 rounded-xl text-xs" />
                      </label>
                    </div>

                    {periodPreview?.isOver24Hours ? (
                      <div className="mt-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[10px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">
                        <p className="font-bold">⚠ Durasi melewati 24 jam</p>
                        <p className="mt-0.5">
                          Lebih 24 jam sebesar {formatDurationLabel(periodPreview.excessOver24hSeconds)}. Tarif harian 1 hari → {periodPreview.dailyPeriods} periode tarif.
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg border px-2 py-2">
                        <p className="text-[8px] text-muted-foreground">Durasi</p>
                        <p className="mt-0.5 truncate text-[9px] font-semibold">{periodPreview ? formatDurationLabel(periodPreview.elapsedSeconds) : "—"}</p>
                      </div>
                      <div className="rounded-lg border px-2 py-2">
                        <p className="text-[8px] text-muted-foreground">Periode</p>
                        <p className="mt-0.5 truncate text-[9px] font-semibold">{periodPreview ? periodPreview.dailyPeriods + " tarif" : "—"}</p>
                      </div>
                      <div className="rounded-lg border px-2 py-2">
                        <p className="text-[8px] text-muted-foreground">Tolerance</p>
                        <p className="mt-0.5 truncate text-[9px] font-semibold">{periodPreview ? formatWorkspaceDateTime(periodPreview.toleranceDeadline, context.data.timezone) : "—"}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-[8px] text-muted-foreground">Penyewa</p>
                    <p className="mt-0.5 truncate text-[11px] font-semibold">{workspace?.renter.nama_lengkap}</p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{workspace?.renter.nomor_telepon ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-[8px] text-muted-foreground">Periode</p>
                    <p className="mt-0.5 text-[10px] font-semibold">{workspace ? formatRentalDateTime(workspace.rental.jadwal_mulai) : "Memuat…"}</p>
                    <p className="text-[9px] text-muted-foreground">→ {workspace ? formatRentalDateTime(workspace.rental.jadwal_kembali) : "—"}</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-[8px] text-muted-foreground">Tolerance</p>
                    <p className="mt-0.5 text-[10px] font-semibold">{workspace ? formatRentalDateTime(workspace.rental.tolerance_deadline) : "—"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </section>

          {!rentalCreated ? (
            <section className="rounded-2xl border bg-card">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                      <ShoppingBag className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Katalog</p>
                      <h2 className="text-[14px] font-bold">Sewa apa?</h2>
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-full text-[9px]">
                    {draftLines.length} item
                  </Badge>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-12 w-full justify-between rounded-xl px-3"
                  onClick={openCatalogPicker}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary">
                      <Search className="size-4" />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-[10px] font-semibold">Buka Katalog Rental</span>
                      <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                        Cari foto, kategori, varian, ready stock, dan tarif
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Button>

                {draftLines.length ? (
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {draftLines.slice(0, 4).map((line) => (
                      <div key={line.key} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/15 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[9px] font-semibold">{line.label}</p>
                          <p className="mt-0.5 truncate text-[8px] text-muted-foreground">{line.description} · {line.input.duration_periods} periode</p>
                        </div>
                        <span className="shrink-0 text-[9px] font-bold">{formatRentalMoney(line.input.subtotal, "IDR")}</span>
                      </div>
                    ))}
                    {draftLines.length > 4 ? <p className="px-1 text-[8px] text-muted-foreground">+ {draftLines.length - 4} item lain di keranjang.</p> : null}
                  </div>
                ) : (
                  <p className="mt-2 text-[9px] text-muted-foreground">Belum ada barang. Pilih barang atau paket melalui katalog.</p>
                )}
              </CardContent>
            </section>
          ) : (
            <section className="rounded-2xl border bg-card">
              <CardContent className="flex items-center justify-between gap-3 p-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Check className="size-4" /></span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rental sudah disiapkan</p>
                    <p className="truncate text-[12px] font-bold">{workspace?.rental.nomor_penyewaan}</p>
                  </div>
                </div>
                <Badge variant={isActive ? "default" : "secondary"} className="rounded-full text-[9px]">{isActive ? "Aktif" : "Siap dioperasikan"}</Badge>
              </CardContent>
            </section>
          )}
        </div>

        <aside className="order-2 space-y-3 lg:order-2">
          <section className="rounded-2xl border bg-card">
            <CardHeader className="px-3.5 pb-2.5 pt-3.5 sm:px-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-primary" />
                  <CardTitle className="text-[14px]">Keranjang Rental</CardTitle>
                </div>
                <Badge variant="secondary" className="rounded-full text-[9px]">{prepared ? "Tersimpan" : draftLines.length + " line"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 px-3.5 pb-3.5 pt-0 sm:px-4">
              {(prepared ? (workspace?.lines ?? []) : draftLines).length ? (
                prepared ? (
                  (workspace?.lines ?? []).map((line) => (
                    <div key={line.detail_penyewaan_id} className="rounded-xl border px-2.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold">{line.paket_nama ?? line.barang_nama ?? "Barang"}</p>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{line.varian_nama ?? "Utama"} · {line.jumlah} unit · {line.subtotal ? line.unit_price + " / unit" : ""}</p>
                        </div>
                        <p className="shrink-0 text-[10px] font-bold">{formatRentalMoney(line.subtotal, line.currency_code)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  draftLines.map((line) => (
                    <div key={line.key} className="rounded-xl border px-2.5 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="rounded-full px-1.5 py-0.5 text-[8px]">{line.kind === "package" ? "Paket" : "Barang"}</Badge>
                            <p className="truncate text-[11px] font-semibold">{line.label}</p>
                          </div>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{line.description} · {line.input.duration_periods} periode</p>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Button type="button" variant="outline" size="icon" className="size-7 rounded-lg" onClick={() => updateLineQuantity(line.key, -1)} disabled={Number(line.input.jumlah) <= 1}>−</Button>
                            <span className="min-w-5 text-center text-[10px] font-bold">{line.input.jumlah}</span>
                            <Button type="button" variant="outline" size="icon" className="size-7 rounded-lg" onClick={() => updateLineQuantity(line.key, 1)}>+</Button>
                            {line.kind === "item" ? <Button type="button" variant="ghost" size="icon" className="ml-1 size-7 rounded-lg" aria-label={"Edit " + line.label} onClick={() => editLine(line)}><ChevronDown className="size-3.5 rotate-[-90deg]" /></Button> : null}
                            <Button type="button" variant="ghost" size="icon" className="ml-auto size-7 rounded-lg text-destructive" aria-label={"Hapus " + line.label} onClick={() => removeLine(line.key)}><Trash2 className="size-3.5" /></Button>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[8px] text-muted-foreground">Subtotal</p>
                          <p className="mt-0.5 text-[11px] font-bold">{formatRentalMoney(line.input.subtotal, line.input.currency_code ?? "IDR")}</p>
                        </div>
                      </div>
                      <div className="mt-2 border-t pt-2 text-[9px] text-muted-foreground">
                        {Number(line.input.jumlah)} unit × {Number(line.input.duration_periods)} periode × {formatRentalMoney(line.input.unit_price, "IDR")}
                      </div>
                    </div>
                  ))
                )
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-center text-[10px] text-muted-foreground">Belum ada barang di keranjang.</div>
              )}

              <div className="border-t pt-2.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted-foreground">Total rental</span>
                  <span className="text-[16px] font-bold">{formatRentalMoney(prepared ? operationalTotal : totalRental, "IDR")}</span>
                </div>
                {!rentalCreated ? (
                  <Button className="mt-2.5 h-10 w-full rounded-xl text-[11px]" disabled={!canPrepareRental || createRentalMutation.isPending} onClick={() => createRentalMutation.mutate()}>
                    {createRentalMutation.isPending || rentalCommandState === "processing" ? <><Loader2 className="animate-spin" /> Menyiapkan…</> : <>Siapkan Rental <ArrowRight /></>}
                  </Button>
                ) : null}
              </div>

              {rentalCommandState === "unknown" && !rentalCreated ? (
                <Alert className="mt-2 rounded-xl">
                  <RefreshCw className="size-4" />
                  <AlertTitle>Hasil pembuatan belum pasti</AlertTitle>
                  <AlertDescription>Periksa state rental sebelum mengirim ulang. Jangan membuat rental kedua secara buta.</AlertDescription>
                </Alert>
              ) : null}
              {rentalCommandState === "conflict" && !rentalCreated ? (
                <Alert variant="destructive" className="mt-2 rounded-xl">
                  <AlertTitle>Data rental berubah</AlertTitle>
                  <AlertDescription>{commandMessage(createRentalMutation.error, "Server menolak data rental saat validasi akhir.")}</AlertDescription>
                </Alert>
              ) : null}
              {rentalCommandState === "error" && !rentalCreated ? (
                <Alert variant="destructive" className="mt-2 rounded-xl">
                  <AlertTitle>Rental belum dapat disiapkan</AlertTitle>
                  <AlertDescription>{commandMessage(createRentalMutation.error, "Pembuatan rental gagal.")}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </section>

          {showPayment ? (
            <section className="rounded-2xl border bg-card">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <WalletCards className="size-4 text-emerald-700" />
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pembayaran</p>
                      <h2 className="text-[14px] font-bold">{formatRentalMoney(operationalTotal, "IDR")}</h2>
                    </div>
                  </div>
                  <Badge variant={currentPaymentStatus === "paid" ? "default" : currentPaymentStatus === "partial" ? "secondary" : "outline"} className="rounded-full text-[9px]">{statusLabel(currentPaymentStatus)}</Badge>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {([
                    ["unpaid", "Belum Bayar"],
                    ["dp", "DP"],
                    ["paid", "Lunas"],
                  ] as const).map(([mode, label]) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={paymentMode === mode ? "default" : "outline"}
                      className="h-8 rounded-full px-2 text-[9px]"
                      disabled={currentPaymentStatus === "paid" && mode !== "paid"}
                      onClick={() => {
                        setPaymentMode(mode);
                        if (mode === "paid") setPaymentAmount(paymentRemaining);
                        if (mode === "unpaid") setPaymentAmount(0);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border px-2.5 py-2">
                    <p className="text-[8px] text-muted-foreground">Sudah bayar</p>
                    <p className="mt-0.5 text-[10px] font-bold">{formatRentalMoney(paymentRecorded, "IDR")}</p>
                  </div>
                  <div className="rounded-lg border px-2.5 py-2">
                    <p className="text-[8px] text-muted-foreground">Sisa</p>
                    <p className="mt-0.5 text-[10px] font-bold">{formatRentalMoney(paymentRemaining, "IDR")}</p>
                  </div>
                </div>

                {currentPaymentStatus !== "paid" && paymentMode !== "unpaid" ? (
                  <div className="mt-2.5 space-y-2">
                    <label className="space-y-1">
                      <span className="text-[9px] font-medium text-muted-foreground">Nominal</span>
                      <div className="flex items-center rounded-xl border px-2.5">
                        <span className="text-[10px] font-semibold text-muted-foreground">Rp</span>
                        <Input
                          type="number"
                          min={1}
                          value={paymentAmount || ""}
                          onChange={(event) => setPaymentAmount(Number(event.target.value))}
                          className="h-10 border-0 px-2 text-right text-[12px] font-bold shadow-none focus-visible:ring-0"
                          placeholder={paymentMode === "paid" ? String(paymentRemaining) : "0"}
                        />
                      </div>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[9px] font-medium text-muted-foreground">Uang masuk ke</span>
                      <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                        <SelectTrigger className="h-10 rounded-xl text-[10px]"><SelectValue placeholder={accounts.isPending ? "Memuat akun…" : "Pilih akun uang"} /></SelectTrigger>
                        <SelectContent>
                          {(accounts.data ?? []).map((account) => (
                            <SelectItem key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                              {account.nama_akun}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <p className="text-[8px] text-muted-foreground">Metode pembayaran default: Cash. Finance tetap mencatat payment dan transaksi pemasukan melalui command existing.</p>

                    <Button
                      type="button"
                      className="h-10 w-full rounded-xl text-[10px]"
                      disabled={paymentState === "processing" || !paymentAccountId || paymentAmount <= 0 || paymentAmount > paymentRemaining}
                      onClick={() => paymentMutation.mutate()}
                    >
                      {paymentState === "processing" ? <><Loader2 className="animate-spin" /> Mencatat…</> : <><CreditCard className="size-4" />{paymentActionLabel}</>}
                    </Button>
                  </div>
                ) : null}

                {paymentState === "unknown" ? (
                  <Alert className="mt-2.5 rounded-xl">
                    <RefreshCw className="size-4" />
                    <AlertTitle>Status pembayaran belum pasti</AlertTitle>
                    <AlertDescription>Rekonsiliasi diperlukan sebelum pengiriman ulang. Sistem tidak melakukan blind retry.</AlertDescription>
                  </Alert>
                ) : null}
                {paymentState === "error" || paymentState === "conflict" ? (
                  <Alert variant="destructive" className="mt-2.5 rounded-xl">
                    <AlertTitle>Pembayaran belum tersimpan</AlertTitle>
                    <AlertDescription>{paymentMutation.error ? commandMessage(paymentMutation.error, "Pencatatan pembayaran gagal.") : "Validasi pembayaran gagal."}</AlertDescription>
                  </Alert>
                ) : null}
                <p className="mt-2 text-[8px] leading-4 text-muted-foreground">Finance tetap menjadi source of truth. Pembayaran dari workspace ini tetap membuat payment dan financial transaction melalui command Finance existing.</p>
              </CardContent>
            </section>
          ) : null}

          {showOperations ? (
            <section className="rounded-2xl border bg-card">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="size-4 text-primary" />
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Unit</p>
                      <h2 className="text-[14px] font-bold">Penetapan Unit</h2>
                    </div>
                  </div>
                  {isActive ? (
                    <Badge className="rounded-full text-[9px]">Serah-terima tercatat</Badge>
                  ) : (
                    <Badge variant="secondary" className="rounded-full text-[9px]">Auto saat Langsung Sewa</Badge>
                  )}
                </div>

                {!isActive ? (
                  <div className="mt-2 rounded-xl border bg-muted/20 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Check className="size-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold">Sistem akan memilih unit otomatis.</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">Manual unit hanya dipakai jika auto-assignment gagal atau operator perlu substitution.</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-[9px]"
                        onClick={() => setUnitExceptionOpen((value) => !value)}
                      >
                        <PackageCheck className="size-3.5" />
                        {unitExceptionOpen ? "Tutup Penetapan Unit" : "Tetapkan / Pilih Unit"}
                      </Button>
                      <span className="text-[8px] text-muted-foreground">Manual tersedia bila admin perlu menentukan unit fisik; Langsung Sewa tetap auto-assignment.</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {workspace?.lines.flatMap((line) => line.assignments.map((assignment) => (
                      <div key={assignment.penetapan_unit_id} className="flex items-center justify-between gap-3 rounded-xl border px-2.5 py-2">
                        <div className="min-w-0"><p className="text-[10px] font-semibold">{assignment.kode_unit}</p><p className="text-[8px] text-muted-foreground">{assignment.status}</p></div>
                        <Badge variant="outline" className="rounded-full text-[8px]">Ditugaskan</Badge>
                      </div>
                    )))}
                    <div className="rounded-xl bg-emerald-50 px-2.5 py-2 text-[9px] font-medium text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200">
                      ✓ {totalReadyLabel} unit sudah ditetapkan dan serah-terima tercatat.
                    </div>
                  </div>
                )}

                {unitExceptionOpen && rentalDetail.data ? (
                  <div className="mt-2.5 rounded-xl border border-amber-300/70 bg-amber-50/60 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/15">
                    <p className="mb-2 text-[9px] font-semibold text-amber-900 dark:text-amber-200">Jalur exception — gunakan hanya jika auto-assignment bermasalah.</p>
                    <RentalPhase2Actions
                      context={{ ...context.data, timezone: context.data.timezone }}
                      rental={rentalDetail.data}
                      onChanged={async () => {
                        setUnitExceptionOpen(false);
                        await refreshOperational();
                      }}
                    />
                  </div>
                ) : null}

                {operationalFeedback ? (
                  <Alert className="mt-2.5 rounded-xl">
                    <PackageCheck className="size-4" />
                    <AlertTitle>Status operasional</AlertTitle>
                    <AlertDescription>{operationalFeedback}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </section>
          ) : null}

          {showOutput ? (
            <section className="rounded-2xl border bg-card">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-4.5" /></span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Sukses & Output</p>
                    <h2 className="mt-0.5 text-[16px] font-bold">Penyewaan Aktif</h2>
                    <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">Barang sudah diserahkan kepada penyewa. Rental dapat ditelusuri dengan QR dan dicetak sebagai bukti transaksi.</p>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <Button type="button" variant="outline" className="h-9 rounded-xl text-[9px]" disabled={!rentalQr.data} onClick={() => setQrOpen(true)}>
                    <QrCode className="size-3.5" /> QR Penyewaan
                  </Button>
                  <Button type="button" className="h-9 rounded-xl text-[9px]" disabled={!receiptData} onClick={() => setReceiptOpen(true)}>
                    <ReceiptText className="size-3.5" /> Struk 58 mm
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px]">
                  <div className="rounded-lg border px-2.5 py-2"><span className="text-muted-foreground">Rental</span><p className="mt-0.5 font-semibold">{workspace?.rental.nomor_penyewaan}</p></div>
                  <div className="rounded-lg border px-2.5 py-2"><span className="text-muted-foreground">Status pembayaran</span><p className="mt-0.5 font-semibold">{statusLabel(currentPaymentStatus)}</p></div>
                </div>
              </CardContent>
            </section>
          ) : null}
        </aside>
      </main>

      {rentalId && operationalWorkspace.isPending ? (
        <div className="rounded-xl border bg-card p-3 text-[10px] text-muted-foreground">Memuat state operasional rental…</div>
      ) : null}

      {prepared && operationalWorkspace.error ? (
        <Alert variant="destructive" className="rounded-xl">
          <AlertTitle>State operasional belum dapat dibaca</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{commandMessage(operationalWorkspace.error, "Workspace rental tidak mengembalikan state terbaru.")}</span>
            <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => void operationalWorkspace.refetch()}><RefreshCw /> Muat ulang</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="sticky bottom-2 z-30 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{prepared ? "Total Rental" : "Total"}</p>
            <p className="truncate text-[14px] font-black">{formatRentalMoney(prepared ? operationalTotal : totalRental, "IDR")}</p>
            {prepared ? <p className="truncate text-[8px] text-muted-foreground">{formatRentalMoney(paymentRecorded, "IDR")} dibayar · {formatRentalMoney(paymentRemaining, "IDR")} sisa</p> : null}
          </div>

          {!rentalCreated ? (
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl px-3 text-[9px]"
                disabled={!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending}
                onClick={() => createRentalMutation.mutate()}
              >
                {createRentalMutation.isPending && !directAfterCreateRef.current ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                {createRentalMutation.isPending && !directAfterCreateRef.current ? "Menyiapkan…" : "Siapkan Rental"}
              </Button>
              <Button
                type="button"
                className="h-10 rounded-xl px-3 text-[9px]"
                disabled={!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending}
                onClick={handleDirectRental}
              >
                {(createRentalMutation.isPending && directAfterCreateRef.current) || activationMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck className="size-3.5" />}
                {(createRentalMutation.isPending && directAfterCreateRef.current) || activationMutation.isPending ? "Menyiapkan…" : "Langsung Sewa"}
              </Button>
            </div>
          ) : isActive ? (
            <Button type="button" variant="outline" className="h-10 rounded-xl px-4 text-[10px]" onClick={() => setReceiptOpen(true)} disabled={!receiptData}>
              <ReceiptText className="size-3.5" /> Output
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 rounded-xl px-4 text-[10px]"
              disabled={activationMutation.isPending || operationalWorkspace.isPending}
              onClick={() => activationMutation.mutate()}
            >
              {activationMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck className="size-3.5" />}
              {activationMutation.isPending ? "Menyiapkan serah-terima…" : "Langsung Sewa"}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={catalogPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCatalogPickerOpen(false);
            setCatalogDialog({ open: false });
          }
        }}
      >
        <DialogContent
          style={{ width: "92vw", height: "90vh", maxWidth: "1400px" }}
          className="!flex !max-w-none flex-col gap-0 overflow-hidden rounded-3xl p-0"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-xl"
                onClick={() => {
                  setCatalogPickerOpen(false);
                  setCatalogDialog({ open: false });
                }}
                aria-label="Tutup katalog"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-[16px]">Katalog Rental</DialogTitle>
                <DialogDescription className="mt-0.5 text-[10px]">
                  Pilih foto, produk, varian, ready stock, dan jumlah. Pilihan disimpan sementara sampai diterapkan ke Rental.
                </DialogDescription>
              </div>
              <Badge variant="secondary" className="rounded-full">
                {pickerLines.length} item
              </Badge>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-2xl border bg-background px-3">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Cari barang, kategori, atau kode unit…"
                    aria-label="Cari barang di katalog"
                    className="h-11 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
                  />
                  <Filter className="size-4 shrink-0 text-muted-foreground" />
                </div>

                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={categoryId === "all" ? "default" : "outline"}
                    className="h-8 shrink-0 rounded-full px-3 text-[10px]"
                    onClick={() => setCategoryId("all")}
                  >
                    Semua
                  </Button>
                  {categories.map((category) => (
                    <Button
                      key={category.id}
                      type="button"
                      size="sm"
                      variant={categoryId === category.id ? "default" : "outline"}
                      className="h-8 shrink-0 rounded-full px-3 text-[10px]"
                      onClick={() => setCategoryId(category.id)}
                    >
                      {category.nama}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant={selectionMode === "package" ? "default" : "outline"}
                    className="h-8 shrink-0 rounded-full px-3 text-[10px]"
                    onClick={() => setSelectionMode(selectionMode === "item" ? "package" : "item")}
                  >
                    {selectionMode === "item" ? "Paket" : "Barang"}
                  </Button>
                </div>

                {selectionMode === "item" ? (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    {activeProducts.map((product) => {
                      const ready = readyStock.data?.byProduct[product.barang_id] ?? 0;
                      const cover = unitCoverByProduct.get(product.barang_id) ?? coverByProduct.get(product.barang_id);
                      const isSelected = catalogDialog.open && catalogDialog.mode === "item" && catalogDialog.id === product.barang_id;

                      return (
                        <button
                          key={product.barang_id}
                          type="button"
                          onClick={() => openItemDialog(product)}
                          className={cn(
                            "overflow-hidden rounded-2xl border bg-card text-left transition hover:-translate-y-0.5 hover:shadow-md",
                            isSelected && "border-primary ring-2 ring-primary/15",
                          )}
                        >
                          <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                            {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <Package className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />}
                            <Badge className="absolute left-2 top-2 rounded-full bg-background/90 text-[8px] text-foreground hover:bg-background/90">
                              {ready > 0 ? "Siap" : "Habis"}
                            </Badge>
                          </div>
                          <div className="space-y-1.5 p-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-bold">{product.nama}</p>
                              <p className="truncate text-[9px] text-muted-foreground">{product.kategori?.nama ?? "Barang"}</p>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn("text-[9px] font-semibold", ready > 0 ? "text-emerald-600" : "text-muted-foreground")}>Ready {ready}</span>
                              <span className="text-[9px] font-semibold text-primary">
                                {product.active_tariff ? formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code) : "Tarif —"}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {!activeProducts.length ? (
                      <div className="col-span-full rounded-2xl border border-dashed p-10 text-center text-xs text-muted-foreground">
                        Barang tidak ditemukan untuk pencarian/filter ini.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    {(packages.data ?? [])
                      .filter((pkg) => pkg.nama.toLowerCase().includes(productSearch.trim().toLowerCase()))
                      .map((pkg) => {
                        const availability = packageAvailability.data?.find((item) => item.paket_sewa_id === pkg.paket_sewa_id);
                        const isSelected = catalogDialog.open && catalogDialog.mode === "package" && catalogDialog.id === pkg.paket_sewa_id;
                        return (
                          <button
                            key={pkg.paket_sewa_id}
                            type="button"
                            onClick={() => openPackageDialog(pkg)}
                            className={cn(
                              "overflow-hidden rounded-2xl border bg-card text-left transition hover:-translate-y-0.5 hover:shadow-md",
                              isSelected && "border-primary ring-2 ring-primary/15",
                            )}
                          >
                            <div className="flex aspect-[4/3] items-center justify-center bg-primary/5 text-primary">
                              <PackageCheck className="size-10" />
                            </div>
                            <div className="space-y-1.5 p-2.5">
                              <p className="truncate text-[11px] font-bold">{pkg.nama}</p>
                              <p className="truncate text-[9px] text-muted-foreground">Paket rental</p>
                              <div className="flex items-center justify-between gap-2">
                                <span className={cn(
                                  "text-[9px] font-semibold",
                                  availability?.status === "available" ? "text-emerald-600" : "text-amber-700",
                                )}>
                                  {availability?.status === "available"
                                    ? "Ready " + (availability.available_package_quantity ?? 0)
                                    : packageAvailabilityHint(availability) ?? "Belum siap"}
                                </span>
                                <span className="text-[9px] font-semibold text-primary">
                                  {pkg.active_tariff ? formatCatalogMoney(pkg.active_tariff.nominal, pkg.active_tariff.currency_code) : "Tarif —"}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}

                {catalogDialog.open ? (
                  <div className="lg:hidden">
                    {catalogDialog.mode === "item" ? (
                      <div className="mt-3 rounded-2xl border bg-card p-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                            {selectedProductImage ? <img src={selectedProductImage} alt="" className="size-full object-cover" /> : <Package className="size-6 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-bold">{selectedProduct?.nama ?? "Barang"}</p>
                            <p className="mt-0.5 text-[9px] text-muted-foreground">{selectedVariant?.nama ?? "Varian utama"} · Ready {selectedReadyStock}</p>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => closeCatalogDialog()} aria-label="Tutup detail barang">
                            <ChevronDown className="size-4" />
                          </Button>
                        </div>

                        {productDetail.data?.variants?.length ? (
                          <label className="mt-3 block space-y-1">
                            <span className="text-[9px] font-medium text-muted-foreground">Varian</span>
                            <Select value={selectedVariantId || "__base"} onValueChange={(value) => setSelectedVariantId(value === "__base" ? "" : value)}>
                              <SelectTrigger className="h-9 rounded-xl text-[10px]"><SelectValue placeholder="Pilih varian" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__base">Tanpa varian</SelectItem>
                                {productDetail.data.variants.map((variant) => <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>{variant.nama}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </label>
                        ) : null}

                        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
                          <div>
                            <p className="text-[9px] text-muted-foreground">Jumlah unit</p>
                            <p className="text-[9px] font-semibold">{billingPeriods || 0} periode tarif</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedQuantity(String(Math.max(1, selectedQuantityNumber - 1)))} disabled={selectedQuantityNumber <= 1}>−</Button>
                            <span className="min-w-7 text-center text-xs font-bold">{selectedQuantityNumber}</span>
                            <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedQuantity(String(selectedQuantityNumber + 1))}>+</Button>
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl bg-primary/5 p-3">
                          <p className="text-[9px] font-semibold text-primary">Subtotal</p>
                          <p className="mt-1 text-sm font-black">
                            {selectedTariff && billingPeriods ? formatCatalogMoney(calculateRentalLineSubtotal(selectedQuantityNumber, Number(selectedTariff.nominal), billingPeriods), "IDR") : "—"}
                          </p>
                        </div>

                        <Button
                          type="button"
                          className="mt-3 h-10 w-full rounded-xl text-[10px]"
                          disabled={!canAddItem}
                          onClick={addCurrentItem}
                        >
                          <Plus className="size-4" /> Tambah ke Keranjang Sementara
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold">{selectedPackage?.nama ?? "Paket"}</p>
                            <p className="mt-0.5 text-[9px] text-muted-foreground">{selectedPackageAvailability?.available_package_quantity ?? 0} paket siap</p>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => closeCatalogDialog()} aria-label="Tutup detail paket">
                            <ChevronDown className="size-4" />
                          </Button>
                        </div>
                        <div className="mt-3 flex items-center justify-between rounded-xl border px-3 py-2.5">
                          <span className="text-[9px] text-muted-foreground">Jumlah paket</span>
                          <div className="flex items-center gap-1.5">
                            <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedPackageQuantity(String(Math.max(1, selectedPackageQuantityNumber - 1)))} disabled={selectedPackageQuantityNumber <= 1}>−</Button>
                            <span className="min-w-7 text-center text-xs font-bold">{selectedPackageQuantityNumber}</span>
                            <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedPackageQuantity(String(selectedPackageQuantityNumber + 1))}>+</Button>
                          </div>
                        </div>
                        <Button type="button" className="mt-3 h-10 w-full rounded-xl text-[10px]" disabled={!canAddPackage} onClick={addCurrentPackage}>
                          <Plus className="size-4" /> Tambah Paket ke Keranjang
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="hidden min-h-0 overflow-y-auto border-l bg-muted/10 p-4 lg:block">
              {catalogDialog.open && catalogDialog.mode === "item" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
                    <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                      {selectedProductImage ? <img src={selectedProductImage} alt="" className="size-full object-cover" /> : <Package className="size-7 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{selectedProduct?.nama ?? "Barang"}</p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">{selectedVariant?.nama ?? "Varian utama"}</p>
                      <p className="mt-1 text-[9px] font-semibold text-emerald-600">Ready {selectedReadyStock}</p>
                    </div>
                  </div>

                  {productDetail.data?.variants?.length ? (
                    <label className="block space-y-1">
                      <span className="text-[9px] font-medium text-muted-foreground">Varian</span>
                      <Select value={selectedVariantId || "__base"} onValueChange={(value) => setSelectedVariantId(value === "__base" ? "" : value)}>
                        <SelectTrigger className="h-9 rounded-xl text-[10px]"><SelectValue placeholder="Pilih varian" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__base">Tanpa varian</SelectItem>
                          {productDetail.data.variants.map((variant) => <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>{variant.nama}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}

                  <div className="flex items-center justify-between rounded-xl border bg-card p-3">
                    <div>
                      <p className="text-[9px] text-muted-foreground">Jumlah</p>
                      <p className="mt-0.5 text-[11px] font-semibold">Unit fisik dipilih server saat assignment.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedQuantity(String(Math.max(1, selectedQuantityNumber - 1)))} disabled={selectedQuantityNumber <= 1}>−</Button>
                      <span className="min-w-7 text-center text-xs font-bold">{selectedQuantityNumber}</span>
                      <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedQuantity(String(selectedQuantityNumber + 1))}>+</Button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-primary/5 p-3">
                    <p className="text-[9px] font-semibold text-primary">Perhitungan tarif</p>
                    <p className="mt-1 text-[11px] font-bold">
                      {selectedQuantityNumber} unit × {billingPeriods || 0} periode × {selectedTariff ? formatCatalogMoney(selectedTariff.nominal, selectedTariff.currency_code) : "Rp0"}
                    </p>
                    <p className="mt-1 text-[14px] font-black">
                      {selectedTariff && billingPeriods ? formatCatalogMoney(calculateRentalLineSubtotal(selectedQuantityNumber, Number(selectedTariff.nominal), billingPeriods), "IDR") : "—"}
                    </p>
                  </div>

                  {availabilityPreview.data && availabilityPreview.data.readyPhysicalUnits < selectedQuantityNumber ? (
                    <Alert variant="destructive" className="rounded-xl">
                      <AlertTitle>Ready stock tidak cukup</AlertTitle>
                      <AlertDescription>Ready {availabilityPreview.data.readyPhysicalUnits} unit, sementara diminta {selectedQuantityNumber}.</AlertDescription>
                    </Alert>
                  ) : null}

                  <Button
                    type="button"
                    className="h-10 w-full rounded-xl text-[10px]"
                    disabled={!canAddItem}
                    onClick={addCurrentItem}
                  >
                    <Plus className="size-4" /> Tambah ke Keranjang Sementara
                  </Button>
                </div>
              ) : catalogDialog.open && catalogDialog.mode === "package" ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold">{selectedPackage?.nama ?? "Paket"}</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">Paket rental dengan komponen tervalidasi server</p>
                        {packageAvailabilityHint(selectedPackageAvailability ?? undefined) ? (
                          <p className="mt-1 truncate text-[9px] font-semibold text-amber-700">
                            {packageAvailabilityHint(selectedPackageAvailability ?? undefined)}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="rounded-full text-[9px]">{selectedPackageAvailability?.available_package_quantity ?? 0} siap</Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {(packageDetail.data?.components ?? []).map((component) => (
                        <div key={component.komponen_paket_id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 px-2.5 py-2">
                          <span className="truncate text-[9px]">{component.varian?.nama ?? component.barang?.nama ?? "Komponen"}</span>
                          <span className="shrink-0 text-[8px] text-muted-foreground">× {component.jumlah}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border bg-card p-3">
                    <span className="text-[9px] font-medium text-muted-foreground">Jumlah Paket</span>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedPackageQuantity(String(Math.max(1, selectedPackageQuantityNumber - 1)))} disabled={selectedPackageQuantityNumber <= 1}>−</Button>
                      <span className="min-w-7 text-center text-xs font-bold">{selectedPackageQuantityNumber}</span>
                      <Button type="button" variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => setSelectedPackageQuantity(String(selectedPackageQuantityNumber + 1))}>+</Button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-primary/5 p-3">
                    <p className="text-[9px] font-semibold text-primary">Perhitungan tarif</p>
                    <p className="mt-1 text-[11px] font-bold">
                      {selectedPackageQuantityNumber} paket × {packageBillingPeriods || 0} periode × {packageTariff ? formatCatalogMoney(packageTariff.nominal, packageTariff.currency_code) : "Rp0"}
                    </p>
                    <p className="mt-1 text-[14px] font-black">
                      {packageTariff && packageBillingPeriods ? formatCatalogMoney(calculateRentalLineSubtotal(selectedPackageQuantityNumber, Number(packageTariff.nominal), packageBillingPeriods), "IDR") : "—"}
                    </p>
                  </div>

                  <Button type="button" className="h-10 w-full rounded-xl text-[10px]" disabled={!canAddPackage} onClick={addCurrentPackage}>
                    <Plus className="size-4" /> Tambah Paket ke Keranjang Sementara
                  </Button>
                </div>
              ) : (
                <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-dashed p-8 text-center">
                  <div>
                    <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-2 text-sm font-semibold">Pilih barang atau paket</p>
                    <p className="mt-1 text-xs text-muted-foreground">Detail foto, varian, stok, periode, dan harga akan muncul di sini.</p>
                  </div>
                </div>
              )}
            </aside>
          </div>

          <DialogClose asChild>
            <Button
              type="button"
              className="absolute bottom-4 right-4 z-20 h-12 rounded-2xl px-4 text-[10px] shadow-lg transition-transform active:scale-[0.98]"
              onClick={applyCatalogPicker}
            >
              <ShoppingCart className="size-4" />
              {pickerLines.length} · {formatRentalMoney(pickerTotal, "IDR")}
            </Button>
          </DialogClose>

        </DialogContent>
      </Dialog>

      <Dialog open={renterPickerOpen}
        onOpenChange={(open) => {
          setRenterPickerOpen(open);
          if (!open) setRenterPickerSearch("");
        }}
      >
        <DialogContent
          style={{ width: "92vw", height: "90vh", maxWidth: "1200px" }}
          className="!flex !max-w-none flex-col gap-0 overflow-hidden rounded-3xl p-0"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl"
                onClick={() => setRenterPickerOpen(false)}
                aria-label="Tutup pemilih penyewa"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-[16px]">Pilih Penyewa</DialogTitle>
                <DialogDescription className="mt-0.5 text-[10px]">Cari berdasarkan nama atau nomor telepon. Tidak ada daftar panjang di halaman Rental.</DialogDescription>
              </div>
              <Button type="button" className="h-9 rounded-xl text-[10px]" onClick={() => { setRenterPickerOpen(false); setNewRenterOpen(true); }}>
                <UserPlus className="size-3.5" /> Baru
              </Button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-2xl space-y-3">
              <div className="flex items-center gap-2 rounded-2xl border px-3">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  autoFocus
                  value={renterPickerSearch}
                  onChange={(event) => setRenterPickerSearch(event.target.value)}
                  placeholder="Cari nama atau nomor telepon…"
                  aria-label="Cari penyewa"
                  className="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
                />
              </div>

              {renters.isPending ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-xs text-muted-foreground">Memuat penyewa…</div>
              ) : (renters.data ?? []).length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(renters.data ?? []).map((renter) => (
                    <button
                      key={renter.penyewa_id}
                      type="button"
                      className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.03]"
                      onClick={() => {
                        setSelectedRenterId(renter.penyewa_id);
                        setRenterPickerOpen(false);
                        setRenterPickerSearch("");
                      }}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Users className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold">{renter.nama_lengkap}</span>
                        <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{renter.nomor_telepon || "Nomor telepon tidak tersedia"}</span>
                      </span>
                      {selectedRenterId === renter.penyewa_id ? <Check className="size-4 text-primary" /> : <ChevronDown className="size-4 -rotate-90 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-8 text-center">
                  <Users className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-semibold">Penyewa tidak ditemukan</p>
                  <p className="mt-1 text-xs text-muted-foreground">Buat penyewa baru tanpa meninggalkan alur Rental.</p>
                  <Button type="button" variant="outline" className="mt-3 rounded-xl" onClick={() => { setRenterPickerOpen(false); setNewRenterOpen(true); }}>
                    <UserPlus className="size-4" /> Tambah Penyewa
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={newRenterOpen} onOpenChange={setNewRenterOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Tambah Penyewa</DialogTitle>
            <DialogDescription>Penyewa dibuat sebagai identity record lalu langsung dipilih untuk rental ini.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="space-y-1">
              <span className="text-[9px] font-medium text-muted-foreground">Nama lengkap</span>
              <Input value={newRenterName} onChange={(event) => setNewRenterName(event.target.value)} aria-label="Nama lengkap penyewa" />
            </label>
            <label className="space-y-1">
              <span className="text-[9px] font-medium text-muted-foreground">Nomor telepon</span>
              <Input value={newRenterPhone} onChange={(event) => setNewRenterPhone(event.target.value)} aria-label="Nomor telepon penyewa" inputMode="tel" />
            </label>
            {createRenterMutation.error ? <Alert variant="destructive" className="rounded-xl"><AlertTitle>Penyewa belum dibuat</AlertTitle><AlertDescription>{commandMessage(createRenterMutation.error, "Pembuatan penyewa gagal.")}</AlertDescription></Alert> : null}
            <Button className="h-10 w-full rounded-xl" disabled={!newRenterName.trim() || !newRenterPhone.trim() || createRenterMutation.isPending} onClick={() => createRenterMutation.mutate()}>
              {createRenterMutation.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Buat dan pilih penyewa
            </Button>
            {isUnknownOutcome(createRenterMutation.error) ? <Button type="button" variant="outline" className="h-9 w-full rounded-xl" onClick={() => void reconcileRenter()}>Periksa status penyewa</Button> : null}
          </div>
        </DialogContent>
      </Dialog>

      {rentalQr.data && receiptData ? (
        <>
          <QrPreviewDialog
            open={qrOpen}
            onOpenChange={setQrOpen}
            title="QR Penyewaan"
            description="QR ini membuka detail rental. Token tidak memuat data sensitif."
            code={rentalQr.data.token_qr}
            kind="penyewaan"
            url={buildPenyewaanQrUrl(window.location.origin, rentalQr.data.token_qr)}
          />
          <RentalReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receiptData} />
        </>
      ) : null}
    </div>
  );
}
