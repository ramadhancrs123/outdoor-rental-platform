import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  History,
  LockKeyhole,
  LockKeyholeOpen,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ReservationItemVisual } from "@/components/reservasi/reservation-item-visual";
import { ReservationStatusBadge, StockLockBadge } from "@/components/reservasi/reservation-ui";
import { stockLockPresentation } from "@/components/reservasi/reservation-status";
import {
  cancelReservation,
  confirmReservation,
  formatReservationDate,
  formatReservationDateTime,
  formatReservationMoney,
  getReservation,
  getReservationCapabilities,
  getReservasiContext,
} from "@/features/reservasi";
import { paths } from "@/routes/paths";
import { getRentalForReservation } from "@/features/penyewaan";
import { getMyBusinessPermissions } from "@/features/event-promotions";
import { amendReservation, listReservationAmendTargets, previewReservationAmendment } from "@/features/reservasi";
import type { ReservationAmendPreview, ReservationAmendTarget, ReservationAmendLineInput } from "@/features/reservasi/types";

function formatQuantity(value: string | number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? new Intl.NumberFormat("id-ID").format(numberValue) : String(value);
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

type CommandFeedback = { kind: "unknown" | "conflict" | "authorization" | "success" | "error"; message: string } | null;

type ReservationAmendDraftLine = {
  id: string;
  targetKey: string;
  tariffId: string;
  quantity: string;
  note: string;
};

function buildReservationAmendDraft(reservation: NonNullable<ReturnType<typeof getReservation> extends Promise<infer T> ? T : never>): ReservationAmendDraftLine[] {
  return reservation.lines.map((line) => ({
    id: line.detail_reservasi_id,
    targetKey: line.paket_sewa_id ? "paket:" + line.paket_sewa_id : line.varian_barang_id ? "varian:" + line.varian_barang_id : line.barang_id ? "barang:" + line.barang_id : "",
    tariffId: line.tarif_sewa_id ?? "",
    quantity: String(line.jumlah),
    note: line.catatan ?? "",
  }));
}

function classifyCommandError(error: unknown): Exclude<CommandFeedback, null> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("capacity") || message.includes("availability") || message.includes("conflict") || message.includes("stock")) {
    return { kind: "conflict", message: "Kapasitas tidak cukup atau state reservasi sudah berubah. Periksa kembali sumber sebelum mencoba lagi." };
  }
  if (message.includes("permission") || message.includes("forbidden") || message.includes("not authorized") || message.includes("otorisasi")) {
    return { kind: "authorization", message: "Perintah tidak dapat dilakukan pada konteks Usaha atau akun admin saat ini." };
  }
  return { kind: "unknown", message: "Status transaksi belum dapat dipastikan. Sistem sudah membaca ulang data sumber. Jangan mengulang tindakan sebelum statusnya jelas." };
}

function statusCopy(status: string) {
  switch (status.toLowerCase()) {
    case "confirmed":
      return "Reservasi terkonfirmasi dan kapasitas sudah menjadi commitment aktif.";
    case "cancelled":
      return "Reservasi dibatalkan. Kapasitas yang sebelumnya terkunci sudah dilepas bila memang terkunci.";
    case "expired":
      return "Reservasi sudah melewati state yang dapat dikonfirmasi.";
    case "fulfilled":
    case "converted":
      return "Reservasi sudah menjadi bagian dari lifecycle berikutnya.";
    case "pending":
      return "Reservasi sedang menunggu proses konfirmasi.";
    default:
      return "Reservasi masih berupa draft dan belum mengunci kapasitas.";
  }
}

export function ReservationShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback>(null);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const [amendLines, setAmendLines] = useState<ReservationAmendDraftLine[]>([]);
  const [amendPreview, setAmendPreview] = useState<ReservationAmendPreview | null>(null);
  const amendCommandContext = useRef<{ idempotencyKey: string; requestId: string } | null>(null);
  const confirmCommandContext = useRef<{ idempotencyKey: string; requestId: string } | null>(null);
  const cancelCommandContext = useRef<{ idempotencyKey: string; requestId: string } | null>(null);

  const context = useQuery({
    queryKey: ["reservasi", "context"],
    queryFn: getReservasiContext,
    staleTime: 60_000,
  });

  const detail = useQuery({
    queryKey: ["reservasi", "detail", context.data?.usahaId, id],
    queryFn: () => getReservation(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });

  const linkedRental = useQuery({
    queryKey: ["penyewaan", "reservation-link", context.data?.usahaId, id],
    queryFn: () => getRentalForReservation(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id && detail.data?.status === "confirmed"),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const promotionPermissions = useQuery({
    queryKey: ["reservasi", "permissions", context.data?.usahaId],
    queryFn: () => getMyBusinessPermissions(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const canUseAmendmentPermission = Boolean(promotionPermissions.data?.includes("reservation.amend"));
  const amendmentTargets = useQuery({
    queryKey: ["reservasi", "amend-targets", context.data?.usahaId],
    queryFn: () => listReservationAmendTargets(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && canUseAmendmentPermission && detail.data?.status === "confirmed" && detail.data?.stock_lock_status === "locked"),
    staleTime: 15_000,
  });

  const amendmentTargetMap = useMemo(
    () => new Map((amendmentTargets.data ?? []).map((target) => [target.key, target])),
    [amendmentTargets.data],
  );

  useEffect(() => {
    if (!amendOpen || !detail.data) return;
    setAmendLines(buildReservationAmendDraft(detail.data));
    setAmendReason("");
    setAmendPreview(null);
    amendCommandContext.current = null;
  }, [amendOpen, detail.data?.reservasi_id, detail.data?.updated_at]);

  const amendmentEstimatedTotal = useMemo(() => amendLines.reduce((sum, line) => {
    const tariff = amendmentTargetMap.get(line.targetKey)?.tariffs.find((item) => item.tarif_sewa_id === line.tariffId);
    const quantity = Number(line.quantity);
    return sum + (tariff && Number.isFinite(quantity) && quantity > 0 ? tariff.nominal * quantity : 0);
  }, 0), [amendLines, amendmentTargetMap]);

  const buildAmendInput = (): ReservationAmendLineInput[] => amendLines.map((line) => {
    const target = amendmentTargetMap.get(line.targetKey);
    const tariff = target?.tariffs.find((item) => item.tarif_sewa_id === line.tariffId);
    const quantity = Number(line.quantity);
    if (!target || !tariff) throw new Error("Pilih target dan tarif aktif untuk setiap rincian.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Jumlah setiap rincian harus lebih besar dari nol.");
    return {
      barang_id: target.barang_id,
      varian_barang_id: target.varian_barang_id,
      paket_sewa_id: target.paket_sewa_id,
      tarif_sewa_id: tariff.tarif_sewa_id,
      jumlah: quantity,
      catatan: line.note.trim() || null,
    };
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id) throw new Error("Konteks reservasi belum siap.");
      if (!canUseAmendmentPermission) throw new Error("Anda tidak memiliki izin mengubah reservasi.");
      const payload = buildAmendInput();
      if (!payload.length) throw new Error("Reservasi harus memiliki minimal satu rincian.");
      return previewReservationAmendment(context.data.usahaId, id, payload);
    },
    onSuccess: (preview) => {
      setAmendPreview(preview);
      setCommandFeedback(null);
    },
    onError: (error) => {
      setAmendPreview(null);
      setCommandFeedback({
        kind: "conflict",
        message: error instanceof Error ? error.message : "Preview perubahan reservasi gagal.",
      });
    },
  });

  const amendMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !detail.data) throw new Error("Konteks reservasi belum siap.");
      if (!canUseAmendmentPermission) throw new Error("Anda tidak memiliki izin mengubah reservasi.");
      if (!amendReason.trim()) throw new Error("Alasan perubahan wajib diisi.");
      if (!amendPreview) throw new Error("Tinjau perubahan dan harga akhir dari server terlebih dahulu.");
      const basePayload = buildAmendInput();
      if (basePayload.length !== amendPreview.lines.length) throw new Error("Rincian berubah sejak preview. Tinjau ulang sebelum menyimpan.");
      const payload: ReservationAmendLineInput[] = basePayload.map((line, index) => {
        const snapshot = amendPreview.lines[index];
        return {
          ...line,
          expected_unit_price: Number(snapshot.unit_price),
          expected_harga_normal: Number(snapshot.harga_normal_snapshot),
          expected_diskon_persen: Number(snapshot.diskon_persen_snapshot),
          expected_nominal_diskon: Number(snapshot.nominal_diskon_snapshot),
          expected_promosi_katalog_id: snapshot.promosi_katalog_id,
          expected_promosi_paket_id: snapshot.promosi_paket_id,
          expected_durasi_unit: snapshot.durasi_unit_snapshot,
          expected_durasi_nilai: Number(snapshot.durasi_nilai_snapshot),
          expected_currency_code: snapshot.currency_code,
        };
      });
      if (!amendCommandContext.current) {
        amendCommandContext.current = {
          idempotencyKey: "amend-reservation-" + id + "-" + createClientId(),
          requestId: createClientId(),
        };
      }
      return amendReservation(
        context.data.usahaId,
        id,
        amendPreview.reservation_updated_at,
        payload,
        amendReason,
        amendCommandContext.current,
      );
    },
    onSuccess: async () => {
      amendCommandContext.current = null;
      setAmendOpen(false);
      setAmendReason("");
      setAmendPreview(null);
      setCommandFeedback({ kind: "success", message: "Perubahan reservasi tersimpan. Harga, promo, durasi, dan kapasitas telah divalidasi kembali oleh server." });
      await Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["reservasi", "amend-targets", context.data?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["penyewaan"] }),
      ]);
    },
    onError: async (error) => {
      await detail.refetch();
      const feedback = classifyCommandError(error);
      setCommandFeedback({
        kind: feedback.kind,
        message: feedback.kind === "conflict"
          ? "Reservasi atau kapasitas telah berubah. Muat ulang detail lalu susun kembali perubahan sebelum mencoba lagi."
          : error instanceof Error ? error.message : feedback.message,
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id) throw new Error("Konteks reservasi belum siap.");
      if (!confirmCommandContext.current) {
        confirmCommandContext.current = {
          idempotencyKey: `confirm-reservation-${id}-${createClientId()}`,
          requestId: createClientId(),
        };
      }
      return confirmReservation(context.data.usahaId, id, confirmCommandContext.current);
    },
    onSuccess: async () => {
      confirmCommandContext.current = null;
      setCommandFeedback(null);
      await Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["permintaan", "list"] }),
      ]);
    },
    onError: async (error) => {
      await detail.refetch();
      const source = queryClient.getQueryData<{ status?: string; stock_lock_status?: string }>([
        "reservasi", "detail", context.data?.usahaId, id,
      ]);
      if (source?.status === "confirmed" && source.stock_lock_status === "locked") {
        confirmCommandContext.current = null;
        setCommandFeedback({ kind: "success", message: "Status transaksi sudah diperiksa ulang: reservasi terkonfirmasi dan kapasitas terkunci. Tidak ada retry otomatis." });
        await queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] });
      } else {
        const feedback = classifyCommandError(error);
        setCommandFeedback(feedback);
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id) throw new Error("Konteks reservasi belum siap.");
      if (!cancelCommandContext.current) {
        cancelCommandContext.current = {
          idempotencyKey: `cancel-reservation-${id}-${createClientId()}`,
          requestId: createClientId(),
        };
      }
      return cancelReservation(context.data.usahaId, id, cancelReason, cancelCommandContext.current);
    },
    onSuccess: async () => {
      cancelCommandContext.current = null;
      setCommandFeedback(null);
      setCancelReason("");
      await Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["permintaan", "list"] }),
      ]);
    },
    onError: async (error) => {
      await detail.refetch();
      const source = queryClient.getQueryData<{ status?: string; stock_lock_status?: string }>([
        "reservasi", "detail", context.data?.usahaId, id,
      ]);
      if (source?.status === "cancelled") {
        cancelCommandContext.current = null;
        setCancelReason("");
        setCommandFeedback({ kind: "success", message: "Status transaksi sudah diperiksa ulang: reservasi dibatalkan dan kapasitas dilepas bila sebelumnya terkunci. Tidak ada retry otomatis." });
        await queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] });
      } else {
        const feedback = classifyCommandError(error);
        setCommandFeedback(feedback);
      }
    },
  });

  if (context.isPending || detail.isPending) {
    return (
      <div className="space-y-5">
        <Card className="shadow-sm"><CardContent className="min-h-44 animate-pulse p-6" /></Card>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="h-52 animate-pulse lg:col-span-2" />
          <Card className="h-52 animate-pulse" />
        </div>
      </div>
    );
  }

  if (context.error || detail.error || !detail.data) {
    return (
      <div className="space-y-5">
        <Button asChild variant="ghost" className="-ml-3">
          <Link to={paths.reservasi}><ArrowLeft /> Kembali ke Reservasi</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Detail reservasi tidak tersedia</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{context.error?.message ?? detail.error?.message ?? "Reservasi tidak ditemukan atau Anda tidak memiliki akses."}</p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => void detail.refetch()}>
              <RefreshCw className="size-4" /> Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const reservation = detail.data;
  const capabilities = getReservationCapabilities();
  const canConfirm = capabilities.mutation && reservation.status === "draft";
  const linkedRentalResolved = linkedRental.isSuccess && !linkedRental.isFetching;
  const canCancel = capabilities.mutation && (
    reservation.status === "draft" ||
    (reservation.status === "confirmed" && linkedRentalResolved && !linkedRental.data)
  );
  const canPrepare = capabilities.mutation &&
    reservation.status === "confirmed" &&
    reservation.stock_lock_status === "locked" &&
    linkedRentalResolved &&
    !linkedRental.data;
  const canAmend = canPrepare && canUseAmendmentPermission;
  const canOpenLinkedRental = reservation.status === "confirmed" && Boolean(linkedRental.data);
  const busy = confirmMutation.isPending || cancelMutation.isPending;
  const lockView = stockLockPresentation(reservation.stock_lock_status);
  const LockIcon = lockView.iconName === "lock" ? LockKeyhole : lockView.iconName === "clock" ? Clock3 : LockKeyholeOpen;
  const totalValue = reservation.lines.reduce((total, line) => total + (Number(line.subtotal) || 0), 0);
  const primaryCurrency = reservation.lines[0]?.currency_code ?? "IDR";

  const events = [
    { label: "Reservasi dibuat", date: reservation.created_at, icon: FileText },
    reservation.confirmed_at
      ? { label: "Reservasi dikonfirmasi", date: reservation.confirmed_at, icon: Check }
      : null,
    reservation.confirmed_at && reservation.stock_lock_status === "locked"
      ? { label: "Kapasitas terkunci", date: reservation.confirmed_at, icon: LockKeyhole }
      : null,
    reservation.canceled_at
      ? { label: "Reservasi dibatalkan", date: reservation.canceled_at, icon: X }
      : null,
    reservation.canceled_at && reservation.stock_lock_status === "released"
      ? { label: "Kapasitas dilepas", date: reservation.canceled_at, icon: History }
      : null,
  ].filter(Boolean) as Array<{ label: string; date: string; icon: typeof FileText }>;

  return (
    <div className="space-y-5 pb-24 lg:pb-10">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 gap-2">
          <Link to={paths.reservasi}><ArrowLeft className="size-4" /> Reservasi</Link>
        </Button>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span>Usaha</span><span>·</span><span className="font-medium text-foreground">{context.data.usahaNama}</span>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative z-10 p-5 sm:p-6 lg:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/75">Reservasi</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{reservation.nomor_reservasi}</h1>
                <ReservationStatusBadge status={reservation.status} />
              </div>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <UserRound className="size-4" aria-hidden="true" />
                {reservation.penyewa_nama ?? "Penyewa tidak ditemukan"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium",
                lockView.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300"
                  : "border-muted bg-muted/50 text-muted-foreground",
              )}>
                <LockIcon className="size-4" aria-hidden="true" />
                {lockView.label}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border bg-background/75 p-4 backdrop-blur sm:p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-4" /></div>
                <div><p className="text-xs text-muted-foreground">Periode Penyewaan</p><p className="mt-1 text-sm font-semibold">{formatReservationDate(reservation.mulai_reservasi)} – {formatReservationDate(reservation.selesai_reservasi)}</p></div>
              </div>
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"><Package className="size-4" /></div>
                <div><p className="text-xs text-muted-foreground">Rincian Reservasi</p><p className="mt-1 text-sm font-semibold">{reservation.detail_count} rincian barang</p></div>
              </div>
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Clock3 className="size-4" /></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 text-sm font-semibold">{statusCopy(reservation.status)}</p></div>
              </div>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full bg-primary/8 blur-3xl" aria-hidden="true" />
      </section>

      {commandFeedback && (
        <Alert className={cn(
          commandFeedback.kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
          commandFeedback.kind === "conflict" && "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
          commandFeedback.kind === "authorization" && "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100",
          commandFeedback.kind === "unknown" && "border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-100",
        )}>
          {commandFeedback.kind === "success" ? <ShieldCheck className="size-4" /> : commandFeedback.kind === "conflict" ? <AlertTriangle className="size-4" /> : <AlertCircle className="size-4" />}
          <AlertTitle>
            {commandFeedback.kind === "success" ? "Status transaksi sudah diperiksa" : commandFeedback.kind === "conflict" ? "Kapasitas atau state berubah" : commandFeedback.kind === "authorization" ? "Aksi tidak diizinkan" : "Status transaksi belum dapat dipastikan"}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{commandFeedback.message}</p>
            {commandFeedback.kind === "unknown" && <Button type="button" variant="outline" size="sm" onClick={() => void detail.refetch()}><RefreshCw className="size-4" /> Cek Status</Button>}
          </AlertDescription>
        </Alert>
      )}

      {(canConfirm || canCancel || reservation.status === "confirmed") && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-4" /></div>
              <div>
                <CardTitle className="text-base">Aksi Reservasi</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Tindakan diproses oleh sistem transaksi yang aman.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {reservation.status === "confirmed" && linkedRental.isPending && (
              <div className="rounded-xl border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                Memeriksa apakah reservasi sudah diteruskan menjadi penyewaan…
              </div>
            )}
            {reservation.status === "confirmed" && linkedRental.error && (
              <Alert variant="destructive">
                <AlertTitle>Status penyewaan belum dapat diperiksa</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{linkedRental.error instanceof Error ? linkedRental.error.message : "Gagal memeriksa penyewaan yang terkait."}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void linkedRental.refetch()}>Coba lagi</Button>
                </AlertDescription>
              </Alert>
            )}
            {canPrepare && (
              <div className="mb-3 flex flex-col gap-4 rounded-2xl border bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">Lanjutkan ke Penyewaan</p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    Nama penyewa dan barang dari reservasi akan terisi otomatis. Isi jadwal mulai dan kembali sesuai waktu kedatangan aktual sebelum membuat penyewaan.
                  </p>
                </div>
                <Button asChild className="h-11 shrink-0 rounded-xl px-5">
                  <Link to={paths.penyewaanWalkIn + "?reservasi_id=" + encodeURIComponent(reservation.reservasi_id)}>
                    Lanjutkan Penyewaan <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            )}
            {canAmend && (
              <div className="mb-3 flex flex-col gap-3 rounded-2xl border bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">Ubah kesepakatan reservasi</p>
                  <p className="mt-1 text-sm text-muted-foreground">Atur ulang barang, varian, paket, jumlah, atau tarif. Harga promosi dan kapasitas akan dihitung ulang oleh server sebelum disimpan.</p>
                </div>
                <Drawer open={amendOpen} onOpenChange={(open) => {
                  if (!open && !amendMutation.isPending) {
                    setAmendOpen(false);
                    amendCommandContext.current = null;
                  } else if (open) setAmendOpen(true);
                }}>
                  <DrawerTrigger asChild>
                    <Button variant="outline" className="h-11 shrink-0 rounded-xl" disabled={amendmentTargets.isPending}>
                      {amendmentTargets.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Ubah reservasi
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="max-h-[92vh] rounded-t-3xl">
                    <DrawerHeader className="text-left">
                      <DrawerTitle>Ubah {reservation.nomor_reservasi}</DrawerTitle>
                      <DrawerDescription>Susun rincian baru. Server akan menghitung harga efektif, snapshot promo, durasi, serta ketersediaan stok sebelum perubahan disimpan.</DrawerDescription>
                    </DrawerHeader>
                    <div className="max-h-[62vh] space-y-3 overflow-y-auto px-4 pb-3">
                      {amendmentTargets.isError ? <Alert variant="destructive"><AlertDescription>{amendmentTargets.error instanceof Error ? amendmentTargets.error.message : "Katalog rental tidak dapat dimuat."}</AlertDescription></Alert> : null}
                      {amendLines.map((line, index) => {
                        const target = amendmentTargetMap.get(line.targetKey);
                        const quantity = Number(line.quantity);
                        const tariff = target?.tariffs.find((item) => item.tarif_sewa_id === line.tariffId);
                        return (
                          <div key={line.id} className="space-y-2 rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold">Rincian {index + 1}</p>
                              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-rose-600" onClick={() => { setAmendPreview(null); setAmendLines((items) => items.filter((item) => item.id !== line.id)); }}>Hapus</Button>
                            </div>
                            <label className="grid gap-1 text-[11px] font-medium">Barang / varian / paket
                              <select className="h-10 rounded-lg border bg-background px-2 text-xs" value={line.targetKey} onChange={(event) => {
                                const next = amendmentTargetMap.get(event.target.value);
                                setAmendPreview(null);
                                setAmendLines((items) => items.map((item) => item.id === line.id ? { ...item, targetKey: event.target.value, tariffId: next?.tariffs[0]?.tarif_sewa_id ?? "" } : item));
                              }}>
                                <option value="">Pilih target</option>
                                {(amendmentTargets.data ?? []).map((item: ReservationAmendTarget) => <option key={item.key} value={item.key}>{item.label}</option>)}
                              </select>
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                              <label className="grid gap-1 text-[11px] font-medium">Tarif sewa
                                <select className="h-10 rounded-lg border bg-background px-2 text-xs" value={line.tariffId} disabled={!target?.tariffs.length} onChange={(event) => { setAmendPreview(null); setAmendLines((items) => items.map((item) => item.id === line.id ? { ...item, tariffId: event.target.value } : item)); }}>
                                  <option value="">Pilih tarif</option>
                                  {(target?.tariffs ?? []).map((item) => <option key={item.tarif_sewa_id} value={item.tarif_sewa_id}>{item.nama} · {money(item.nominal)} / {item.durasi_nilai} {item.durasi_unit}</option>)}
                                </select>
                              </label>
                              <label className="grid gap-1 text-[11px] font-medium">Jumlah
                                <Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => { setAmendPreview(null); setAmendLines((items) => items.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item)); }} />
                              </label>
                            </div>
                            <label className="grid gap-1 text-[11px] font-medium">Catatan (opsional)
                              <Input value={line.note} onChange={(event) => { setAmendPreview(null); setAmendLines((items) => items.map((item) => item.id === line.id ? { ...item, note: event.target.value } : item)); }} placeholder="Catatan item" />
                            </label>
                            <div className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-[10px]">
                              <span className="text-muted-foreground">{tariff ? "Tarif dasar " + money(tariff.nominal) + " × " + (Number.isFinite(quantity) ? quantity : 0) : "Tarif belum dipilih"}</span>
                              <strong>{tariff && Number.isFinite(quantity) && quantity > 0 ? money(tariff.nominal * quantity) : "—"}</strong>
                            </div>
                          </div>
                        );
                      })}
                      <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => { setAmendPreview(null); setAmendLines((items) => [...items, { id: createClientId(), targetKey: "", tariffId: "", quantity: "1", note: "" }]); }}>
                        + Tambah rincian
                      </Button>
                      <div className="rounded-xl border bg-primary/[0.035] p-3">
                        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Total sebelumnya</span><strong>{formatReservationMoney(totalValue, primaryCurrency)}</strong></div>
                        {amendPreview ? <>
                          <div className="mt-1 flex items-center justify-between text-xs"><span className="text-muted-foreground">Total baru (harga server)</span><strong>{money(amendPreview.total_after)}</strong></div>
                          <div className="mt-1 flex items-center justify-between text-xs"><span className="text-muted-foreground">Perubahan</span><strong className={amendPreview.delta > 0 ? "text-amber-700" : amendPreview.delta < 0 ? "text-emerald-700" : ""}>{amendPreview.delta > 0 ? "+" : ""}{money(amendPreview.delta)}</strong></div>
                          <div className="mt-3 space-y-1 border-t pt-2">
                            {amendPreview.lines.map((line, index) => <div key={index} className="flex items-center justify-between gap-3 text-[10px]"><span className="min-w-0 truncate text-muted-foreground">Rincian {index + 1} · {line.diskon_persen_snapshot > 0 || line.nominal_diskon_snapshot > 0 ? "Promo diterapkan" : "Harga normal"}</span><strong className="shrink-0">{money(line.unit_price)} × {line.jumlah}</strong></div>)}
                          </div>
                          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">Preview server berhasil. Harga dan identitas promo akan dicocokkan ulang sebelum commit.</p>
                        </> : <>
                          <div className="mt-1 flex items-center justify-between text-xs"><span className="text-muted-foreground">Estimasi tarif dasar</span><strong>{money(amendmentEstimatedTotal)}</strong></div>
                          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">Tinjau perubahan untuk mendapatkan harga efektif termasuk promosi aktif dan validasi kapasitas dari server.</p>
                        </>}
                      </div>
                      <label className="grid gap-1 text-xs font-medium">Alasan perubahan
                        <Input value={amendReason} onChange={(event) => setAmendReason(event.target.value)} placeholder="Contoh: pelanggan mengganti jumlah dan pilihan barang" maxLength={500} />
                      </label>
                    </div>
                    <DrawerFooter>
                      {!amendPreview ? (
                        <Button className="h-11 rounded-xl" disabled={previewMutation.isPending || amendMutation.isPending || amendLines.length === 0 || amendmentTargets.isPending} onClick={() => previewMutation.mutate()}>
                          {previewMutation.isPending ? <><Loader2 className="size-4 animate-spin" /> Memeriksa harga & kapasitas…</> : "Tinjau perubahan"}
                        </Button>
                      ) : (
                        <>
                          <Button className="h-11 rounded-xl" disabled={amendMutation.isPending || !amendReason.trim()} onClick={() => amendMutation.mutate()}>
                            {amendMutation.isPending ? <><Loader2 className="size-4 animate-spin" /> Menyimpan perubahan…</> : "Konfirmasi perubahan"}
                          </Button>
                          <Button type="button" variant="outline" className="h-10 rounded-xl" disabled={amendMutation.isPending || previewMutation.isPending} onClick={() => previewMutation.mutate()}>Perbarui preview</Button>
                        </>
                      )}
                      <p className="px-2 text-center text-[10px] text-muted-foreground">Harga snapshot lama tetap berlaku sampai perubahan ini berhasil dikonfirmasi.</p>
                      <DrawerClose asChild><Button variant="outline" className="h-11 rounded-xl" disabled={amendMutation.isPending}>Batal</Button></DrawerClose>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              </div>
            )}
            {canOpenLinkedRental && linkedRental.data && (
              <div className="mb-3 flex flex-col gap-4 rounded-2xl border bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-emerald-950/15">
                <div className="min-w-0">
                  <p className="font-semibold">Penyewaan sudah dibuat</p>
                  <p className="mt-1 text-sm text-muted-foreground">{linkedRental.data.nomor_penyewaan} · status {linkedRental.data.status}</p>
                </div>
                <Button asChild variant="outline" className="h-11 shrink-0 rounded-xl px-5">
                  <Link to={paths.penyewaan + "/" + linkedRental.data.penyewaan_id}>
                    Buka Penyewaan <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            )}
            {canCancel && (
              <Drawer open={cancelOpen} onOpenChange={setCancelOpen}>
                <DrawerTrigger asChild>
                  <Button variant="outline" className="h-11 w-full rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:w-auto">
                    <X className="size-4" /> Batalkan Reservasi
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="rounded-t-3xl">
                  <DrawerHeader className="pb-3 text-left">
                    <div className="mx-auto mb-2 grid size-14 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/35 dark:text-rose-300">
                      <X className="size-7" />
                    </div>
                    <DrawerTitle className="text-xl">Batalkan Reservasi {reservation.nomor_reservasi}?</DrawerTitle>
                    <DrawerDescription>
                      Reservasi yang sudah memiliki kapasitas terkunci akan melepaskan kapasitas tersebut setelah pembatalan berhasil. Riwayat reservasi tetap disimpan.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="space-y-3 px-4 pb-3">
                    <Label htmlFor="cancel-reason">Alasan pembatalan</Label>
                    <Input
                      id="cancel-reason"
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Contoh: pelanggan membatalkan kebutuhan"
                      disabled={busy}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <DrawerFooter>
                    <Button
                      disabled={busy || cancelReason.trim().length === 0}
                      className="h-12 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
                      onClick={() => {
                        cancelMutation.mutate();
                        setCancelOpen(false);
                      }}
                    >
                      {cancelMutation.isPending ? "Membatalkan…" : "Batalkan Reservasi"}
                    </Button>
                    <DrawerClose asChild>
                      <Button variant="outline" className="h-12 rounded-xl" disabled={busy}>Kembali</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            )}


          </CardContent>
        </Card>
      )}

      <section className="grid gap-5 lg:grid-cols-[1.35fr_.8fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Penyewa & Periode</CardTitle>
            <p className="text-xs text-muted-foreground">Data Reservasi sebelum masuk ke proses berikutnya.</p>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <InfoBlock icon={UserRound} label="Penyewa" value={reservation.penyewa_nama ?? "Penyewa tidak ditemukan"} />
            <InfoBlock icon={CalendarDays} label="Periode" value={`${formatReservationDate(reservation.mulai_reservasi)} – ${formatReservationDate(reservation.selesai_reservasi)}`} />
            <InfoBlock icon={FileText} label="Permintaan sumber" value={reservation.nomor_permintaan ?? "Tidak ada permintaan sumber"} />
            <InfoBlock icon={Clock3} label="Dibuat" value={formatReservationDateTime(reservation.created_at)} />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Reservasi & Penguncian Stok</CardTitle>
            <p className="text-xs text-muted-foreground">Penguncian stok bukan Penetapan Unit fisik.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">Penguncian Stok</p>
              <div className="mt-2"><StockLockBadge status={reservation.stock_lock_status} /></div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">Unit Barang</p>
              <p className="mt-1 text-sm font-medium">Belum menjadi Penetapan Unit pada Reservasi.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_.8fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Items & Price Snapshot</CardTitle>
            <p className="text-xs text-muted-foreground">Nilai di sini mengikuti transaction snapshot, bukan menghitung ulang harga katalog.</p>
          </CardHeader>
          <CardContent>
            {reservation.lines.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada detail reservasi.</div>
            ) : (
              <div className="space-y-3">
                {reservation.lines.map((line) => (
                  <div key={line.detail_reservasi_id} className="rounded-2xl border p-4">
                    <div className="flex items-start gap-3">
                      <ReservationItemVisual variant="tent" compact className="size-16 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{line.barang_nama ?? line.varian_nama ?? line.paket_nama ?? "Target tidak ditemukan"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{line.varian_nama ?? line.paket_nama ?? "Detail barang"}</p>
                          </div>
                          <span className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold tabular-nums">× {formatQuantity(line.jumlah)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-3">
                      <InfoBlock label="Harga/unit" value={formatReservationMoney(line.unit_price, line.currency_code)} compact />
                      <InfoBlock label="Subtotal" value={formatReservationMoney(line.subtotal, line.currency_code)} compact />
                      <InfoBlock label="Catatan" value={line.catatan ?? "—"} compact />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Separator className="my-5" />
            <div className="flex items-end justify-between gap-3">
              <div><p className="text-xs text-muted-foreground">Total snapshot</p><p className="mt-1 text-sm text-muted-foreground">{primaryCurrency}</p></div>
              <p className="text-2xl font-bold tracking-tight">{formatReservationMoney(totalValue, primaryCurrency)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pembayaran</CardTitle>
            <p className="text-xs text-muted-foreground">Pembayaran tetap dikelola oleh Keuangan.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-muted/40 p-4">
              <p className="text-sm font-medium">Keputusan pembayaran dilakukan pada menu Keuangan</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Halaman ini tidak membuat, mengubah, atau menyimpulkan status pembayaran.</p>
            </div>
            <div className="rounded-xl border p-4 text-sm">
              <p className="text-xs text-muted-foreground">Nilai Reservasi</p>
              <p className="mt-1 font-semibold">{formatReservationMoney(totalValue, primaryCurrency)}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Activity History</CardTitle>
            <p className="text-xs text-muted-foreground">Hanya event yang memiliki source timestamp ditampilkan.</p>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Belum ada event historis yang dapat ditampilkan.</div>
            ) : (
              <div className="space-y-0">
                {events.map((event, index) => {
                  const Icon = event.icon;
                  return (
                    <div key={`${event.label}-${event.date}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="grid size-8 place-items-center rounded-full border bg-background text-primary"><Icon className="size-3.5" /></span>
                        {index < events.length - 1 && <span className="my-1 h-full min-h-8 w-px bg-border" />}
                      </div>
                      <div className="pb-5">
                        <p className="text-sm font-medium">{event.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatReservationDateTime(event.date)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Batas Pengelolaan Data</CardTitle>
            <p className="text-xs text-muted-foreground">Context agar action tetap berada pada domain yang benar.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <BoundaryRow title="Reservasi" value="Fakta Reservasi" active />
            <BoundaryRow title="Inventaris" value="Data Unit Barang" />
            <BoundaryRow title="Penyewaan" value="Usage truth" />
            <BoundaryRow title="Keuangan" value="Money truth" />
            <BoundaryRow title="Pemeriksaan" value="Condition truth" />
          </CardContent>
        </Card>
      </section>

      {reservation.permintaan_sewa_id && (
        <Card className="border-primary/10 bg-primary/[0.025] shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Permintaan sumber</p>
              <p className="mt-1 text-xs text-muted-foreground">Kembali ke konteks kebutuhan awal sebelum reservasi dibuat.</p>
            </div>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to={paths.permintaan + "/" + reservation.permintaan_sewa_id}>
                {reservation.nomor_permintaan ?? "Buka Permintaan"} <ChevronRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Alert className="border-primary/10 bg-primary/[0.03]">
        <ShieldCheck className="size-4" />
        <AlertTitle>{capabilities.mutation ? "Aksi tersedia" : "Mode baca"}</AlertTitle>
        <AlertDescription>{capabilities.reason}</AlertDescription>
      </Alert>

      <div className="fixed inset-x-2 bottom-3 z-40 rounded-2xl border bg-background/95 p-2 shadow-[0_14px_44px_rgba(20,40,30,.16)] backdrop-blur-md lg:hidden">
        <div className="grid gap-2">
          {canPrepare && (
            <Button asChild className="h-11 rounded-xl">
              <Link to={paths.penyewaanWalkIn + "?reservasi_id=" + encodeURIComponent(reservation.reservasi_id)}>Lanjutkan Penyewaan <ArrowRight className="size-4" /></Link>
            </Button>
          )}
          {canOpenLinkedRental && linkedRental.data && (
            <Button asChild variant="outline" className="h-11 rounded-xl">
              <Link to={paths.penyewaan + "/" + linkedRental.data.penyewaan_id}>Buka Penyewaan <ArrowRight className="size-4" /></Link>
            </Button>
          )}
          {canConfirm && (
            <Button className="h-11 rounded-xl" onClick={() => confirmMutation.mutate()} disabled={busy}>
              {confirmMutation.isPending ? "Mengonfirmasi…" : "Konfirmasi Reservasi"}
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" className="h-11 rounded-xl border-rose-200 text-rose-700" onClick={() => setCancelOpen(true)} disabled={busy}>
              Batalkan Reservasi
            </Button>
          )}
          {!canPrepare && !canConfirm && !canCancel && (
            <Button asChild variant="ghost" className="h-11 rounded-xl">
              <Link to={paths.reservasi}>Kembali ke Reservasi</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  label,
  value,
  compact = false,
}: {
  icon?: typeof UserRound;
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-1" : "flex items-start gap-3")}>
      {!compact && Icon ? (
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-sm font-medium", !compact && "leading-5")}>{value}</p>
      </div>
    </div>
  );
}

function BoundaryRow({ title, value, active = false }: { title: string; value: string; active?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-xl border p-3", active && "border-primary/20 bg-primary/[0.035]")}>
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{value}</p></div>
      {active ? <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" aria-label="Domain aktif" /> : <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" />}
    </div>
  );
}

ReservationShow.displayName = "ReservationShow";
