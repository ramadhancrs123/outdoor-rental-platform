import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronRight, Clock3, FileText, History, MapPin, QrCode, Search, Wrench } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  lookupInventoryUnitByQr,
  type InventoryContext,
  type InventoryOperationalContext,
  type InventoryUnit,
  type InventoryUnitHistory,
} from "@/features/inventaris";
import {
  formatInventoryDateTime,
  inventoryEventLabel,
  inventoryStatusLabel,
  inventoryStatusVariant,
} from "@/features/inventaris";
import { paths } from "@/routes/paths";

export function InventoryStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={inventoryStatusVariant(status)} className="rounded-full px-2.5 py-1 text-[11px]">
      {inventoryStatusLabel(status)}
    </Badge>
  );
}

export function UnitIdentity({ unit, compact = false }: { unit: InventoryUnit; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Boxes className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">{unit.kode_unit}</p>
        <p className="truncate text-sm text-muted-foreground">
          {unit.barang?.nama ?? "Barang tidak ditemukan"}
          {unit.varian?.nama ? ` · ${unit.varian.nama}` : ""}
        </p>
        {!compact && unit.serial_number ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Serial {unit.serial_number}</p>
        ) : null}
      </div>
    </div>
  );
}

function getReadinessCopy(unit: InventoryUnit, operational?: InventoryOperationalContext | null) {
  switch (unit.status) {
    case "inspection_pending":
      return {
        title: "Menunggu pemeriksaan return",
        description: "Pemeriksaan terstruktur dimulai dari Pengembalian setelah unit diterima.",
        action: null,
        href: null,
        icon: CheckCircle2,
      };

    case "maintenance":
      return {
        title: "Dalam perawatan",
        description: operational?.openMaintenance.length
          ? `${operational.openMaintenance.length} pekerjaan perawatan masih terbuka.`
          : "Unit sedang berada pada state perawatan.",
        action: "Buka Perawatan",
        href: paths.perawatan + "?unit_id=" + unit.unit_barang_id,
        icon: Wrench,
      };
    case "rented":
      return {
        title: "Sedang disewa",
        description: operational?.activeRental?.nomor_penyewaan
          ? `Penyewaan aktif ${operational.activeRental.nomor_penyewaan} menggunakan unit ini.`
          : "Unit sedang disewa.",
        action: operational?.activeRental
          ? "Buka Penyewaan"
          : "Tinjau Penyewaan",
        href: operational?.activeRental
          ? paths.penyewaan + "/" + operational.activeRental.penyewaan_id
          : paths.penyewaan,
        icon: Clock3,
      };
    case "lost":
      return {
        title: "Hilang",
        description: "Unit tidak boleh diperlakukan sebagai unit siap dipakai.",
        action: null,
        href: null,
        icon: AlertTriangle,
      };
    case "damaged":
      return {
        title: "Rusak",
        description: "Kondisi fisik perlu ditangani melalui workflow Perawatan.",
        action: "Buka Perawatan",
        href: paths.perawatan + "?unit_id=" + unit.unit_barang_id,
        icon: Wrench,
      };
    case "ready":
      return {
        title: "Siap secara fisik",
        description: "Siap Disewakan menunjukkan kondisi fisik unit. Ketersediaan untuk periode sewa tetap perlu diperiksa melalui Reservasi/Penyewaan.",
        action: null,
        href: null,
        icon: CheckCircle2,
      };
    default:
      return {
        title: inventoryStatusLabel(unit.status),
        description: "Tinjau status unit dan lanjutkan melalui menu yang sesuai.",
        action: null,
        href: null,
        icon: Clock3,
      };
  }
}

export function InventoryReadinessBanner({
  unit,
  operational,
}: {
  unit: InventoryUnit;
  operational?: InventoryOperationalContext | null;
}) {
  const readiness = getReadinessCopy(unit, operational);
  const Icon = readiness.icon;

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{readiness.title}</p>
              <InventoryStatusBadge status={unit.status} />
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{readiness.description}</p>
          </div>
          {readiness.href ? (
            <Button asChild variant="outline" className="hidden shrink-0 rounded-xl sm:inline-flex">
              <Link to={readiness.href}>{readiness.action}<ArrowRight /></Link>
            </Button>
          ) : null}
        </div>
        {readiness.href ? (
          <Button asChild variant="outline" className="mt-3 w-full rounded-xl sm:hidden">
            <Link to={readiness.href}>{readiness.action}<ArrowRight /></Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function InventoryContextFacts({ operational }: { operational: InventoryOperationalContext | undefined }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card className="shadow-none">
        <CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Penetapan Unit Saat Ini</p>
          <p className="font-semibold">{operational?.currentAssignment ? "Ada penetapan unit aktif" : "Tidak ada penetapan unit aktif"}</p>
          <p className="text-xs text-muted-foreground">
            {operational?.currentAssignment
              ? "Pemakaian unit ditetapkan oleh workflow Penyewaan."
              : "Belum ada penetapan unit aktif."}
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Penyewaan Saat Ini</p>
          <p className="font-semibold">{operational?.activeRental?.nomor_penyewaan ?? "Tidak ada penyewaan aktif"}</p>
          <p className="text-xs text-muted-foreground">
            {operational?.activeRental ? "Data utama penyewaan dikelola pada menu Penyewaan." : "Tidak ada penyewaan aktif yang terbaca."}
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Pengembalian / Pemeriksaan / Perawatan</p>
          <p className="font-semibold">
            {operational?.latestReturn
              ? "Unit sudah diterima kembali"
              : operational?.latestInspection
                ? "Pemeriksaan terakhir tersedia"
                : operational?.openMaintenance.length
                  ? `${operational.openMaintenance.length} perawatan terbuka`
                  : "Belum ada fakta tambahan"}
          </p>
          <p className="text-xs text-muted-foreground">Status akhir tetap dikelola pada menu masing-masing.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function UnitHistoryTimeline({ history }: { history: InventoryUnitHistory[] }) {
  if (!history.length) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex min-h-28 items-center gap-3 p-5 text-sm text-muted-foreground">
          <History className="size-5" aria-hidden="true" />
          Belum ada riwayat unit yang dapat ditampilkan.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative space-y-1">
      {history.map((item, index) => (
        <div key={item.riwayat_unit_id} className="relative flex gap-3">
          <div className="relative flex w-7 shrink-0 justify-center">
            <span className="z-10 mt-3 size-2.5 rounded-full border-2 border-background bg-primary" />
            {index < history.length - 1 ? <span className="absolute top-5 h-full w-px bg-border" /> : null}
          </div>
          <Card className="mb-3 min-w-0 flex-1 shadow-none">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full">{inventoryEventLabel(item.jenis_kejadian)}</Badge>
                <span className="text-xs text-muted-foreground">{formatInventoryDateTime(item.terjadi_at)}</span>
              </div>
              <p className="text-sm">
                {item.status_sebelum || "—"} → {item.status_sesudah || "—"}
              </p>
              {item.lokasi_sebelum_nama || item.lokasi_sesudah_nama ? (
                <p className="text-sm text-muted-foreground">
                  <MapPin className="mr-1 inline size-3.5" aria-hidden="true" />
                  {item.lokasi_sebelum_nama ?? "—"} → {item.lokasi_sesudah_nama ?? "—"}
                </p>
              ) : null}
              {item.catatan ? <p className="text-sm leading-5 text-muted-foreground">{item.catatan}</p> : null}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

export function UnknownOutcomeNotice({
  message,
  onReconcile,
  busy = false,
}: {
  message: string;
  onReconcile: () => void;
  busy?: boolean;
}) {
  return (
    <Alert className="border-amber-400/50 bg-amber-500/[0.06]">
      <AlertTriangle className="size-4" />
      <AlertTitle>Hasil tindakan belum dapat dipastikan</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        <p className="font-medium">Perubahan sudah dikirim, tetapi hasil akhirnya belum dapat dipastikan. Jangan kirim tindakan yang sama lagi.</p>
        <Button variant="outline" className="rounded-xl" onClick={onReconcile} disabled={busy}>
          {busy ? "Memeriksa…" : "Periksa Status Tindakan"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function UnitConflictNotice({
  unit,
  reason,
}: {
  unit: InventoryUnit;
  reason: string;
}) {
  return (
    <Alert variant="destructive" className="border-destructive/40">
      <AlertTriangle className="size-4" />
      <AlertTitle>Perubahan tidak dapat diterapkan</AlertTitle>
      <AlertDescription className="space-y-2">
        <p><strong>Status saat ini:</strong> {inventoryStatusLabel(unit.status)}</p>
        <p><strong>Alasan:</strong> {reason}</p>
        <p><strong>Tindakan:</strong> muat ulang data unit dan lanjutkan sesuai status terbaru.</p>
      </AlertDescription>
    </Alert>
  );
}

export function QrLookupDialog({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: InventoryContext;
}) {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setIdentifier("");
      setError("");
    }
  }, [open]);

  const resolve = async () => {
    if (!identifier.trim()) {
      setError("Kode QR unit wajib diisi.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await lookupInventoryUnitByQr(context.usahaId, identifier);
      onOpenChange(false);
      navigate(paths.inventaris + "/" + result.unit.unit_barang_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unit tidak ditemukan.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="size-5" />Pindai / Temukan Unit</DialogTitle>
          <DialogDescription>
            QR hanya cara cepat menemukan unit. Setelah ditemukan, sistem tetap memvalidasi Usaha dan akses sebelum detail unit dibuka.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid min-h-28 place-items-center rounded-2xl border border-dashed bg-muted/30">
            <div className="text-center">
              <QrCode className="mx-auto size-9 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">Pindai QR dengan kamera bila tersedia. Sebagai alternatif, masukkan kode yang tercetak pada QR unit.</p>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              aria-label="Kode QR unit"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void resolve();
              }}
              placeholder="Masukkan kode dari QR unit"
              className="h-11 rounded-xl pl-9"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="h-11 w-full rounded-xl" onClick={() => void resolve()} disabled={loading}>
            {loading ? "Mencari Unit…" : "Temukan Unit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UnitCard({
  unit,
  href,
}: {
  unit: InventoryUnit;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="group block rounded-2xl border border-border/70 bg-card px-3 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-4"
    >
      <div className="grid grid-cols-[60px_minmax(0,1fr)] gap-3 sm:grid-cols-[64px_minmax(0,1fr)]">
        <div
          className="grid size-[60px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-primary/10 bg-primary/[0.06] text-primary sm:size-16"
          aria-label={"Pratinjau " + (unit.barang?.nama ?? "barang")}
        >
          <Boxes className="size-6" aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 pr-1">
              <p className="truncate text-[15px] font-semibold leading-5">{unit.kode_unit}</p>
              <p className="truncate text-[13px] leading-5 text-muted-foreground">
                {unit.barang?.nama ?? "Barang tidak ditemukan"}
                {unit.varian?.nama ? " · " + unit.varian.nama : ""}
              </p>
            </div>
            <InventoryStatusBadge status={unit.status} />
          </div>

          <div className="mt-2 grid gap-1.5 text-[13px] leading-5">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Lokasi</span>
              </span>
              <span className="min-w-0 truncate text-right font-medium">
                {unit.lokasi?.nama ?? "Belum ditentukan"}
              </span>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Kondisi</span>
              </span>
              <span className="min-w-0 truncate text-right font-medium">
                {unit.kondisi_ringkas ?? "Belum dicatat"}
              </span>
            </div>
          </div>

          {unit.status === "rented" ? (
            <div className="mt-1.5 text-xs font-medium text-primary">Penyewaan aktif</div>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1 text-sm font-medium text-primary">
        Lihat detail
        <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

export function InventoryListSummary({
  count,
  availabilityContext,
}: {
  count: number;
  availabilityContext: "all" | "ready_now" | "rental_active" | "attention";
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{count} unit</span>
      <span aria-hidden="true">·</span>
      <span>{availabilityContext === "ready_now" ? "Siap secara fisik" : availabilityContext === "rental_active" ? "Sedang disewa" : availabilityContext === "attention" ? "Perlu perhatian" : "Semua konteks"}</span>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      <Skeleton className="h-36 rounded-2xl" />
    </div>
  );
}
