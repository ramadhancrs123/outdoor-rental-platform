import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateRentalPolicy } from "@/features/penyewaan/service";

type Props = {
  usahaId: string;
  currentToleranceHours: number;
  currentLateFeeEnabled: boolean;
  currentLateFeePerHour: number;
  onSaved: () => void;
};

export function RentalPolicyDialog({
  usahaId,
  currentToleranceHours,
  currentLateFeeEnabled,
  currentLateFeePerHour,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tolerance, setTolerance] = useState(String(currentToleranceHours));
  const [lateFeeEnabled, setLateFeeEnabled] = useState(currentLateFeeEnabled);
  const [lateFeePerHour, setLateFeePerHour] = useState(String(currentLateFeePerHour));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTolerance(String(currentToleranceHours));
    setLateFeeEnabled(currentLateFeeEnabled);
    setLateFeePerHour(String(currentLateFeePerHour));
  }, [open, currentToleranceHours, currentLateFeeEnabled, currentLateFeePerHour]);

  async function save() {
    const toleranceValue = Number(tolerance);
    const feeValue = Number(lateFeePerHour);
    if (!Number.isFinite(toleranceValue) || toleranceValue < 0) {
      toast.error("Batas toleransi harus berupa angka 0 atau lebih.");
      return;
    }
    if (!Number.isFinite(feeValue) || feeValue < 0) {
      toast.error("Tarif denda harus berupa angka 0 atau lebih.");
      return;
    }
    if (lateFeeEnabled && feeValue <= 0) {
      toast.error("Isi tarif denda per jam saat fitur denda diaktifkan.");
      return;
    }

    setPending(true);
    try {
      await updateRentalPolicy(usahaId, {
        defaultToleranceHours: toleranceValue,
        lateFeeEnabled,
        lateFeePerHour: feeValue,
      });
      toast.success("Aturan penyewaan tersimpan.");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aturan penyewaan gagal disimpan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" className="min-h-10 rounded-xl" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" />
        Aturan Penyewaan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Aturan Penyewaan</DialogTitle>
            <DialogDescription>
              Master ini digunakan untuk penyewaan baru. Rental yang sudah berjalan mempertahankan deadline yang sudah tercatat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <Label htmlFor="default-tolerance">Batas toleransi default</Label>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="default-tolerance"
                  type="number"
                  min="0"
                  step="0.5"
                  value={tolerance}
                  onChange={(event) => setTolerance(event.target.value)}
                  inputMode="decimal"
                  className="h-11"
                />
                <span className="text-sm text-muted-foreground">jam</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Contoh 10 = sepuluh jam setelah jadwal kembali.
              </p>
            </div>

            <div className="rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="late-fee-enabled">Denda keterlambatan</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opsional. Dihitung setelah batas toleransi terlewati.
                  </p>
                </div>
                <Switch id="late-fee-enabled" checked={lateFeeEnabled} onCheckedChange={setLateFeeEnabled} />
              </div>
              {lateFeeEnabled ? (
                <div className="mt-4">
                  <Label htmlFor="late-fee-hourly">Tarif denda per jam</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium">Rp</span>
                    <Input
                      id="late-fee-hourly"
                      type="number"
                      min="0"
                      step="1000"
                      value={lateFeePerHour}
                      onChange={(event) => setLateFeePerHour(event.target.value)}
                      inputMode="numeric"
                      className="h-11"
                    />
                    <span className="text-sm text-muted-foreground">/ jam</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-xl" onClick={() => setOpen(false)} disabled={pending}>Batal</Button>
              <Button className="rounded-xl" onClick={() => void save()} disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan Aturan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
