import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRentalMoney } from "@/features/penyewaan";
import type { RentalConsequenceReview } from "@/features/keuangan";

function consequenceLabel(value: RentalConsequenceReview["jenis_konsekuensi"]) {
  switch (value) {
    case "late_fee":
      return "Denda keterlambatan";
    case "damage":
      return "Kerusakan";
    case "loss":
      return "Kehilangan";
    case "missing_component":
      return "Komponen kurang";
    default:
      return "Lainnya";
  }
}

function statusMeta(value: RentalConsequenceReview["status"]) {
  switch (value) {
    case "approved":
      return { label: "Sudah disetujui", icon: CheckCircle2 };
    case "rejected":
      return { label: "Tidak dibebankan", icon: CheckCircle2 };
    default:
      return { label: "Menunggu tinjauan", icon: Clock3 };
  }
}

export function RentalConsequenceList({
  items,
  title = "Potensi Tanggungan Penyewa",
}: {
  items: RentalConsequenceReview[];
  title?: string;
}) {
  if (!items.length) return null;

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Catatan ini belum menjadi pembayaran atau tagihan. Bagian Keuangan menentukan tindak lanjut akhirnya.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => {
          const meta = statusMeta(item.status);
          const Icon = meta.icon;
          const amount = item.nominal_disetujui ?? item.nominal_kandidat;
          return (
            <div key={item.evaluasi_konsekuensi_id} className="rounded-2xl border p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-9 place-items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="size-4" />
                  </span>
                  <div>
                    <p className="font-semibold">{consequenceLabel(item.jenis_konsekuensi)}</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.alasan}</p>
                  </div>
                </div>
                <Badge variant={item.status === "rejected" ? "outline" : "secondary"} className="w-fit rounded-full">
                  <Icon /> {meta.label}
                </Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Tanggung jawab</p>
                  <p className="mt-1 text-sm font-semibold">
                    {item.pihak_tanggung_jawab === "penyewa" ? "Penyewa" : item.pihak_tanggung_jawab === "usaha" ? "Usaha" : "Belum ditentukan"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nominal</p>
                  <p className="mt-1 text-sm font-semibold">
                    {amount == null ? "Belum ditentukan" : formatRentalMoney(amount, item.currency_code)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status catatan</p>
                  <p className="mt-1 text-sm font-semibold">
                    {item.status === "approved" ? "Siap ditindaklanjuti Keuangan" : item.status === "rejected" ? "Tidak dibebankan" : "Perlu ditinjau Keuangan"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
