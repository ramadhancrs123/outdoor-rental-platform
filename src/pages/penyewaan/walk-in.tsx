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
  X,
  Users,
  WalletCards,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createDirectRentalWithDiscount,
  createRentalFromReservationWithDiscount,
  getOperationalRentalWorkspace,
  getRental,
  getPenyewaanContext,
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
  type CatalogTariff,
  calculateRentalLineSubtotal,
  calculateTariffPeriods,
  resolvePackagePrice,
} from "@/features/katalog";
import { isActiveCatalogTariff, formatCatalogMoney } from "@/features/katalog/utils";
import { listInventoryPackageAvailability, listInventoryReadyUnitCovers, type InventoryPackageAvailability } from "@/features/inventaris";
import { createRenter, getRenterSummary, listRenters, reconcileRenterCreation } from "@/features/penyewa/service";
import { getReservation } from "@/features/reservasi/service";
import type { ReservationDetail } from "@/features/reservasi/types";
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
import { buildPenyewaanQrUrl, getQrPenyewaanRecord, getRentalReceiptData } from "@/features/qr-operasional";
import { createClientId } from "@/lib/client-id";
import {
  getCheckoutDiscountPolicy,
  getMyBusinessPermissions,
  previewLoyaltyDiscount,
  reconcileEventPromotionCheckout,
} from "@/features/event-promotions";
import type { CheckoutDiscountRequest } from "@/features/penyewaan/types";
import { createMixedCheckout, getSaleReceiptData, listSaleCatalogItems } from "@/features/penjualan";
import type { SaleCatalogItem, SaleReceiptData } from "@/features/penjualan";
import { paths } from "@/routes/paths";
import {
  checkoutAkashaSmartBooking,
  getAkashaSmartBooking,
} from "@/features/akasha-smart-booking/service";
import { cn } from "@/lib/utils";
import { supabase } from "@/app/providers/supabase/client";

type DraftRentalLine = {
  key: string;
  kind: "item" | "package";
  label: string;
  description: string;
  stockReadyAtSelection?: number | null;
  normalUnitPrice?: number;
  promoDiscountPercent?: number;
  promoId?: string | null;
  tariffDurationUnit?: string | null;
  tariffDurationValue?: number | null;
  input: DirectRentalLineInput;
};

type SmartBookingRentalCatalogRow = {
  barang_id: string
  varian_barang_id: string | null
  tarif_sewa_id: string
  barang_nama: string
  varian_nama: string | null
  harga_normal: number | string
  diskon_persen: number | string | null
  harga_efektif: number | string | null
  currency_code: string
  inventory_mode: string | null
  durasi_unit: string
  durasi_nilai: number
}

type SmartBookingPackageRow = {
  paket_sewa_id: string
  nama: string
  status: string
}

type SmartBookingPackageTariffRow = Pick<
  CatalogTariff,
  "tarif_sewa_id" | "paket_sewa_id" | "durasi_unit" | "durasi_nilai" | "nominal" | "currency_code"
>

type SmartBookingPackagePromoRow = {
  paket_sewa_id: string
  tarif_sewa_id: string
  harga_normal: number | string
  harga_promo: number | string
}

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

function matchesCatalogTerm(term: string, name: string, categoryName: string, slug = "") {
  if (!term) return true;
  const needle = term.toLocaleLowerCase("id-ID");
  return (
    name.toLocaleLowerCase("id-ID").includes(needle) ||
    categoryName.toLocaleLowerCase("id-ID").includes(needle) ||
    slug.toLocaleLowerCase("id-ID").includes(needle)
  );
}

export function RentalWalkIn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const renterIdFromQuery = searchParams.get("renter_id");
  const reservationIdFromQuery = searchParams.get("reservasi_id");
  const smartBookingIdFromQuery = searchParams.get("smart_booking_id");
  const isReservationFlow = Boolean(reservationIdFromQuery);
  const isSmartBookingFlow = Boolean(smartBookingIdFromQuery);
  const queryClient = useQueryClient();

  const context = useQuery({
    queryKey: ["penyewaan", "context"],
    queryFn: getPenyewaanContext,
    staleTime: 60_000,
  });

  const reservationPrefill = useQuery<ReservationDetail>({
    queryKey: ["penyewaan", "reservation-prefill", context.data?.usahaId, reservationIdFromQuery],
    queryFn: () => getReservation(context.data!.usahaId, reservationIdFromQuery!),
    enabled: Boolean(context.data?.usahaId && reservationIdFromQuery),
    staleTime: 30_000,
  });

  const smartBookingPrefill = useQuery({
    queryKey: ["akasha-smart-booking", "walk-in-prefill", context.data?.usahaId, smartBookingIdFromQuery],
    queryFn: () => getAkashaSmartBooking(smartBookingIdFromQuery!),
    enabled: Boolean(context.data?.usahaId && smartBookingIdFromQuery),
    staleTime: 10_000,
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
  const [saleCategoryId, setSaleCategoryId] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const [cartReviewOpen, setCartReviewOpen] = useState(false);
  const [itemConfigOpen, setItemConfigOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<"rental" | "package" | "sale">("rental");
  const catalogPickerOpen = searchParams.get("view") === "catalog";
  const [catalogDialog, setCatalogDialog] = useState<CatalogDialogState>({ open: false });
  const [pickerLines, setPickerLines] = useState<DraftRentalLine[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedQuantity, setSelectedQuantity] = useState("1");
  const [selectedPackageQuantity, setSelectedPackageQuantity] = useState("1");
  const [selectedPackageNote, setSelectedPackageNote] = useState("");

  const [draftLines, setDraftLines] = useState<DraftRentalLine[]>([]);
  const [saleCart, setSaleCart] = useState<Record<string, { item: SaleCatalogItem; jumlah: number }>>({});
  const [saleBonusReasons, setSaleBonusReasons] = useState<Record<string, string>>({});
  const [checkoutDiscountMode, setCheckoutDiscountMode] = useState<CheckoutDiscountRequest["mode"]>("none");
  const [manualDiscountAmount, setManualDiscountAmount] = useState("");
  const [manualDiscountReasonCode, setManualDiscountReasonCode] = useState("other");
  const [manualDiscountReasonNote, setManualDiscountReasonNote] = useState("");
  const [manualDiscountApplied, setManualDiscountApplied] = useState(false);
  const [manualDiscountDialogOpen, setManualDiscountDialogOpen] = useState(false);
  const [manualDiscountDraftAmount, setManualDiscountDraftAmount] = useState("");
  const [manualDiscountDraftReasonCode, setManualDiscountDraftReasonCode] = useState("other");
  const [manualDiscountDraftReasonNote, setManualDiscountDraftReasonNote] = useState("");
  const [applyLoyaltyDiscount, setApplyLoyaltyDiscount] = useState(false);
  useEffect(() => {
    setApplyLoyaltyDiscount(false);
  }, [selectedRenterId]);
  const [mixedSaleId, setMixedSaleId] = useState("");
  const [rentalId, setRentalId] = useState("");
  const [rentalCommandKey, setRentalCommandKey] = useState(() => createClientId());
  const [rentalCommandState, setRentalCommandState] = useState<CommandState>("idle");
  const [smartBookingPrefillState, setSmartBookingPrefillState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [smartBookingPrefillError, setSmartBookingPrefillError] = useState("");
  const [smartBookingPrefillAttempt, setSmartBookingPrefillAttempt] = useState(0);
  const smartBookingPrefillStartedRef = useRef(false);
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

  const selectedRenterFromPicker = (renters.data ?? []).find((renter) => renter.penyewa_id === selectedRenterId) ?? null;
  const selectedRenterQuery = useQuery({
    queryKey: ["penyewa", "walk-in-selected", context.data?.usahaId, selectedRenterId],
    queryFn: () => getRenterSummary({
      akunAdminId: context.data!.akunAdminId,
      usahaId: context.data!.usahaId,
      usahaNama: context.data!.usahaNama,
    }, selectedRenterId),
    enabled: Boolean(context.data?.usahaId && selectedRenterId && !rentalId && !selectedRenterFromPicker),
    staleTime: 30_000,
  });

  const saleCatalog = useQuery<SaleCatalogItem[]>({
    queryKey: ["penjualan", "catalog", context.data?.usahaId],
    queryFn: () => listSaleCatalogItems(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && !rentalId && !isReservationFlow && !isSmartBookingFlow),
    staleTime: 20_000,
  });

  const products = useQuery({
    queryKey: ["penyewaan", "walk-in", "products", context.data?.usahaId],
    queryFn: () => listCatalogProducts(context.data!.usahaId, { ...DEFAULT_CATALOG_FILTERS, pageSize: 100 }),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && selectionMode === "rental" && !rentalId && !isReservationFlow && !isSmartBookingFlow),
    staleTime: 60_000,
  });

  const packages = useQuery({
    queryKey: ["penyewaan", "walk-in", "packages", context.data?.usahaId],
    queryFn: () => listCatalogPackages(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && selectionMode === "package" && !rentalId && !isReservationFlow && !isSmartBookingFlow),
    staleTime: 60_000,
  });

  const packageAvailability = useQuery<InventoryPackageAvailability[]>({
    queryKey: ["penyewaan", "walk-in", "package-availability", context.data?.usahaId, startAt, endAt],
    queryFn: () => listInventoryPackageAvailability(context.data!.usahaId, {
      startAt: localDateTimeToUtcIso(startAt, context.data!.timezone),
      endAt: localDateTimeToUtcIso(endAt, context.data!.timezone),
    }),
    enabled: Boolean(
      context.data?.usahaId && catalogPickerOpen && selectionMode === "package" && Boolean(packages.data?.length) && !rentalId && !isReservationFlow && startAt && endAt
      && new Date(endAt).getTime() > new Date(startAt).getTime(),
    ),
    staleTime: 10_000,
  });

  const productIds = useMemo(
    () => (products.data?.products ?? []).map((product) => product.barang_id),
    [products.data?.products],
  );

  const productCovers = useQuery({
    queryKey: ["penyewaan", "walk-in", "product-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogProductCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && selectionMode === "rental" && productIds.length && !rentalId && !isReservationFlow),
    staleTime: 60_000,
  });

  const unitCovers = useQuery({
    queryKey: ["penyewaan", "walk-in", "ready-unit-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listInventoryReadyUnitCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && selectionMode === "rental" && productIds.length && !rentalId && !isReservationFlow),
    staleTime: 15_000,
  });

  const readyStock = useQuery({
    queryKey: ["penyewaan", "walk-in", "ready-stock", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogReadyStock(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && selectionMode === "rental" && productIds.length && !rentalId && !isReservationFlow),
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
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && itemDialogId && !rentalId && !isReservationFlow),
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
    enabled: Boolean(context.data?.usahaId && catalogPickerOpen && packageDialogId && !rentalId && !isReservationFlow),
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

  useEffect(() => {
    const booking = smartBookingPrefill.data;
    if (!isSmartBookingFlow || !context.data || !booking || smartBookingPrefillStartedRef.current) return;
    smartBookingPrefillStartedRef.current = true;

    void (async () => {
      try {
        setSmartBookingPrefillState("loading");
        setSmartBookingPrefillError("");

        if (booking.workflow_status !== "ready_for_checkout") {
          throw new Error("Booking belum berstatus Siap checkout. Kembali ke detail booking untuk meninjau status dan permintaan customer.");
        }
        if (booking.change_requests.some((request) => request.status === "pending")) {
          throw new Error("Selesaikan atau tolak seluruh permintaan perubahan customer sebelum checkout.");
        }

        const nextStart = booking.requested_pickup_at
          ? formatDateTimeLocalInTimezone(new Date(booking.requested_pickup_at), context.data.timezone)
          : "";
        const nextEnd = booking.requested_return_at
          ? formatDateTimeLocalInTimezone(new Date(booking.requested_return_at), context.data.timezone)
          : "";
        if (booking.renter_id) setSelectedRenterId(booking.renter_id);
        setStartAt(nextStart);
        setEndAt(nextEnd);

        const [rentalResult, packageResult, packageTariffResult, packagePromoResult, saleOptions] = await Promise.all([
          supabase.from("v_public_katalog_rental")
            .select("barang_id,varian_barang_id,tarif_sewa_id,barang_nama,varian_nama,harga_normal,diskon_persen,harga_efektif,currency_code,inventory_mode,durasi_unit,durasi_nilai")
            .eq("usaha_id", context.data.usahaId),
          supabase.from("v_public_paket_sewa")
            .select("paket_sewa_id,nama,status")
            .eq("usaha_id", context.data.usahaId)
            .eq("status", "active"),
          supabase.from("v_public_tarif_sewa")
            .select("tarif_sewa_id,paket_sewa_id,durasi_unit,durasi_nilai,nominal,currency_code")
            .eq("usaha_id", context.data.usahaId),
          supabase.from("v_public_paket_promo")
            .select("paket_sewa_id,tarif_sewa_id,harga_normal,harga_promo")
            .eq("usaha_id", context.data.usahaId),
          listSaleCatalogItems(context.data.usahaId),
        ]);
        for (const result of [rentalResult, packageResult, packageTariffResult, packagePromoResult]) {
          if (result.error) throw result.error;
        }

        const rentalRows = (rentalResult.data ?? []) as unknown as SmartBookingRentalCatalogRow[];
        const packageRows = (packageResult.data ?? []) as unknown as SmartBookingPackageRow[];
        const packageTariffs = (packageTariffResult.data ?? []) as unknown as SmartBookingPackageTariffRow[];
        const packagePromos = (packagePromoResult.data ?? []) as unknown as SmartBookingPackagePromoRow[];
        const nextRentalLines: DraftRentalLine[] = [];
        const nextSaleCart: Record<string, { item: SaleCatalogItem; jumlah: number }> = {};

        for (const line of booking.lines) {
          if (line.kind === "sale") {
            const saleOption = saleOptions.find((item) =>
              line.varian_barang_id
                ? item.varian_barang_id === line.varian_barang_id
                : !item.varian_barang_id && item.barang_id === line.barang_id,
            );
            if (!saleOption) {
              throw new Error("Barang pembelian pada booking tidak lagi aktif di katalog. Ajukan perubahan item sebelum checkout.");
            }
            nextSaleCart[saleOption.key] = {
              item: saleOption,
              jumlah: Number(line.quantity),
            };
            continue;
          }

          const quantity = Number(line.quantity);
          if (!Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
            throw new Error("Jumlah item rental pada snapshot booking tidak valid.");
          }

          if (line.paket_sewa_id) {
            const packageRow = packageRows.find((item) => item.paket_sewa_id === line.paket_sewa_id);
            if (!packageRow) {
              throw new Error("Paket rental pada booking tidak lagi aktif. Ajukan alternatif melalui portal customer.");
            }
            const tariff = packageTariffs.find((item) =>
              item.paket_sewa_id === line.paket_sewa_id &&
              item.tarif_sewa_id === line.tarif_sewa_id,
            );
            if (!tariff) {
              throw new Error("Tarif aktif untuk paket " + packageRow.nama + " belum tersedia.");
            }
            const promo = packagePromos.find((item) =>
              item.paket_sewa_id === line.paket_sewa_id && item.tarif_sewa_id === tariff.tarif_sewa_id,
            );
            const normalPrice = Number(promo?.harga_normal ?? tariff.nominal);
            const effectivePrice = Number(promo?.harga_promo ?? tariff.nominal);
            const periods = nextStart && nextEnd
              ? calculateTariffPeriods(nextStart, nextEnd, tariff)
              : 1;
            const identity = "package:" + line.paket_sewa_id;
            nextRentalLines.push({
              key: identity,
              kind: "package",
              label: packageRow.nama,
              description: "Paket × " + quantity,
              normalUnitPrice: normalPrice,
              promoDiscountPercent: normalPrice > 0 && effectivePrice < normalPrice
                ? Math.round((1 - effectivePrice / normalPrice) * 10000) / 100
                : 0,
              promoId: null,
              tariffDurationUnit: tariff.durasi_unit,
              tariffDurationValue: Number(tariff.durasi_nilai),
              stockReadyAtSelection: null,
              input: {
                paket_sewa_id: line.paket_sewa_id,
                tarif_sewa_id: tariff.tarif_sewa_id,
                duration_periods: Math.max(1, periods),
                jumlah: quantity,
                unit_price: effectivePrice,
                subtotal: calculateRentalLineSubtotal(quantity, effectivePrice, Math.max(1, periods)),
                currency_code: "IDR",
                catatan: null,
              },
            });
            continue;
          }

          const catalogRow = rentalRows.find((item) =>
            item.tarif_sewa_id === line.tarif_sewa_id &&
            (line.varian_barang_id
              ? item.varian_barang_id === line.varian_barang_id
              : !item.varian_barang_id && item.barang_id === line.barang_id),
          );
          if (!catalogRow) {
            throw new Error("Barang rental " + line.name + " tidak lagi memiliki tarif publik aktif. Ajukan perubahan melalui portal customer.");
          }
          const normalPrice = Number(catalogRow.harga_normal);
          const effectivePrice = Number(catalogRow.harga_efektif ?? catalogRow.harga_normal);
          const periods = nextStart && nextEnd
            ? calculateTariffPeriods(nextStart, nextEnd, {
                durasi_unit: catalogRow.durasi_unit,
                durasi_nilai: Number(catalogRow.durasi_nilai),
              })
            : 1;
          const identity = line.varian_barang_id
            ? "item:" + catalogRow.barang_id + ":" + line.varian_barang_id
            : "item:" + catalogRow.barang_id + ":base";
          nextRentalLines.push({
            key: identity,
            kind: "item",
            label: catalogRow.varian_nama
              ? catalogRow.barang_nama + " · " + catalogRow.varian_nama
              : catalogRow.barang_nama,
            description: "× " + quantity + " unit",
            normalUnitPrice: normalPrice,
            promoDiscountPercent: Number(catalogRow.diskon_persen ?? 0),
            promoId: null,
            tariffDurationUnit: catalogRow.durasi_unit,
            tariffDurationValue: Number(catalogRow.durasi_nilai),
            stockReadyAtSelection: null,
            input: {
              barang_id: line.varian_barang_id ? null : catalogRow.barang_id,
              varian_barang_id: line.varian_barang_id,
              tarif_sewa_id: catalogRow.tarif_sewa_id,
              duration_periods: Math.max(1, periods),
              jumlah: quantity,
              unit_price: effectivePrice,
              subtotal: calculateRentalLineSubtotal(quantity, effectivePrice, Math.max(1, periods)),
              currency_code: "IDR",
              catatan: null,
            },
          });
        }

        setDraftLines(nextRentalLines);
        setPickerLines(nextRentalLines.map((line) => ({ ...line, input: { ...line.input } })));
        setSaleCart(nextSaleCart);
        setSmartBookingPrefillState("ready");
      } catch (error) {
        setSmartBookingPrefillError(error instanceof Error ? error.message : "Snapshot booking gagal dipersiapkan.");
        setSmartBookingPrefillState("error");
      }
    })();
  }, [context.data, isSmartBookingFlow, smartBookingPrefill.data, smartBookingPrefillAttempt]);

  useEffect(() => {
    if (
      !isSmartBookingFlow ||
      !startAt ||
      !endAt ||
      new Date(endAt).getTime() <= new Date(startAt).getTime()
    ) return;
    setDraftLines((current) => current.map((line) => {
      if (!line.tariffDurationUnit || !line.tariffDurationValue) return line;
      const periods = calculateTariffPeriods(startAt, endAt, {
        durasi_unit: line.tariffDurationUnit,
        durasi_nilai: line.tariffDurationValue,
      });
      if (!periods) return line;
      return {
        ...line,
        input: {
          ...line.input,
          duration_periods: periods,
          subtotal: calculateRentalLineSubtotal(
            Number(line.input.jumlah),
            Number(line.input.unit_price),
            periods,
          ),
        },
      };
    }));
  }, [endAt, isSmartBookingFlow, startAt]);

  const accounts = useQuery<FinanceAccount[]>({
    queryKey: ["keuangan", "accounts", context.data?.usahaId],
    queryFn: () => listFinanceAccounts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && (rentalId || Object.keys(saleCart).length > 0)),
    staleTime: 30_000,
  });

  const rentalQr = useQuery({
    queryKey: ["qr-operasional", "penyewaan", context.data?.usahaId, rentalId],
    queryFn: () => getQrPenyewaanRecord(context.data!.usahaId, rentalId),
    enabled: Boolean(context.data?.usahaId && rentalId),
    staleTime: 5 * 60_000,
  });

  const mixedReceipt = useQuery<SaleReceiptData>({
    queryKey: ["penjualan", "mixed-receipt", context.data?.usahaId, mixedSaleId],
    queryFn: () => getSaleReceiptData(context.data!.usahaId, mixedSaleId),
    enabled: Boolean(context.data?.usahaId && mixedSaleId),
    staleTime: 60_000,
  });

  const receiptQuery = useQuery({
    queryKey: ["qr-operasional", "rental-receipt", context.data?.usahaId, rentalId],
    queryFn: () => getRentalReceiptData(context.data!.usahaId, rentalId),
    enabled: Boolean(context.data?.usahaId && rentalId),
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

  const catalogSearch = productSearch.trim();

  const activeProducts = useMemo(
    () =>
      (products.data?.products ?? []).filter(
        (product) =>
          product.status === "active" &&
          (product.is_rentable || product.has_rentable_variants) &&
          (categoryId === "all" || product.kategori_barang_id === categoryId) &&
          matchesCatalogTerm(catalogSearch, product.nama, product.kategori?.nama ?? "", product.slug),
      ),
    [categoryId, catalogSearch, products.data?.products],
  );

  const categories = useMemo(() => {
    const map = new Map<string, { id: string; nama: string }>();
    for (const product of products.data?.products ?? []) {
      if (product.status !== "active" || !product.kategori || (!product.is_rentable && !product.has_rentable_variants)) continue;
      map.set(product.kategori.kategori_barang_id, {
        id: product.kategori.kategori_barang_id,
        nama: product.kategori.nama,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  }, [products.data?.products]);

  const selectedProduct = useMemo<CatalogProduct | null>(
    () => (itemDialogId ? (products.data?.products ?? []).find((product) => product.barang_id === itemDialogId) ?? null : null),
    [itemDialogId, products.data?.products],
  );

  useEffect(() => {
    if (!catalogDialog.open || catalogDialog.mode !== "item" || !productDetail.data || selectedVariantId) return;
    const activeVariant = productDetail.data.variants.find((variant) =>
      (variant.is_rentable ?? productDetail.data?.is_rentable) &&
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

  const selectedRentalPromotion = selectedVariant?.rental_promotion ??
    (selectedVariantId
      ? selectedProduct?.rental_variant_promotions?.[selectedVariantId] ?? selectedProduct?.rental_promotion ?? null
      : selectedProduct?.rental_promotion ?? null);
  const selectedRentalNormalUnitPrice = Number(selectedTariff?.nominal ?? 0);
  const selectedRentalEffectiveUnitPrice = selectedTariff
    ? selectedRentalPromotion
      ? Math.round(selectedRentalNormalUnitPrice * (100 - Number(selectedRentalPromotion.diskon_persen)) + Number.EPSILON) / 100
      : selectedRentalNormalUnitPrice
    : 0;
  const pricedVariantId =
    productDetail.data?.variants.find((variant) =>
      (variant.is_rentable ?? productDetail.data?.is_rentable) &&
      productDetail.data?.tariffs.some(
        (tariff) =>
          tariff.varian_barang_id === variant.varian_barang_id &&
          isActiveCatalogTariff(tariff, rentalTariffAt),
      ),
    )?.varian_barang_id ?? "";
  const effectiveVariantId = selectedVariantId || pricedVariantId;

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

  const selectedRentalNormalSubtotal = selectedTariff && billingPeriods
    ? calculateRentalLineSubtotal(Number(selectedQuantity), selectedRentalNormalUnitPrice, billingPeriods)
    : 0;
  const selectedRentalEffectiveSubtotal = selectedTariff && billingPeriods
    ? calculateRentalLineSubtotal(Number(selectedQuantity), selectedRentalEffectiveUnitPrice, billingPeriods)
    : 0;


  const reservationLines = reservationPrefill.data?.lines ?? [];
  const totalRental = isReservationFlow
    ? reservationLines.reduce((sum, line) => sum + Number(line.subtotal ?? 0), 0)
    : draftLines.reduce((sum, line) => sum + Number(line.input.subtotal), 0);
  const rentalCurrencyCode = isReservationFlow ? reservationLines[0]?.currency_code ?? "IDR" : "IDR";
  const saleCategories = useMemo(() => {
    const map = new Map<string, { id: string; nama: string }>();
    for (const item of saleCatalog.data ?? []) {
      if (!item.kategori_barang_id || !item.kategori_nama) continue;
      map.set(item.kategori_barang_id, {
        id: item.kategori_barang_id,
        nama: item.kategori_nama,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  }, [saleCatalog.data]);

  const saleCatalogItems = (saleCatalog.data ?? []).filter(
    (item) =>
      (saleCategoryId === "all" || item.kategori_barang_id === saleCategoryId) &&
      matchesCatalogTerm(catalogSearch, item.nama, item.kategori_nama),
  );
  const visibleCategories = selectionMode === "sale" ? saleCategories : categories;
  const visibleCategoryId = selectionMode === "sale" ? saleCategoryId : categoryId;
  const setVisibleCategoryId = selectionMode === "sale" ? setSaleCategoryId : setCategoryId;
  const saleCartLines = Object.values(saleCart);
  const saleSubtotal = saleCartLines.reduce((sum, line) => {
    const isBonus = Object.prototype.hasOwnProperty.call(saleBonusReasons, line.item.key);
    const effectivePrice = Number(line.item.harga_jual_efektif ?? line.item.harga_jual ?? 0);
    return sum + (isBonus ? 0 : effectivePrice * line.jumlah);
  }, 0);

  const promotionPermissions = useQuery({
    queryKey: ["event-promotions", "walk-in-permissions", context.data?.usahaId],
    queryFn: () => getMyBusinessPermissions(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });
  const checkoutDiscountPolicy = useQuery({
    queryKey: ["event-promotions", "checkout-policy", context.data?.usahaId],
    queryFn: () => getCheckoutDiscountPolicy(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });
  const canApplyCheckoutDiscount = promotionPermissions.data?.includes("checkout_discount.apply") === true;
  const canOverrideLoyalty = promotionPermissions.data?.includes("checkout_discount.override") === true;
  const canApplyRetailBonus = promotionPermissions.data?.includes("retail_bonus.apply") === true;
  const loyaltyPreview = useQuery({
    queryKey: ["event-promotions", "walk-in-reservation-loyalty-preview", context.data?.usahaId, selectedRenterId, totalRental],
    queryFn: () => previewLoyaltyDiscount(context.data!.usahaId, selectedRenterId, totalRental),
    enabled: Boolean(context.data?.usahaId && selectedRenterId && totalRental > 0 && !rentalId && isReservationFlow),
    staleTime: 10_000,
  });
  const allowedManualReasons = checkoutDiscountPolicy.data?.allowed_reason_codes ?? ["other"];
  const firstAllowedManualReason = allowedManualReasons[0];
  const currentManualReasonAllowed = allowedManualReasons.includes(manualDiscountReasonCode);
  const manualAmountValue = Number(manualDiscountAmount);
  const walkInManualAmountValue = manualDiscountApplied ? Math.max(0, manualAmountValue || 0) : 0;
  const legacyRequestedDiscountAmount = checkoutDiscountMode === "loyalty"
    ? Number(loyaltyPreview.data?.recommended_amount ?? 0)
    : checkoutDiscountMode === "manual" ? manualAmountValue : 0;
  const legacyDiscountRequest: CheckoutDiscountRequest = checkoutDiscountMode === "manual"
    ? {
        mode: "manual",
        amount: manualAmountValue,
        reason_code: manualDiscountReasonCode,
        reason_note: manualDiscountReasonNote.trim() || null,
      }
    : checkoutDiscountMode === "loyalty" ? { mode: "loyalty" } : { mode: "none" };
  const effectiveDiscountAmount = Math.min(Math.max(0, legacyRequestedDiscountAmount), totalRental);
  const discountedRentalTotal = Math.max(0, totalRental - effectiveDiscountAmount);
  const manualDiscountExceedsPercentCap = checkoutDiscountPolicy.data?.max_discount_percent != null &&
    totalRental > 0 &&
    manualAmountValue / totalRental * 100 > Number(checkoutDiscountPolicy.data.max_discount_percent);
  const manualDiscountExceedsAmountCap = checkoutDiscountPolicy.data?.max_discount_amount != null &&
    manualAmountValue > Number(checkoutDiscountPolicy.data.max_discount_amount);
  const manualDiscountExceedsLoyalty = loyaltyPreview.data?.eligible === true &&
    manualAmountValue > Number(loyaltyPreview.data.recommended_amount);
  const manualDiscountOverrideAllowed = checkoutDiscountPolicy.data?.allow_above_loyalty === true && canOverrideLoyalty;
  const legacyDiscountInputIsValid = checkoutDiscountMode === "none" ||
    (canApplyCheckoutDiscount && checkoutDiscountMode === "loyalty" &&
      loyaltyPreview.isSuccess && loyaltyPreview.data?.eligible === true && legacyRequestedDiscountAmount > 0) ||
    (canApplyCheckoutDiscount && checkoutDiscountMode === "manual" &&
      checkoutDiscountPolicy.data?.manual_discount_enabled === true &&
      Number.isFinite(manualAmountValue) && manualAmountValue > 0 && manualAmountValue <= totalRental &&
      !manualDiscountExceedsPercentCap && !manualDiscountExceedsAmountCap &&
      (!manualDiscountExceedsLoyalty || manualDiscountOverrideAllowed) &&
      allowedManualReasons.includes(manualDiscountReasonCode) &&
      (!checkoutDiscountPolicy.data.require_reason || Boolean(manualDiscountReasonNote.trim())));

  const loyaltyBasisAmount = Math.max(0, totalRental - walkInManualAmountValue) + saleSubtotal;
  const walkInLoyaltyPreview = useQuery({
    queryKey: ["event-promotions", "walk-in-checkout-loyalty-preview", context.data?.usahaId, selectedRenterId, loyaltyBasisAmount],
    queryFn: () => previewLoyaltyDiscount(context.data!.usahaId, selectedRenterId, loyaltyBasisAmount),
    enabled: Boolean(context.data?.usahaId && selectedRenterId && !rentalId && !isReservationFlow),
    staleTime: 10_000,
  });
  const walkInLoyaltyRecommended = Number(walkInLoyaltyPreview.data?.recommended_amount ?? 0);
  const walkInLoyaltyActual = applyLoyaltyDiscount ? walkInLoyaltyRecommended : 0;
  const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
  const walkInLoyaltySaleAmount = loyaltyBasisAmount > 0
    ? walkInLoyaltyActual >= loyaltyBasisAmount
      ? saleSubtotal
      : Math.min(saleSubtotal, roundMoney(walkInLoyaltyActual * saleSubtotal / loyaltyBasisAmount))
    : 0;
  const walkInLoyaltyRentalAmount = roundMoney(walkInLoyaltyActual - walkInLoyaltySaleAmount);
  const walkInEffectiveRentalDiscount = walkInManualAmountValue + walkInLoyaltyRentalAmount;
  const walkInDiscountedRentalTotal = Math.max(0, totalRental - walkInEffectiveRentalDiscount);
  const checkoutTotal = Math.max(0, walkInDiscountedRentalTotal + saleSubtotal - walkInLoyaltySaleAmount);
  const manualDraftAmountValue = Number(manualDiscountDraftAmount);
  const manualDraftExceedsPercentCap = checkoutDiscountPolicy.data?.max_discount_percent != null &&
    totalRental > 0 && manualDraftAmountValue / totalRental * 100 > Number(checkoutDiscountPolicy.data.max_discount_percent);
  const manualDraftExceedsAmountCap = checkoutDiscountPolicy.data?.max_discount_amount != null &&
    manualDraftAmountValue > Number(checkoutDiscountPolicy.data.max_discount_amount);
  const manualDiscountDraftIsValid = Boolean(
    canApplyCheckoutDiscount &&
    checkoutDiscountPolicy.data?.manual_discount_enabled === true &&
    Number.isFinite(manualDraftAmountValue) && manualDraftAmountValue > 0 && manualDraftAmountValue <= totalRental &&
    !manualDraftExceedsPercentCap && !manualDraftExceedsAmountCap &&
    allowedManualReasons.includes(manualDiscountDraftReasonCode) &&
    (!checkoutDiscountPolicy.data.require_reason || Boolean(manualDiscountDraftReasonNote.trim())),
  );
  const directDiscountInputIsValid =
    (!manualDiscountApplied || Boolean(
      canApplyCheckoutDiscount &&
      checkoutDiscountPolicy.data?.manual_discount_enabled === true &&
      Number.isFinite(walkInManualAmountValue) && walkInManualAmountValue > 0 && walkInManualAmountValue <= totalRental &&
      !manualDiscountExceedsPercentCap && !manualDiscountExceedsAmountCap &&
      allowedManualReasons.includes(manualDiscountReasonCode) &&
      (!checkoutDiscountPolicy.data.require_reason || Boolean(manualDiscountReasonNote.trim()))
    )) &&
    (!applyLoyaltyDiscount || Boolean(
      canApplyCheckoutDiscount &&
      walkInLoyaltyPreview.isSuccess &&
      walkInLoyaltyPreview.data?.eligible === true &&
      walkInLoyaltyRecommended > 0
    ));
  const discountInputIsValid = isReservationFlow ? legacyDiscountInputIsValid : directDiscountInputIsValid;
  const discountRequest: CheckoutDiscountRequest = isReservationFlow
    ? legacyDiscountRequest
    : manualDiscountApplied || applyLoyaltyDiscount
      ? {
          mode: "combined",
          manual: {
            enabled: manualDiscountApplied,
            amount: walkInManualAmountValue,
            reason_code: manualDiscountReasonCode,
            reason_note: manualDiscountReasonNote.trim() || null,
          },
          loyalty: { apply: applyLoyaltyDiscount },
        }
      : { mode: "none" };
  const hasBonusLineWithoutReason = saleCartLines.some(({ item }) =>
    Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) &&
    !saleBonusReasons[item.key]?.trim(),
  );
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
      startAt,
      endAt,
    ],
    queryFn: async () => {
      const { previewDirectRentalAvailability } = await import("@/features/penyewaan");
      return previewDirectRentalAvailability(context.data!.usahaId, {
        barangId: itemDialogId,
        varianBarangId: effectiveVariantId || null,
        requestedUnits: selectedQuantityNumber,
        startAt: localDateTimeToUtcIso(startAt, context.data!.timezone),
        endAt: localDateTimeToUtcIso(endAt, context.data!.timezone),
      });
    },
    enabled:
      Boolean(context.data?.usahaId && itemDialogId && startAt && endAt)
      && new Date(endAt).getTime() > new Date(startAt).getTime()
      && Number.isInteger(selectedQuantityNumber)
      && selectedQuantityNumber > 0
      && !rentalId
      && !isReservationFlow,
    staleTime: 10_000,
  });

  const selectedReadyStock =
    availabilityPreview.data?.readyPhysicalUnits ??
    (selectedVariantId
      ? readyStock.data?.byVariant[selectedVariantId] ?? 0
      : itemDialogId
        ? readyStock.data?.byProduct[itemDialogId] ?? 0
        : 0);

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

  const packagePrice = useMemo(
    () => resolvePackagePrice(packageTariff, packageDetail.data?.package.active_promo),
    [packageTariff, packageDetail.data?.package.active_promo],
  );

  const packageBillingPeriods =
    packageTariff && canMoveFromPeriod
      ? calculateTariffPeriods(startAt, endAt, packageTariff)
      : 0;

  const selectedItemIsRentable = selectedVariantId
    ? Boolean(selectedVariant?.is_rentable ?? selectedProduct?.is_rentable)
    : Boolean(selectedProduct?.is_rentable);

  const canOpenItemConfig = Boolean(selectedProduct && selectedItemIsRentable);
  const canAddItem =
    Boolean(selectedProduct && selectedTariff && selectedItemIsRentable && canMoveFromPeriod) &&
    Number.isInteger(selectedQuantityNumber) &&
    selectedQuantityNumber > 0 &&
    billingPeriods > 0 &&
    availabilityPreview.isSuccess &&
    availabilityPreview.data.physicalCheck === "pass" &&
    selectedQuantityNumber <= selectedReadyStock;

  const canAddPackage =
    Boolean(selectedPackage && packageTariff && canMoveFromPeriod) &&
    packageTariff?.currency_code === "IDR" &&
    packageBillingPeriods > 0 &&
    Number.isInteger(selectedPackageQuantityNumber) &&
    selectedPackageQuantityNumber > 0 &&
    selectedPackageAvailability?.status === "available" &&
    selectedPackageQuantityNumber <= (selectedPackageAvailability?.available_package_quantity ?? 0);

  const selectedRenter = selectedRenterQuery.data ?? selectedRenterFromPicker;

  const paymentRecorded = operationalWorkspace.data?.payments.reduce(
    (sum, payment) => sum + Number(payment.amount ?? 0),
    0,
  ) ?? 0;
  const operationalTotal = Number(operationalWorkspace.data?.rental.total_amount ?? 0);
  const paymentRemaining = Math.max(0, operationalTotal - paymentRecorded);
  const currentPaymentStatus = paymentStatus(paymentRecorded, operationalTotal);

  const receiptData = receiptQuery.data ?? null;

  useEffect(() => {
    if (!context.data || startAt || rentalId || isReservationFlow || isSmartBookingFlow) return;
    setStartAt(formatDateTimeLocalInTimezone(new Date(), context.data.timezone));
  }, [context.data, isReservationFlow, isSmartBookingFlow, rentalId, startAt]);

  useEffect(() => {
    const reservation = reservationPrefill.data;
    if (!isReservationFlow || !reservation || reservation.status !== "confirmed" || reservation.stock_lock_status !== "locked") return;
    setSelectedRenterId(reservation.penyewa_id);
  }, [isReservationFlow, reservationPrefill.data]);

  useEffect(() => {
    if (!accounts.data?.length || paymentAccountId) return;
    setPaymentAccountId(accounts.data[0].akun_keuangan_id);
  }, [accounts.data, paymentAccountId]);

  useEffect(() => {
    if (firstAllowedManualReason && !currentManualReasonAllowed) {
      setManualDiscountReasonCode(firstAllowedManualReason);
    }
  }, [firstAllowedManualReason, currentManualReasonAllowed]);

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

  const rentalCommandIdempotencyKey =
    isReservationFlow && reservationIdFromQuery
      ? "create-rental-from-reservation-" + reservationIdFromQuery + "-" + rentalCommandKey
      : rentalCommandKey;

  const createRentalMutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Usaha belum tersedia.");

      if (isSmartBookingFlow) {
        const booking = smartBookingPrefill.data;
        if (!booking || smartBookingPrefillState !== "ready") {
          throw new Error("Snapshot booking belum selesai dipersiapkan.");
        }
        if (booking.workflow_status !== "ready_for_checkout") {
          throw new Error("Booking harus berstatus Siap checkout.");
        }
        if (booking.change_requests.some((request) => request.status === "pending")) {
          throw new Error("Selesaikan permintaan perubahan customer sebelum checkout.");
        }
        if (!draftLines.length && !saleCartLines.length) {
          throw new Error("Booking tidak memiliki barang untuk ditransaksikan.");
        }
        if (draftLines.length > 0) {
          if (!booking.renter_id || selectedRenterId !== booking.renter_id) {
            throw new Error("Identitas penyewa pada booking tidak sesuai.");
          }
          if (!canMoveFromPeriod) {
            throw new Error("Jam aktual pengambilan dan pengembalian harus diisi terlebih dahulu.");
          }
          if (
            startAt.slice(0, 10) !== booking.requested_pickup_date ||
            endAt.slice(0, 10) !== booking.requested_return_date
          ) {
            throw new Error("Tanggal transaksi harus mengikuti jadwal booking yang telah disetujui.");
          }
        }
        if (saleCartLines.length > 0 && !paymentAccountId) {
          throw new Error("Pilih akun operasional penerima pembayaran sebelum checkout.");
        }
        if (hasBonusLineWithoutReason || saleCartLines.some(({ item }) =>
          Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key),
        )) {
          throw new Error("Item bonus tidak dapat ditambahkan saat proses Reservasi. Ajukan perubahan kepada customer terlebih dahulu.");
        }

        setRentalCommandState("processing");
        return checkoutAkashaSmartBooking({
          smartBookingId: booking.smart_booking_id,
          expectedRevision: booking.revision,
          pickupAt: draftLines.length
            ? localDateTimeToUtcIso(startAt, context.data.timezone)
            : null,
          returnAt: draftLines.length
            ? localDateTimeToUtcIso(endAt, context.data.timezone)
            : null,
          rentalLines: draftLines.map((line) => line.input),
          saleLines: saleCartLines.map(({ item, jumlah }) => ({
            barang_id: item.barang_id,
            varian_barang_id: item.varian_barang_id,
            jumlah,
          })),
          accountId: saleCartLines.length > 0 ? paymentAccountId : null,
          paymentMethod,
          paymentRentalAmount: 0,
          note: "Transaksi dari Reservasi Akasha " + booking.reference_code,
          discountRequest: draftLines.length ? discountRequest : { mode: "none" },
          idempotencyKey: rentalCommandKey,
          requestId: createClientId(),
          activateRental: directAfterCreateRef.current && draftLines.length > 0,
        });
      }

      if (!selectedRenterId) throw new Error("Pilih penyewa terlebih dahulu.");
      if (!canMoveFromPeriod) throw new Error("Waktu mulai dan kembali wajib diisi dengan durasi yang valid.");
      if (isReservationFlow) {
        const reservation = reservationPrefill.data;
        if (!reservationIdFromQuery || !reservation) throw new Error("Detail reservasi belum selesai dimuat.");
        if (reservation.status !== "confirmed" || reservation.stock_lock_status !== "locked") {
          throw new Error("Reservasi harus terkonfirmasi dan stoknya terkunci sebelum dilanjutkan.");
        }
        if (selectedRenterId !== reservation.penyewa_id) {
          throw new Error("Penyewa harus mengikuti identitas yang terdaftar pada reservasi.");
        }
        if (startAt.slice(0, 10) !== reservation.mulai_reservasi || endAt.slice(0, 10) !== reservation.selesai_reservasi) {
          throw new Error("Tanggal mulai dan kembali harus sesuai periode reservasi. Admin tetap menentukan jam aktual.");
        }
        if (!reservation.lines.length) throw new Error("Reservasi belum memiliki barang atau paket.");
        setRentalCommandState("processing");
        return createRentalFromReservationWithDiscount(
          context.data.usahaId,
          {
            reservasiId: reservation.reservasi_id,
            jadwalMulai: localDateTimeToUtcIso(startAt, context.data.timezone),
            jadwalKembali: localDateTimeToUtcIso(endAt, context.data.timezone),
          },
          discountRequest,
          { idempotencyKey: rentalCommandIdempotencyKey, requestId: createClientId() },
          directAfterCreateRef.current,
        );
      }
      if (!draftLines.length) throw new Error("Tambahkan minimal satu barang atau paket.");
      setRentalCommandState("processing");
      const directInput = {
        penyewa_id: selectedRenterId,
        jadwal_mulai: localDateTimeToUtcIso(startAt, context.data.timezone),
        jadwal_kembali: localDateTimeToUtcIso(endAt, context.data.timezone),
        catatan: null,
        lines: draftLines.map((line) => line.input),
      };
      const commandOptions = { idempotencyKey: rentalCommandKey, requestId: createClientId() };
      if (saleCartLines.length > 0) {
        if (saleSubtotal > 0 && !paymentAccountId) throw new Error("Pilih akun operasional penerima pembayaran sebelum checkout.");
        if (hasBonusLineWithoutReason) throw new Error("Alasan untuk setiap barang bonus wajib diisi.");
        return createMixedCheckout(context.data.usahaId, {
          penyewaId: selectedRenterId,
          jadwalMulai: directInput.jadwal_mulai,
          jadwalKembali: directInput.jadwal_kembali,
          rentalLines: directInput.lines,
          saleLines: saleCartLines.map(({ item, jumlah }) => {
            const isBonus = Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key);
            return {
              barang_id: item.barang_id,
              varian_barang_id: item.varian_barang_id,
              jumlah,
              is_bonus_rental: isBonus,
              bonus_reason: isBonus ? saleBonusReasons[item.key].trim() : null,
            };
          }),
          akunKeuanganId: paymentAccountId || null,
          metode: paymentMethod,
          catatan: "Barang tambahan dibeli pada pembuatan rental.",
        }, {
          ...commandOptions,
          activateRental: directAfterCreateRef.current,
          discountRequest,
        });
      }
      return createDirectRentalWithDiscount(
        context.data.usahaId,
        directInput,
        discountRequest,
        commandOptions,
        directAfterCreateRef.current,
      );
    },
    onSuccess: async (result) => {
      if (isSmartBookingFlow) {
        const booking = smartBookingPrefill.data;
        directAfterCreateRef.current = false;
        setRentalCommandState("idle");
        if (!booking) throw new Error("Referensi Reservasi tidak tersedia setelah checkout.");

        setSaleCart({});
        setSaleBonusReasons({});
        setDraftLines([]);
        setPickerLines([]);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["penyewaan"] }),
          queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
          queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
          queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
          queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking"] }),
        ]);
        navigate(paths.reservasi + "/" + booking.smart_booking_id);
        return;
      }

      const id = result.penyewaan_id;
      if (!id) throw new Error("Rental berhasil dibuat tetapi ID penyewaan tidak dikembalikan.");
      const directActivationCommitted = directAfterCreateRef.current;
      if ("penjualan_id" in result && typeof result.penjualan_id === "string") {
        setMixedSaleId(result.penjualan_id);
        setSaleCart({});
        setSaleBonusReasons({});
      }
      setRentalId(id);
      await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });
      if ("penjualan_id" in result && typeof result.penjualan_id === "string") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
          queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
          queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
        ]);
      }

      if (directActivationCommitted) {
        directAfterCreateRef.current = false;
        setRentalCommandState("idle");
        setOperationalFeedback("Penyewaan langsung aktif. Penetapan unit dan serah-terima tersimpan dalam satu transaksi.");
        await queryClient.invalidateQueries({ queryKey: ["penyewaan", "operational-workspace", context.data?.usahaId, id] });
      } else if (directAfterCreateRef.current) {
        directAfterCreateRef.current = false;
        await activateImmediatelyAfterCreate(id);
      } else {
        setRentalCommandState("idle");
      }
    },
    onError: async (error) => {
      if (isSmartBookingFlow) {
        if (isUnknownOutcome(error)) {
          setRentalCommandState("unknown");
          setOperationalFeedback("Status konversi belum dapat dipastikan. Gunakan tombol yang sama untuk mengulang dengan kunci transaksi identik; server akan mengembalikan hasil yang sudah tersimpan tanpa membuat transaksi ganda.");
          return;
        }
        directAfterCreateRef.current = false;
        setRentalCommandState(isBusinessConflict(error) ? "conflict" : "error");
        setOperationalFeedback(commandMessage(error, "Proses transaksi Reservasi gagal. Periksa jadwal, tarif, akun pembayaran, dan stok terkini."));
        setRentalCommandKey(createClientId());
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "detail", context.data?.usahaId, smartBookingIdFromQuery] }),
          queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "availability", context.data?.usahaId, smartBookingIdFromQuery] }),
        ]);
        return;
      }

      if (!context.data) {
        directAfterCreateRef.current = false;
        setRentalCommandState("unknown");
        return;
      }
      if (isUnknownOutcome(error)) {
        const directActivationRequested = directAfterCreateRef.current;
        const commandName = saleCartLines.length > 0
          ? directActivationRequested
            ? "create_mixed_checkout_and_activate_with_discount"
            : "create_mixed_checkout_with_discount"
          : isReservationFlow
            ? directActivationRequested
              ? "create_rental_from_reservation_and_activate_with_discount"
              : "create_rental_from_reservation_with_discount"
            : directActivationRequested
              ? "create_direct_rental_and_activate_with_discount"
              : "create_direct_rental_with_discount";
        try {
          const reconciliation = await reconcileEventPromotionCheckout(
            context.data.usahaId,
            commandName,
            saleCartLines.length > 0 ? rentalCommandKey : rentalCommandIdempotencyKey,
          );
          if (reconciliation.state === "committed" && reconciliation.response) {
            const response = reconciliation.response;
            const committedRentalId = typeof response.penyewaan_id === "string" ? response.penyewaan_id : "";
            if (!committedRentalId) throw new Error("Hasil rekonsiliasi tidak memuat penyewaan_id.");
            setRentalId(committedRentalId);
            directAfterCreateRef.current = false;
            if (saleCartLines.length > 0) {
              const committedSaleId = typeof response.penjualan_id === "string" ? response.penjualan_id : "";
              if (committedSaleId) setMixedSaleId(committedSaleId);
              setSaleCart({});
              setSaleBonusReasons({});
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
                queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
                queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
              ]);
            }
            setRentalCommandState("idle");
            if (directActivationRequested) {
              setOperationalFeedback("Penyewaan langsung aktif. Status transaksi, penetapan unit, dan serah-terima sudah terverifikasi.");
            }
            await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });
            await queryClient.invalidateQueries({ queryKey: ["penyewaan", "operational-workspace", context.data.usahaId, committedRentalId] });
            return;
          }
          if (reconciliation.state === "not_found") {
            directAfterCreateRef.current = false;
            setRentalCommandKey(createClientId());
            setRentalCommandState("error");
            setOperationalFeedback("Server memastikan transaksi belum tersimpan. Keranjang tetap tersedia; periksa kembali sebelum mengirim ulang.");
            return;
          }
        } catch {
          // The server could not confirm the command outcome; keep the explicit unknown state.
        }
        setRentalCommandState("unknown");
        return;
      }
      directAfterCreateRef.current = false;
      setRentalCommandState(isBusinessConflict(error) ? "conflict" : "error");
      if (isBusinessConflict(error)) {
        setOperationalFeedback(commandMessage(error, "Stok fisik tidak mencukupi atau unit sedang digunakan penyewaan lain."));
      }
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

  const selectedRenterIsValid = isReservationFlow
    ? Boolean(reservationPrefill.data && selectedRenterId === reservationPrefill.data.penyewa_id)
    : isSmartBookingFlow && draftLines.length === 0
      ? true
      : Boolean(selectedRenterId);
  const selectedLinesExist = isReservationFlow
    ? reservationLines.length > 0
    : isSmartBookingFlow
      ? draftLines.length + saleCartLines.length > 0
      : draftLines.length > 0;
  const reservationContinuationIsValid = !isReservationFlow || Boolean(
    reservationPrefill.data &&
    reservationPrefill.data.status === "confirmed" &&
    reservationPrefill.data.stock_lock_status === "locked" &&
    startAt.slice(0, 10) === reservationPrefill.data.mulai_reservasi &&
    endAt.slice(0, 10) === reservationPrefill.data.selesai_reservasi,
  );
  const smartBookingReady = !isSmartBookingFlow || Boolean(
    smartBookingPrefillState === "ready" &&
    smartBookingPrefill.data?.workflow_status === "ready_for_checkout" &&
    !smartBookingPrefill.data.change_requests.some((request) => request.status === "pending"),
  );
  const rentalPeriodValid = isSmartBookingFlow
    ? draftLines.length === 0 || canMoveFromPeriod
    : canMoveFromPeriod;
  const discountValidForFlow = isSmartBookingFlow && draftLines.length === 0
    ? true
    : discountInputIsValid;
  const saleAccountReady = isSmartBookingFlow
    ? saleCartLines.length === 0 || (Boolean(paymentAccountId) && accounts.isSuccess)
    : saleSubtotal <= 0 || (Boolean(paymentAccountId) && accounts.isSuccess);
  const canPrepareRental = Boolean(
    smartBookingReady &&
    selectedRenterIsValid &&
    rentalPeriodValid &&
    selectedLinesExist &&
    discountValidForFlow &&
    !hasBonusLineWithoutReason &&
    saleAccountReady &&
    reservationContinuationIsValid &&
    (!isReservationFlow || !reservationPrefill.isPending) &&
    (!isSmartBookingFlow || !smartBookingPrefill.isPending),
  );

  const handlePrepareRental = () => {
    if (!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending) return;
    if (rentalCommandState !== "unknown") directAfterCreateRef.current = false;
    createRentalMutation.mutate();
  };

  const handleDirectRental = () => {
    if (!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending) return;
    if (rentalId) {
      activationMutation.mutate(rentalId);
      return;
    }
    if (rentalCommandState !== "unknown") directAfterCreateRef.current = true;
    createRentalMutation.mutate();
  };

  const rentalCreated = Boolean(rentalId);
  const isActive = operationalWorkspace.data?.rental.status === "active";
  const totalReadyLabel = isActive
    ? operationalWorkspace.data?.lines.reduce((sum, line) => sum + line.assignments.length, 0) ?? 0
    : 0;

  const selectedProductImage = itemDialogId
    ? (selectedVariantId
      ? unitCoverByVariant.get(selectedVariantId) ??
        selectedVariant?.media?.find((media) => media.is_cover)?.url ??
        selectedVariant?.media?.[0]?.url ??
        unitCoverByProduct.get(itemDialogId) ??
        coverByProduct.get(itemDialogId)
      : unitCoverByProduct.get(itemDialogId) ?? coverByProduct.get(itemDialogId)) ?? null
    : null;

  const openItemDialog = (product: CatalogProduct) => {
    setItemConfigOpen(false);
    setSelectedVariantId("");
    setSelectedQuantity("1");
    setCatalogDialog({ open: true, mode: "item", id: product.barang_id });
  };

  const openPackageDialog = (pkg: CatalogPackage) => {
    setItemConfigOpen(false);
    setSelectedPackageQuantity("1");
    setSelectedPackageNote("");
    setCatalogDialog({ open: true, mode: "package", id: pkg.paket_sewa_id });
  };

  const closeCatalogDialog = () => {
    setItemConfigOpen(false);
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
              isActiveCatalogTariff(tariff, rentalTariffAt),
          )
        : null) ??
      selectedTariff;
    const lineBillingPeriods =
      lineTariff && canMoveFromPeriod
        ? calculateTariffPeriods(startAt, endAt, lineTariff)
        : billingPeriods;
    if (!lineTariff || !lineBillingPeriods) return;

    const linePromotion = lineVariantId
      ? productDetail.data?.variants.find((variant) => variant.varian_barang_id === lineVariantId)?.rental_promotion ??
        selectedProduct.rental_variant_promotions?.[lineVariantId] ?? selectedProduct.rental_promotion ?? null
      : selectedProduct.rental_promotion ?? null;
    const lineNormalUnitPrice = Number(lineTariff.nominal);
    const lineEffectiveUnitPrice = linePromotion
      ? roundMoney(lineNormalUnitPrice * (100 - Number(linePromotion.diskon_persen)) / 100)
      : lineNormalUnitPrice;

    const input: DirectRentalLineInput = {
      barang_id: selectedProduct.barang_id,
      varian_barang_id: lineVariantId || null,
      tarif_sewa_id: lineTariff.tarif_sewa_id,
      duration_periods: lineBillingPeriods,
      jumlah: quantity,
      unit_price: lineEffectiveUnitPrice,
      subtotal: calculateRentalLineSubtotal(quantity, lineEffectiveUnitPrice, lineBillingPeriods),
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
                normalUnitPrice: lineNormalUnitPrice,
                promoDiscountPercent: Number(linePromotion?.diskon_persen ?? 0),
                promoId: linePromotion?.promosi_katalog_id ?? null,
                stockReadyAtSelection: availabilityPreview.data?.readyPhysicalUnits ?? selectedReadyStock,
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
          normalUnitPrice: lineNormalUnitPrice,
          promoDiscountPercent: Number(linePromotion?.diskon_persen ?? 0),
          promoId: linePromotion?.promosi_katalog_id ?? null,
          stockReadyAtSelection: availabilityPreview.data?.readyPhysicalUnits ?? selectedReadyStock,
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
      unit_price: Number(packagePrice.effectivePrice ?? packageTariff.nominal),
      subtotal: calculateRentalLineSubtotal(
        quantity,
        Number(packagePrice.effectivePrice ?? packageTariff.nominal),
        packageBillingPeriods,
      ),
      currency_code: "IDR",
      catatan: selectedPackageNote.trim() || null,
    };
    const identity = "package:" + selectedPackage.paket_sewa_id;
    setPickerLines((current) => {
      const existing = current.find((line) => line.key === identity);
      if (existing) {
        return current.map((line) => (line.key === identity ? {
          ...line,
          input,
          normalUnitPrice: Number(packagePrice.normalPrice ?? packageTariff.nominal),
          promoDiscountPercent: packagePrice.isPromo && packagePrice.normalPrice ? roundMoney((1 - Number(packagePrice.effectivePrice) / packagePrice.normalPrice) * 100) : 0,
          promoId: packagePrice.promo?.promosi_paket_id ?? null,
          stockReadyAtSelection: selectedPackageAvailability?.available_package_quantity ?? null,
          description: "Paket × " + quantity,
        } : line));
      }
      return [
        ...current,
        {
          key: identity,
          kind: "package",
          label: selectedPackage.nama,
          description: "Paket × " + quantity,
          normalUnitPrice: Number(packagePrice.normalPrice ?? packageTariff.nominal),
          promoDiscountPercent: packagePrice.isPromo && packagePrice.normalPrice ? roundMoney((1 - Number(packagePrice.effectivePrice) / packagePrice.normalPrice) * 100) : 0,
          promoId: packagePrice.promo?.promosi_paket_id ?? null,
          stockReadyAtSelection: selectedPackageAvailability?.available_package_quantity ?? null,
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

  const openCatalogPage = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "catalog");
      return next;
    });
  };

  const closeCatalogPage = () => {
    setCartReviewOpen(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("view");
      return next;
    });
    setCatalogDialog({ open: false });
  };

  const switchCatalogMode = (mode: "rental" | "package" | "sale") => {
    setSelectionMode(mode);
    setCatalogDialog({ open: false });
    setItemConfigOpen(false);
    setSelectedVariantId("");
    if (mode === "rental") setCategoryId("all");
    if (mode === "sale") setSaleCategoryId("all");
  };

  const editLine = (line: DraftRentalLine, picker = false) => {
    if (line.kind !== "item") return;
    const parts = line.key.split(":");
    const productId = parts[1] ?? "";
    const variantId = parts[2] === "base" ? "" : parts.slice(2).join(":");
    setSelectionMode("rental");
    setSelectedVariantId(variantId);
    setSelectedQuantity(String(line.input.jumlah));
    setCatalogDialog({ open: true, mode: "item", id: productId });
    setItemConfigOpen(true);
    if (!picker) {
      setPickerLines(draftLines.map((draftLine) => ({
        ...draftLine,
        input: { ...draftLine.input },
      })));
      openCatalogPage();
    }
  };

  const editPackageLine = (line: DraftRentalLine) => {
    const paketId = line.input.paket_sewa_id;
    if (!paketId) return;
    setSelectionMode("package");
    setSelectedPackageQuantity(String(line.input.jumlah));
    setSelectedPackageNote(line.input.catatan ?? "");
    setCatalogDialog({ open: true, mode: "package", id: paketId });
    setCartReviewOpen(false);
  };

  const pickerTotal = pickerLines.reduce((sum, line) => sum + Number(line.input.subtotal), 0);
  const pickerItemCount =
    pickerLines.reduce((sum, line) => sum + Number(line.input.jumlah), 0) +
    saleCartLines.reduce((sum, line) => sum + line.jumlah, 0);

  const openCatalogPicker = () => {
    setPickerLines(draftLines.map((line) => ({ ...line, input: { ...line.input } })));
    setProductSearch("");
    setCategoryId("all");
    setSaleCategoryId("all");
    setCartReviewOpen(false);
    setSelectionMode("rental");
    setCatalogDialog({ open: false });
    openCatalogPage();
  };

  const applyCatalogPicker = () => {
    setDraftLines(pickerLines.map((line) => ({ ...line, input: { ...line.input } })));
    closeCatalogPage();
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

  const saleCartPanel = (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShoppingCart className="size-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="truncate text-[11px] font-bold">Keranjang pembelian</h2>
            <p className="text-[9px] text-muted-foreground">Barang jual dalam checkout yang sama.</p>
          </div>
        </div>
        <span className="shrink-0 text-[9px] font-semibold">{saleCartLines.reduce((sum, line) => sum + line.jumlah, 0)} item</span>
      </div>
      {saleCartLines.length ? (
        <div className="space-y-2 p-3">
          <div className="space-y-1.5">
            {saleCartLines.map(({ item, jumlah }) => {
              const isUntracked = item.inventory_mode === "untracked";
              const availableStock = Number(item.available_stock ?? 0);
              return (
              <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold">{item.nama}</p>
                  <p className="text-[9px] text-muted-foreground">
                    <span>{jumlah} × {Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) ? "Bonus rental · Rp0" : formatCatalogMoney(item.harga_jual_efektif ?? item.harga_jual ?? 0, "IDR")}</span> · {isUntracked ? "Stok tidak dilacak" : "Stok " + availableStock}
                  </p>
                  {!Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) && item.promo_diskon_persen != null ? (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[8px]">
                      <span className="text-muted-foreground line-through">{formatCatalogMoney(item.harga_jual ?? 0, "IDR")}</span>
                      <span className="font-semibold text-emerald-700">Promo {item.promo_diskon_persen}% · {formatCatalogMoney(Number(item.harga_jual_efektif ?? item.harga_jual ?? 0) * jumlah, "IDR")}</span>
                    </div>
                  ) : !Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) ? (
                    <p className="mt-0.5 text-[8px] font-semibold">Subtotal {formatCatalogMoney(Number(item.harga_jual_efektif ?? item.harga_jual ?? 0) * jumlah, "IDR")}</p>
                  ) : null}
                  {!isSmartBookingFlow && canApplyRetailBonus ? (
                    <div className="mt-1.5 space-y-1.5">
                      <Button
                        type="button"
                        variant={Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) ? "secondary" : "outline"}
                        size="sm"
                        className="h-6 rounded-lg px-2 text-[8px]"
                        onClick={() => setSaleBonusReasons((current) => {
                          const next = { ...current };
                          if (Object.prototype.hasOwnProperty.call(next, item.key)) delete next[item.key];
                          else next[item.key] = "";
                          return next;
                        })}
                      >
                        {Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) ? "Batalkan bonus" : "Jadikan bonus rental"}
                      </Button>
                      {Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key) ? (
                        <Input
                          value={saleBonusReasons[item.key]}
                          onChange={(event) => setSaleBonusReasons((current) => ({ ...current, [item.key]: event.target.value }))}
                          placeholder="Alasan pemberian bonus (wajib)"
                          className="h-8 rounded-lg text-[9px]"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!isSmartBookingFlow ? (
                  <>
                  <Button type="button" variant="outline" size="icon" className="size-6 rounded-md" aria-label={"Kurangi " + item.nama}
                    onClick={() => {
                      if (jumlah <= 1) {
                        setSaleBonusReasons((current) => {
                          const copy = { ...current };
                          delete copy[item.key];
                          return copy;
                        });
                      }
                      setSaleCart((current) => {
                        const copy = { ...current };
                        const line = copy[item.key];
                        if (!line || line.jumlah <= 1) delete copy[item.key];
                        else copy[item.key] = { ...line, jumlah: line.jumlah - 1 };
                        return copy;
                      });
                    }}>−</Button>
                  <span className="min-w-4 text-center text-[9px] font-bold">{jumlah}</span>
                  <Button type="button" variant="outline" size="icon" className="size-6 rounded-md" aria-label={"Tambah " + item.nama}
                    disabled={!isUntracked && jumlah >= availableStock}
                    onClick={() => setSaleCart((current) => ({
                      ...current,
                      [item.key]: { item, jumlah: (current[item.key]?.jumlah ?? 0) + 1 },
                    }))}>+</Button>
                  <Button type="button" variant="ghost" size="icon" className="size-6 rounded-md text-destructive" aria-label={"Hapus " + item.nama}
                    onClick={() => {
                      setSaleCart((current) => {
                        const copy = { ...current };
                        delete copy[item.key];
                        return copy;
                      });
                      setSaleBonusReasons((current) => {
                        const copy = { ...current };
                        delete copy[item.key];
                        return copy;
                      });
                    }}><Trash2 className="size-3" /></Button>
                  </>
                  ) : (
                    <span className="rounded-md bg-background px-2 py-1 text-[9px] font-semibold">Snapshot × {jumlah}</span>
                  )}
                </div>
              </div>
            );
            })}
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-[10px]">
            <span className="text-muted-foreground">Subtotal pembelian</span>
            <strong>{formatCatalogMoney(saleSubtotal, "IDR")}</strong>
          </div>
          {saleSubtotal > 0 || (isSmartBookingFlow && saleCartLines.length > 0) ? (
            <label className="grid gap-1 text-[9px] font-medium">
              Pembayaran penjualan masuk ke
              <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                <SelectTrigger className="h-8 rounded-lg text-[10px]">
                  <SelectValue placeholder={accounts.isPending ? "Memuat akun…" : "Pilih akun kas/bank"} />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((account) => (
                    <SelectItem key={account.akun_keuangan_id} value={account.akun_keuangan_id}>{account.nama_akun}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : (
            <p className="rounded-lg bg-emerald-500/5 px-2.5 py-2 text-[8px] text-muted-foreground">
              Keranjang hanya berisi barang bonus. Tidak ada penerimaan kas dari penjualan.
            </p>
          )}
          {accounts.isError ? (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-[10px]">{commandMessage(accounts.error, "Akun pembayaran tidak dapat dimuat.")}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : (
        <p className="px-3 py-3 text-[9px] text-muted-foreground">
          Belum ada barang untuk dibeli. Pilih tab Barang jual untuk menambahkan produk.
        </p>
      )}
    </section>
  );

  const paymentActionLabel =
    currentPaymentStatus === "paid"
      ? "Lunas"
      : paymentMode === "paid"
        ? "Catat Pelunasan"
        : "Catat DP";

  const catalogPickerPage = catalogPickerOpen ? (
        <main className="relative -mx-3 -mt-4 -mb-24 flex h-[calc(100dvh-3.5rem)] min-h-0 w-[calc(100%+1.5rem)] max-w-none flex-col gap-0 overflow-hidden bg-background sm:-mx-5 sm:-mt-5 sm:w-[calc(100%+2.5rem)] lg:-mx-6 lg:-mt-6 lg:-mb-8 lg:h-[calc(100dvh-3.5rem)] lg:w-[calc(100%+3rem)]">
          <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1 sm:px-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              onClick={closeCatalogPage}
              aria-label="Tutup katalog"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="secondary" className="rounded-full text-[10px]">
                {pickerItemCount} item
              </Badge>
              <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg" onClick={closeCatalogPage} aria-label="Kembali ke formulir rental">
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-h-0 overflow-y-auto px-2.5 pb-24 pt-2.5 sm:px-3 sm:pb-24 sm:pt-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-2xl border bg-background px-3">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Cari nama barang atau kategori…"
                    aria-label="Cari barang di katalog"
                    className="h-10 border-0 px-0 text-[12px] shadow-none focus-visible:ring-0"
                  />
                  <Filter className="size-4 shrink-0 text-muted-foreground" />
                </div>

                <div className="space-y-2">
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Jenis transaksi katalog">
                    <Button type="button" size="sm" role="tab" aria-selected={selectionMode === "rental"} variant={selectionMode === "rental" ? "default" : "outline"} className="h-8 shrink-0 rounded-full px-3 text-[10px]" onClick={() => switchCatalogMode("rental")}>Barang sewa</Button>
                    <Button type="button" size="sm" role="tab" aria-selected={selectionMode === "package"} variant={selectionMode === "package" ? "default" : "outline"} className="h-8 shrink-0 rounded-full px-3 text-[10px]" onClick={() => switchCatalogMode("package")}>Paket rental</Button>
                    <Button type="button" size="sm" role="tab" aria-selected={selectionMode === "sale"} variant={selectionMode === "sale" ? "default" : "outline"} className="h-8 shrink-0 rounded-full px-3 text-[10px]" onClick={() => switchCatalogMode("sale")}>Barang jual</Button>
                  </div>
                  {selectionMode !== "package" ? (
                    <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label={selectionMode === "sale" ? "Filter kategori barang jual" : "Filter kategori barang sewa"}>
                      <Button type="button" size="sm" variant={visibleCategoryId === "all" ? "default" : "outline"} className="h-7 shrink-0 rounded-full px-3 text-[9px]" onClick={() => setVisibleCategoryId("all")}>Semua</Button>
                      {visibleCategories.map((category) => (
                        <Button key={category.id} type="button" size="sm" variant={visibleCategoryId === category.id ? "default" : "outline"} className="h-7 shrink-0 rounded-full px-3 text-[9px]" onClick={() => setVisibleCategoryId(category.id)}>{category.nama}</Button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {selectionMode === "rental" ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {products.isPending ? <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-[10px] text-muted-foreground"><Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat katalog sewa…</div> : null}
                    {products.isError ? <Alert variant="destructive" className="col-span-full"><AlertTitle>Katalog sewa belum dapat dimuat</AlertTitle><AlertDescription>{commandMessage(products.error, "Periksa koneksi dan coba muat ulang.")}</AlertDescription></Alert> : null}
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
                              <span className="flex min-w-0 flex-col items-end text-right">
                                {product.active_tariff && product.rental_promotion ? (
                                  <>
                                    <span className="text-[8px] text-muted-foreground line-through">{formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code)}</span>
                                    <span className="text-[9px] font-bold text-emerald-700">{formatCatalogMoney(roundMoney(Number(product.active_tariff.nominal) * (100 - Number(product.rental_promotion.diskon_persen)) / 100), product.active_tariff.currency_code)}</span>
                                    <span className="text-[8px] font-semibold text-emerald-700">Promo {product.rental_promotion.diskon_persen}%</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[9px] font-semibold text-primary">{product.active_tariff ? formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code) : "Tarif —"}</span>
                                    {product.has_variant_promotion ? <span className="text-[8px] font-semibold text-emerald-700">Promo varian tersedia</span> : null}
                                  </>
                                )}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {products.isSuccess && !activeProducts.length ? (
                      <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-[10px] text-muted-foreground">
                        Barang sewa tidak ditemukan untuk pencarian atau kategori ini.
                      </div>
                    ) : null}
                  </div>
                ) : selectionMode === "package" ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {packages.isPending ? <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-[10px] text-muted-foreground"><Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat paket rental…</div> : null}
                    {packages.isError ? <Alert variant="destructive" className="col-span-full"><AlertDescription>{commandMessage(packages.error, "Katalog paket gagal dimuat.")}</AlertDescription></Alert> : null}
                    {packages.isSuccess && !packages.data?.length ? (
                      <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-[10px] text-muted-foreground">
                        Belum ada paket rental aktif. Barang sewa dan barang jual tetap tersedia melalui tab masing-masing.
                      </div>
                    ) : null}
                    {(packages.data ?? [])
                      .filter((pkg) => matchesCatalogTerm(catalogSearch, pkg.nama, "Paket rental", pkg.slug))
                      .map((pkg) => {
                        const availability = packageAvailability.data?.find((item) => item.paket_sewa_id === pkg.paket_sewa_id);
                        const isSelected = catalogDialog.open && catalogDialog.mode === "package" && catalogDialog.id === pkg.paket_sewa_id;
                        const availabilityLabel = !canMoveFromPeriod
                          ? "Atur periode rental"
                          : packageAvailability.isPending
                            ? "Memeriksa stok…"
                            : packageAvailability.isError
                              ? "Stok belum dapat diverifikasi"
                              : availability?.status === "available"
                                ? "Ready " + (availability.available_package_quantity ?? 0)
                                : availability
                                  ? packageAvailabilityHint(availability) ?? "Belum siap"
                                  : "Data stok tidak tersedia";
                        const availabilityTone = availability?.status === "available"
                          ? "text-emerald-600"
                          : !canMoveFromPeriod || packageAvailability.isPending
                            ? "text-muted-foreground"
                            : "text-amber-700";
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
                              <div className="mt-1 flex min-w-0 flex-col items-start gap-1">
                                <span className={cn(
                                  "max-w-full break-words text-[9px] font-semibold leading-tight",
                                  availabilityTone,
                                )}>
                                  {availabilityLabel}
                                </span>
                                {(() => {
                                  const price = resolvePackagePrice(pkg.active_tariff ?? null, pkg.active_promo);
                                  return (
                                    <div className="flex min-w-0 max-w-full flex-col items-start gap-0.5">
                                      {price.isPromo ? (
                                        <div className="flex flex-wrap items-center gap-1">
                                          <Badge variant="secondary" className="h-4 rounded-full px-1.5 py-0 text-[8px] leading-none">Promo</Badge>
                                          <span className="break-words text-[8px] font-medium leading-tight text-muted-foreground line-through">
                                            {formatCatalogMoney(price.normalPrice, pkg.active_tariff?.currency_code)}
                                          </span>
                                        </div>
                                      ) : null}
                                      <span className={cn(
                                        "max-w-full break-words text-[10px] font-bold leading-tight",
                                        price.isPromo ? "text-emerald-700 dark:text-emerald-300" : "text-primary",
                                      )}>
                                        {pkg.active_tariff
                                          ? formatCatalogMoney(price.effectivePrice, pkg.active_tariff.currency_code)
                                          : "Tarif belum ditentukan"}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {saleCatalog.isPending ? (
                      <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-[10px] text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat barang jual…
                      </div>
                    ) : null}
                    {saleCatalog.isError ? (
                      <Alert variant="destructive" className="col-span-full">
                        <AlertTitle>Katalog barang jual belum dapat dimuat</AlertTitle>
                        <AlertDescription>{commandMessage(saleCatalog.error, "Periksa koneksi dan coba muat ulang.")}</AlertDescription>
                      </Alert>
                    ) : null}
                    {saleCatalogItems.map((item) => {
                      const quantity = saleCart[item.key]?.jumlah ?? 0;
                      const isUntracked = item.inventory_mode === "untracked";
                      const availableStock = Number(item.available_stock ?? 0);
                      const canSell = (isUntracked || availableStock > 0) && item.harga_jual != null && item.harga_jual > 0;
                      return (
                        <article key={item.key} className="min-w-0 overflow-hidden rounded-2xl border bg-card">
                          <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                            {item.cover_url ? <img src={item.cover_url} alt="" loading="lazy" className="size-full object-cover" /> : <Package className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />}
                            <Badge className="absolute left-2 top-2 rounded-full bg-background/90 text-[8px] text-foreground hover:bg-background/90">
                              {isUntracked ? "Stok bebas" : availableStock > 0 ? "Stok " + availableStock : "Habis"}
                            </Badge>
                          </div>
                          <div className="space-y-1.5 p-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-bold">{item.nama}</p>
                              <p className="truncate text-[9px] text-muted-foreground">{item.kategori_nama}</p>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-col items-start">
                                {item.harga_jual == null ? (
                                  <span className="text-[9px] font-semibold text-muted-foreground">Harga belum diatur</span>
                                ) : (
                                  <>
                                    <span className="text-[9px] font-semibold text-primary">
                                      {formatCatalogMoney(item.harga_jual_efektif ?? item.harga_jual, "IDR")}
                                    </span>
                                    {item.promo_diskon_persen != null ? (
                                      <span className="text-[8px] text-emerald-700 dark:text-emerald-300">
                                        Promo {item.promo_diskon_persen}% · <span className="line-through text-muted-foreground">{formatCatalogMoney(item.harga_jual, "IDR")}</span>
                                      </span>
                                    ) : null}
                                  </>
                                )}
                              </div>
                              {quantity > 0 ? <span className="text-[8px] font-semibold text-emerald-700">Dipilih {quantity}</span> : null}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 w-full rounded-lg text-[9px]"
                              disabled={!canSell || (!isUntracked && quantity >= availableStock)}
                              onClick={() => setSaleCart((current) => ({
                                ...current,
                                [item.key]: { item, jumlah: (current[item.key]?.jumlah ?? 0) + 1 },
                              }))}
                            >
                              <Plus className="size-3" />{quantity ? "Tambah lagi" : "Tambah ke pembelian"}
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                    {saleCatalog.isSuccess && !saleCatalogItems.length ? (
                      <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-[10px] text-muted-foreground">
                        Barang jual tidak ditemukan untuk pencarian atau kategori ini.
                      </div>
                    ) : null}
                  </div>
                )}

                {catalogDialog.open ? (
                  <div className="lg:hidden">
                    {catalogDialog.mode === "item" ? null : (
                      <div className="mt-3 rounded-2xl border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold">{selectedPackage?.nama ?? "Paket"}</p>
                            <p className="mt-0.5 text-[9px] text-muted-foreground">
                              {!canMoveFromPeriod
                                ? "Atur periode rental untuk cek stok"
                                : packageAvailability.isPending
                                  ? "Memeriksa ketersediaan paket…"
                                  : packageAvailability.isError
                                    ? "Stok belum dapat diverifikasi"
                                    : selectedPackageAvailability?.status === "available"
                                      ? (selectedPackageAvailability.available_package_quantity ?? 0) + " paket siap"
                                      : selectedPackageAvailability
                                        ? packageAvailabilityHint(selectedPackageAvailability) ?? "Belum siap"
                                        : "Data stok tidak tersedia"}
                            </p>
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
                      </div>
                    )}
                  </div>
                ) : null}

              </div>
            </div>

            <aside className="hidden min-h-0 overflow-y-auto border-l bg-muted/10 p-3 lg:block">
              {catalogDialog.open && catalogDialog.mode === "item" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
                    <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                      {selectedProductImage ? <img src={selectedProductImage} alt="" className="size-full object-cover" /> : <Package className="size-7 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{selectedProduct?.nama ?? "Barang"}</p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">{selectedVariant?.nama ?? "Pilih varian melalui dialog"}</p>
                      <p className="mt-1 text-[9px] font-semibold text-emerald-600">Ready {selectedReadyStock}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-dashed p-4 text-center">
                    <p className="text-[10px] font-semibold">Atur pilihan sebelum menambahkan</p>
                    <p className="mt-1 text-[9px] text-muted-foreground">Tekan tombol Tambah di bawah untuk menentukan varian, jumlah unit, dan tarif.</p>
                    <Button type="button" size="sm" className="mt-3 h-8 rounded-lg text-[9px]" disabled={!canOpenItemConfig} onClick={() => setItemConfigOpen(true)}>
                      Atur jumlah & tarif
                    </Button>
                  </div>
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
                      <Badge variant="secondary" className="rounded-full text-[9px]">
                        {!canMoveFromPeriod
                          ? "Periode belum diatur"
                          : packageAvailability.isPending
                            ? "Memeriksa stok"
                            : packageAvailability.isError
                              ? "Gagal cek stok"
                              : selectedPackageAvailability?.status === "available"
                                ? (selectedPackageAvailability.available_package_quantity ?? 0) + " siap"
                                : selectedPackageAvailability
                                  ? packageAvailabilityHint(selectedPackageAvailability) ?? "Belum siap"
                                  : "Data stok tidak tersedia"}
                      </Badge>
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
                      {selectedPackageQuantityNumber} paket × {packageBillingPeriods || 0} periode × {packageTariff ? formatCatalogMoney(packagePrice.effectivePrice, packageTariff.currency_code) : "Rp0"}
                    </p>
                    {packagePrice.isPromo && packagePrice.normalPrice != null && packageTariff ? (
                      <p className="mt-1 text-[10px] text-muted-foreground line-through">
                        Harga normal {formatCatalogMoney(packagePrice.normalPrice, packageTariff.currency_code)} / periode
                      </p>
                    ) : null}
                    <p className="mt-1 text-[14px] font-black">
                      {packageTariff && packageBillingPeriods
                        ? formatCatalogMoney(
                            calculateRentalLineSubtotal(
                              selectedPackageQuantityNumber,
                              Number(packagePrice.effectivePrice ?? packageTariff.nominal),
                              packageBillingPeriods,
                            ),
                            "IDR",
                          )
                        : "—"}
                    </p>
                  </div>

                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed p-5 text-center">
                  <div>
                    <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-2 text-sm font-semibold">
                      {selectionMode === "sale" ? "Pilih barang jual" : "Pilih barang atau paket"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectionMode === "sale"
                        ? "Pilih barang untuk ditambahkan ke keranjang pembelian."
                        : "Detail foto, varian, stok, periode, dan harga akan muncul di sini."}
                    </p>
                  </div>
                </div>
              )}
            </aside>
          </div>

          <div data-testid="catalog-sticky-actions" className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(15,23,42,.08)] backdrop-blur">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] text-muted-foreground">{pickerItemCount} barang dipilih</p>
              <p className="truncate text-[12px] font-bold">{formatRentalMoney(pickerTotal + saleSubtotal, "IDR")}</p>
            </div>
            {catalogDialog.open && catalogDialog.mode === "item" ? (
              <Button type="button" className="h-10 shrink-0 rounded-xl px-3 text-[10px] sm:px-4" disabled={!canOpenItemConfig} onClick={() => setItemConfigOpen(true)}>
                <Plus className="size-3.5" /> Tambah ke Keranjang Sementara
              </Button>
            ) : catalogDialog.open && catalogDialog.mode === "package" ? (
              <Button type="button" className="h-10 shrink-0 rounded-xl px-3 text-[10px] sm:px-4" disabled={!canAddPackage} onClick={addCurrentPackage}>
                <Plus className="size-3.5" /> Tambah Paket
              </Button>
            ) : null}
            <Button
              type="button"
              variant="default"
              className="h-10 shrink-0 rounded-xl px-3 text-[10px] shadow-sm"
              aria-label="Tinjau keranjang"
              onClick={() => setCartReviewOpen(true)}
            >
              <ShoppingCart className="size-4" />
              <span className="hidden sm:inline">Keranjang</span>
              <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 rounded-full px-1 text-[9px]">
                {pickerItemCount}
              </Badge>
            </Button>
          </div>

          <Dialog open={itemConfigOpen} onOpenChange={setItemConfigOpen}>
            <DialogContent
              showCloseButton={false}
              className="flex max-h-[min(88dvh,720px)] w-[calc(100%-1rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-2xl p-0"
            >
              <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
                <div className="flex items-start justify-between gap-3 pr-7">
                  <div className="min-w-0">
                    <DialogTitle className="text-[15px]">Atur barang sewa</DialogTitle>
                    <DialogDescription className="mt-1 text-[10px]">
                      Pilih varian dan jumlah unit, lalu periksa ketersediaan serta tarif sebelum menambahkan.
                    </DialogDescription>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3 size-8 rounded-lg" onClick={() => setItemConfigOpen(false)} aria-label="Tutup pengaturan barang">
                    <X className="size-4" />
                  </Button>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                    {selectedProductImage ? <img src={selectedProductImage} alt="" className="size-full object-cover" /> : <Package className="size-7 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold">{selectedProduct?.nama ?? "Barang"}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{selectedVariant?.nama ?? "Varian utama"}</p>
                    <p className="mt-1 text-[10px] font-semibold text-emerald-600">
                      {availabilityPreview.data
                        ? "Ready " + selectedReadyStock + " untuk periode ini"
                        : "Ready " + selectedReadyStock + " unit fisik"}
                    </p>
                  </div>
                </div>
                {productDetail.isPending ? (
                  <div className="rounded-xl border border-dashed p-4 text-center text-[10px] text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat pilihan varian dan tarif…
                  </div>
                ) : null}
                {productDetail.isError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Detail barang belum dapat dimuat</AlertTitle>
                    <AlertDescription>{commandMessage(productDetail.error, "Coba tutup lalu pilih barang kembali.")}</AlertDescription>
                  </Alert>
                ) : null}
                {productDetail.data?.variants?.filter((variant) => variant.is_rentable ?? productDetail.data?.is_rentable).length ? (
                  <label className="block space-y-1">
                    <span className="text-[10px] font-medium text-muted-foreground">Varian / unit barang</span>
                    <Select value={selectedVariantId || "__base"} onValueChange={(value) => setSelectedVariantId(value === "__base" ? "" : value)}>
                      <SelectTrigger className="h-10 rounded-xl text-[11px]"><SelectValue placeholder="Pilih varian" /></SelectTrigger>
                      <SelectContent>
                        {productDetail.data.is_rentable ? <SelectItem value="__base">Tanpa varian</SelectItem> : null}
                        {productDetail.data.variants.filter((variant) => variant.is_rentable ?? productDetail.data?.is_rentable).map((variant) => <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>{variant.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                ) : null}
                <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold">Jumlah unit</p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {canMoveFromPeriod ? (billingPeriods || 0) + " periode tarif" : "Atur periode rental terlebih dahulu"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="outline" size="icon" className="size-9 rounded-lg" onClick={() => setSelectedQuantity(String(Math.max(1, selectedQuantityNumber - 1)))} disabled={selectedQuantityNumber <= 1}>−</Button>
                    <span className="min-w-6 text-center text-sm font-bold">{selectedQuantityNumber}</span>
                    <Button type="button" variant="outline" size="icon" className="size-9 rounded-lg" onClick={() => setSelectedQuantity(String(selectedQuantityNumber + 1))}>+</Button>
                  </div>
                </div>
                <div className="rounded-xl bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-semibold text-primary">Perhitungan tarif</span>
                    <span className="text-muted-foreground">{selectedReadyStock} unit siap</span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold">
                    {selectedQuantityNumber} unit × {billingPeriods || 0} periode × {selectedTariff ? formatCatalogMoney(selectedRentalEffectiveUnitPrice, selectedTariff.currency_code) : "Tarif belum tersedia"}
                  </p>
                  {selectedRentalPromotion && selectedTariff ? (
                    <div className="mt-1 flex items-center gap-1.5 text-[9px]">
                      <span className="text-muted-foreground line-through">{formatCatalogMoney(selectedRentalNormalSubtotal, selectedTariff.currency_code)}</span>
                      <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[8px] text-emerald-700">Promo {selectedRentalPromotion.diskon_persen}%</Badge>
                    </div>
                  ) : null}
                  <p className="mt-1 text-[17px] font-black">
                    {selectedTariff && billingPeriods ? formatCatalogMoney(selectedRentalEffectiveSubtotal, "IDR") : "—"}
                  </p>
                </div>
                {!canMoveFromPeriod ? (
                  <Alert>
                    <AlertDescription className="text-[10px]">Atur tanggal mulai dan kembali pada formulir rental untuk menghitung tarif dan memeriksa stok.</AlertDescription>
                  </Alert>
                ) : availabilityPreview.isPending ? (
                  <p className="text-[10px] text-muted-foreground">Memeriksa unit siap dan benturan jadwal…</p>
                ) : availabilityPreview.error ? (
                  <Alert variant="destructive" className="rounded-xl">
                    <AlertTitle>Ketersediaan belum dapat diverifikasi</AlertTitle>
                    <AlertDescription className="text-[10px]">Barang tidak dapat ditambahkan sebelum status unit dan jadwal berhasil diperiksa.</AlertDescription>
                  </Alert>
                ) : availabilityPreview.data && availabilityPreview.data.readyPhysicalUnits < selectedQuantityNumber ? (
                  <Alert variant="destructive" className="rounded-xl">
                    <AlertTitle>Unit tersedia tidak cukup</AlertTitle>
                    <AlertDescription className="text-[10px]">{availabilityPreview.data.readyPhysicalUnits} unit siap dan tidak berbenturan, sementara diminta {selectedQuantityNumber}.</AlertDescription>
                  </Alert>
                ) : availabilityPreview.isSuccess ? (
                  <p className="text-[10px] font-medium text-emerald-700">Ketersediaan terverifikasi untuk periode rental ini.</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <p className="text-[9px] text-muted-foreground">Subtotal</p>
                  {selectedRentalPromotion && selectedTariff ? <p className="truncate text-[9px] text-muted-foreground line-through">{formatCatalogMoney(selectedRentalNormalSubtotal, "IDR")}</p> : null}
                  <p className="truncate text-[13px] font-black">
                    {selectedTariff && billingPeriods ? formatCatalogMoney(selectedRentalEffectiveSubtotal, "IDR") : "—"}
                  </p>
                </div>
                <Button type="button" className="h-10 shrink-0 rounded-xl px-4 text-[10px]" disabled={!canAddItem} onClick={addCurrentItem}>
                  <Plus className="size-4" /> Tambahkan
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={cartReviewOpen} onOpenChange={setCartReviewOpen}>
            <DialogContent
              showCloseButton={false}
              className="flex max-h-[86dvh] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
            >
              <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
                <div className="flex items-start justify-between gap-3 pr-7">
                  <div className="min-w-0">
                    <DialogTitle className="text-[15px]">Tinjau pilihan</DialogTitle>
                    <DialogDescription className="mt-1 text-[10px]">
                      Periksa barang sewa, pembelian tambahan, jumlah, stok, dan tujuan pembayaran sebelum selesai.
                    </DialogDescription>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3 size-8 rounded-lg" onClick={() => setCartReviewOpen(false)} aria-label="Tutup keranjang">
                    <X className="size-4" />
                  </Button>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
                <section className="rounded-xl border bg-card">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                    <div className="min-w-0">
                      <h2 className="text-[11px] font-bold">Keranjang sewa</h2>
                      <p className="text-[9px] text-muted-foreground">Barang dan paket yang akan disewa.</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[9px]">
                      {pickerLines.reduce((sum, line) => sum + Number(line.input.jumlah), 0)} unit
                    </Badge>
                  </div>
                  {pickerLines.length ? (
                    <div className="space-y-1.5 p-2.5">
                      {pickerLines.map((line) => (
                        <div key={line.key} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-semibold">{line.label}</p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{line.description}</p>
                            <p className="mt-0.5 text-[9px] text-muted-foreground">
                              {line.stockReadyAtSelection == null
                                ? "Stok diverifikasi saat dipilih"
                                : line.kind === "package"
                                  ? line.stockReadyAtSelection + " paket siap saat dipilih"
                                  : line.stockReadyAtSelection + " unit siap saat dipilih"}
                              {" · "}{line.input.duration_periods} periode
                            </p>
                            {Number(line.promoDiscountPercent ?? 0) > 0 ? <p className="mt-1 text-[8px] text-muted-foreground line-through">{formatCatalogMoney(calculateRentalLineSubtotal(Number(line.input.jumlah), Number(line.normalUnitPrice ?? line.input.unit_price), Number(line.input.duration_periods)), line.input.currency_code ?? "IDR")}</p> : null}
                            <p className="mt-0.5 text-[9px] font-semibold">{formatCatalogMoney(line.input.subtotal, line.input.currency_code ?? "IDR")}</p>
                            {Number(line.promoDiscountPercent ?? 0) > 0 ? <Badge variant="secondary" className="mt-1 rounded-full px-1.5 py-0 text-[8px] text-emerald-700">Promo {line.promoDiscountPercent}%</Badge> : null}
                          </div>
                          {!isSmartBookingFlow ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 rounded-lg px-2 text-[9px]"
                                onClick={() => {
                                  if (line.kind === "item") editLine(line, true);
                                  else editPackageLine(line);
                                }}
                              >
                                Ubah
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-lg text-destructive"
                                aria-label={"Hapus " + line.label}
                                onClick={() => setPickerLines((current) => current.filter((entry) => entry.key !== line.key))}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t pt-2 text-[10px]">
                        <span className="text-muted-foreground">Subtotal sewa</span>
                        <strong>{formatRentalMoney(pickerTotal, "IDR")}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-[9px] text-muted-foreground">Belum ada barang atau paket sewa dipilih.</p>
                  )}
                </section>
                {saleCartPanel}
                <div className="flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2.5">
                  <span className="text-[10px] font-semibold">Total pilihan</span>
                  <strong className="text-[13px]">{formatRentalMoney(pickerTotal + saleSubtotal, "IDR")}</strong>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-background px-3 py-3 sm:px-4">
                <Button type="button" variant="outline" className="h-9 rounded-xl text-[10px]" onClick={() => setCartReviewOpen(false)}>
                  Kembali ke katalog
                </Button>
                <Button type="button" className="h-9 rounded-xl px-4 text-[10px]" onClick={() => {
                  setCartReviewOpen(false);
                  applyCatalogPicker();
                }}>
                  Selesai memilih <Check className="size-3.5" />
                </Button>
              </div>
            </DialogContent>
          </Dialog>

        </main>
  ) : null;

  if (catalogPickerPage) return catalogPickerPage;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 pb-28 lg:space-y-4 lg:pb-24">
      <header className="rounded-2xl border bg-card px-3 py-3 shadow-[0_3px_14px_rgba(23,61,51,.05)] sm:px-4">
        <div className="flex items-center gap-2.5">
          <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-xl" aria-label={isSmartBookingFlow ? "Kembali ke detail Reservasi" : isReservationFlow ? "Kembali ke reservasi" : "Kembali ke penyewaan"}>
            <Link to={isSmartBookingFlow && smartBookingIdFromQuery
              ? paths.reservasi + "/" + smartBookingIdFromQuery
              : isReservationFlow && reservationIdFromQuery
                ? paths.reservasi
                : paths.penyewaan}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[17px] font-bold tracking-tight">{prepared ? (workspace?.rental.nomor_penyewaan ?? "Rental") : isSmartBookingFlow ? "Proses Reservasi" : isReservationFlow ? "Lanjutkan Penyewaan" : "Rental Baru"}</h1>
              <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[9px]">{prepared ? "Operasional" : isSmartBookingFlow ? "Reservasi" : isReservationFlow ? "Dari Reservasi" : "Penyewaan Langsung"}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{prepared
                ? workspace?.renter.nama_lengkap
                : isSmartBookingFlow
                  ? smartBookingPrefill.data?.customer_name ?? "Memuat customer booking…"
                  : isReservationFlow
                    ? reservationPrefill.data?.penyewa_nama ?? "Memuat penyewa reservasi…"
                    : selectedRenter?.nama_lengkap ?? "Pilih penyewa"}</span>
              <span>·</span>
              <span>{prepared
                ? workspace?.renter.nomor_telepon ?? "—"
                : isSmartBookingFlow
                  ? smartBookingPrefill.data?.customer_phone ?? "—"
                  : selectedRenter?.nomor_telepon ?? "—"}</span>
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
          {isSmartBookingFlow ? (
            <Alert className="border-primary/20 bg-primary/[0.035]">
              <ShoppingBag className="size-4 text-primary" />
              <AlertTitle className="text-[12px]">
                {smartBookingPrefillState === "loading" || smartBookingPrefill.isPending
                  ? "Menyiapkan snapshot Reservasi…"
                  : "Snapshot Reservasi · " + (smartBookingPrefill.data?.reference_code ?? "Reservasi")}
              </AlertTitle>
              <AlertDescription className="text-[10px] leading-5">
                {smartBookingPrefillState === "error"
                  ? smartBookingPrefillError
                  : "Daftar item dan jumlah mengikuti permintaan customer yang telah disetujui. Walk-in hanya menentukan waktu aktual dan pembayaran; harga, promo, serta stok akan dihitung ulang oleh server saat transaksi."}
              </AlertDescription>
              {smartBookingPrefillState === "error" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8 text-[10px]"
                  onClick={() => {
                    smartBookingPrefillStartedRef.current = false;
                    setSmartBookingPrefillState("loading");
                    setSmartBookingPrefillError("");
                    void smartBookingPrefill.refetch().then((result) => {
                      if (result.error || !result.data) {
                        setSmartBookingPrefillError(
                          result.error instanceof Error
                            ? result.error.message
                            : "Detail booking belum dapat dimuat. Periksa akses admin lalu coba lagi.",
                        );
                        setSmartBookingPrefillState("error");
                        return;
                      }
                      setSmartBookingPrefillAttempt((value) => value + 1);
                    });
                  }}
                >
                  <RefreshCw className="size-3.5" /> Coba muat ulang
                </Button>
              ) : null}
            </Alert>
          ) : null}
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
                  {isSmartBookingFlow ? (
                    <div className="mt-3 rounded-xl border bg-primary/[0.035] px-3 py-3">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Customer dari booking</p>
                      {smartBookingPrefill.isPending ? (
                        <Skeleton className="mt-2 h-12 rounded-lg" />
                      ) : smartBookingPrefill.error ? (
                        <Alert variant="destructive" className="mt-2 rounded-lg">
                          <AlertDescription>{commandMessage(smartBookingPrefill.error, "Detail booking tidak dapat dimuat.")}</AlertDescription>
                        </Alert>
                      ) : smartBookingPrefill.data ? (
                        <div className="mt-2 flex items-center gap-3">
                          <span className="grid size-9 place-items-center rounded-xl bg-background text-primary"><Users className="size-4" /></span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-bold">{smartBookingPrefill.data.customer_name}</p>
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{smartBookingPrefill.data.customer_phone}</p>
                          </div>
                          <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">Terkait booking</Badge>
                        </div>
                      ) : null}
                    </div>
                  ) : isReservationFlow ? (
                    <div className="mt-3 rounded-xl border bg-primary/[0.035] px-3 py-3">
                      {reservationPrefill.isPending ? (
                        <p className="text-[10px] text-muted-foreground">Memuat penyewa dari reservasi…</p>
                      ) : reservationPrefill.error ? (
                        <Alert variant="destructive" className="rounded-lg">
                          <AlertTitle>Data reservasi tidak dapat dimuat</AlertTitle>
                          <AlertDescription>{commandMessage(reservationPrefill.error, "Periksa kembali reservasi sebelum melanjutkan.")}</AlertDescription>
                        </Alert>
                      ) : reservationPrefill.data ? (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Penyewa terdaftar</p>
                              <p className="mt-1 truncate text-[13px] font-bold">{reservationPrefill.data.penyewa_nama ?? "Nama penyewa tidak tersedia"}</p>
                              <p className="mt-1 text-[9px] text-muted-foreground">Reservasi {reservationPrefill.data.nomor_reservasi}</p>
                            </div>
                            <Badge variant={reservationPrefill.data.status === "confirmed" && reservationPrefill.data.stock_lock_status === "locked" ? "secondary" : "destructive"} className="rounded-full text-[9px]">
                              {reservationPrefill.data.status === "confirmed" && reservationPrefill.data.stock_lock_status === "locked" ? "Terkonfirmasi" : "Perlu diperiksa"}
                            </Badge>
                          </div>
                          {reservationPrefill.data.status !== "confirmed" || reservationPrefill.data.stock_lock_status !== "locked" ? (
                            <p className="mt-2 text-[10px] text-destructive">Reservasi harus dikonfirmasi dan stok terkunci sebelum penyewaan dibuat.</p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : (
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
                            {selectedRenter ? selectedRenter.nama_lengkap + (selectedRenter.nomor_telepon ? " · " + selectedRenter.nomor_telepon : "") : "Pilih penyewa / cari nama atau nomor"}
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
                            {!isReservationFlow ? (
                              <p className="mt-1 truncate text-[9px] font-medium text-muted-foreground">
                                {walkInLoyaltyPreview.isPending ? "Memuat riwayat rental…" : walkInLoyaltyPreview.isError ? "Riwayat loyalitas belum dapat dimuat" : !walkInLoyaltyPreview.data?.is_enabled ? `${walkInLoyaltyPreview.data?.completed_rental_count ?? 0} rental selesai · Program loyalitas belum diaktifkan` : !walkInLoyaltyPreview.data?.is_in_period ? `${walkInLoyaltyPreview.data.completed_rental_count} rental selesai · Program belum berlaku` : walkInLoyaltyPreview.data.eligible ? `${walkInLoyaltyPreview.data.completed_rental_count} rental selesai · Layak loyalitas` : `${walkInLoyaltyPreview.data.completed_rental_count} dari ${walkInLoyaltyPreview.data.minimum_completed_rentals ?? 0} rental selesai`}
                              </p>
                            ) : null}
                          </div>
                          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-[10px]" onClick={() => setSelectedRenterId("")}>Ganti</Button>
                        </div>
                      ) : (
                        <div className="mt-2 rounded-xl border border-dashed px-3 py-2 text-[9px] text-muted-foreground">
                          Belum ada penyewa. Pilih penyewa untuk melanjutkan rental.
                        </div>
                      )}
                    </>
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
                        <Input
                          type="datetime-local"
                          value={startAt}
                          min={isSmartBookingFlow && smartBookingPrefill.data?.requested_pickup_date
                            ? smartBookingPrefill.data.requested_pickup_date + "T00:00"
                            : isReservationFlow && reservationPrefill.data
                              ? reservationPrefill.data.mulai_reservasi + "T00:00"
                              : undefined}
                          max={isSmartBookingFlow && smartBookingPrefill.data?.requested_pickup_date
                            ? smartBookingPrefill.data.requested_pickup_date + "T23:59"
                            : isReservationFlow && reservationPrefill.data
                              ? reservationPrefill.data.mulai_reservasi + "T23:59"
                              : undefined}
                          onChange={(event) => setStartAt(event.target.value)}
                          className="h-10 rounded-xl text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[9px] font-medium text-muted-foreground">Kembali</span>
                        <Input
                          type="datetime-local"
                          value={endAt}
                          min={isSmartBookingFlow && smartBookingPrefill.data?.requested_return_date
                            ? smartBookingPrefill.data.requested_return_date + "T00:00"
                            : isReservationFlow && reservationPrefill.data
                              ? reservationPrefill.data.selesai_reservasi + "T00:00"
                              : undefined}
                          max={isSmartBookingFlow && smartBookingPrefill.data?.requested_return_date
                            ? smartBookingPrefill.data.requested_return_date + "T23:59"
                            : isReservationFlow && reservationPrefill.data
                              ? reservationPrefill.data.selesai_reservasi + "T23:59"
                              : undefined}
                          onChange={(event) => setEndAt(event.target.value)}
                          className="h-10 rounded-xl text-xs"
                        />
                      </label>
                    </div>
                    {isSmartBookingFlow ? (
                      <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                        Booking website hanya menetapkan tanggal. Pilih jam aktual pengambilan dan pengembalian sesuai serah-terima di lokasi. Tanggal tetap mengikuti booking; durasi dan tarif dihitung ulang oleh mesin rental.
                      </p>
                    ) : isReservationFlow ? (
                      <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                        Isi jam mulai saat penyewa benar-benar datang dan jam kembali sesuai kesepakatan. Tanggal mengikuti reservasi dan waktu dikonversi memakai timezone Usaha.
                      </p>
                    ) : null}
                    {isSmartBookingFlow && smartBookingPrefill.data && startAt && endAt &&
                      (startAt.slice(0, 10) !== smartBookingPrefill.data.requested_pickup_date ||
                        endAt.slice(0, 10) !== smartBookingPrefill.data.requested_return_date) ? (
                      <Alert variant="destructive" className="mt-2 rounded-lg">
                        <AlertDescription>Tanggal transaksi harus mengikuti tanggal booking yang sudah disetujui. Ubah jam tanpa menggeser tanggalnya.</AlertDescription>
                      </Alert>
                    ) : null}
                    {isReservationFlow && reservationPrefill.data && startAt && endAt &&
                      (startAt.slice(0, 10) !== reservationPrefill.data.mulai_reservasi || endAt.slice(0, 10) !== reservationPrefill.data.selesai_reservasi) ? (
                      <Alert variant="destructive" className="mt-2 rounded-lg">
                        <AlertDescription>Tanggal mulai dan kembali harus mengikuti tanggal reservasi. Ubah jam sesuai kondisi aktual tanpa mengubah tanggal reservasi.</AlertDescription>
                      </Alert>
                    ) : null}

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
            isReservationFlow ? (
              <section className="rounded-2xl border bg-card">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                        <ShoppingBag className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reservasi</p>
                        <h2 className="text-[14px] font-bold">Barang yang dipilih</h2>
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[9px]">{reservationLines.length} item</Badge>
                  </div>
                  {reservationPrefill.isPending ? (
                    <p className="mt-3 text-[10px] text-muted-foreground">Memuat barang reservasi…</p>
                  ) : reservationPrefill.error ? (
                    <Alert variant="destructive" className="mt-3 rounded-xl">
                      <AlertTitle>Barang reservasi tidak dapat dimuat</AlertTitle>
                      <AlertDescription>{commandMessage(reservationPrefill.error, "Coba buka ulang reservasi.")}</AlertDescription>
                    </Alert>
                  ) : reservationLines.length ? (
                    <div className="mt-3 space-y-1.5">
                      {reservationLines.map((line) => (
                        <div key={line.detail_reservasi_id} className="flex items-start justify-between gap-3 rounded-xl border bg-muted/15 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold">{line.paket_nama ?? line.barang_nama ?? "Barang"}</p>
                            {line.varian_nama ? <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{line.varian_nama}</p> : null}
                            <p className="mt-1 text-[9px] text-muted-foreground">{formatRentalMoney(line.unit_price ?? 0, line.currency_code)} × {new Intl.NumberFormat("id-ID").format(Number(line.jumlah))}</p>
                          </div>
                          <p className="shrink-0 text-[10px] font-bold">{formatRentalMoney(line.subtotal ?? 0, line.currency_code)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-[10px] text-muted-foreground">Reservasi belum memiliki barang atau paket.</p>
                  )}
                  <p className="mt-3 text-[9px] leading-4 text-muted-foreground">Barang, jumlah, dan harga mengikuti reservasi yang sudah dikonfirmasi. Untuk mengubah pilihan, selesaikan koreksi di alur reservasi terlebih dahulu.</p>
                </CardContent>
              </section>
            ) : (
            <section className="rounded-2xl border bg-card">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                      <ShoppingBag className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{isSmartBookingFlow ? "Reservasi" : "Katalog"}</p>
                      <h2 className="text-[14px] font-bold">{isSmartBookingFlow ? "Item permintaan customer" : "Sewa apa?"}</h2>
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-full text-[9px]">
                    {draftLines.length + saleCartLines.reduce((sum, line) => sum + line.jumlah, 0)} item
                  </Badge>
                </div>

                {isSmartBookingFlow ? (
                  <p className="mt-3 rounded-xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[9px] leading-4 text-muted-foreground">
                    Item, jumlah, dan tarif acuan mengikuti snapshot booking yang disetujui customer. Tarif harus masih aktif. Perubahan item hanya dapat diajukan melalui portal customer.
                  </p>
                ) : (
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
                        <span className="block truncate text-[10px] font-semibold">Buka Katalog</span>
                        <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                          Pilih sewa, paket, dan pembelian tambahan dalam satu alur
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                )}

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
                {saleCartLines.length ? (
                  <div className="mt-3 rounded-xl border bg-emerald-500/[0.04] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[9px] font-semibold">Pembelian tambahan · {saleCartLines.reduce((sum, line) => sum + line.jumlah, 0)} item</p>
                      <span className="text-[9px] font-bold">{formatCatalogMoney(saleSubtotal, "IDR")}</span>
                    </div>
                    <div className="mt-2 space-y-1.5 border-t border-emerald-500/15 pt-2">
                      {saleCartLines.map(({ item, jumlah }) => {
                        const isBonus = Object.prototype.hasOwnProperty.call(saleBonusReasons, item.key);
                        const normalPrice = Number(item.harga_jual ?? 0) * jumlah;
                        const effectivePrice = isBonus ? 0 : Number(item.harga_jual_efektif ?? item.harga_jual ?? 0) * jumlah;
                        return (
                          <div key={item.key} className="flex items-center justify-between gap-2 text-[8px]">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.nama} × {jumlah}</p>
                              {isBonus ? <p className="text-emerald-700">Bonus rental</p> : item.promo_diskon_persen != null ? (
                                <p className="text-emerald-700">{item.promo_diskon_persen}% · <span className="text-muted-foreground line-through">{formatCatalogMoney(normalPrice, "IDR")}</span></p>
                              ) : null}
                            </div>
                            <span className="shrink-0 font-semibold">{formatCatalogMoney(effectivePrice, "IDR")}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </section>
            )
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
          {mixedSaleId ? (
            <section className="rounded-2xl border border-emerald-300/70 bg-emerald-50/40 dark:bg-emerald-950/10">
              <CardContent className="space-y-2 p-3.5">
                <div className="flex items-center gap-2"><Check className="size-4 text-emerald-600"/><p className="text-[11px] font-bold">Checkout rental + pembelian tersimpan</p></div>
                {mixedReceipt.isPending ? <p className="text-[9px] text-muted-foreground">Menyiapkan ringkasan checkout…</p> : mixedReceipt.error ? <Alert variant="destructive"><AlertDescription>{commandMessage(mixedReceipt.error,"Ringkasan checkout belum dapat dimuat.")}</AlertDescription></Alert> : mixedReceipt.data ? <><p className="text-[10px] font-semibold">{mixedReceipt.data.nomor_checkout}</p><p className="text-[9px] text-muted-foreground">Total {formatRentalMoney(mixedReceipt.data.total_amount,"IDR")} · diterima {formatRentalMoney(mixedReceipt.data.amount_paid,"IDR")}</p><Button type="button" className="h-9 w-full rounded-xl text-[10px]" disabled={!receiptData} onClick={()=>setReceiptOpen(true)}><ReceiptText className="size-3.5"/>Cetak Struk 58 mm</Button></> : null}
                {receiptQuery.error ? <Alert variant="destructive"><AlertDescription>{commandMessage(receiptQuery.error,"Struk gabungan belum dapat disiapkan.")}</AlertDescription></Alert> : null}
              </CardContent>
            </section>
          ) : null}
          <section className="rounded-2xl border bg-card">
            <CardHeader className="px-3.5 pb-2.5 pt-3.5 sm:px-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="size-4 text-primary" />
                  <CardTitle className="text-[14px]">Keranjang Rental</CardTitle>
                </div>
                <Badge variant="secondary" className="rounded-full text-[9px]">{prepared ? "Tersimpan" : isReservationFlow ? reservationLines.length + " line" : draftLines.length + " line"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 px-3.5 pb-3.5 pt-0 sm:px-4">
              {(prepared ? (workspace?.lines ?? []) : isReservationFlow ? reservationLines : draftLines).length ? (
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
                ) : isReservationFlow ? (
                  reservationLines.map((line) => (
                    <div key={line.detail_reservasi_id} className="rounded-xl border bg-muted/10 px-2.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold">{line.paket_nama ?? line.barang_nama ?? "Barang"}</p>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                            {(line.varian_nama ?? "Utama") + " · " + Number(line.jumlah) + " unit"}
                          </p>
                          <p className="mt-1 text-[9px] text-muted-foreground">Harga mengikuti reservasi yang dikonfirmasi.</p>
                        </div>
                        <p className="shrink-0 text-[10px] font-bold">{formatRentalMoney(line.subtotal ?? 0, line.currency_code)}</p>
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
                            {isSmartBookingFlow ? (
                              <Badge variant="outline" className="text-[8px]">Snapshot customer · {line.input.jumlah} unit</Badge>
                            ) : (
                              <>
                                <Button type="button" variant="outline" size="icon" className="size-7 rounded-lg" onClick={() => updateLineQuantity(line.key, -1)} disabled={Number(line.input.jumlah) <= 1}>−</Button>
                                <span className="min-w-5 text-center text-[10px] font-bold">{line.input.jumlah}</span>
                                <Button type="button" variant="outline" size="icon" className="size-7 rounded-lg" onClick={() => updateLineQuantity(line.key, 1)}>+</Button>
                                {line.kind === "item" ? <Button type="button" variant="ghost" size="icon" className="ml-1 size-7 rounded-lg" aria-label={"Edit " + line.label} onClick={() => editLine(line)}><ChevronDown className="size-3.5 rotate-[-90deg]" /></Button> : null}
                                <Button type="button" variant="ghost" size="icon" className="ml-auto size-7 rounded-lg text-destructive" aria-label={"Hapus " + line.label} onClick={() => removeLine(line.key)}><Trash2 className="size-3.5" /></Button>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[8px] text-muted-foreground">Subtotal</p>
                          {Number(line.promoDiscountPercent ?? 0) > 0 ? <p className="text-[8px] text-muted-foreground line-through">{formatRentalMoney(calculateRentalLineSubtotal(Number(line.input.jumlah), Number(line.normalUnitPrice ?? line.input.unit_price), Number(line.input.duration_periods)), line.input.currency_code ?? "IDR")}</p> : null}
                          <p className="mt-0.5 text-[11px] font-bold">{formatRentalMoney(line.input.subtotal, line.input.currency_code ?? "IDR")}</p>
                          {Number(line.promoDiscountPercent ?? 0) > 0 ? <p className="text-[8px] font-semibold text-emerald-700">Promo {line.promoDiscountPercent}%</p> : null}
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

              {!rentalCreated && selectedLinesExist && isReservationFlow ? (
                <div className="mt-3 space-y-2 rounded-xl border bg-muted/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold">Diskon rental</p>
                    <Badge variant="outline" className="rounded-full text-[8px]">Bukan diskon barang jual</Badge>
                  </div>
                  <Select
                    value={checkoutDiscountMode}
                    onValueChange={(value) => setCheckoutDiscountMode(value as CheckoutDiscountRequest["mode"])}
                  >
                    <SelectTrigger className="h-9 rounded-lg text-[10px]">
                      <SelectValue placeholder="Pilih diskon" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Tanpa diskon</SelectItem>
                      <SelectItem value="loyalty" disabled={!canApplyCheckoutDiscount || loyaltyPreview.data?.eligible !== true}>
                        Loyalitas berkelanjutan
                      </SelectItem>
                      <SelectItem
                        value="manual"
                        disabled={!canApplyCheckoutDiscount || checkoutDiscountPolicy.data?.manual_discount_enabled !== true}
                      >
                        Diskon manual
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {checkoutDiscountMode === "loyalty" ? (
                    loyaltyPreview.isPending ? (
                      <p className="text-[9px] text-muted-foreground">Memeriksa kelayakan loyalitas penyewa…</p>
                    ) : loyaltyPreview.isError ? (
                      <p className="text-[9px] text-destructive">{commandMessage(loyaltyPreview.error, "Kelayakan loyalitas belum dapat diperiksa.")}</p>
                    ) : loyaltyPreview.data?.eligible ? (
                      <div className="rounded-lg bg-emerald-500/5 px-2.5 py-2 text-[9px]">
                        <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                          {loyaltyPreview.data.completed_rental_count} rental selesai · rekomendasi {loyaltyPreview.data.recommended_discount_percent}%
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Potongan {formatRentalMoney(loyaltyPreview.data.recommended_amount, "IDR")} berdasarkan kelayakan yang dihitung server.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[9px] text-muted-foreground">Penyewa belum memenuhi kelayakan program loyalitas aktif.</p>
                    )
                  ) : null}
                  {checkoutDiscountMode === "manual" ? (
                    <div className="grid gap-2">
                      <label className="grid gap-1 text-[9px]">
                        Nominal diskon
                        <Input
                          type="number"
                          min={1}
                          max={totalRental}
                          value={manualDiscountAmount}
                          onChange={(event) => setManualDiscountAmount(event.target.value)}
                          placeholder="Nominal dalam rupiah"
                          className="h-9 rounded-lg text-[10px]"
                        />
                      </label>
                      <label className="grid gap-1 text-[9px]">
                        Kategori alasan
                        <Select value={manualDiscountReasonCode} onValueChange={setManualDiscountReasonCode}>
                          <SelectTrigger className="h-9 rounded-lg text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {allowedManualReasons.map((reason) => (
                              <SelectItem key={reason} value={reason}>{reason.replaceAll("_", " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-[9px]">
                        Catatan alasan {checkoutDiscountPolicy.data?.require_reason ? "(wajib)" : "(opsional)"}
                        <Input
                          value={manualDiscountReasonNote}
                          onChange={(event) => setManualDiscountReasonNote(event.target.value)}
                          placeholder="Contoh: kompensasi keterlambatan layanan"
                          className="h-9 rounded-lg text-[10px]"
                        />
                      </label>
                      {checkoutDiscountPolicy.data?.max_discount_percent != null || checkoutDiscountPolicy.data?.max_discount_amount != null ? (
                        <p className="text-[8px] text-muted-foreground">
                          Batas kebijakan: {checkoutDiscountPolicy.data.max_discount_percent != null ? checkoutDiscountPolicy.data.max_discount_percent + "%" : "—"} · {checkoutDiscountPolicy.data.max_discount_amount != null ? formatRentalMoney(Number(checkoutDiscountPolicy.data.max_discount_amount), "IDR") : "tanpa batas nominal"}
                          {canOverrideLoyalty ? " · override loyalitas diizinkan untuk akun ini" : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!canApplyCheckoutDiscount && checkoutDiscountMode !== "none" ? (
                    <p className="text-[9px] text-destructive">Akun ini tidak memiliki hak menerapkan diskon checkout.</p>
                  ) : null}
                  {checkoutDiscountMode === "manual" && manualDiscountExceedsPercentCap ? (
                    <p className="text-[9px] text-destructive">Persentase diskon melebihi batas kebijakan usaha.</p>
                  ) : null}
                  {checkoutDiscountMode === "manual" && manualDiscountExceedsAmountCap ? (
                    <p className="text-[9px] text-destructive">Nominal diskon melebihi batas kebijakan usaha.</p>
                  ) : null}
                  {checkoutDiscountMode === "manual" && manualDiscountExceedsLoyalty && !manualDiscountOverrideAllowed ? (
                    <p className="text-[9px] text-destructive">Diskon di atas rekomendasi loyalitas tidak diizinkan oleh kebijakan atau hak akses akun ini.</p>
                  ) : null}
                  {checkoutDiscountMode === "manual" && loyaltyPreview.isPending ? (
                    <p className="text-[9px] text-muted-foreground">Tunggu verifikasi rekomendasi loyalitas sebelum menerapkan diskon manual.</p>
                  ) : null}
                  {checkoutDiscountMode === "manual" && loyaltyPreview.isError ? (
                    <p className="text-[9px] text-destructive">Rekomendasi loyalitas tidak dapat diverifikasi. Diskon manual belum dapat diterapkan.</p>
                  ) : null}
                  <div className="flex items-center justify-between border-t pt-2 text-[9px]">
                    <span className="text-muted-foreground">Potongan rental</span>
                    <strong>{formatRentalMoney(effectiveDiscountAmount, "IDR")}</strong>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Rental setelah diskon</span>
                    <strong className="text-[12px]">{formatRentalMoney(discountedRentalTotal, "IDR")}</strong>
                  </div>
                </div>
              ) : null}

              {!rentalCreated && selectedLinesExist && !isReservationFlow ? (
                <div className="mt-3 space-y-2.5 rounded-xl border bg-muted/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold">Diskon & pembayaran</p>
                    <Badge variant="outline" className="rounded-full text-[8px]">Walk-in</Badge>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg bg-background px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold">Diskon manual rental</p>
                      {manualDiscountApplied ? (
                        <p className="mt-0.5 text-[10px] font-bold text-emerald-700">−{formatRentalMoney(walkInManualAmountValue, "IDR")}</p>
                      ) : (
                        <p className="mt-0.5 text-[8px] text-muted-foreground">Belum diterapkan</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {manualDiscountApplied ? (
                        <>
                          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[9px]" onClick={() => {
                            setManualDiscountDraftAmount(manualDiscountAmount);
                            setManualDiscountDraftReasonCode(manualDiscountReasonCode);
                            setManualDiscountDraftReasonNote(manualDiscountReasonNote);
                            setManualDiscountDialogOpen(true);
                          }}>Ubah</Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[9px] text-destructive" onClick={() => {
                            setManualDiscountApplied(false);
                            setManualDiscountAmount("");
                            setManualDiscountReasonCode("other");
                            setManualDiscountReasonNote("");
                          }}>Hapus</Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-[9px]" disabled={!canApplyCheckoutDiscount || checkoutDiscountPolicy.data?.manual_discount_enabled !== true || totalRental <= 0} onClick={() => {
                          setManualDiscountDraftAmount("");
                          setManualDiscountDraftReasonCode(allowedManualReasons[0] ?? "other");
                          setManualDiscountDraftReasonNote("");
                          setManualDiscountDialogOpen(true);
                        }}><Plus className="mr-1 size-3"/>Tambah diskon</Button>
                      )}
                    </div>
                  </div>
                  {manualDiscountApplied && (!directDiscountInputIsValid || walkInManualAmountValue > totalRental) ? (
                    <p className="text-[8px] text-destructive">Diskon manual tidak lagi sesuai total rental atau kebijakan. Ubah diskon sebelum checkout.</p>
                  ) : null}
                  {!canApplyCheckoutDiscount ? <p className="text-[8px] text-muted-foreground">Akun ini tidak memiliki izin menerapkan diskon checkout.</p> : null}
                  {checkoutDiscountPolicy.isSuccess && checkoutDiscountPolicy.data?.manual_discount_enabled !== true ? <p className="text-[8px] text-muted-foreground">Diskon manual belum diaktifkan pada kebijakan usaha.</p> : null}

                  <div className="flex items-center justify-between gap-3 border-t pt-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-semibold">Diskon loyalitas</p>
                      {walkInLoyaltyPreview.isPending ? (
                        <p className="mt-0.5 text-[8px] text-muted-foreground">Memeriksa kelayakan penyewa…</p>
                      ) : walkInLoyaltyPreview.isError ? (
                        <p className="mt-0.5 text-[8px] text-destructive">Rekomendasi loyalitas tidak dapat diverifikasi.</p>
                      ) : !walkInLoyaltyPreview.data?.is_enabled ? (
                        <p className="mt-0.5 text-[8px] text-muted-foreground">Program loyalitas belum diaktifkan.</p>
                      ) : !walkInLoyaltyPreview.data?.is_in_period ? (
                        <p className="mt-0.5 text-[8px] text-muted-foreground">Program loyalitas belum berada dalam periode berlaku.</p>
                      ) : walkInLoyaltyPreview.data.eligible ? (
                        <p className="mt-0.5 text-[8px] text-emerald-700">Rekomendasi {walkInLoyaltyPreview.data.recommended_discount_percent}% · {formatRentalMoney(walkInLoyaltyRecommended, "IDR")}</p>
                      ) : (
                        <p className="mt-0.5 text-[8px] text-muted-foreground">{walkInLoyaltyPreview.data.completed_rental_count} dari {walkInLoyaltyPreview.data.minimum_completed_rentals ?? 0} rental selesai.</p>
                      )}
                    </div>
                    <Switch
                      checked={applyLoyaltyDiscount}
                      onCheckedChange={setApplyLoyaltyDiscount}
                      disabled={!canApplyCheckoutDiscount || walkInLoyaltyPreview.isPending || walkInLoyaltyPreview.data?.eligible !== true || walkInLoyaltyRecommended <= 0}
                      aria-label="Terapkan diskon loyalitas"
                    />
                  </div>
                  {applyLoyaltyDiscount && !directDiscountInputIsValid ? <p className="text-[8px] text-destructive">Kelayakan diskon loyalitas berubah. Periksa kembali sebelum checkout.</p> : null}

                  <div className="space-y-1.5 border-t pt-2 text-[9px]">
                    <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Subtotal rental (setelah promo)</span><span className="font-semibold">{formatRentalMoney(totalRental, "IDR")}</span></div>
                    {saleSubtotal > 0 ? <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Subtotal pembelian (setelah promo)</span><span className="font-semibold">{formatRentalMoney(saleSubtotal, "IDR")}</span></div> : null}
                    {walkInManualAmountValue > 0 ? <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Diskon manual rental</span><span className="font-semibold text-emerald-700">−{formatRentalMoney(walkInManualAmountValue, "IDR")}</span></div> : null}
                    {walkInLoyaltyActual > 0 ? <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Diskon loyalitas checkout</span><span className="font-semibold text-emerald-700">−{formatRentalMoney(walkInLoyaltyActual, "IDR")}</span></div> : null}
                    <div className="flex items-center justify-between gap-2 border-t pt-2 text-[10px]"><span className="font-bold">Total checkout</span><strong className="text-[14px]">{formatRentalMoney(checkoutTotal, "IDR")}</strong></div>
                  </div>
                </div>
              ) : null}

              <div className="border-t pt-2.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted-foreground">{prepared && mixedSaleId ? "Total checkout" : isReservationFlow ? "Total rental" : "Total checkout"}</span>
                  <span className="text-[16px] font-bold">{formatRentalMoney(prepared ? (mixedSaleId ? Number(mixedReceipt.data?.total_amount ?? operationalTotal) : operationalTotal) : isReservationFlow ? discountedRentalTotal : checkoutTotal, isReservationFlow && !prepared ? rentalCurrencyCode : "IDR")}</span>
                </div>
                {!rentalCreated ? (
                  <p className="mt-2 text-[9px] text-muted-foreground">
                    Pilih mode tindakan pada tombol bawah. Transaksi penjualan ikut dibuat otomatis bila keranjang memuat barang jual.
                  </p>
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

                {receiptQuery.error ? <Alert variant="destructive" className="mt-2 rounded-xl"><AlertDescription>{commandMessage(receiptQuery.error, "Struk belum dapat disiapkan.")}</AlertDescription></Alert> : null}
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
            <p className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{prepared && mixedSaleId ? "Total Checkout" : prepared ? "Total Rental" : isReservationFlow ? "Total Rental" : "Total Checkout"}</p>
            <p className="truncate text-[14px] font-black">{formatRentalMoney(prepared ? (mixedSaleId ? Number(mixedReceipt.data?.total_amount ?? operationalTotal) : operationalTotal) : isReservationFlow ? discountedRentalTotal : checkoutTotal, isReservationFlow && !prepared ? rentalCurrencyCode : "IDR")}</p>
            {prepared ? <p className="truncate text-[8px] text-muted-foreground">{formatRentalMoney(paymentRecorded, "IDR")} dibayar untuk rental · {formatRentalMoney(paymentRemaining, "IDR")} sisa rental</p> : null}
          </div>

          {!rentalCreated ? (
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl px-3 text-[9px]"
                disabled={!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending || (isSmartBookingFlow && rentalCommandState === "unknown" && directAfterCreateRef.current)}
                onClick={handlePrepareRental}
              >
                {createRentalMutation.isPending && !directAfterCreateRef.current ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                {createRentalMutation.isPending && !directAfterCreateRef.current
                  ? "Menyiapkan…"
                  : isSmartBookingFlow
                    ? rentalCommandState === "unknown" ? "Ulangi proses sebelumnya" : "Proses booking"
                    : isReservationFlow
                      ? "Buat Penyewaan"
                      : "Siapkan Rental"}
              </Button>
              <Button
                type="button"
                className="h-10 rounded-xl px-3 text-[9px]"
                disabled={!canPrepareRental || createRentalMutation.isPending || activationMutation.isPending || (isSmartBookingFlow && draftLines.length === 0) || (isSmartBookingFlow && rentalCommandState === "unknown" && !directAfterCreateRef.current)}
                onClick={handleDirectRental}
              >
                {(createRentalMutation.isPending && directAfterCreateRef.current) || activationMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck className="size-3.5" />}
                {(createRentalMutation.isPending && directAfterCreateRef.current) || activationMutation.isPending
                  ? "Menyiapkan…"
                  : isSmartBookingFlow
                    ? "Proses & aktifkan rental"
                    : isReservationFlow
                      ? "Buat & Aktifkan Rental"
                      : "Langsung Sewa"}
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



      <Dialog open={manualDiscountDialogOpen} onOpenChange={setManualDiscountDialogOpen}>
        <DialogContent className="flex max-h-[82dvh] w-[calc(100%-1rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
            <DialogTitle className="text-[14px]">Diskon manual rental</DialogTitle>
            <DialogDescription className="text-[9px]">Diskon ini mengurangi subtotal rental, lalu rekomendasi loyalitas dihitung dari total checkout setelahnya.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-[9px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal rental</span><strong>{formatRentalMoney(totalRental, "IDR")}</strong></div>
              {checkoutDiscountPolicy.data?.max_discount_percent != null || checkoutDiscountPolicy.data?.max_discount_amount != null ? (
                <p className="mt-1 text-muted-foreground">Batas {checkoutDiscountPolicy.data.max_discount_percent != null ? `${checkoutDiscountPolicy.data.max_discount_percent}%` : "—"} · {checkoutDiscountPolicy.data.max_discount_amount != null ? formatRentalMoney(Number(checkoutDiscountPolicy.data.max_discount_amount), "IDR") : "tanpa batas nominal"}</p>
              ) : null}
            </div>
            <label className="grid gap-1.5 text-[10px] font-medium">
              Nominal diskon (Rp)
              <Input type="number" min={1} max={totalRental} value={manualDiscountDraftAmount} onChange={(event) => setManualDiscountDraftAmount(event.target.value)} placeholder="Masukkan nominal diskon" className="h-10 rounded-xl text-[11px]" />
            </label>
            <label className="grid gap-1.5 text-[10px] font-medium">
              Kategori alasan
              <Select value={manualDiscountDraftReasonCode} onValueChange={setManualDiscountDraftReasonCode}>
                <SelectTrigger className="h-10 rounded-xl text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>{allowedManualReasons.map((reason) => <SelectItem key={reason} value={reason}>{reason.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-[10px] font-medium">
              Catatan alasan {checkoutDiscountPolicy.data?.require_reason ? "(wajib)" : "(opsional)"}
              <Input value={manualDiscountDraftReasonNote} onChange={(event) => setManualDiscountDraftReasonNote(event.target.value)} placeholder="Contoh: kompensasi layanan" className="h-10 rounded-xl text-[11px]" />
            </label>
            {!canApplyCheckoutDiscount ? <p className="text-[9px] text-destructive">Akun ini tidak memiliki izin diskon checkout.</p> : null}
            {checkoutDiscountPolicy.data?.manual_discount_enabled !== true ? <p className="text-[9px] text-destructive">Kebijakan usaha belum mengaktifkan diskon manual.</p> : null}
            {manualDraftExceedsPercentCap ? <p className="text-[9px] text-destructive">Persentase diskon melebihi batas kebijakan usaha.</p> : null}
            {manualDraftExceedsAmountCap ? <p className="text-[9px] text-destructive">Nominal diskon melebihi batas kebijakan usaha.</p> : null}
            {Number.isFinite(manualDraftAmountValue) && manualDraftAmountValue > totalRental ? <p className="text-[9px] text-destructive">Diskon tidak boleh melebihi subtotal rental.</p> : null}
          </div>
          <div className="sticky bottom-0 flex shrink-0 justify-end gap-2 border-t bg-background px-4 py-3">
            <Button type="button" variant="outline" className="h-9 rounded-xl text-[10px]" onClick={() => setManualDiscountDialogOpen(false)}>Batal</Button>
            <Button type="button" className="h-9 rounded-xl text-[10px]" disabled={!manualDiscountDraftIsValid} onClick={() => {
              setManualDiscountAmount(String(manualDraftAmountValue));
              setManualDiscountReasonCode(manualDiscountDraftReasonCode);
              setManualDiscountReasonNote(manualDiscountDraftReasonNote.trim());
              setManualDiscountApplied(true);
              setManualDiscountDialogOpen(false);
            }}>Terapkan diskon</Button>
          </div>
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

      {rentalQr.data ? (
        <QrPreviewDialog
          open={qrOpen}
          onOpenChange={setQrOpen}
          title="QR Penyewaan"
          description="QR ini membuka detail rental. Token tidak memuat data sensitif."
          code={rentalQr.data.token_qr}
          kind="penyewaan"
          url={buildPenyewaanQrUrl(window.location.origin, rentalQr.data.token_qr)}
        />
      ) : null}
      {receiptData ? <RentalReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receiptData} /> : null}
    </div>
  );
}
