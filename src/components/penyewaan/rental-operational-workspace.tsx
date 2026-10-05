import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getOperationalReturnWorkspace, processOperationalUnitReturn, type OperationalReturnUnitState } from "@/features/pengembalian/operational";
import { formatRentalDateTime } from "@/features/penyewaan";
import { createClientId } from "@/lib/client-id";
import { paths } from "@/routes/paths";

export type RentalOperationalWorkspaceProps = {
  usahaId: string;
  penyewaanId: string;
  enabled: boolean;
  rentalStatus: string;
  onChanged?: () => Promise<void> | void;
};

type ConditionChoice = "normal" | "dirty" | "damage" | "missing_component" | "loss";

const CONDITION_OPTIONS: Array<{ value: ConditionChoice; label: string; description: string }> = [
  { value: "normal", label: "Baik", description: "Tidak ada tindakan lanjutan; unit dapat masuk readiness." },
  { value: "dirty", label: "Kotor", description: "Buat tindak lanjut pembersihan." },
  { value: "damage", label: "Rusak", description: "Buat tugas Perawatan untuk perbaikan." },
  { value: "missing_component", label: "Komponen kurang", description: "Tindak lanjuti sebagai kebutuhan Perawatan." },
  { value: "loss", label: "Hilang", description: "Tandai unit sebagai Hilang dan keluarkan dari pool penyewaan baru." },
];

function readinessLabel(state: OperationalReturnUnitState["readiness_state"]) {
  if (state === "ready") return "Siap Disewakan";
  if (state === "maintenance_required") return "Masuk Perawatan";
  if (state === "lost") return "Hilang";
  if (state === "inspection_pending") return "Menunggu Pemeriksaan";
  return "Belum Siap";
}

function buildInspection(choice: ConditionChoice) {
  switch (choice) {
    case "normal":
      return {
        hasil: "normal" as const,
        kelengkapanStatus: "complete" as const,
        keputusanOperasional: "ready_review" as const,
        catatan: null,
        findings: [],
      };
    case "dirty":
      return {
        hasil: "issue_found" as const,
        kelengkapanStatus: "complete" as const,
        keputusanOperasional: "cleaning_required" as const,
        catatan: "Unit memerlukan pembersihan setelah pengembalian.",
        findings: [{ jenis_temuan: "dirty" as const, deskripsi: "Unit diterima dalam kondisi kotor dan memerlukan pembersihan.", status_tindak_lanjut: "pending" }],
      };
    case "damage":
      return {
        hasil: "issue_found" as const,
        kelengkapanStatus: "complete" as const,
        keputusanOperasional: "maintenance_required" as const,
        catatan: "Unit memiliki kerusakan setelah pengembalian.",
        findings: [{ jenis_temuan: "damage" as const, deskripsi: "Unit diterima dengan kerusakan dan memerlukan perbaikan.", status_tindak_lanjut: "pending" }],
      };
    case "missing_component":
      return {
        hasil: "issue_found" as const,
        kelengkapanStatus: "incomplete" as const,
        keputusanOperasional: "maintenance_required" as const,
        catatan: "Komponen unit tidak lengkap saat pengembalian.",
        findings: [{ jenis_temuan: "missing_component" as const, deskripsi: "Komponen unit tidak lengkap dan perlu ditindaklanjuti.", status_tindak_lanjut: "pending" }],
      };
    case "loss":
      return {
        hasil: "issue_found" as const,
        kelengkapanStatus: "incomplete" as const,
        keputusanOperasional: "unavailable" as const,
        catatan: "Unit dinyatakan hilang pada proses pengembalian.",
        findings: [{ jenis_temuan: "loss" as const, deskripsi: "Unit tidak ditemukan saat pengembalian.", status_tindak_lanjut: "pending" }],
      };
  }
}

function unitIdentity(unit: OperationalReturnUnitState) {
  return unit.kode_unit + " · " + (unit.barang_nama ?? "Barang");
}

export function RentalOperationalWorkspace({ usahaId, penyewaanId, enabled, rentalStatus, onChanged }: RentalOperationalWorkspaceProps) {
  const queryClient = useQueryClient();
  const [condition, setCondition] = useState<Record<string, ConditionChoice | undefined>>({});
  const [errorText, setErrorText] = useState("");
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const commandRef = useRef<{ key: string; requestId: string; unitId: string } | null>(null);

  const workspace = useQuery({
    queryKey: ["penyewaan", "operational-return-workspace", usahaId, penyewaanId],
    queryFn: () => getOperationalReturnWorkspace(usahaId, penyewaanId),
    enabled: enabled && Boolean(usahaId && penyewaanId),
    staleTime: 3_000,
  });

  const mutation = useMutation({
    mutationFn: async (unit: OperationalReturnUnitState) => {
      const selected = condition[unit.unit_barang_id];
      if (!selected) throw new Error("Pilih kondisi unit sebelum menerima pengembalian.");
      commandRef.current = { key: createClientId(), requestId: createClientId(), unitId: unit.unit_barang_id };
      return processOperationalUnitReturn(
        usahaId,
        {
          rentalId: penyewaanId,
          unitBarangId: unit.unit_barang_id,
          inspection: buildInspection(selected),
          expectedRentalUpdatedAt: workspace.data!.rental.updated_at,
        },
        {
          idempotencyKey: commandRef.current.key,
          requestId: commandRef.current.requestId,
        },
      );
    },
    onMutate: () => {
      setErrorText("");
      setUnknownOutcome(false);
    },
    onSuccess: async () => {
      commandRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["penyewaan", "detail", usahaId, penyewaanId] }),
        queryClient.invalidateQueries({ queryKey: ["penyewaan", "operational-return-workspace", usahaId, penyewaanId] }),
        queryClient.invalidateQueries({ queryKey: ["pengembalian", "queue", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
      ]);
      await onChanged?.();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("UNKNOWN_OUTCOME:") || message.includes("UNKNOWN_OUTCOME")) {
        setUnknownOutcome(true);
        setErrorText("Hasil pengembalian belum dapat dipastikan. Jangan mengulang tindakan sebelum status unit diverifikasi.");
        return;
      }
      setErrorText(message);
    },
  });

  const summary = useMemo(() => {
    const units = workspace.data?.operational_units ?? [];
    return {
      total: units.length,
      returned: units.filter((unit) => Boolean(unit.return)).length,
      ready: units.filter((unit) => unit.readiness_state === "ready").length,
      maintenance: units.filter((unit) => unit.readiness_state === "maintenance_required").length,
      outstanding: units.filter((unit) => !unit.return).length,
    };
  }, [workspace.data?.operational_units]);

  if (!(enabled && (rentalStatus === "active" || rentalStatus === "return_in_progress" || rentalStatus === "completed"))) {
    return null;
  }

  if (workspace.isPending) {
    return <Card data-testid="rental-operational-workspace"><CardContent className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">Memuat status operasional rental…</CardContent></Card>;
  }

  if (workspace.error || !workspace.data) {
    return (
      <Card data-testid="rental-operational-workspace">
        <CardContent className="p-4">
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>Workspace operasional belum tersedia</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{workspace.error instanceof Error ? workspace.error.message : "Status return unit belum dapat dimuat."}</span>
              <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>Muat Ulang</Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const units = workspace.data.operational_units;
  const canProcess = rentalStatus === "active" || rentalStatus === "return_in_progress";
  const allReturned = summary.total > 0 && summary.outstanding === 0;

  return (
    <section id="rental-operational" data-testid="rental-operational-workspace" className="rounded-[22px] border border-border/65 bg-card shadow-[0_8px_28px_rgba(28,67,56,.06)]">
      <div className="border-b border-border/60 px-3.5 py-3.5 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><RotateCcw className="size-4.5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Pusat Operasional</p>
              <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">Pengembalian → Kondisi → Ready</h2>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Setiap unit diproses sendiri. Unit normal tidak tertahan oleh unit lain yang perlu Perawatan.</p>
            </div>
          </div>
          <Badge variant={allReturned ? "outline" : "secondary"} className="shrink-0 rounded-full text-[9px]">
            {summary.returned}/{summary.total} kembali
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-4 divide-x rounded-2xl border bg-muted/10">
          <div className="px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Diterima</p><p className="mt-0.5 text-sm font-bold">{summary.returned}</p></div>
          <div className="px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Ready</p><p className="mt-0.5 text-sm font-bold text-emerald-700 dark:text-emerald-300">{summary.ready}</p></div>
          <div className="px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Perawatan</p><p className="mt-0.5 text-sm font-bold text-amber-700 dark:text-amber-300">{summary.maintenance}</p></div>
          <div className="px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Belum kembali</p><p className="mt-0.5 text-sm font-bold">{summary.outstanding}</p></div>
        </div>
      </div>

      {errorText ? (
        <div className="px-3.5 pt-3.5 sm:px-4">
          <Alert variant={unknownOutcome ? "destructive" : "default"}>
            <AlertTriangle className="size-4" />
            <AlertTitle>{unknownOutcome ? "Tindakan belum terverifikasi" : "Pengembalian belum diproses"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{errorText}</span>
              <Button variant="outline" size="sm" onClick={() => { setUnknownOutcome(false); setErrorText(""); void workspace.refetch(); }}>Verifikasi Status</Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="space-y-2.5 p-3.5 sm:p-4">
        {units.map((unit) => {
          const selected = condition[unit.unit_barang_id];
          const isThisMutation = mutation.isPending && commandRef.current?.unitId === unit.unit_barang_id;
          return (
            <div key={unit.unit_barang_id} className="rounded-2xl border border-border/70 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold">{unitIdentity(unit)}</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {unit.return ? `Diterima ${formatRentalDateTime(unit.return.diterima_at)}` : "Masih berada pada penyewa"}
                  </p>
                </div>
                <Badge variant={unit.return ? (unit.readiness_state === "ready" ? "outline" : "secondary") : "secondary"} className="shrink-0 rounded-full text-[9px]">
                  {unit.return ? readinessLabel(unit.readiness_state) : "Belum kembali"}
                </Badge>
              </div>

              {unit.return ? (
                <div className="mt-3 rounded-xl bg-muted/15 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-semibold">
                    {unit.readiness_state === "ready" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : unit.readiness_state === "lost" ? (
                      <AlertTriangle className="size-3.5 text-red-600" />
                    ) : (
                      <Wrench className="size-3.5 text-amber-600" />
                    )}
                    {unit.inspection ? ("Pemeriksaan: " + (unit.inspection.hasil === "normal" ? "Normal" : "Ada temuan")) : "Pemeriksaan belum tersedia"}
                  </div>
                  {unit.readiness_state === "lost" ? (
                    <div className="mt-1 space-y-1 text-[9px] leading-4 text-muted-foreground">
                      <p className="font-medium text-foreground">Unit ditandai Hilang dan tidak tersedia untuk penyewaan baru.</p>
                      <p>Tinjau Potensi Tanggungan Penyewa dari temuan kehilangan. Tidak ada pekerjaan Perawatan yang dibuat untuk kondisi ini.</p>
                    </div>
                  ) : unit.maintenance ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] leading-4 text-muted-foreground">
                      <span>Perawatan {unit.maintenance.perawatan_id.slice(0, 8).toUpperCase()} · {unit.maintenance.status}</span>
                      <Link to={paths.perawatan + "/" + unit.maintenance.perawatan_id} className="font-semibold text-primary hover:underline">Buka Perawatan</Link>
                    </div>
                  ) : unit.readiness_state === "ready" ? (
                    <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Unit sudah dikembalikan ke pool siap disewakan.</p>
                  ) : (
                    <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Unit belum memenuhi readiness dan memerlukan tinjauan lanjutan.</p>
                  )}
                </div>
              ) : canProcess ? (
                <div className="mt-3 space-y-3 rounded-xl border border-dashed p-3">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-semibold"><ClipboardCheck className="size-3.5 text-primary" />Kondisi saat diterima</div>
                    <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Pilih fakta kondisi. Sistem tidak menganggap unit normal secara otomatis.</p>
                  </div>
                  <RadioGroup value={selected ?? ""} onValueChange={(value) => setCondition((current) => ({ ...current, [unit.unit_barang_id]: value as ConditionChoice }))} className="grid gap-2 sm:grid-cols-2">
                    {CONDITION_OPTIONS.map((option) => (
                      <Label key={option.value} htmlFor={`condition-${unit.unit_barang_id}-${option.value}`} className="flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 hover:bg-accent/20">
                        <RadioGroupItem id={`condition-${unit.unit_barang_id}-${option.value}`} value={option.value} className="mt-0.5" />
                        <span className="min-w-0"><span className="block text-[10px] font-semibold">{option.label}</span><span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">{option.description}</span></span>
                      </Label>
                    ))}
                  </RadioGroup>
                  <Button
                    className="h-10 w-full rounded-xl text-xs"
                    disabled={!selected || mutation.isPending}
                    onClick={() => mutation.mutate(unit)}
                  >
                    {isThisMutation ? "Menerima & memproses unit…" : "Terima Unit + Proses Kondisi"}
                    {!isThisMutation ? <Check /> : null}
                  </Button>
                </div>
              ) : null}

              {unit.return?.catatan ? <p className="mt-2 text-[9px] text-muted-foreground">Catatan: {unit.return.catatan}</p> : null}
            </div>
          );
        })}
      </div>

      <Separator />
      <div className="flex flex-col gap-2 px-3.5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <p className="text-[10px] font-semibold">State rental</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            {allReturned ? "Semua unit sudah diterima. Readiness dihitung per unit." : summary.outstanding + " unit masih bersama penyewa."}
          </p>
        </div>
        <Button variant="outline" className="h-9 rounded-xl text-[10px]" onClick={() => void workspace.refetch()}>
          Muat status terbaru
        </Button>
      </div>
    </section>
  );
}
