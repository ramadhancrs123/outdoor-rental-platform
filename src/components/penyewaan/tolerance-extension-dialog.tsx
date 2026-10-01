import { useState } from "react";
import { Clock3, History } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extendRentalTolerance } from "@/features/penyewaan/service";
import { formatRentalDateTime } from "@/features/penyewaan/utils";

export type ToleranceHistoryItem = {
  riwayat_toleransi_penyewaan_id: string;
  tolerance_sebelum: string;
  tolerance_sesudah: string;
  tambahan_menit: number;
  alasan: string;
  actor_akun_admin_id: string;
  actor_nama_tampilan?: string | null;
  occurred_at: string;
};

type Props = {
  usahaId: string;
  penyewaanId: string;
  currentDeadline: string | null;
  history: ToleranceHistoryItem[];
  onSaved: () => void;
};

const presets = [
  { minutes: 30, label: "+30 menit" },
  { minutes: 60, label: "+1 jam" },
  { minutes: 120, label: "+2 jam" },
  { minutes: 180, label: "+3 jam" },
];

export function ToleranceExtensionDialog({
  usahaId,
  penyewaanId,
  currentDeadline,
  history,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function save() {
    if (!reason.trim()) {
      toast.error("Catatan admin wajib diisi.");
      return;
    }
    if (!Number.isInteger(minutes) || minutes <= 0) {
      toast.error("Tambahan waktu harus lebih dari 0 menit.");
      return;
    }

    setPending(true);
    try {
      await extendRentalTolerance(usahaId, penyewaanId, {
        additionalMinutes: minutes,
        reason: reason.trim(),
      });
      toast.success("Batas toleransi diperpanjang.");
      setReason("");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tambahan toleransi gagal disimpan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button className="min-h-10 rounded-xl" onClick={() => setOpen(true)}>
        <Clock3 className="size-4" />
        Tambah Toleransi
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Waktu Toleransi</DialogTitle>
            <DialogDescription>
              Jadwal kembali tetap sama. Hanya batas toleransi yang diperpanjang dan akan tercatat di log admin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Batas saat ini</p>
              <p className="mt-1 text-lg font-bold">{formatRentalDateTime(currentDeadline)}</p>
            </div>

            <div>
              <Label>Tambahan waktu</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {presets.map((preset) => (
                  <Button
                    key={preset.minutes}
                    type="button"
                    variant={minutes === preset.minutes ? "default" : "outline"}
                    className="min-h-11 rounded-xl"
                    onClick={() => setMinutes(preset.minutes)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                  inputMode="numeric"
                  className="h-11"
                  aria-label="Tambahan menit custom"
                />
                <span className="shrink-0 text-sm text-muted-foreground">menit</span>
              </div>
            </div>

            <div>
              <Label htmlFor="tolerance-reason">Catatan admin *</Label>
              <Textarea
                id="tolerance-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: kendaraan penyewa mengalami kendala di perjalanan."
                className="mt-2 min-h-28 rounded-2xl"
                maxLength={2000}
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">{reason.length}/2000</p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">Yang berubah</p>
              <p className="mt-1">
                Batas toleransi bertambah {minutes} menit. Jadwal kembali resmi tidak berubah.
              </p>
            </div>

            {history.length > 0 ? (
              <div className="rounded-2xl border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  onClick={() => setShowHistory((value) => !value)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <History className="size-4" />
                    Riwayat Toleransi
                  </span>
                  <Badge variant="secondary">{history.length}</Badge>
                </button>
                {showHistory ? (
                  <div className="space-y-3 border-t p-4">
                    {history.map((item) => (
                      <div key={item.riwayat_toleransi_penyewaan_id} className="rounded-xl bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">
                            {formatRentalDateTime(item.tolerance_sebelum)} → {formatRentalDateTime(item.tolerance_sesudah)}
                          </p>
                          <Badge variant="outline">+{item.tambahan_menit} menit</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.alasan}</p>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Admin {item.actor_nama_tampilan ?? item.actor_akun_admin_id} · {formatRentalDateTime(item.occurred_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)} disabled={pending}>Batal</Button>
              <Button className="rounded-xl" onClick={() => void save()} disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan Tambahan Toleransi"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
