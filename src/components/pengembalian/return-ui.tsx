import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  History,
  Info,
  QrCode,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { ReturnQueueItem, ReturnUnitRow, ReturnWorkspace } from "@/features/pengembalian";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { formatReturnDateTime, semanticReturnLabel } from "@/features/pengembalian";

export type ReturnDueState = ReturnQueueItem["due_state"];

const dueConfig: Record<ReturnDueState, { label: string; className: string; icon: typeof Clock3 }> = {
  not_due: {
    label: "Belum jatuh tempo",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
    icon: Clock3,
  },
  due: {
    label: "Sudah jatuh tempo",
    className: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200",
    icon: AlertCircle,
  },
  late_within_tolerance: {
    label: "Masih dalam toleransi",
    className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    icon: Clock3,
  },
  tolerance_expired: {
    label: "Toleransi lewat",
    className: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    icon: ShieldAlert,
  },
  returned: {
    label: "Sudah dikembalikan",
    className: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
    icon: CheckCircle2,
  },
};

export function ReturnDueBadge({ state }: { state: ReturnDueState }) {
  const config = dueConfig[state] ?? dueConfig.not_due;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={"gap-1.5 rounded-full px-2.5 py-1 font-medium " + config.className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}

export function ReturnProgress({
  returned,
  total,
  outstanding,
  compact = false,
}: {
  returned: number;
  total: number;
  outstanding?: number;
  compact?: boolean;
}) {
  const safeTotal = Math.max(total, 0);
  const percent = safeTotal === 0 ? 0 : Math.min(100, Math.round((returned / safeTotal) * 100));
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={compact ? "text-sm font-semibold" : "text-lg font-bold tracking-tight"}>
            <span>{returned} / {safeTotal}</span> unit {compact ? "kembali" : "dikembalikan"}
          </p>
          {typeof outstanding === "number" ? (
            <p className="text-xs text-muted-foreground">{outstanding} unit masih outstanding</p>
          ) : null}
        </div>
        <span className="text-xs font-medium text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: percent + "%" }} />
      </div>
    </div>
  );
}

export function ReturnQueueCard({
  item,
  href,
  onOpen,
  tone = "bg-card",
}: {
  item: ReturnQueueItem;
  href: string;
  onOpen?: () => void;
  tone?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const initials = (item.penyewa_nama ?? "P").trim().slice(0, 2).toUpperCase();
  const isCompleted = item.rental_status === "completed";

  return (
    <Card className={`overflow-hidden rounded-[20px] border-border/75 ${tone} shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition hover:-translate-y-px`}>
      <CardContent className="p-0">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_36px] items-start gap-3 p-3.5">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/[0.08] text-sm font-bold text-primary">
            {initials}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[16px] font-semibold leading-5">{item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p>
              <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium">
                {semanticReturnLabel(item.rental_status)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.nomor_penyewaan}</p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full bg-muted/70"
            aria-label={expanded ? "Tutup detail pengembalian" : "Buka detail pengembalian"}
            onClick={() => setExpanded((value) => !value)}
          >
            <ArrowRight className={expanded ? "size-4 rotate-90 transition-transform" : "size-4 -rotate-45 transition-transform"} />
          </Button>
        </div>

        <div className="grid grid-cols-3 divide-x border-y border-border/60 bg-background/70">
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Jadwal kembali</p>
            <p className="mt-1 truncate text-[13px] font-semibold">{formatReturnDateTime(item.jadwal_kembali)}</p>
          </div>
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Progress</p>
            <p className="mt-1 truncate text-[13px] font-semibold">{item.returned_unit_count}/{item.total_unit_count} unit</p>
            <p className="truncate text-[11px] text-muted-foreground">{item.outstanding_unit_count} outstanding</p>
          </div>
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Toleransi</p>
            <p className="mt-1 truncate text-[13px] font-semibold">{formatReturnDateTime(item.tolerance_deadline)}</p>
          </div>
        </div>

        {expanded ? (
          <div className="space-y-3 border-t border-border/60 p-3.5">
            <ReturnProgress
              returned={item.returned_unit_count}
              total={item.total_unit_count}
              outstanding={item.outstanding_unit_count}
              compact
            />

            <RentalTimingSummary
              scheduleAt={item.jadwal_kembali}
              toleranceDeadline={item.tolerance_deadline}
              compact
              refreshMs={30_000}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <ReturnDueBadge state={item.due_state} />
              <Button asChild className="min-h-10 rounded-xl px-4">
                <a href={href} onClick={() => onOpen?.()}>
                  {isCompleted ? "Lihat Pengembalian" : "Proses Pengembalian"}
                  <ArrowRight />
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <ReturnDueBadge state={item.due_state} />
            <span className="text-xs text-muted-foreground">Buka untuk detail</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReturnUnitCard({
  unit,
  selected,
  disabled,
  onChange,
}: {
  unit: ReturnUnitRow;
  selected: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const canSelect = !unit.returned && unit.unit_status === "rented";
  return (
    <label
      className={[
        "flex w-full min-w-0 box-border items-start gap-3 rounded-2xl border p-4 outline-none transition overflow-hidden",
        canSelect ? "cursor-pointer hover:bg-accent/30 focus-within:ring-2 focus-within:ring-ring" : "opacity-70",
        selected ? "border-primary/50 bg-primary/[0.03]" : "border-border/80 bg-card",
      ].join(" ")}
    >
      <Checkbox
        checked={selected}
        disabled={disabled || !canSelect}
        onCheckedChange={(value) => onChange(value === true)}
        aria-label={"Pilih unit " + unit.kode_unit}
        className="mt-1"
      />
      <div className="grid size-12 shrink-0 place-items-center rounded-2xl border bg-muted/40 text-primary">
        <Smartphone className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">{unit.kode_unit}</p>
            <p className="truncate text-sm text-muted-foreground">
              {unit.barang_nama ?? "Barang tidak ditemukan"}
              {unit.varian_nama ? " · " + unit.varian_nama : ""}
            </p>
          </div>
          <Badge variant={unit.returned ? "outline" : "secondary"} className="w-fit rounded-full">
            {unit.returned ? "Sudah diterima" : semanticReturnLabel(unit.unit_status)}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {unit.returned ? <span>Diterima {formatReturnDateTime(unit.received_at)}</span> : <span>Menunggu diterima</span>}
          {unit.inspection_status ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Pemeriksaan: {semanticReturnLabel(unit.inspection_status)}</span>
            </>
          ) : null}
        </div>
      </div>
    </label>
  );
}

export function ReturnHistoryTimeline({ workspace }: { workspace: ReturnWorkspace }) {
  if (!workspace.returnRecords.length) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
        <History className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 font-medium">Belum ada pengembalian tercatat</p>
        <p className="mt-1 text-sm text-muted-foreground">Riwayat akan muncul setelah pengembalian dicatat.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {workspace.returnRecords.map((record, index) => (
        <div key={record.pengembalian_id} className="relative flex gap-3">
          <div className="flex w-5 flex-col items-center">
            <div className="mt-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3.5" aria-hidden="true" />
            </div>
            {index < workspace.returnRecords.length - 1 ? <div className="mt-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="mb-4 min-w-0 flex-1 rounded-2xl border bg-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{record.nomor_pengembalian}</p>
                <p className="text-xs text-muted-foreground">{formatReturnDateTime(record.dimulai_at)}</p>
              </div>
              <Badge variant="outline" className="w-fit rounded-full">{semanticReturnLabel(record.status)}</Badge>
            </div>
            <Separator className="my-3" />
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div><p className="text-[11px] text-muted-foreground">Unit diterima</p><p className="mt-1 font-medium">{record.detailIds.length} unit</p></div>
              <div><p className="text-[11px] text-muted-foreground">Admin</p><p className="mt-1 font-medium">{record.diproses_by_admin_id}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Catatan</p><p className="mt-1 font-medium">{record.catatan ?? "—"}</p></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReturnStateNotice({
  tone,
  title,
  children,
  actionLabel,
  onAction,
}: {
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  children: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? Clock3 : tone === "danger" ? ShieldAlert : Info;
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30"
          : "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30";
  return (
    <Alert className={className}>
      <Icon className="size-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>{children}</p>
        {actionLabel && onAction ? (
          <Button variant="outline" size="sm" className="w-fit rounded-xl" onClick={onAction}>{actionLabel}</Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function ReturnConfirmationDialog({
  open,
  onOpenChange,
  workspace,
  selectedUnits,
  note,
  onNoteChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: ReturnWorkspace;
  selectedUnits: ReturnUnitRow[];
  note: string;
  onNoteChange: (value: string) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Konfirmasi Pengembalian</DialogTitle>
          <DialogDescription>Pastikan data berikut sudah benar sebelum mencatat unit yang benar-benar diterima.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-[11px] text-muted-foreground">Penyewaan</p><p className="mt-1 font-semibold">{workspace.rental.nomor_penyewaan}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Penyewa</p><p className="mt-1 font-semibold">{workspace.renter?.nama_lengkap ?? "—"}</p></div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground">Unit yang diterima · {selectedUnits.length}</p>
            <div className="mt-2 space-y-2">
              {selectedUnits.map((unit) => (
                <div key={unit.unit_barang_id} className="flex items-center gap-3 rounded-xl border p-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                    <Smartphone className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">{unit.kode_unit}</p>
                    <p className="truncate text-xs text-muted-foreground">{unit.barang_nama ?? "Barang"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="return-confirm-note" className="text-xs font-semibold">Catatan penerimaan <span className="font-normal text-muted-foreground">(opsional)</span></label>
            <Textarea id="return-confirm-note" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Catatan serah-terima / penerimaan" disabled={pending} />
          </div>

          <ReturnStateNotice tone="info" title="Setelah pengembalian dicatat">
            Unit yang diterima masuk ke tahap pemeriksaan. Pengembalian tidak otomatis membuat unit menjadi Siap Disewakan dan tidak mengubah jadwal penyewaan.
          </ReturnStateNotice>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={pending}>Kembali</Button>
            <Button className="h-11 rounded-xl" onClick={onConfirm} disabled={pending || selectedUnits.length === 0}>
              {pending ? "Mencatat pengembalian…" : "Terima Pengembalian"}
              {!pending ? <Check /> : null}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnQrDialog({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "active" | "denied" | "unsupported">("idle");
  const [manual, setManual] = useState("");
  const [scanMessage, setScanMessage] = useState("Arahkan kamera ke QR code unit.");

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unsupported");
        return;
      }
      setCameraState("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (window as typeof window & {
          BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };
        }).BarcodeDetector;
        if (!Detector) {
          setCameraState("unsupported");
          setScanMessage("Kamera aktif. Browser ini belum menyediakan QR decoding otomatis. Gunakan kode QR secara manual.");
          return;
        }
        setCameraState("active");
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue?.trim();
            if (value) {
              stopCamera();
              onResolved(value);
              return;
            }
          } catch {
            // Keep camera running; manual fallback remains available.
          }
          rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } catch {
        setCameraState("denied");
        setScanMessage("Kamera tidak dapat diakses. Izinkan kamera atau gunakan kode QR manual.");
      }
    };
    void start();
    return () => stopCamera();
  }, [open, onResolved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-3xl p-0 sm:max-w-lg">
        <div className="border-b px-5 py-4">
          <DialogTitle>Pindai QR Unit</DialogTitle>
          <DialogDescription>QR hanya cara cepat menemukan unit. Validasi penyewaan tetap dilakukan oleh sistem.</DialogDescription>
        </div>

        <div className="p-5">
          <div className="relative overflow-hidden rounded-3xl bg-slate-950">
            <div className="aspect-[4/3]">
              <video ref={videoRef} muted playsInline className="size-full object-cover" aria-label="Pratinjau kamera pemindai QR" />
            </div>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="size-48 rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,.45)]" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-slate-950/70 px-4 py-3 text-xs text-white backdrop-blur">
              <Camera className="size-4" aria-hidden="true" />
              {cameraState === "starting" ? "Mengaktifkan kamera…" : scanMessage}
            </div>
          </div>

          {cameraState === "denied" ? (
            <ReturnStateNotice tone="warning" title="Kamera tidak tersedia">
              Izinkan akses kamera untuk memindai QR. Anda tetap dapat memasukkan kode QR secara manual tanpa mengubah penyewaan.
            </ReturnStateNotice>
          ) : null}
          {cameraState === "unsupported" ? (
            <ReturnStateNotice tone="info" title="Masukkan kode QR manual">
              Browser ini belum mendukung QR decoding otomatis pada halaman ini. Anda tetap dapat memasukkan kode QR unit secara manual.
            </ReturnStateNotice>
          ) : null}

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            atau gunakan manual
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <Input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Kode QR unit"
              aria-label="Kode QR unit"
              onKeyDown={(event) => {
                if (event.key === "Enter" && manual.trim()) {
                  onResolved(manual.trim());
                  onOpenChange(false);
                }
              }}
            />
            <Button type="button" className="rounded-xl" disabled={!manual.trim()} onClick={() => {
              onResolved(manual.trim());
              onOpenChange(false);
            }}>
              Cari
            </Button>
          </div>

          <Button type="button" variant="ghost" className="mt-2 w-full rounded-xl" onClick={() => {
            stopCamera();
            onOpenChange(false);
          }}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnWorkspaceHeader({
  workspace,
  dueState,
}: {
  workspace: ReturnWorkspace;
  dueState: ReturnDueState;
}) {
  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl border bg-primary/5 text-primary sm:size-16">
              <QrCode className="size-7" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Proses Pengembalian</p>
              <h1 className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">{workspace.rental.nomor_penyewaan}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {workspace.renter?.nama_lengkap ?? "Penyewa tidak ditemukan"}
                {workspace.renter?.nomor_telepon ? " · " + workspace.renter.nomor_telepon : ""}
              </p>
            </div>
          </div>
          <ReturnDueBadge state={dueState} />
        </div>
      </CardContent>
    </Card>
  );
}

export function SuccessReturnPanel({
  workspace,
  returnNumber,
  returnedCount,
  receivedAt,
  onOpenDetail,
  onBack,
}: {
  workspace: ReturnWorkspace;
  returnNumber: string;
  returnedCount: number;
  receivedAt: string;
  onOpenDetail: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card className="overflow-hidden shadow-sm">
        <CardContent className="flex min-h-[30rem] flex-col items-center justify-center gap-5 p-8 text-center sm:p-10">
          <div className="grid size-20 place-items-center rounded-full bg-primary/10 ring-8 ring-primary/[0.04] text-primary">
            <Check className="size-10" strokeWidth={2.5} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pengembalian Berhasil Dicatat</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {returnedCount} unit diterima. Unit sekarang masuk tahap pemeriksaan.
            </p>
          </div>
          <div className="w-full max-w-md rounded-2xl border bg-muted/20 p-4 text-left">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-[11px] text-muted-foreground">No. Pengembalian</p><p className="mt-1 font-semibold">{returnNumber}</p></div>
              <div><p className="text-[11px] text-muted-foreground">No. Penyewaan</p><p className="mt-1 font-semibold">{workspace.rental.nomor_penyewaan}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Unit diterima</p><p className="mt-1 font-semibold">{returnedCount} unit</p></div>
              <div><p className="text-[11px] text-muted-foreground">Waktu penerimaan</p><p className="mt-1 font-semibold">{formatReturnDateTime(receivedAt)}</p></div>
            </div>
          </div>
          <ReturnStateNotice tone="info" title="Langkah berikutnya">
            Pengembalian sudah tercatat. Periksa unit sekarang agar alur berlanjut tanpa menunggu jadwal atau timer.
          </ReturnStateNotice>
          <div className="w-full max-w-md space-y-2 text-left">
            {workspace.units
              .filter((unit) => unit.returned && unit.detail_pengembalian_id)
              .map((unit) => (
                <Link
                  key={unit.detail_pengembalian_id}
                  to={"/pemeriksaan/" + unit.detail_pengembalian_id}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>
                    <span className="block font-semibold">{unit.kode_unit}</span>
                    <span className="block text-xs text-muted-foreground">Periksa Kondisi</span>
                  </span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ))}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="h-11 min-w-44 rounded-xl" onClick={onOpenDetail}>Lihat Detail Pengembalian</Button>
            <Button variant="outline" className="h-11 rounded-xl" onClick={onBack}>Kembali ke Daftar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
