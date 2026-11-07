import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ClipboardCheck, Loader2, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getOperationalReturnWorkspace,
  processOperationalUnitReturns,
  type OperationalReturnUnitState,
} from "@/features/pengembalian/operational";
import { formatRentalDateTime } from "@/features/penyewaan";
import { paths } from "@/routes/paths";

export type RentalOperationalWorkspaceProps = {
  usahaId: string;
  penyewaanId: string;
  enabled: boolean;
  rentalStatus: string;
  onChanged?: () => Promise<void> | void;
};

type ConditionChoice = "normal" | "dirty" | "damage" | "missing_component" | "loss";
type BatchProgress = { index: number; total: number; unitBarangId: string };
type BatchFailure = { unitBarangId?: string; message: string; unknownOutcome: boolean };

const EMPTY_OPERATIONAL_UNITS: OperationalReturnUnitState[] = [];

const CONDITION_OPTIONS: Array<{ value: ConditionChoice; label: string; description: string }> = [
  { value: "normal", label: "Baik", description: "Unit normal dan dapat dinilai siap disewakan." },
  { value: "dirty", label: "Kotor", description: "Membutuhkan pembersihan." },
  { value: "damage", label: "Rusak", description: "Membutuhkan perbaikan." },
  { value: "missing_component", label: "Komponen kurang", description: "Komponen tidak lengkap dan perlu ditindaklanjuti." },
  { value: "loss", label: "Hilang", description: "Unit tidak ditemukan dan dikeluarkan dari pool." },
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
  const [conditionExpanded, setConditionExpanded] = useState<Record<string, boolean>>({});
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchFailure, setBatchFailure] = useState<BatchFailure | null>(null);

  const workspace = useQuery({
    queryKey: ["penyewaan", "operational-return-workspace", usahaId, penyewaanId],
    queryFn: () => getOperationalReturnWorkspace(usahaId, penyewaanId),
    enabled: enabled && Boolean(usahaId && penyewaanId),
    staleTime: 3_000,
  });

  const units = workspace.data?.operational_units ?? EMPTY_OPERATIONAL_UNITS;
  const selectedUnits = units.filter(
    (unit) => !unit.return && unit.unit_status === "rented" && Boolean(condition[unit.unit_barang_id]),
  );
  const summary = useMemo(() => ({
    total: units.length,
    returned: units.filter((unit) => Boolean(unit.return)).length,
    ready: units.filter((unit) => unit.readiness_state === "ready").length,
    maintenance: units.filter((unit) => unit.readiness_state === "maintenance_required").length,
    outstanding: units.filter((unit) => !unit.return).length,
  }), [units]);
  const canProcess = rentalStatus === "active" || rentalStatus === "return_in_progress";
  const hasProcessableUnits = units.some((unit) => !unit.return && unit.unit_status === "rented");
  const allOutstandingSelected = summary.outstanding > 0 && selectedUnits.length === summary.outstanding;
  const actionLabel = selectedUnits.length === 0
    ? hasProcessableUnits ? "Pilih kondisi unit" : "Tidak ada unit untuk diproses"
    : allOutstandingSelected
      ? "Selesaikan Sewa"
      : "Proses Pengembalian · " + selectedUnits.length + " Unit";

  const mutation = useMutation({
    mutationFn: async (targets: OperationalReturnUnitState[]) => {
      const selected = targets.map((unit) => ({
        unitBarangId: unit.unit_barang_id,
        inspection: buildInspection(condition[unit.unit_barang_id] as ConditionChoice),
      }));
      return processOperationalUnitReturns(
        usahaId,
        {
          rentalId: penyewaanId,
          units: selected,
        },
        {
          onProgress: (progress) => setBatchProgress(progress),
        },
      );
    },
    onMutate: (targets) => {
      setBatchFailure(null);
      setBatchProgress({
        index: 0,
        total: targets.length,
        unitBarangId: targets[0]?.unit_barang_id ?? "",
      });
    },
    onSuccess: async (result) => {
      const processedIds = result.processed.map((item) => item.unitBarangId);
      if (processedIds.length) {
        setCondition((current) => {
          const next = { ...current };
          for (const unitId of processedIds) delete next[unitId];
          return next;
        });
      }

      setBatchProgress(null);
      if (result.state !== "completed") {
        setBatchFailure({
          unitBarangId: result.failedUnitId,
          message: result.error ?? "Sebagian pengembalian belum dapat diproses.",
          unknownOutcome: Boolean(result.unknownOutcome),
        });
      } else {
        setBatchFailure(null);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["penyewaan", "detail", usahaId, penyewaanId] }),
        queryClient.invalidateQueries({ queryKey: ["penyewaan", "operational-return-workspace", usahaId, penyewaanId] }),
        queryClient.invalidateQueries({ queryKey: ["pengembalian", "queue", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
      ]);
      await workspace.refetch();
      await onChanged?.();
    },
    onError: async (error) => {
      setBatchProgress(null);
      setBatchFailure({
        message: error instanceof Error ? error.message : "Pengembalian unit gagal.",
        unknownOutcome: Boolean(error instanceof Error && error.message.includes("UNKNOWN_OUTCOME")),
      });
      await workspace.refetch();
    },
  });

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

  const allReturned = summary.total > 0 && summary.outstanding === 0;
  const verifyStatus = async () => {
    const refreshed = await workspace.refetch();
    if (refreshed.isError || !refreshed.data) {
      setBatchFailure((current) => current ? {
        ...current,
        message: "Status server masih belum dapat dibaca. Jangan ulangi perintah sampai status unit terverifikasi.",
        unknownOutcome: true,
      } : null);
      return;
    }

    const confirmed = refreshed.data.operational_units
      .filter((unit) => Boolean(unit.return && unit.inspection))
      .map((unit) => unit.unit_barang_id);
    if (confirmed.length) {
      setCondition((current) => {
        const next = { ...current };
        for (const unitId of confirmed) delete next[unitId];
        return next;
      });
    }
    setBatchFailure(null);
    setBatchProgress(null);
    await onChanged?.();
  };
  const processSelected = () => {
    if (!selectedUnits.length || mutation.isPending || batchFailure?.unknownOutcome) return;
    setConditionExpanded({});
    mutation.mutate(selectedUnits);
  };

  return (
    <section id="rental-operational" data-testid="rental-operational-workspace" className="rounded-[22px] border border-border/65 bg-card shadow-[0_8px_28px_rgba(28,67,56,.06)]">
      <div className="border-b border-border/60 px-3.5 py-3.5 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><RotateCcw className="size-4.5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Pusat Operasional</p>
              <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">Pengembalian → Kondisi → Ready</h2>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Pilih kondisi setiap unit, lalu proses sekaligus. Sistem tetap menjalankan return dan pemeriksaan per unit.</p>
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

      {batchFailure && !batchFailure.unitBarangId ? (
        <div className="px-3.5 pt-3.5 sm:px-4">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>{batchFailure.unknownOutcome ? "Status hasil belum terverifikasi" : "Pengembalian belum selesai"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 text-[10px]">
              <span>{batchFailure.message}</span>
              {batchFailure.unknownOutcome ? (
                <Button variant="outline" size="sm" className="h-8 self-start rounded-lg text-[9px]" onClick={() => void verifyStatus()}>
                  Verifikasi Status
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="space-y-2.5 p-3.5 sm:p-4">
        {units.map((unit) => {
          const selected = condition[unit.unit_barang_id];
          const selectedOption = CONDITION_OPTIONS.find((option) => option.value === selected);
          const isThisMutation = mutation.isPending && batchProgress?.unitBarangId === unit.unit_barang_id;
          const isFailed = batchFailure?.unitBarangId === unit.unit_barang_id;
          return (
            <div key={unit.unit_barang_id} className="rounded-2xl border border-border/70 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold">{unitIdentity(unit)}</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {unit.return
                      ? "Diterima " + formatRentalDateTime(unit.return.diterima_at)
                      : unit.unit_status === "rented"
                        ? "Belum diterima dari penyewa"
                        : "Perlu verifikasi · status inventaris " + unit.unit_status}
                  </p>
                </div>
                <Badge variant={unit.return ? (unit.readiness_state === "ready" ? "outline" : "secondary") : unit.unit_status === "rented" ? "secondary" : "destructive"} className="shrink-0 rounded-full text-[9px]">
                  {unit.return ? readinessLabel(unit.readiness_state) : unit.unit_status === "rented" ? "Belum kembali" : "Status " + unit.unit_status}
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
              ) : canProcess && unit.unit_status === "rented" ? (
                <div className="mt-3 space-y-2 rounded-xl border border-dashed p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[10px] font-semibold">
                      <ClipboardCheck className="size-3.5 text-primary" />
                      Kondisi saat diterima
                    </div>
                    {isThisMutation ? (
                      <span className="shrink-0 text-[9px] font-medium text-primary">
                        Memproses {batchProgress?.index}/{batchProgress?.total}
                      </span>
                    ) : selectedOption ? (
                      <Badge variant="outline" className="shrink-0 rounded-full text-[9px]">{selectedOption.label}</Badge>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">Belum dipilih</span>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-between rounded-lg px-2.5 text-[10px]"
                    onClick={() => setConditionExpanded((current) => ({
                      ...current,
                      [unit.unit_barang_id]: !current[unit.unit_barang_id],
                    }))}
                    aria-expanded={Boolean(conditionExpanded[unit.unit_barang_id])}
                    aria-controls={"condition-options-" + unit.unit_barang_id}
                    disabled={mutation.isPending || Boolean(batchFailure?.unknownOutcome)}
                  >
                    {selectedOption ? "Kondisi: " + selectedOption.label : "Pilih kondisi unit"}
                    <ChevronDown className={"size-3.5 transition-transform " + (conditionExpanded[unit.unit_barang_id] ? "rotate-180" : "")} />
                  </Button>

                  {conditionExpanded[unit.unit_barang_id] ? (
                    <div id={"condition-options-" + unit.unit_barang_id} role="radiogroup" aria-label={"Kondisi " + unitIdentity(unit)} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {CONDITION_OPTIONS.map((option) => {
                        const isSelected = selected === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={option.label + ": " + option.description}
                            onClick={() => {
                              setCondition((current) => ({ ...current, [unit.unit_barang_id]: option.value }));
                              setConditionExpanded((current) => ({ ...current, [unit.unit_barang_id]: false }));
                            }}
                            className={"flex min-h-9 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (isSelected ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/30" : "hover:bg-accent/20")}
                          >
                            <span aria-hidden="true" className={"grid size-3.5 shrink-0 place-items-center rounded-full border " + (isSelected ? "border-primary" : "border-muted-foreground/50")}>
                              {isSelected ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                            </span>
                            <span className="leading-4">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : canProcess ? (
                <Alert className="mt-3" variant="destructive">
                  <ShieldAlert className="size-3.5" />
                  <AlertTitle className="text-[10px]">Penerimaan unit diblokir</AlertTitle>
                  <AlertDescription className="text-[9px] leading-4">
                    Unit belum tercatat keluar melalui serah-terima yang sah. Status inventaris saat ini <strong>{unit.unit_status}</strong>; sistem hanya menerima pengembalian untuk unit berstatus <strong>rented</strong>. Verifikasi penetapan dan serah-terima sebelum melanjutkan.
                  </AlertDescription>
                </Alert>
              ) : null}

              {isFailed && batchFailure ? (
                <Alert className="mt-3" variant="destructive">
                  <AlertTriangle className="size-3.5" />
                  <AlertTitle className="text-[10px]">{batchFailure.unknownOutcome ? "Status hasil belum terverifikasi" : "Unit belum berhasil diproses"}</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2 text-[9px] leading-4">
                    <span>{batchFailure.message}</span>
                    {batchFailure.unknownOutcome ? (
                      <Button variant="outline" size="sm" className="h-8 self-start rounded-lg text-[9px]" onClick={() => void verifyStatus()}>
                        Verifikasi Status
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {unit.return?.catatan ? <p className="mt-2 text-[9px] text-muted-foreground">Catatan: {unit.return.catatan}</p> : null}
            </div>
          );
        })}
      </div>

      <Separator />
      <div className="flex flex-col gap-2 px-3.5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <p className="text-[10px] font-semibold">{selectedUnits.length} unit dipilih untuk diproses</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            {allReturned
              ? "Semua unit sudah diterima. Readiness dihitung per unit."
              : summary.outstanding + " unit masih bersama penyewa."}
          </p>
        </div>
        <div className="hidden lg:block">
          {canProcess ? (
            <Button
              className="h-9 min-w-52 rounded-xl text-[10px]"
              disabled={!selectedUnits.length || mutation.isPending || Boolean(batchFailure?.unknownOutcome)}
              onClick={processSelected}
            >
              {mutation.isPending ? <><Loader2 className="size-3.5 animate-spin" />Memproses {batchProgress?.index ?? 0}/{batchProgress?.total ?? selectedUnits.length}</> : <>{actionLabel}<Check className="size-3.5" /></>}
            </Button>
          ) : null}
        </div>
        <Button variant="outline" className="h-9 rounded-xl text-[10px] sm:ml-auto" onClick={() => void workspace.refetch()}>
          Muat status terbaru
        </Button>
      </div>

      {canProcess && summary.outstanding > 0 ? (
        <div className="fixed inset-x-3 bottom-16 z-40 lg:hidden">
          <div className="rounded-2xl border border-white/60 bg-background/92 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
            <Button
              className="h-11 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold hover:bg-[#075944]"
              disabled={!selectedUnits.length || mutation.isPending || Boolean(batchFailure?.unknownOutcome)}
              onClick={processSelected}
            >
              {mutation.isPending ? (
                <><Loader2 className="size-4 animate-spin" />Memproses {batchProgress?.index ?? 0}/{batchProgress?.total ?? selectedUnits.length}</>
              ) : (
                <>{selectedUnits.length ? actionLabel : "Pilih kondisi unit"}<Check className="size-4" /></>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
