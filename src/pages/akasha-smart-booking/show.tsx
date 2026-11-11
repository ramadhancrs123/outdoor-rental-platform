import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, Clipboard,
  Clock3, Copy, ExternalLink, FileClock, KeyRound, Loader2, MessageCircle,
  Package, RefreshCw, ShieldAlert, ShieldCheck, ShoppingBag, UserRound,
  Warehouse, X,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { appConfig } from "@/app/config";
import { supabase } from "@/app/providers/supabase/client";
import { getMyBusinessPermissions } from "@/features/event-promotions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { createClientId } from "@/lib/client-id";
import { paths } from "@/routes/paths";
import {
  applyAkashaSmartBookingItemChange,
  getAkashaSmartBooking,
  getAkashaSmartBookingAvailability,
  getAkashaSmartBookingConversion,
  resolveAkashaSmartBookingChange,
  rotateAkashaSmartBookingAccess,
  confirmAkashaSmartBooking,
} from "@/features/akasha-smart-booking/service";
import type {
  AkashaSmartBookingAvailability,
  AkashaSmartBookingChangeRequest,
  AkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/types";
import { createAkashaPortalLink } from "@/features/akasha-smart-booking/portal-link";
import {
  calculateSmartBookingLineEstimate,
  calculateSmartBookingTariffPeriods,
  formatSmartBookingStayLabel,
  type SmartBookingTariffPeriod,
} from "@/features/akasha-smart-booking/estimate";

type ProposedTarget = {
  kind: "rental" | "sale";
  barang_id?: string | null;
  varian_barang_id?: string | null;
  paket_sewa_id?: string | null;
  jumlah?: number;
};

type CatalogTarget = {
  id: string;
  kind: "rental" | "sale" | "package";
  name: string;
  variant: string | null;
  category: string | null;
  price: number | null;
  duration: string | null;
};

type RotatedAccess = {
  accessCode: string;
  portalLinkUrl: string | null;
  expiresAt: string;
};

const STATUS_LABELS: Record<AkashaSmartBookingStatus, string> = {
  received: "Menunggu konfirmasi",
  reviewing: "Menunggu konfirmasi",
  acknowledged: "Menunggu konfirmasi",
  customer_action_required: "Menunggu pelanggan",
  change_requested: "Perubahan diminta",
  cancellation_pending: "Pembatalan diminta",
  ready_for_checkout: "Siap diproses",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
  fulfilled: "Selesai",
};

function formatDate(value: string | null, timezone = "Asia/Jakarta") {
  if (!value) return "Belum ditentukan";
  const parts = value.split("-").map(Number);
  if (parts.length === 3 && parts.every(Boolean)) {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: timezone })
      .format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: timezone, hour12: false,
  }).format(date);
}

function formatDateTime(value: string | null, timezone = "Asia/Jakarta") {
  if (!value) return "Belum tersedia";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: timezone, hour12: false,
  }).format(date);
}

function formatCurrency(value: number, currencyCode = "IDR") {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: currencyCode, maximumFractionDigits: 0,
  }).format(value);
}

function statusVariant(status: AkashaSmartBookingStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "received" || status === "change_requested" || status === "cancellation_pending") return "default";
  if (status === "customer_action_required") return "destructive";
  if (status === "ready_for_checkout" || status === "fulfilled") return "secondary";
  return "outline";
}

function changeTypeLabel(type: string) {
  const labels: Record<string, string> = {
    item_change: "Perubahan daftar barang",
    variant_change: "Perubahan varian",
    quantity_change: "Perubahan jumlah",
    schedule_change: "Perubahan jadwal",
    alternative_interest: "Permintaan alternatif",
    cancellation: "Permintaan pembatalan",
    other: "Permintaan lainnya",
  };
  return labels[type] ?? "Permintaan perubahan";
}

function changeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Menunggu pemeriksaan",
    applied: "Sudah diterapkan",
    approved: "Disetujui",
    rejected: "Ditolak",
    withdrawn: "Dibatalkan",
  };
  return labels[status] ?? status;
}

function getProposalItems(payload: Record<string, unknown>): ProposedTarget[] {
  if (!Array.isArray(payload.items)) return [];
  return payload.items.filter((item): item is ProposedTarget =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function targetKey(item: ProposedTarget) {
  if (item.paket_sewa_id) return "package:" + item.paket_sewa_id;
  if (item.varian_barang_id) return (item.kind === "sale" ? "sale-variant:" : "variant:") + item.varian_barang_id;
  if (item.barang_id) return (item.kind === "sale" ? "sale-product:" : "product:") + item.barang_id;
  return "";
}

function availabilityLabel(status: string) {
  const labels: Record<string, string> = {
    available_now: "Terlihat tersedia saat ini",
    ready_now: "Terlihat tersedia saat ini",
    insufficient_quantity: "Jumlah belum mencukupi saat ini",
    currently_unavailable: "Belum tersedia saat ini",
    unavailable_now: "Belum tersedia saat ini",
    potential_return: "Ada potensi pengembalian",
    potential_return_may_help: "Bergantung pada pengembalian",
    potential_returns_may_help: "Bergantung pada pengembalian",
    other_variants_available: "Varian lain terlihat tersedia",
    all_components_ready_now: "Komponen terlihat siap",
    one_or_more_components_need_review: "Sebagian barang perlu diperiksa",
    one_or_more_components_short: "Ada komponen belum mencukupi",
    shortage: "Jumlah belum mencukupi",
    catalog_unavailable: "Item tidak lagi tersedia di katalog",
    package_components_unavailable: "Komponen paket belum dipastikan",
    unknown: "Perlu diperiksa pengelola",
  };
  return labels[status] ?? "Perlu diperiksa pengelola";
}

function availabilityVariant(status: string): "secondary" | "outline" | "destructive" {
  if (["ready_now", "all_components_ready_now", "available_now"].includes(status)) return "secondary";
  if (["shortage", "insufficient_quantity", "currently_unavailable", "unavailable_now", "one_or_more_components_short", "catalog_unavailable", "package_components_unavailable"].includes(status)) return "destructive";
  return "outline";
}

function targetName(target: ProposedTarget, map: Map<string, CatalogTarget>) {
  const found = map.get(targetKey(target));
  const quantity = Number(target.jumlah) || 1;
  return {
    label: found
      ? (found.kind === "sale" ? "Beli · " : found.kind === "package" ? "Paket · " : "Sewa · ")
        + found.name + (found.variant ? " · " + found.variant : "")
      : "Item tidak lagi tersedia pada katalog publik",
    quantity,
    price: found?.price ?? null,
    duration: found?.duration ?? null,
    category: found?.category ?? null,
  };
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value}</p>
      {detail ? <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function AkashaSmartBookingShow() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: tenantStatus, current, error: tenantError } = useCurrentUsaha();
  const [resolutionNote, setResolutionNote] = useState("");
  const [publicResolutionNote, setPublicResolutionNote] = useState("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [dpChoice, setDpChoice] = useState<"none" | "received" | "">("");
  const [dpInput, setDpInput] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [adminUrl, setAdminUrl] = useState("");
  const [rotatedAccess, setRotatedAccess] = useState<RotatedAccess | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const itemIdempotencyRef = useRef(new Map<string, string>());
  const rotateIdempotencyRef = useRef<string | null>(null);

  const permissions = useQuery({
    queryKey: ["akasha-smart-booking", "permissions", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: () => getMyBusinessPermissions(current!.usahaId),
    staleTime: 30_000,
  });
  const canReview = permissions.isSuccess && permissions.data.includes("reservation.amend");
  const canRotateAccess = permissions.isSuccess && permissions.data.includes("access_control.manage");

  const booking = useQuery({
    queryKey: ["akasha-smart-booking", "detail", current?.usahaId, id],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId && id),
    queryFn: () => getAkashaSmartBooking(id),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const rentalTariffIds = useMemo(() => Array.from(new Set(
    (booking.data?.lines ?? [])
      .filter((line) => line.kind === "rental")
      .map((line) => line.tarif_sewa_id)
      .filter((tariffId): tariffId is string => Boolean(tariffId)),
  )), [booking.data?.lines]);

  const bookingTariffs = useQuery({
    queryKey: ["akasha-smart-booking", "tariffs", booking.data?.usaha_id, rentalTariffIds],
    enabled: Boolean(booking.data?.usaha_id && rentalTariffIds.length > 0),
    queryFn: async () => {
      if (!booking.data?.usaha_id || rentalTariffIds.length === 0) return new Map<string, SmartBookingTariffPeriod>();
      const { data, error } = await supabase
        .from("tarif_sewa")
        .select("tarif_sewa_id,durasi_unit,durasi_nilai")
        .eq("usaha_id", booking.data.usaha_id)
        .in("tarif_sewa_id", rentalTariffIds);
      if (error) throw error;
      return new Map((data ?? []).map((tariff) => [tariff.tarif_sewa_id, {
        durasi_unit: tariff.durasi_unit,
        durasi_nilai: Number(tariff.durasi_nilai),
      }]));
    },
    staleTime: 60_000,
  });

  const conversion = useQuery({
    queryKey: ["akasha-smart-booking", "conversion", current?.usahaId, id],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId && id),
    queryFn: () => getAkashaSmartBookingConversion(id),
    staleTime: 15_000,
  });

  const availability = useQuery<AkashaSmartBookingAvailability>({
    queryKey: ["akasha-smart-booking", "availability", current?.usahaId, id],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId && id),
    queryFn: () => getAkashaSmartBookingAvailability(id),
    staleTime: 30_000,
    refetchInterval: 90_000,
  });

  const targetCatalog = useQuery({
    queryKey: ["akasha-smart-booking", "catalog-targets", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: async () => {
      if (!current?.usahaId) throw new Error("Usaha aktif belum tersedia.");
      const [rental, sale, packages] = await Promise.all([
        supabase.from("v_public_katalog_rental").select("barang_id,varian_barang_id,barang_nama,varian_nama,kategori_nama,harga_efektif,durasi_nilai,durasi_unit").eq("usaha_id", current.usahaId),
        supabase.from("v_public_katalog_jual").select("barang_id,varian_barang_id,barang_nama,varian_nama,kategori_nama,harga_efektif").eq("usaha_id", current.usahaId),
        supabase.from("v_public_paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", current.usahaId).eq("status", "active"),
      ]);
      if (rental.error) throw rental.error;
      if (sale.error) throw sale.error;
      if (packages.error) throw packages.error;
      const map = new Map<string, CatalogTarget>();
      for (const row of rental.data ?? []) {
        const duration = row.durasi_nilai && row.durasi_unit ? row.durasi_nilai + " " + row.durasi_unit : null;
        const target: CatalogTarget = {
          id: row.varian_barang_id ? "variant:" + row.varian_barang_id : "product:" + row.barang_id,
          kind: "rental",
          name: row.barang_nama,
          variant: row.varian_nama,
          category: row.kategori_nama,
          price: row.harga_efektif === null ? null : Number(row.harga_efektif),
          duration,
        };
        map.set(target.id, target);
      }
      for (const row of sale.data ?? []) {
        const target: CatalogTarget = {
          id: row.varian_barang_id ? "sale-variant:" + row.varian_barang_id : "sale-product:" + row.barang_id,
          kind: "sale",
          name: row.barang_nama,
          variant: row.varian_nama,
          category: row.kategori_nama,
          price: row.harga_efektif === null ? null : Number(row.harga_efektif),
          duration: null,
        };
        map.set(target.id, target);
      }
      for (const row of packages.data ?? []) {
        map.set("package:" + row.paket_sewa_id, {
          id: "package:" + row.paket_sewa_id,
          kind: "package",
          name: row.nama,
          variant: null,
          category: "Paket sewa",
          price: null,
          duration: null,
        });
      }
      return map;
    },
    staleTime: 60_000,
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "detail", current?.usahaId, id] }),
      queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "availability", current?.usahaId, id] }),
      queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "list", current?.usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "summary", current?.usahaId] }),
    ]);
  };

  const confirmationMutation = useMutation({
    mutationFn: async (dpAmount: number) => {
      if (!booking.data || !canReview) throw new Error("Akses untuk mengonfirmasi booking tidak diberikan.");
      return confirmAkashaSmartBooking({
        smartBookingId: booking.data.smart_booking_id,
        expectedRevision: booking.data.revision,
        dpAmount,
      });
    },
    onSuccess: async (result) => {
      setActionError(null);
      setActionMessage(result.dp_amount > 0
        ? "Booking dikonfirmasi. DP " + formatCurrency(result.dp_amount, booking.data?.currency_code) + " (" + result.dp_percent.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "%) berhasil dicatat."
        : "Booking dikonfirmasi tanpa DP.");
      setConfirmDialogOpen(false);
      setDpChoice("");
      setDpInput("");
      await refreshAll();
    },
    onError: (error: unknown) => setActionError(error instanceof Error ? error.message : "Konfirmasi booking gagal disimpan."),
  });

  const changeMutation = useMutation({
    mutationFn: async (input: { change: AkashaSmartBookingChangeRequest; decision: "approved" | "rejected" }) => {
      if (!booking.data || !canReview) throw new Error("Akses untuk meninjau perubahan tidak diberikan.");
      const { change, decision } = input;
      const itemTypes = ["item_change", "variant_change", "quantity_change", "alternative_interest"];
      if (decision === "approved" && itemTypes.includes(change.type)) {
        const keyName = change.id + ":" + booking.data.revision;
        let idempotencyKey = itemIdempotencyRef.current.get(keyName);
        if (!idempotencyKey) {
          idempotencyKey = "smart-booking-item-apply-" + createClientId();
          itemIdempotencyRef.current.set(keyName, idempotencyKey);
        }
        return applyAkashaSmartBookingItemChange({
          changeRequestId: change.id,
          expectedRevision: booking.data.revision,
          idempotencyKey,
          resolutionNote: resolutionNote.trim() || null,
          publicResolutionNote: publicResolutionNote.trim() || null,
        });
      }

      const payload = change.payload as Record<string, unknown>;
      const schedulePayload = change.type === "schedule_change" && decision === "approved"
        ? {
            requested_pickup_date: typeof payload.requested_pickup_date === "string" ? payload.requested_pickup_date : undefined,
            requested_return_date: typeof payload.requested_return_date === "string" ? payload.requested_return_date : undefined,
            requested_pickup_at: typeof payload.requested_pickup_at === "string" ? payload.requested_pickup_at : null,
            requested_return_at: typeof payload.requested_return_at === "string" ? payload.requested_return_at : null,
          }
        : null;
      return resolveAkashaSmartBookingChange({
        changeRequestId: change.id,
        decision,
        expectedRevision: booking.data.revision,
        resolutionNote: resolutionNote.trim() || null,
        publicResolutionNote: publicResolutionNote.trim() || null,
        schedulePayload,
      });
    },
    onSuccess: async (result) => {
      setActionError(null);
      setActionMessage(result.request_status === "applied"
        ? "Data reservasi berhasil diperbarui."
        : result.request_status === "approved"
          ? "Permintaan berhasil disetujui."
          : "Permintaan perubahan ditolak.");
      setResolutionNote("");
      setPublicResolutionNote("");
      await refreshAll();
    },
    onError: (error: unknown) => setActionError(error instanceof Error ? error.message : "Permintaan gagal diselesaikan."),
  });

  const accessMutation = useMutation({
    mutationFn: async () => {
      if (!booking.data || !canRotateAccess) throw new Error("Akses pelanggan belum tersedia untuk akun ini.");
      if (!rotateIdempotencyRef.current) {
        rotateIdempotencyRef.current = "smart-booking-access-" + createClientId();
      }
      return rotateAkashaSmartBookingAccess(booking.data.smart_booking_id, rotateIdempotencyRef.current);
    },
    onSuccess: (result) => {
      const portalLinkUrl = typeof result.portal_link_token === "string"
        ? createAkashaPortalLink(appConfig.akashaPublicSiteUrl, result.portal_link_token)
        : null;
      setRotatedAccess({
        accessCode: result.access_code,
        portalLinkUrl,
        expiresAt: result.expires_at,
      });
      setActionError(null);
      setActionMessage("Kode akses dan tautan pribadi pelanggan telah diperbarui. Bagikan secara langsung kepada pelanggan.");
      rotateIdempotencyRef.current = null;
    },
    onError: (error: unknown) => {
      rotateIdempotencyRef.current = null;
      setActionError(error instanceof Error ? error.message : "Akses pelanggan gagal diperbarui.");
    },
  });

  const detail = booking.data;
  const pendingChanges = detail?.change_requests.filter((change) => change.status === "pending") ?? [];
  const proposedCatalog = targetCatalog.data ?? new Map<string, CatalogTarget>();
  const closed = detail ? ["cancelled", "expired", "fulfilled"].includes(detail.workflow_status) : false;
  const canConfirm = detail
    ? !closed
      && pendingChanges.length === 0
      && ["received", "reviewing", "acknowledged", "change_requested"].includes(detail.workflow_status)
    : false;
  const businessTimezone = detail?.business_timezone ?? "Asia/Jakarta";
  const recordedDp = detail?.dp_amount ?? null;
  const recordedDpPercent = recordedDp !== null && (detail?.quote_total ?? 0) > 0
    ? (recordedDp / (detail?.quote_total ?? 1)) * 100
    : null;
  const dpInputAmount = dpInput.trim() === "" ? null : Number(dpInput);
  const dpInputValid = dpChoice === "none"
    || (dpChoice === "received"
      && dpInputAmount !== null
      && Number.isInteger(dpInputAmount)
      && dpInputAmount > 0
      && dpInputAmount <= (detail?.quote_total ?? 0));
  const dpInputPercent = dpChoice === "received" && dpInputAmount !== null && (detail?.quote_total ?? 0) > 0
    ? (dpInputAmount / (detail?.quote_total ?? 1)) * 100
    : null;
  const bookingDpPercentLabel = recordedDpPercent === null
    ? null
    : recordedDpPercent.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "%";
  const bookingTariffMap = bookingTariffs.data ?? new Map<string, SmartBookingTariffPeriod>();
  const estimatedLines = (detail?.lines ?? []).map((line) => {
    const tariff = line.tarif_sewa_id ? bookingTariffMap.get(line.tarif_sewa_id) ?? null : null;
    const periods = line.kind === "rental"
      ? calculateSmartBookingTariffPeriods(detail?.requested_pickup_date ?? null, detail?.requested_return_date ?? null, tariff)
      : 1;
    const estimatedPeriods = periods ?? 1;
    return {
      line,
      periods,
      estimatedPeriods,
      estimatedSubtotal: calculateSmartBookingLineEstimate(line.quantity, line.unit_price, estimatedPeriods),
      normalSubtotal: calculateSmartBookingLineEstimate(line.quantity, line.normal_price, estimatedPeriods),
    };
  });
  const estimatedBookingTotal = estimatedLines.reduce((sum, entry) => sum + entry.estimatedSubtotal, 0);
  const unresolvedEstimateLineCount = estimatedLines.filter((entry) => entry.line.kind === "rental" && entry.periods === null).length;
  const requestedStayLabel = formatSmartBookingStayLabel(
    detail?.requested_pickup_date ?? null,
    detail?.requested_return_date ?? null,
  );
  const bookingSummary = useMemo(() => {
    if (!detail) return "";
    const lines = detail.lines.map((line) => {
      const kind = line.kind === "rental" ? "Sewa" : "Beli";
      const name = line.name + (line.variant ? " · " + line.variant : "");
      return kind + " · " + name + " × " + line.quantity;
    });
    return [
      "Reservasi Akasha Outdoor " + detail.reference_code,
      "Pelanggan: " + detail.customer_name,
      "WhatsApp: " + detail.customer_phone,
      "Pengambilan: " + formatDate(detail.requested_pickup_date, businessTimezone),
      "Pengembalian: " + formatDate(detail.requested_return_date, businessTimezone),
      "Durasi estimasi: " + (requestedStayLabel ?? "Belum ditentukan"),
      ...lines,
      "Perkiraan total sewa + beli: " + formatCurrency(estimatedBookingTotal, detail.currency_code),
      "Catatan: estimasi tanggal mengasumsikan jam ambil dan kembali setara. Admin menghitung ulang berdasarkan waktu serah-terima aktual; stok belum dialokasikan.",
    ].join("\\n");
  }, [detail, businessTimezone, requestedStayLabel, estimatedBookingTotal]);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    const url = window.location.origin + paths.reservasi + "/" + id;
    setAdminUrl(url);
    let active = true;
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#1D1916", light: "#FFFFFF" },
    }).then((dataUrl) => {
      if (active) setQrUrl(dataUrl);
    }).catch(() => {
      if (active) setQrUrl(null);
    });
    return () => { active = false; };
  }, [id]);

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setActionError("Clipboard tidak tersedia. Salin teks secara manual.");
    }
  }

  function handleStatusChange() {
    confirmationMutation.reset();
    setActionError(null);
    setDpChoice("");
    setDpInput("");
    setConfirmDialogOpen(true);
  }

  function handleConfirmBooking() {
    if (!detail || !dpChoice) return;
    const amount = dpChoice === "none" ? 0 : Number(dpInput);
    if (!Number.isInteger(amount) || amount < 0 || amount > detail.quote_total || (dpChoice === "received" && amount <= 0)) {
      setActionError("Nominal DP harus berupa angka rupiah bulat, lebih dari Rp0, dan tidak melebihi total booking.");
      return;
    }
    setActionError(null);
    confirmationMutation.mutate(amount);
  }

  async function handleRotateAccess() {
    if (!window.confirm("Terbitkan kode akses dan tautan pribadi baru? Akses sebelumnya akan dicabut.")) return;
    setRotatedAccess(null);
    accessMutation.mutate();
  }

  if (tenantStatus === "loading" || booking.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-48 rounded-xl" /></div>
      </div>
    );
  }

  if (tenantStatus === "error" || !current) {
    return <Alert variant="destructive"><AlertTitle>Usaha aktif belum tersedia</AlertTitle><AlertDescription>{tenantError?.message ?? "Pilih usaha aktif."}</AlertDescription></Alert>;
  }

  if (booking.error || !detail) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.reservasi)}><ArrowLeft className="size-4" /> Kembali ke Reservasi</Button>
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Detail Reservasi belum dapat dimuat</AlertTitle><AlertDescription>{booking.error?.message ?? "Reservasi tidak ditemukan atau akun Anda tidak memiliki akses."}</AlertDescription></Alert>
      </div>
    );
  }

  const waPhone = detail.customer_phone_normalized.replace(/[^0-9]/g, "");
  const waText = "Halo " + detail.customer_name + ", kami dari Akasha Outdoor ingin menindaklanjuti reservasi " + detail.reference_code + ".";
  const waLink = waPhone ? "https://wa.me/" + waPhone + "?text=" + encodeURIComponent(waText) : null;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 pb-8 sm:space-y-5" data-testid="akasha-smart-booking-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
          <Link to={paths.reservasi}><ArrowLeft className="size-3.5" /> Kembali ke Reservasi</Link>
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { void booking.refetch(); void availability.refetch(); }} disabled={booking.isFetching || availability.isFetching}>
          <RefreshCw className={"size-3.5 " + (booking.isFetching || availability.isFetching ? "animate-spin" : "")} /> Perbarui data
        </Button>
      </div>

      <header className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">Detail Reservasi</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{detail.reference_code}</h1>
              <Badge variant={statusVariant(detail.workflow_status)}>{STATUS_LABELS[detail.workflow_status]}</Badge>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
              Dibuat {formatDateTime(detail.created_at, businessTimezone)} · diperbarui {formatDateTime(detail.updated_at, businessTimezone)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {waLink ? (
              <Button variant="outline" size="sm" className="h-9 text-xs" asChild>
                <a href={waLink} target="_blank" rel="noreferrer"><MessageCircle className="size-3.5" /> WhatsApp</a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void copyValue("summary", bookingSummary)}>
              {copied === "summary" ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />} Salin ringkasan
            </Button>
            {canConfirm && canReview ? (
              <Button
                type="button"
                size="sm"
                className="h-9 text-xs"
                disabled={confirmationMutation.isPending}
                onClick={handleStatusChange}
              >
                <CheckCircle2 className="size-3.5" />
                Konfirmasi & siapkan checkout
              </Button>
            ) : null}
          </div>
        </div>
        {detail.workflow_status === "ready_for_checkout" ? (
          <Alert className="mt-4 border-amber-500/25 bg-amber-500/[0.04]">
            <ShieldAlert className="size-4 text-amber-600" />
            <AlertTitle className="text-sm">Barang diperiksa kembali saat transaksi disiapkan</AlertTitle>
            <AlertDescription className="text-xs">Stok akan diperiksa dan dialokasikan hanya melalui alur transaksi operasional yang sudah ada.</AlertDescription>
          </Alert>
        ) : null}
      </header>

      {actionError ? (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Aksi belum berhasil</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>
      ) : null}
      {actionMessage ? (
        <Alert className="border-emerald-500/25 bg-emerald-500/[0.04]"><CheckCircle2 className="size-4 text-emerald-600" /><AlertTitle className="text-sm">Informasi</AlertTitle><AlertDescription className="text-xs">{actionMessage}</AlertDescription></Alert>
      ) : null}
      {permissions.isSuccess && !canReview ? (
        <Alert className="border-amber-500/25 bg-amber-500/[0.04]">
          <ShieldAlert className="size-4 text-amber-600" />
          <AlertTitle className="text-sm">Mode lihat saja</AlertTitle>
          <AlertDescription className="text-xs">Akun ini hanya dapat melihat reservasi. Tindakan perubahan dan status tidak tersedia.</AlertDescription>
        </Alert>
      ) : null}
      {permissions.isError ? (
        <Alert variant="destructive"><AlertTitle>Hak akses belum dapat diperiksa</AlertTitle><AlertDescription>{permissions.error.message}. Tindakan admin dinonaktifkan.</AlertDescription></Alert>
      ) : null}

      <Tabs defaultValue="detail" className="w-full" data-testid="booking-detail-tabs">
        <TabsList className="grid h-10 w-full grid-cols-3 rounded-xl p-1">
          <TabsTrigger value="detail" className="gap-1.5 text-xs">
            <UserRound className="size-3.5" /> Detail
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5 text-xs">
            <FileClock className="size-3.5" /> Permintaan
            {pendingChanges.length > 0 ? <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">{pendingChanges.length}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="access" className="gap-1.5 text-xs">
            <KeyRound className="size-3.5" /> Akses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="detail" className="mt-3 space-y-3">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="order-2 min-w-0 space-y-3 xl:order-1">
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><UserRound className="size-4 text-primary" /> Pelanggan & periode</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2.5 p-3 pt-1 sm:gap-3 sm:p-4 sm:pt-1">
              <Metric label="Nama pelanggan" value={detail.customer_name} />
              <Metric label="Nomor WhatsApp" value={detail.customer_phone} />
              <Metric label="Pengambilan" value={formatDate(detail.requested_pickup_date, businessTimezone)} />
              <Metric label="Pengembalian" value={formatDate(detail.requested_return_date, businessTimezone)} />
              <Metric label="Durasi" value={requestedStayLabel ?? (detail.lines.some((line) => line.kind === "rental") ? "Belum ditentukan" : "—")} />
              <Metric label="Perkiraan total sewa + beli" value={bookingTariffs.isLoading && rentalTariffIds.length > 0 ? "Menghitung..." : formatCurrency(estimatedBookingTotal, detail.currency_code)} detail="Perkiraan, belum tagihan akhir" />
            </CardContent>
          </Card>
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Package className="size-4 text-primary" /> Barang dalam reservasi</span>
                <Badge variant="secondary">{detail.lines.length} item</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 p-3 pt-1">
              {estimatedLines.map(({ line, periods, estimatedPeriods, estimatedSubtotal, normalSubtotal }) => (
                <div key={line.line_id} className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{line.name}{line.variant ? " · " + line.variant : ""}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {line.kind === "rental"
                        ? "Rental · " + (requestedStayLabel ?? "tanggal belum valid") + " · " + (periods === null ? "durasi belum dapat dihitung" : estimatedPeriods + " periode")
                        : "Pembelian · sekali beli"} · {line.quantity} unit

                    </p>
                    {line.kind === "rental" ? <p className="mt-1 text-[10px] text-muted-foreground">{line.quantity} unit × {periods === null ? "—" : estimatedPeriods} periode × {formatCurrency(line.unit_price, line.currency_code)}</p> : null}
                    {line.discount_percent > 0 ? <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-300">{"Promo " + line.discount_percent + "% · estimasi hemat " + formatCurrency(Math.max(0, normalSubtotal - estimatedSubtotal), line.currency_code)}</p> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {line.discount_percent > 0 ? <p className="text-[10px] text-muted-foreground line-through">{formatCurrency(normalSubtotal, line.currency_code)}</p> : null}
                    <p className="text-sm font-semibold">{formatCurrency(estimatedSubtotal, line.currency_code)}</p>
                  </div>
                </div>
              ))}
              {bookingTariffs.isError || unresolvedEstimateLineCount > 0 ? (
                <Alert className="mt-3 border-amber-500/25 bg-amber-500/[0.04]">
                  <ShieldAlert className="size-4 text-amber-600" />
                  <AlertTitle className="text-xs">Sebagian periode belum dapat dihitung</AlertTitle>
                  <AlertDescription className="text-[10px]">Estimasi untuk item terkait masih memakai satu periode dasar. Periksa tarif dan waktu serah-terima sebelum transaksi.</AlertDescription>
                </Alert>
              ) : null}
              <p className="pt-3 text-[10px] leading-5 text-muted-foreground">
                Estimasi ini menghitung periode dari rentang tanggal dengan asumsi jam ambil dan kembali setara, mengikuti aturan lama sewa. Saat transaksi, gunakan jam serah-terima aktual; total dan tarif akan dihitung kembali.
              </p>
            </CardContent>
          </Card>
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Warehouse className="size-4 text-primary" /> Ketersediaan barang saat ini</span>
                <Badge variant="outline">Ketersediaan dicek saat checkout</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-1">
              {availability.isLoading ? <Skeleton className="h-20 rounded-lg" /> : availability.error ? (
                <Alert variant="destructive"><AlertDescription>{availability.error.message}</AlertDescription></Alert>
              ) : availability.data ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>Diperiksa {formatDateTime(availability.data.checked_at, businessTimezone)}</span>
                    <span>{availability.data.return_tolerance_hours} jam toleransi</span>
                  </div>
                  {Date.now() - new Date(availability.data.checked_at).getTime() > 180_000 ? (
                    <Alert className="border-amber-500/25 bg-amber-500/[0.04]">
                      <ShieldAlert className="size-4 text-amber-600" />
                      <AlertTitle className="text-xs">Informasi stok perlu diperbarui</AlertTitle>
                      <AlertDescription className="text-[10px]">Info stok terakhir lebih dari tiga menit. Perbarui sebelum menyiapkan transaksi.</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="space-y-2.5">
                    {availability.data.lines.map((line) => (
                      <div key={line.line_id} className="rounded-xl border border-border/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold">{line.item_name}{line.variant_name ? " · " + line.variant_name : ""}</p>
                          <Badge variant={availabilityVariant(line.status)}>{availabilityLabel(line.status)}</Badge>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {line.kind === "rental" ? "Rental" : "Pembelian"} · Diminta {line.requested_quantity}
                        </p>
                        {line.components.map((component, index) => {
                          const projection = component.availability ?? component;
                          const ready = projection.ready_now_requested_variant ?? projection.ready_now_across_variants;
                          const potential = projection.potential_returns_before_pickup_requested_variant ?? projection.potential_returns_before_pickup_across_variants;
                          const total = projection.total_serialized_units;
                          const current = line.kind === "sale"
                            ? projection.available_now_requested_variant ?? projection.available_now_across_variants
                            : null;
                          return (
                            <div key={component.component_name ?? index} className="mt-2 border-t border-border/60 pt-2">
                              <p className="text-[11px] font-medium">{component.component_name ?? projection.product_name ?? line.item_name}</p>
                              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <Metric label="Siap saat ini" value={ready == null ? "—" : String(ready)} />
                                {current !== null ? <Metric label="Tersedia saat ini" value={String(current)} /> : <Metric label="Status varian" value={availabilityLabel(projection.status ?? line.status)} /> }
                                <Metric label="Perkiraan kembali" value={potential == null ? "0" : String(potential)} detail="Belum siap" />
                                <Metric label="Total unit" value={total == null ? "—" : String(total)} />
                              </div>
                              {component.requested_variant ? <p className="mt-1 text-[10px] text-muted-foreground">Varian: {component.requested_variant}</p> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] leading-5 text-muted-foreground">
                    Barang yang masih disewa atau belum lolos pemeriksaan belum dihitung siap digunakan.
                  </p>
                </>
              ) : <p className="text-xs text-muted-foreground">Informasi stok belum tersedia.</p>}
            </CardContent>
          </Card>
            </div>
            <aside className="order-1 space-y-3 xl:order-2">
              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Uang muka (DP)</span>
                    {recordedDp === null ? (
                      <Badge variant="outline">Belum dicatat</Badge>
                    ) : recordedDp > 0 ? (
                      <Badge variant="secondary">Sudah diterima</Badge>
                    ) : (
                      <Badge variant="outline">Tanpa DP</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-3 pt-1">
                  <div>
                    <p className="text-[10px] text-muted-foreground">DP tercatat</p>
                    <p className="mt-0.5 text-lg font-bold tracking-tight">
                      {recordedDp === null ? "—" : formatCurrency(recordedDp, detail.currency_code)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">Dari total booking</span>
                      <span className="font-semibold">{bookingDpPercentLabel ?? "Belum dihitung"}</span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label="Persentase DP dari total booking"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.max(0, recordedDpPercent ?? 0))}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: Math.min(100, Math.max(0, recordedDpPercent ?? 0)) + "%" }}
                      />
                    </div>
                  </div>
                  <div className="border-t border-border/60 pt-2">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">Total booking</span>
                      <span className="font-semibold">{formatCurrency(detail.quote_total, detail.currency_code)}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      {recordedDp === null
                        ? "DP belum dicatat pada booking ini."
                        : recordedDp > 0
                          ? "DP tercatat sebagai informasi dan belum diperhitungkan sebagai pembayaran transaksi."
                          : "Customer tidak membayar DP saat booking dikonfirmasi."}
                    </p>
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Catatan DP hanya untuk informasi booking dan tidak masuk ke saldo kas atau laporan keuangan.
                  </p>
                </CardContent>
              </Card>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="requests" className="mt-3 space-y-3">
          <div className="grid gap-3 xl:grid-cols-2">
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><FileClock className="size-4 text-primary" /> Permintaan perubahan pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-1">
              {pendingChanges.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Tidak ada perubahan yang menunggu pemeriksaan.</p>
              ) : pendingChanges.map((change) => {
                const items = getProposalItems(change.payload);
                return (
                  <article key={change.id} className="rounded-xl border border-border/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{changeTypeLabel(change.type)}</p>
                      <Badge variant="default">Perlu diperiksa</Badge>
                    </div>
                    {change.reason ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{change.reason}</p> : null}
                    {change.type === "schedule_change" ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Metric label="Tanggal pengambilan" value={formatDate(typeof change.payload.requested_pickup_date === "string" ? change.payload.requested_pickup_date : null, businessTimezone)} />
                        <Metric label="Tanggal pengembalian" value={formatDate(typeof change.payload.requested_return_date === "string" ? change.payload.requested_return_date : null, businessTimezone)} />
                      </div>
                    ) : null}
                    {items.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
                        {items.map((item, index) => {
                          const target = targetName(item, proposedCatalog);
                          return (
                            <div key={index} className="flex items-start justify-between gap-2 rounded-lg bg-muted/35 px-2.5 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-medium">{target.label}</p>
                                <p className="text-[10px] text-muted-foreground">Jumlah diminta: {target.quantity}{target.category ? " · " + target.category : ""}</p>
                              </div>
                              {target.price !== null ? <span className="shrink-0 text-[10px] font-semibold">{formatCurrency(target.price)}{target.duration ? " / " + target.duration : ""}</span> : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {change.type === "alternative_interest" ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">Persetujuan akan mengganti tepat satu item sumber. Item lain tetap dipertahankan.</p>
                    ) : null}
                    <Badge variant="outline" className="mt-2">{changeStatusLabel(change.status)}</Badge>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        size="sm"
                        className="h-9 text-xs"
                        disabled={!canReview || changeMutation.isPending || targetCatalog.isLoading}
                        onClick={() => changeMutation.mutate({ change, decision: "approved" })}
                      >
                        {changeMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        {change.type === "item_change" || change.type === "variant_change" || change.type === "quantity_change" || change.type === "alternative_interest" ? "Terapkan perubahan item" : "Setujui"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs"
                        disabled={!canReview || changeMutation.isPending}
                        onClick={() => changeMutation.mutate({ change, decision: "rejected" })}
                      >
                        <X className="size-3.5" /> Tolak permintaan
                      </Button>
                    </div>
                  </article>
                );
              })}
              {targetCatalog.error ? <p className="text-[10px] text-amber-700">Nama item usulan tidak dapat dibaca dari katalog publik. Barang akan diperiksa kembali sebelum perubahan diterapkan.</p> : null}
              <div className="grid gap-2">
                <label className="space-y-1 text-[11px] font-medium">
                  Catatan internal resolusi
                  <Textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={500} rows={2} placeholder="Catatan untuk audit internal (opsional)" className="text-xs" />
                </label>
                <label className="space-y-1 text-[11px] font-medium">
                  Pesan untuk pelanggan
                  <Textarea value={publicResolutionNote} onChange={(event) => setPublicResolutionNote(event.target.value)} maxLength={500} rows={2} placeholder="Contoh: Perubahan disetujui, kami menyiapkan alternatif tersebut." className="text-xs" />
                </label>
              </div>
              {canReview ? null : <p className="text-[10px] text-muted-foreground">Tindakan ini membutuhkan hak akses untuk mengubah reservasi.</p>}
            </CardContent>
          </Card>
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock3 className="size-4 text-primary" /> Riwayat pelanggan</CardTitle></CardHeader>
            <CardContent className="space-y-0 p-3 pt-1">
              {detail.timeline.length === 0 ? <p className="text-xs text-muted-foreground">Belum ada aktivitas.</p> : detail.timeline.map((event, index) => (
                <div key={index} className="relative border-l border-border pb-4 pl-4 last:border-0 last:pb-0">
                  <span className="absolute -left-[5px] top-0.5 size-2 rounded-full bg-primary" />
                  <p className="text-xs font-semibold">{event.public_message ?? event.type}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(event.created_at, businessTimezone)} · {event.actor_type}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        <TabsContent value="access" className="mt-3 space-y-3">
          <div className="grid gap-3 xl:grid-cols-2">
          {conversion.data ? (
            <Card className="border-emerald-500/25 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" /> Transaksi sudah dibuat
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-3 pt-1 sm:grid-cols-2">
                {conversion.data.checkout_number ? <Metric label="Nomor transaksi" value={conversion.data.checkout_number} /> : null}
                {conversion.data.rental_number ? <Metric label="Nomor penyewaan" value={conversion.data.rental_number} /> : null}
                {conversion.data.sale_number ? <Metric label="Nomor penjualan" value={conversion.data.sale_number} /> : null}
                <Metric label="Tanggal transaksi" value={formatDateTime(conversion.data.converted_at, businessTimezone)} />
                <p className="sm:col-span-2 text-[10px] leading-5 text-muted-foreground">
                  Barang diperiksa kembali saat transaksi disiapkan. Reservasi tidak mengurangi stok.
                </p>
              </CardContent>
            </Card>
          ) : conversion.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Referensi transaksi belum dapat dimuat</AlertTitle>
              <AlertDescription>{conversion.error.message}</AlertDescription>
            </Alert>
          ) : null}
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="size-4 text-primary" /> Akses pelanggan</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-3 pt-1">
              <p className="text-[10px] leading-5 text-muted-foreground">Buat kode akses dan tautan pribadi baru saat pelanggan kehilangan akses. Kode sebelumnya akan dinonaktifkan.</p>
              <Button className="h-9 w-full text-xs" variant="outline" disabled={!canRotateAccess || accessMutation.isPending} onClick={() => void handleRotateAccess()}>
                {accessMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Buat kode & tautan baru
              </Button>
              {permissions.isSuccess && !canRotateAccess ? <p className="text-[10px] text-muted-foreground">Akun ini tidak memiliki hak untuk mengubah akses pelanggan.</p> : null}
              {rotatedAccess ? (
                <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kode akses baru</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <code className="text-lg font-bold tracking-widest text-primary">{rotatedAccess.accessCode}</code>
                      <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void copyValue("code", rotatedAccess.accessCode)} aria-label="Salin kode akses">
                        {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
                      </Button>
                    </div>
                  </div>
                  {rotatedAccess.portalLinkUrl ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tautan pribadi pelanggan</p>
                      <p className="mt-1 break-all text-[11px] text-primary">{rotatedAccess.portalLinkUrl}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-2 h-8 w-full text-xs" onClick={() => void copyValue("link", rotatedAccess.portalLinkUrl as string)}>
                        {copied === "link" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Salin tautan pribadi
                      </Button>
                    </div>
                  ) : null}
                  <p className="text-[10px] text-muted-foreground">Berlaku sampai {formatDateTime(rotatedAccess.expiresAt, businessTimezone)}. Bagikan melalui kanal pribadi; jangan tempel pada QR admin.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clipboard className="size-4 text-primary" /> QR admin</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-3 pt-1">
              {qrUrl ? (
                <div className="flex justify-center rounded-xl border border-border bg-white p-3">
                  <img src={qrUrl} alt={"QR admin untuk reservasi " + detail.reference_code} className="size-44 object-contain" />
                </div>
              ) : <div className="grid h-44 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">QR sedang disiapkan…</div>}
              <p className="text-[10px] leading-5 text-muted-foreground">QR ini hanya dapat dibuka oleh admin setelah masuk ke akun.</p>
              <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs" disabled={!adminUrl} onClick={() => void copyValue("admin-url", adminUrl)}>
                {copied === "admin-url" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Salin tautan detail admin
              </Button>
            </CardContent>
          </Card>
<Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShoppingBag className="size-4 text-primary" /> Lanjutkan transaksi</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-3 pt-1">
              {conversion.data ? (
                <p className="text-[10px] leading-5 text-muted-foreground">Reservasi ini sudah menjadi transaksi. Lanjutkan penetapan unit dan serah-terima melalui halaman Penyewaan bila diperlukan.</p>
              ) : (
                <>
                  <p className="text-[10px] leading-5 text-muted-foreground">Halaman Penyewaan akan dibuka dengan data pelanggan dan barang dari reservasi. Petugas mengisi waktu serah-terima; tarif, promo, dan ketersediaan diperiksa kembali saat transaksi dibuat.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full text-xs"
                    disabled={!canReview || detail.workflow_status !== "ready_for_checkout" || pendingChanges.length > 0}
                    asChild
                  >
                    <Link to={paths.penyewaan + "/walk-in?smart_booking_id=" + encodeURIComponent(detail.smart_booking_id)}>
                      <ExternalLink className="size-3.5" /> Siapkan transaksi
                    </Link>
                  </Button>
                </>
              )}
              <p className="text-[10px] leading-4 text-muted-foreground">Tidak ada unit fisik atau kapasitas yang dikunci oleh website booking.</p>
            </CardContent>
          </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-md rounded-2xl p-4 sm:p-5">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="text-base">Konfirmasi booking</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Pilih apakah pelanggan sudah memberikan DP. Booking tetap dapat dikonfirmasi meski belum ada DP.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Total booking</span>
                <span className="font-semibold">{formatCurrency(detail.quote_total, detail.currency_code)}</span>
              </div>
            </div>
            <RadioGroup
              value={dpChoice}
              onValueChange={(value) => setDpChoice(value as "none" | "received")}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
                <RadioGroupItem value="none" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">Belum menerima DP</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">Konfirmasi booking tanpa uang muka.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
                <RadioGroupItem value="received" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">Sudah menerima DP</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">Catat nominal yang sudah diterima dari pelanggan.</span>
                </span>
              </label>
            </RadioGroup>

            {dpChoice === "received" ? (
              <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                <label htmlFor="booking-dp-amount" className="block text-xs font-semibold">Nominal DP (Rp)</label>
                <Input
                  id="booking-dp-amount"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  max={detail.quote_total}
                  value={dpInput}
                  onChange={(event) => setDpInput(event.target.value)}
                  placeholder="Contoh: 100000"
                  className="h-10 rounded-lg text-sm"
                />
                {dpInputAmount !== null && dpInputPercent !== null && dpInputValid ? (
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-muted-foreground">Persentase dari total booking</span>
                    <span className="font-semibold text-primary">
                      {dpInputPercent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Isi nominal rupiah bulat, minimal Rp1 dan maksimal sebesar total booking.
                  </p>
                )}
                {dpInputAmount !== null && dpInputAmount > detail.quote_total ? (
                  <p className="text-[10px] text-destructive">Nominal DP tidak boleh melebihi total booking.</p>
                ) : null}
              </div>
            ) : null}
            <p className="text-[10px] leading-4 text-muted-foreground">
              Pencatatan ini tidak membuat transaksi pembayaran, tidak menambah saldo kas, dan tidak mengunci barang.
            </p>
            {confirmationMutation.isError ? (
              <Alert variant="destructive" className="py-2">
                <AlertTitle className="text-xs">Konfirmasi belum berhasil</AlertTitle>
                <AlertDescription className="text-[10px]">
                  {confirmationMutation.error instanceof Error ? confirmationMutation.error.message : "Periksa kembali data booking lalu coba lagi."}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 flex-1 text-xs sm:flex-none"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={confirmationMutation.isPending}
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 flex-1 text-xs sm:flex-none"
              onClick={handleConfirmBooking}
              disabled={!dpChoice || !dpInputValid || confirmationMutation.isPending}
            >
              {confirmationMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Konfirmasi & siapkan checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
