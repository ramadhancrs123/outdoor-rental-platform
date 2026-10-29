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
  Package,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
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

function formatQuantity(value: string | number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? new Intl.NumberFormat("id-ID").format(numberValue) : String(value);
}

type CommandFeedback = { kind: "unknown" | "conflict" | "authorization" | "success" | "error"; message: string } | null;

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
