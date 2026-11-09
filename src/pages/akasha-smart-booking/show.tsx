import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Clipboard,
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
import { Separator } from "@/components/ui/separator";
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
  setAkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/service";
import type {
  AkashaSmartBookingAvailability,
  AkashaSmartBookingChangeRequest,
  AkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/types";
import { createAkashaPortalLink } from "@/features/akasha-smart-booking/portal-link";

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
  received: "Baru diterima",
  reviewing: "Sedang ditinjau",
  acknowledged: "Sudah ditinjau",
  customer_action_required: "Menunggu customer",
  change_requested: "Perubahan diminta",
  cancellation_pending: "Pembatalan diminta",
  ready_for_checkout: "Siap checkout",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
  fulfilled: "Dikonversi",
};

const STATUS_ACTIONS: Partial<Record<AkashaSmartBookingStatus, Array<{
  status: Exclude<AkashaSmartBookingStatus, "received" | "change_requested" | "cancellation_pending" | "fulfilled">;
  label: string;
  description: string;
}>>> = {
  received: [{ status: "reviewing", label: "Mulai tinjau", description: "Tandai permintaan masuk sebagai sedang ditinjau." }],
  reviewing: [
    { status: "acknowledged", label: "Tandai ditinjau", description: "Pengelola telah memeriksa permintaan." },
    { status: "customer_action_required", label: "Minta tanggapan customer", description: "Customer perlu memberi informasi tambahan." },
    { status: "cancelled", label: "Batalkan booking", description: "Tutup permintaan booking tanpa membuat transaksi." },
  ],
  acknowledged: [
    { status: "reviewing", label: "Tinjau kembali", description: "Kembalikan booking ke tahap pemeriksaan." },
    { status: "customer_action_required", label: "Minta tanggapan customer", description: "Customer perlu memberi informasi tambahan." },
    { status: "ready_for_checkout", label: "Siap untuk checkout", description: "Tandai siap ditindaklanjuti di lokasi; stok belum dialokasikan." },
    { status: "cancelled", label: "Batalkan booking", description: "Tutup permintaan booking tanpa membuat transaksi." },
  ],
  customer_action_required: [
    { status: "reviewing", label: "Lanjutkan tinjauan", description: "Pengelola melanjutkan peninjauan." },
    { status: "acknowledged", label: "Tandai ditinjau", description: "Tanggapan customer telah diperiksa." },
    { status: "ready_for_checkout", label: "Siap untuk checkout", description: "Tandai siap ditindaklanjuti di lokasi; stok belum dialokasikan." },
    { status: "cancelled", label: "Batalkan booking", description: "Tutup permintaan booking tanpa membuat transaksi." },
  ],
  change_requested: [
    { status: "reviewing", label: "Tinjau perubahan", description: "Kembalikan ke tahap pemeriksaan setelah semua permintaan ditangani." },
    { status: "acknowledged", label: "Tandai ditinjau", description: "Perubahan telah ditinjau tanpa mengubah item." },
    { status: "customer_action_required", label: "Minta tanggapan customer", description: "Customer perlu memberi informasi tambahan." },
    { status: "cancelled", label: "Batalkan booking", description: "Tutup permintaan booking tanpa membuat transaksi." },
  ],
  ready_for_checkout: [
    { status: "reviewing", label: "Tinjau kembali", description: "Kembalikan ke pemeriksaan." },
    { status: "cancelled", label: "Batalkan booking", description: "Tutup permintaan booking." },
    { status: "expired", label: "Tandai kedaluwarsa", description: "Tutup permintaan yang sudah tidak berlaku." },
  ],
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
    pending: "Menunggu tinjauan",
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
    one_or_more_components_need_review: "Sebagian komponen perlu ditinjau",
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
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
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

  const statusMutation = useMutation({
    mutationFn: async (targetStatus: Exclude<AkashaSmartBookingStatus, "received" | "change_requested" | "cancellation_pending" | "fulfilled">) => {
      if (!booking.data || !canReview) throw new Error("Akses untuk mengubah status tidak diberikan.");
      return setAkashaSmartBookingStatus({
        smartBookingId: booking.data.smart_booking_id,
        targetStatus,
        expectedRevision: booking.data.revision,
        note: resolutionNote.trim() || null,
      });
    },
    onSuccess: async (result) => {
      setActionError(null);
      setActionMessage("Status booking berhasil diperbarui menjadi " + STATUS_LABELS[result.workflow_status] + ".");
      await refreshAll();
    },
    onError: (error: unknown) => setActionError(error instanceof Error ? error.message : "Status booking gagal diperbarui."),
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
        ? "Perubahan berhasil diterapkan ke snapshot Smart Booking."
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
      if (!booking.data || !canRotateAccess) throw new Error("Akses rotasi customer tidak diberikan.");
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
      setActionMessage("Kode akses dan tautan pribadi customer telah diperbarui. Bagikan secara pribadi.");
      rotateIdempotencyRef.current = null;
    },
    onError: (error: unknown) => {
      rotateIdempotencyRef.current = null;
      setActionError(error instanceof Error ? error.message : "Akses customer gagal diperbarui.");
    },
  });

  const detail = booking.data;
  const pendingChanges = detail?.change_requests.filter((change) => change.status === "pending") ?? [];
  const proposedCatalog = targetCatalog.data ?? new Map<string, CatalogTarget>();
  const transitions = detail && pendingChanges.length === 0
    ? STATUS_ACTIONS[detail.workflow_status] ?? []
    : [];
  const closed = detail ? ["cancelled", "expired", "fulfilled"].includes(detail.workflow_status) : false;
  const businessTimezone = detail?.business_timezone ?? "Asia/Jakarta";
  const bookingSummary = useMemo(() => {
    if (!detail) return "";
    const lines = detail.lines.map((line) => {
      const kind = line.kind === "rental" ? "Sewa" : "Beli";
      const name = line.name + (line.variant ? " · " + line.variant : "");
      return kind + " · " + name + " × " + line.quantity;
    });
    return [
      "Booking Akasha Outdoor " + detail.reference_code,
      "Customer: " + detail.customer_name,
      "Telepon: " + detail.customer_phone,
      "Pengambilan: " + formatDate(detail.requested_pickup_date, businessTimezone),
      "Pengembalian: " + formatDate(detail.requested_return_date, businessTimezone),
      ...lines,
      "Estimasi dasar: " + formatCurrency(detail.quote_total, detail.currency_code),
      "Catatan: stok belum dialokasikan; harga dan ketersediaan diverifikasi kembali saat transaksi.",
    ].join("\\n");
  }, [detail, businessTimezone]);

  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    const url = window.location.origin + paths.akashaSmartBooking + "/" + id;
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

  async function handleStatusChange(
    targetStatus: Exclude<AkashaSmartBookingStatus, "received" | "change_requested" | "cancellation_pending" | "fulfilled">,
  ) {
    if (targetStatus === "cancelled" || targetStatus === "expired") {
      if (!window.confirm("Tutup booking ini dengan status " + STATUS_LABELS[targetStatus] + "?")) return;
    }
    statusMutation.mutate(targetStatus);
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
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.akashaSmartBooking)}><ArrowLeft className="size-4" /> Kembali ke antrian</Button>
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Detail booking belum dapat dimuat</AlertTitle><AlertDescription>{booking.error?.message ?? "Booking tidak ditemukan atau Anda tidak memiliki akses."}</AlertDescription></Alert>
      </div>
    );
  }

  const waPhone = detail.customer_phone_normalized.replace(/[^0-9]/g, "");
  const waText = "Halo " + detail.customer_name + ", kami dari Akasha Outdoor ingin menindaklanjuti booking " + detail.reference_code + ".";
  const waLink = waPhone ? "https://wa.me/" + waPhone + "?text=" + encodeURIComponent(waText) : null;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 pb-8 sm:space-y-5" data-testid="akasha-smart-booking-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
          <Link to={paths.akashaSmartBooking}><ArrowLeft className="size-3.5" /> Kembali ke antrian</Link>
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { void booking.refetch(); void availability.refetch(); }} disabled={booking.isFetching || availability.isFetching}>
          <RefreshCw className={"size-3.5 " + (booking.isFetching || availability.isFetching ? "animate-spin" : "")} /> Perbarui data
        </Button>
      </div>

      <header className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">Detail booking online</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{detail.reference_code}</h1>
              <Badge variant={statusVariant(detail.workflow_status)}>{STATUS_LABELS[detail.workflow_status]}</Badge>
              <Badge variant="outline">Revisi #{detail.revision}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Dibuat {formatDateTime(detail.created_at, businessTimezone)} · diperbarui {formatDateTime(detail.updated_at, businessTimezone)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {waLink ? (
              <Button variant="outline" size="sm" className="h-9 text-xs" asChild>
                <a href={waLink} target="_blank" rel="noreferrer"><MessageCircle className="size-3.5" /> WhatsApp customer</a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void copyValue("summary", bookingSummary)}>
              {copied === "summary" ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />} Salin ringkasan
            </Button>
          </div>
        </div>
        {detail.workflow_status === "ready_for_checkout" ? (
          <Alert className="mt-4 border-amber-500/25 bg-amber-500/[0.04]">
            <ShieldAlert className="size-4 text-amber-600" />
            <AlertTitle className="text-sm">Siap checkout bukan berarti stok terkunci</AlertTitle>
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
          <AlertDescription className="text-xs">Akun ini tidak memiliki permission <code>reservation.amend</code>. Tindakan perubahan dan status dinonaktifkan.</AlertDescription>
        </Alert>
      ) : null}
      {permissions.isError ? (
        <Alert variant="destructive"><AlertTitle>Permission belum dapat diverifikasi</AlertTitle><AlertDescription>{permissions.error.message}. Tindakan admin dinonaktifkan.</AlertDescription></Alert>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-3">
          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><UserRound className="size-4 text-primary" /> Customer & periode</CardTitle></CardHeader>
            <CardContent className="grid gap-3 p-4 pt-1 sm:grid-cols-2">
              <Metric label="Nama customer" value={detail.customer_name} />
              <Metric label="Nomor WhatsApp" value={detail.customer_phone} />
              <Metric label="Pengambilan" value={formatDate(detail.requested_pickup_date, businessTimezone)} />
              <Metric label="Pengembalian" value={formatDate(detail.requested_return_date, businessTimezone)} />
              <Metric label="Estimasi dasar booking" value={formatCurrency(detail.quote_total, detail.currency_code)} detail="Bukan tagihan final / invoice" />
              <Metric label="Status proses" value={STATUS_LABELS[detail.workflow_status]} detail={"Zona waktu " + businessTimezone} />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Package className="size-4 text-primary" /> Rincian item booking</span>
                <Badge variant="secondary">{detail.lines.length} item</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 p-4 pt-1">
              {detail.lines.map((line) => (
                <div key={line.line_id} className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{line.name}{line.variant ? " · " + line.variant : ""}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {line.kind === "rental" ? "Rental · tarif dasar per siklus" : "Pembelian"} · {line.quantity} unit
                      {line.inventory_mode_snapshot ? " · " + line.inventory_mode_snapshot : ""}
                    </p>
                    {line.discount_percent > 0 ? <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-300">{"Promo " + line.discount_percent + "% · hemat " + formatCurrency(line.discount_amount, line.currency_code)}</p> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {line.discount_percent > 0 ? <p className="text-[10px] text-muted-foreground line-through">{formatCurrency(line.normal_price * line.quantity, line.currency_code)}</p> : null}
                    <p className="text-sm font-semibold">{formatCurrency(line.subtotal, line.currency_code)}</p>
                  </div>
                </div>
              ))}
              <p className="pt-3 text-[10px] leading-5 text-muted-foreground">
                Harga rental yang tampil adalah snapshot tarif dasar per siklus. Total akhir mengikuti durasi dan validasi saat transaksi di lokasi.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Warehouse className="size-4 text-primary" /> Proyeksi ketersediaan saat ini</span>
                <Badge variant="outline">Bukan reservasi stok</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-1">
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
                      <AlertTitle className="text-xs">Proyeksi perlu diperbarui</AlertTitle>
                      <AlertDescription className="text-[10px]">Informasi ketersediaan terakhir lebih dari tiga menit. Refresh sebelum mengambil keputusan atau membuka transaksi.</AlertDescription>
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
                          {line.kind === "rental" ? "Rental" : "Pembelian"} · Diminta {line.requested_quantity} · {line.inventory_mode ?? "Mode stok tidak diketahui"}
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
                                <Metric label="Ready sekarang" value={ready == null ? "—" : String(ready)} />
                                {current !== null ? <Metric label="Tersedia saat ini" value={String(current)} /> : <Metric label="Status varian" value={availabilityLabel(projection.status ?? line.status)} /> }
                                <Metric label="Potensi kembali" value={potential == null ? "0" : String(potential)} detail="Belum ready" />
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
                    Potensi pengembalian dipisahkan dari stok siap. Unit yang belum dikembalikan atau belum lolos pemeriksaan tidak dianggap ready. Tidak ada unit fisik yang ditampilkan pada portal customer.
                  </p>
                </>
              ) : <p className="text-xs text-muted-foreground">Proyeksi belum tersedia.</p>}
            </CardContent>
          </Card>

          {conversion.data ? (
            <Card className="border-emerald-500/25 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" /> Transaksi operasional terhubung
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-4 pt-1 sm:grid-cols-2">
                {conversion.data.checkout_number ? <Metric label="Nomor checkout" value={conversion.data.checkout_number} /> : null}
                {conversion.data.rental_number ? <Metric label="Nomor penyewaan" value={conversion.data.rental_number} /> : null}
                {conversion.data.sale_number ? <Metric label="Nomor penjualan" value={conversion.data.sale_number} /> : null}
                <Metric label="Dikonversi" value={formatDateTime(conversion.data.converted_at, businessTimezone)} />
                <p className="sm:col-span-2 text-[10px] leading-5 text-muted-foreground">
                  Stok diperiksa ulang oleh perintah transaksi operasional. Booking tidak membuat penguncian kapasitas terpisah.
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
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><FileClock className="size-4 text-primary" /> Permintaan perubahan customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-1">
              {pendingChanges.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Tidak ada permintaan yang menunggu ditinjau.</p>
              ) : pendingChanges.map((change) => {
                const items = getProposalItems(change.payload);
                return (
                  <article key={change.id} className="rounded-xl border border-border/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{changeTypeLabel(change.type)}</p>
                      <Badge variant="default">Menunggu tinjauan</Badge>
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
              {targetCatalog.error ? <p className="text-[10px] text-amber-700">Nama item usulan tidak dapat dibaca dari katalog publik. Backend tetap memvalidasi kembali target sebelum penerapan.</p> : null}
              <div className="grid gap-2">
                <label className="space-y-1 text-[11px] font-medium">
                  Catatan internal resolusi
                  <Textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={500} rows={2} placeholder="Catatan untuk audit internal (opsional)" className="text-xs" />
                </label>
                <label className="space-y-1 text-[11px] font-medium">
                  Pesan yang terlihat customer
                  <Textarea value={publicResolutionNote} onChange={(event) => setPublicResolutionNote(event.target.value)} maxLength={500} rows={2} placeholder="Contoh: Perubahan disetujui, kami menyiapkan alternatif tersebut." className="text-xs" />
                </label>
              </div>
              {canReview ? null : <p className="text-[10px] text-muted-foreground">Resolusi membutuhkan permission reservation.amend.</p>}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock3 className="size-4 text-primary" /> Timeline customer</CardTitle></CardHeader>
            <CardContent className="space-y-0 p-4 pt-1">
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

        <aside className="space-y-3">
          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-primary" /> Kontrol status</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 pt-1">
              {pendingChanges.length > 0 ? (
                <p className="text-xs leading-5 text-muted-foreground">Selesaikan atau tolak permintaan customer yang masih pending terlebih dahulu. Status booking akan mengikuti hasil resolusi permintaan.</p>
              ) : transitions.length === 0 || closed ? (
                <p className="text-xs text-muted-foreground">Tidak ada transisi status lanjutan yang tersedia.</p>
              ) : transitions.map((action) => (
                <div key={action.status} className="space-y-1">
                  <Button
                    type="button"
                    variant={action.status === "cancelled" ? "destructive" : action.status === "ready_for_checkout" ? "default" : "outline"}
                    className="h-9 w-full justify-start text-xs"
                    disabled={!canReview || statusMutation.isPending}
                    onClick={() => void handleStatusChange(action.status)}
                  >
                    {statusMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                    {action.label}
                  </Button>
                  <p className="px-1 text-[10px] leading-4 text-muted-foreground">{action.description}</p>
                </div>
              ))}
              <Separator className="my-2" />
              <label className="space-y-1 text-[11px] font-medium">
                Catatan perubahan status
                <Textarea rows={3} maxLength={500} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Catatan yang relevan untuk customer..." className="text-xs" />
              </label>
              <p className="text-[10px] leading-4 text-muted-foreground">Status "Siap checkout" tidak mengunci stok. Status selesai hanya dapat ditetapkan setelah transaksi nyata terhubung.</p>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="size-4 text-primary" /> Akses customer</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 pt-1">
              <p className="text-[10px] leading-5 text-muted-foreground">Terbitkan ulang kode akses dan tautan pribadi saat customer kehilangan akses. Kredensial baru akan mencabut kredensial sebelumnya.</p>
              <Button className="h-9 w-full text-xs" variant="outline" disabled={!canRotateAccess || accessMutation.isPending} onClick={() => void handleRotateAccess()}>
                {accessMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Rotasi kode & tautan
              </Button>
              {permissions.isSuccess && !canRotateAccess ? <p className="text-[10px] text-muted-foreground">Membutuhkan permission access_control.manage.</p> : null}
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
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tautan pribadi customer</p>
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
            <CardContent className="space-y-2 p-4 pt-1">
              {qrUrl ? (
                <div className="flex justify-center rounded-xl border border-border bg-white p-3">
                  <img src={qrUrl} alt={"QR admin untuk booking " + detail.reference_code} className="size-44 object-contain" />
                </div>
              ) : <div className="grid h-44 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">QR sedang disiapkan…</div>}
              <p className="text-[10px] leading-5 text-muted-foreground">QR hanya membuka detail admin yang dilindungi autentikasi, tenant, dan permission. QR bukan bukti otorisasi.</p>
              <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs" disabled={!adminUrl} onClick={() => void copyValue("admin-url", adminUrl)}>
                {copied === "admin-url" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Salin deep link admin
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShoppingBag className="size-4 text-primary" /> Handoff transaksi</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 pt-1">
              {conversion.data ? (
                <p className="text-[10px] leading-5 text-muted-foreground">Booking telah dikonversi ke transaksi operasional. Lanjutkan penetapan unit dan serah-terima melalui workspace penyewaan bila masih diperlukan.</p>
              ) : (
                <>
                  <p className="text-[10px] leading-5 text-muted-foreground">Walk-in akan dibuka dengan customer dan snapshot item booking. Admin menentukan jam aktual serta akun pembayaran; backend menghitung ulang tarif, promo, dan ketersediaan saat transaksi dibuat.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full text-xs"
                    disabled={!canReview || detail.workflow_status !== "ready_for_checkout" || pendingChanges.length > 0}
                    asChild
                  >
                    <Link to={paths.penyewaan + "/walk-in?smart_booking_id=" + encodeURIComponent(detail.smart_booking_id)}>
                      <ExternalLink className="size-3.5" /> Proses transaksi dari Walk-in
                    </Link>
                  </Button>
                </>
              )}
              <p className="text-[10px] leading-4 text-muted-foreground">Tidak ada unit fisik atau kapasitas yang dikunci oleh website booking.</p>
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}
