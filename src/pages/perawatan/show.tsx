import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  MoreVertical,
  Info,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  completeMaintenance,
  getMaintenanceWorkspace,
  getPerawatanContext,
  reconcileMaintenanceCommand,
  startMaintenance,
  verifyMaintenanceReadiness,
} from "@/features/perawatan";
import { formatMaintenanceDateTime, semanticMaintenanceLabel } from "@/features/perawatan/utils";
import { paths } from "@/routes/paths";

type CommandRef = {
  command: "start_maintenance" | "complete_maintenance" | "verify_maintenance_readiness";
  key: string;
};

type CompletionSuccess = {
  findingCount: number;
  cost: number | null;
  decision: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PerawatanShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [errorFeedback, setErrorFeedback] = useState("");
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [commandRef, setCommandRef] = useState<CommandRef | null>(null);
  const [executor, setExecutor] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [completionSuccess, setCompletionSuccess] = useState<CompletionSuccess | null>(null);

  const context = useQuery({
    queryKey: ["perawatan", "context"],
    queryFn: getPerawatanContext,
    staleTime: 60_000,
  });

  const workspace = useQuery({
    queryKey: ["perawatan", "workspace", context.data?.usahaId, id],
    queryFn: () => getMaintenanceWorkspace(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
  });

  const invalidate = async () => {
    await Promise.all([
      workspace.refetch(),
      queryClient.invalidateQueries({ queryKey: ["perawatan", "queue"] }),
      queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
      queryClient.invalidateQueries({ queryKey: ["pemeriksaan"] }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !workspace.data) throw new Error("Maintenance belum siap.");
      const key = "start-maintenance-" + crypto.randomUUID();
      setCommandRef({ command: "start_maintenance", key });
      return startMaintenance(
        context.data.usahaId,
        workspace.data.maintenance.perawatan_id,
        workspace.data.maintenance.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => { setFeedback(""); setErrorFeedback(""); setUnknownFeedback(""); },
    onSuccess: async () => { setCommandRef(null); setFeedback("Perawatan dimulai."); await invalidate(); },
    onError: (error) => {
      const message = errorMessage(error, "Perawatan gagal dimulai.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil start belum dapat dipastikan. Jangan memulai maintenance kedua.");
      else setErrorFeedback(message);
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !workspace.data) throw new Error("Maintenance belum siap.");
      const parsedCost = cost.trim() === "" ? null : Number(cost);
      if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) throw new Error("Biaya harus berupa angka nol atau lebih.");
      const key = "complete-maintenance-" + crypto.randomUUID();
      setCommandRef({ command: "complete_maintenance", key });
      return completeMaintenance(
        context.data.usahaId,
        {
          perawatanId: workspace.data.maintenance.perawatan_id,
          pelaksana: executor,
          biaya: parsedCost,
          currencyCode: "IDR",
          catatan: note,
        },
        workspace.data.maintenance.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => { setFeedback(""); setErrorFeedback(""); setUnknownFeedback(""); },
    onSuccess: async (result) => {
      setCommandRef(null);
      setCompletionSuccess({
        findingCount: workspace.data?.findings.length ?? 0,
        cost: typeof result.biaya === "number" ? result.biaya : (cost ? Number(cost) : null),
        decision: "maintenance_completed",
      });
      await invalidate();
    },
    onError: (error) => {
      const message = errorMessage(error, "Perawatan gagal diselesaikan.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil penyelesaian belum dapat dipastikan. Jangan menyimpan penyelesaian kedua.");
      else setErrorFeedback(message);
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async (verificationResult: "passed" | "failed") => {
      if (!context.data || !workspace.data) throw new Error("Maintenance belum siap.");
      const key = "verify-maintenance-" + crypto.randomUUID();
      setCommandRef({ command: "verify_maintenance_readiness", key });
      return verifyMaintenanceReadiness(
        context.data.usahaId,
        { perawatanId: workspace.data.maintenance.perawatan_id, verificationResult, catatan: verificationNote },
        workspace.data.maintenance.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => { setFeedback(""); setErrorFeedback(""); setUnknownFeedback(""); },
    onSuccess: async (result) => {
      setCommandRef(null);
      setFeedback(result.verification_result === "passed" ? "Verification LULUS. Inventaris menetapkan unit READY." : "Verification GAGAL. Unit tetap tidak READY.");
      setVerificationNote("");
      await invalidate();
    },
    onError: (error) => {
      const message = errorMessage(error, "Verification gagal diproses.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil verification belum dapat dipastikan. Periksa status command.");
      else setErrorFeedback(message);
    },
  });

  const reconcile = async () => {
    if (!context.data || !commandRef) return;
    setReconciling(true);
    try {
      const result = await reconcileMaintenanceCommand(context.data.usahaId, commandRef.command, commandRef.key);
      if (result.state === "committed") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Command sudah committed. State terbaru sedang disegarkan.");
        await workspace.refetch();
      } else if (result.state === "not_found") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Command tidak ditemukan. Muat data terbaru sebelum mencoba lagi.");
        await workspace.refetch();
      } else {
        setUnknownFeedback("Command masih UNKNOWN_OUTCOME. Jangan mengirim command kedua.");
      }
    } catch (error) {
      setUnknownFeedback(errorMessage(error, "Rekonsiliasi gagal."));
    } finally {
      setReconciling(false);
    }
  };

  if (context.isPending || workspace.isPending) {
    return <div className="space-y-4"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-[500px] rounded-2xl" /></div>;
  }

  if (context.error || workspace.error || !context.data || !workspace.data) {
    return <Alert variant="destructive"><AlertTitle>Workspace perawatan tidak tersedia</AlertTitle><AlertDescription className="flex flex-col gap-3"><span>{context.error?.message ?? errorMessage(workspace.error, "Data perawatan tidak ditemukan.")}</span><Button variant="outline" size="sm" onClick={() => void workspace.refetch()}><RefreshCw />Muat ulang</Button></AlertDescription></Alert>;
  }

  const { maintenance, unit, sourceInspection, findings, history } = workspace.data;
  const isStartable = maintenance.status === "planned";
  const isCompletable = maintenance.status === "in_progress";

  if (completionSuccess) {
    return (
      <div className="min-h-[calc(100dvh-8rem)] pb-24">
        <Card className="relative min-h-[620px] overflow-hidden rounded-3xl shadow-sm">
          <CardContent className="relative flex min-h-[620px] flex-col items-center justify-center gap-4 p-6 text-center sm:p-10">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <span className="absolute left-[12%] top-[18%] size-2 rounded-full bg-emerald-400/60" />
              <span className="absolute left-[24%] top-[74%] size-2 rounded-full bg-sky-400/50" />
              <span className="absolute right-[18%] top-[24%] size-2 rounded-full bg-amber-400/60" />
              <span className="absolute right-[28%] bottom-[18%] size-1.5 rounded-full bg-fuchsia-400/50" />
            </div>
            <div className="relative grid size-24 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-12" /></div>
            <div className="relative">
              <h1 className="text-2xl font-bold tracking-tight sm:text-[30px]">Perawatan Selesai</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Pekerjaan perawatan telah dicatat sebagai selesai.</p>
            </div>
            <div className="relative w-full max-w-md rounded-2xl border bg-background p-4 text-left">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">No. Perawatan</p><p className="mt-1 text-sm font-semibold">{maintenance.perawatan_id.slice(0, 8).toUpperCase()}</p></div>
                <div><p className="text-xs text-muted-foreground">Unit</p><p className="mt-1 text-sm font-semibold">{unit.kode_unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Biaya</p><p className="mt-1 text-sm font-semibold">{completionSuccess.cost == null ? "-" : `Rp ${new Intl.NumberFormat("id-ID").format(completionSuccess.cost)}`}</p></div>
              </div>
            </div>
            <Alert className="relative w-full max-w-md text-left">
              <Info className="size-4" />
              <AlertTitle>Unit belum dianggap READY</AlertTitle>
              <AlertDescription>Verifikasi kesiapan masih diperlukan melalui workflow yang sah. Perawatan selesai tidak otomatis membuat unit READY.</AlertDescription>
            </Alert>
            <div className="relative flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <Button className="flex-1 rounded-xl" onClick={() => setCompletionSuccess(null)}><Wrench />Lihat Detail Perawatan</Button>
              <Button asChild variant="outline" className="flex-1 rounded-xl"><Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}><ExternalLink />Buka Verifikasi</Link></Button>
            </div>
            <Button asChild variant="ghost" className="relative rounded-xl"><Link to={paths.perawatan}>Kembali ke Daftar</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28 lg:space-y-5 lg:pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl"><Link to={paths.perawatan} aria-label="Kembali ke Perawatan"><ArrowLeft /></Link></Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Perawatan {maintenance.perawatan_id.slice(0, 8).toUpperCase()}</p>
            <h1 className="text-2xl font-bold tracking-tight">{unit.kode_unit}</h1>
            <p className="text-sm text-muted-foreground">{unit.barang_nama ?? "Barang"}{unit.varian_nama ? " · " + unit.varian_nama : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2"><Badge variant={maintenance.status === "completed" ? "outline" : "secondary"} className="rounded-full">{semanticMaintenanceLabel(maintenance.status)}</Badge><Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label="Menu perawatan"><MoreVertical /></Button></div>
      </header>

      {feedback ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>Status diperbarui</AlertTitle><AlertDescription>{feedback}</AlertDescription></Alert> : null}
      {errorFeedback ? <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Perawatan belum diperbarui</AlertTitle><AlertDescription className="space-y-3"><p>{errorFeedback}</p><Button variant="outline" size="sm" onClick={() => void workspace.refetch()}><RefreshCw />Muat Data Terbaru</Button></AlertDescription></Alert> : null}
      {unknownFeedback ? <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Permintaan belum dapat dipastikan</AlertTitle><AlertDescription className="space-y-3"><p>Perubahan mungkin sudah diproses, tetapi hasil belum diterima perangkat. Jangan membuat record kedua.</p><Button variant="outline" size="sm" disabled={reconciling} onClick={() => void reconcile()}>{reconciling ? "Memeriksa..." : "Periksa Status Command"}</Button></AlertDescription></Alert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Unit</p><p className="mt-1 font-semibold">{unit.kode_unit}</p><p className="text-sm text-muted-foreground">{unit.barang_nama ?? "-"}{unit.varian_nama ? " · " + unit.varian_nama : ""}</p><Badge variant="secondary" className="mt-3 rounded-full">{semanticMaintenanceLabel(unit.status)}</Badge></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sumber</p><p className="mt-1 font-semibold">{sourceInspection ? "Pemeriksaan" : "Manual"}</p>{sourceInspection ? <p className="text-sm text-muted-foreground">{sourceInspection.pemeriksaan_id.slice(0, 8).toUpperCase()}</p> : <p className="text-sm text-muted-foreground">Alasan tercatat di catatan maintenance</p>}</CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Jenis Perawatan</p><p className="mt-1 font-semibold">{semanticMaintenanceLabel(maintenance.jenis_perawatan)}</p><Badge variant="outline" className="mt-3 rounded-full">{semanticMaintenanceLabel(maintenance.status)}</Badge></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Source & Condition</CardTitle><p className="text-sm text-muted-foreground">Mengapa unit perlu dirawat.</p></CardHeader>
          <CardContent className="space-y-4">
            {sourceInspection ? (
              <>
                <div className="rounded-2xl border bg-muted/15 p-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">Pemeriksaan Sumber</p><p className="mt-1 font-semibold">{sourceInspection.pemeriksaan_id}</p></div><Badge variant="secondary" className="rounded-full">{semanticMaintenanceLabel(sourceInspection.keputusan_operasional)}</Badge></div>
                  <p className="mt-3 text-sm text-muted-foreground">{formatMaintenanceDateTime(sourceInspection.diperiksa_at)} · {semanticMaintenanceLabel(sourceInspection.hasil)} · {semanticMaintenanceLabel(sourceInspection.kelengkapan_status)}</p>
                </div>
                <div><p className="mb-2 text-sm font-semibold">Temuan</p>{findings.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Tidak ada finding terkait.</div> : findings.map((finding) => <div key={finding.temuan_pemeriksaan_id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-3"><Badge variant="outline" className="rounded-full">{semanticMaintenanceLabel(finding.jenis_temuan)}</Badge><span className="text-xs text-muted-foreground">{finding.status_tindak_lanjut}</span></div><p className="mt-2 text-sm leading-6">{finding.deskripsi}</p>{finding.nominal_potensi_biaya !== null ? <p className="mt-2 text-xs text-muted-foreground">Potensi biaya · Rp {new Intl.NumberFormat("id-ID").format(Number(finding.nominal_potensi_biaya))}</p> : null}</div>)}</div>
              </>
            ) : (
              <div className="rounded-2xl border bg-amber-50/60 p-4"><p className="font-semibold">Manual Maintenance</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{maintenance.catatan || "Alasan maintenance manual tercatat pada record."}</p></div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Detail Pekerjaan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-xs text-muted-foreground">Deskripsi</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{maintenance.deskripsi_pekerjaan}</p></div>
            <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Pelaksana</p><p className="mt-1 text-sm font-medium">{maintenance.pelaksana ?? executor ?? "-"}</p></div><div className="rounded-xl bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Biaya</p><p className="mt-1 text-sm font-medium">{maintenance.biaya == null ? "-" : `Rp ${new Intl.NumberFormat("id-ID").format(Number(maintenance.biaya))}`}</p></div></div>
            <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Catatan</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{maintenance.catatan || "-"}</p></div>
          </CardContent>
        </Card>
      </div>

      {isStartable ? (
        <Card className="rounded-2xl border-primary/15 bg-primary/[0.025] shadow-sm lg:sticky lg:bottom-4">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold">Perawatan Direncanakan</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Mulai pekerjaan untuk mengubah state menjadi Berjalan. Waktu mulai ditentukan server.</p></div>
            <Button className="h-12 rounded-xl sm:min-w-52" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>{startMutation.isPending ? "Memulai..." : "Mulai Perawatan"}<ArrowRight /></Button>
          </CardContent>
        </Card>
      ) : null}

      {isCompletable ? (
        <Card className="rounded-2xl shadow-sm lg:sticky lg:bottom-4">
          <CardHeader><CardTitle className="text-base">Selesaikan Perawatan</CardTitle><p className="text-sm text-muted-foreground">Catat fakta pekerjaan yang benar-benar selesai.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Pelaksana<input aria-label="Pelaksana penyelesaian" className="h-11 rounded-xl border bg-background px-3" value={executor} onChange={(e) => setExecutor(e.target.value)} placeholder={maintenance.pelaksana ?? "Nama pelaksana"} /></label>
              <label className="grid gap-2 text-sm font-medium">Biaya aktual<input aria-label="Biaya aktual" type="number" min="0" className="h-11 rounded-xl border bg-background px-3" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={maintenance.biaya == null ? "Opsional" : String(maintenance.biaya)} /></label>
            </div>
            <label className="grid gap-2 text-sm font-medium">Catatan penyelesaian<Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Apa yang benar-benar dikerjakan dan diuji?" rows={4} /></label>
            <Button className="h-12 w-full rounded-xl sm:w-auto" disabled={completeMutation.isPending} onClick={() => completeMutation.mutate()}>{completeMutation.isPending ? "Menyimpan..." : "Selesaikan Perawatan"}<Check /></Button>
          </CardContent>
        </Card>
      ) : null}

      {maintenance.status === "completed" ? (
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Verification</CardTitle><p className="text-sm text-muted-foreground">Completion bukan READY. Konfirmasi hasil pekerjaan melalui verification yang sah.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-blue-50/50 p-4"><p className="font-semibold">Menunggu verifikasi kesiapan</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Unit belum boleh dipresentasikan sebagai READY hanya karena maintenance completed.</p></div>
            <Textarea value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Catatan hasil uji setelah maintenance" aria-label="Catatan verification" />
            <div className="flex flex-col gap-2 sm:flex-row"><Button disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("passed")}>{verificationMutation.isPending ? "Memproses..." : "Verification Lulus"}</Button><Button variant="outline" disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("failed")}>Verification Gagal</Button><Button asChild variant="ghost"><Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}><ExternalLink />Buka Pemeriksaan</Link></Button></div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Timeline Unit</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada riwayat unit.</p> : history.map((entry) => (
            <div key={entry.riwayat_unit_id} className="relative rounded-2xl border p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="font-medium">{semanticMaintenanceLabel(entry.jenis_kejadian)}</p><p className="text-xs text-muted-foreground">{formatMaintenanceDateTime(entry.terjadi_at)}</p></div>
              <p className="mt-1 text-xs text-muted-foreground">{entry.status_sebelum ?? "-"} → {entry.status_sesudah ?? "-"} · {entry.sumber_type ?? "-"}</p>
              {entry.catatan ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.catatan}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
