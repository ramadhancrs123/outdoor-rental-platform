import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  History,
  ImagePlus,
  Info,
  LockKeyhole,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Tag,
  Trash2,
  Upload,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  completeInspection,
  getInspectionWorkspace,
  getPemeriksaanContext,
  reconcileInspectionCommand,
  startInspection,
  uploadAndAttachInspectionEvidence,
  type InspectionFindingInput,
} from "@/features/pemeriksaan";
import { formatInspectionDateTime, nextInspectionAction, semanticInspectionLabel } from "@/features/pemeriksaan/utils";
import { paths } from "@/routes/paths";

const FINDING_TYPES = ["damage", "loss", "missing_component", "dirty", "other"] as const;
const DECISIONS = ["ready_review", "cleaning_required", "maintenance_required", "unavailable", "follow_up_required", "no_action", "readiness_review"] as const;
const SECTIONS = [
  ["context", "Konteks"],
  ["result", "Hasil & Keputusan"],
  ["findings", "Temuan"],
  ["evidence", "Bukti Foto"],
  ["notes", "Catatan"],
  ["review", "Tinjau & Simpan"],
] as const;
type Section = typeof SECTIONS[number][0];
type CommandRef = { key: string; type: "start" | "complete" | "evidence" };

const blankFinding = (): InspectionFindingInput => ({
  jenis_temuan: "damage",
  deskripsi: "",
  tingkat: null,
  status_tindak_lanjut: "open",
  nominal_potensi_biaya: null,
  currency_code: "IDR",
});

function humanError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/stale|updated_at|berubah sejak|outdated|concurrency/i.test(message)) {
    return "Data berubah sejak halaman dibuka. Muat ulang sebelum melanjutkan.";
  }
  if (/not found|tidak ditemukan/i.test(message)) return "Data pemeriksaan tidak ditemukan atau sudah berubah.";
  if (/permission|unauthor|forbidden/i.test(message)) return "Anda tidak memiliki izin untuk melakukan tindakan ini.";
  if (/network|fetch|timeout|failed to fetch/i.test(message)) return "Koneksi tidak stabil. Coba lagi setelah koneksi tersedia.";
  return message;
}

function decisionLabel(value: string) {
  const map: Record<string, string> = {
    ready_review: "Verifikasi Kesiapan",
    readiness_review: "Verifikasi Kesiapan",
    cleaning_required: "Perlu Pembersihan",
    maintenance_required: "Perlu Perawatan",
    unavailable: "Belum Siap Digunakan",
    follow_up_required: "Perlu Tindak Lanjut",
    no_action: "Tidak Ada Tindakan",
  };
  return map[value] ?? semanticInspectionLabel(value);
}

export function InspectionShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<Section>("context");
  const [hasil, setHasil] = useState<"normal" | "issue_found">("normal");
  const [kelengkapanStatus, setKelengkapanStatus] = useState<"complete" | "incomplete" | "unknown">("complete");
  const [keputusan, setKeputusan] = useState<(typeof DECISIONS)[number]>("readiness_review");
  const [catatan, setCatatan] = useState("");
  const [findings, setFindings] = useState<InspectionFindingInput[]>([]);
  const [feedback, setFeedback] = useState("");
  const [errorFeedback, setErrorFeedback] = useState("");
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [commandRef, setCommandRef] = useState<CommandRef | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [completionResult, setCompletionResult] = useState<{ decision: string; findingCount: number; evidenceCount: number; maintenanceId: string | null } | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const context = useQuery({
    queryKey: ["pemeriksaan", "context"],
    queryFn: getPemeriksaanContext,
    staleTime: 60_000,
  });
  const workspace = useQuery({
    queryKey: ["pemeriksaan", "workspace", context.data?.usahaId, id],
    queryFn: () => getInspectionWorkspace(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
  });

  const current = workspace.data?.currentInspection;
  const canEdit = current?.hasil === "pending" && workspace.data?.returnDetail.status_pemeriksaan === "in_progress";
  const summaryFindings = useMemo(() => findings.filter((item) => item.deskripsi.trim()), [findings]);
  const latestCompleted = workspace.data?.history.find((item) => item.hasil !== "pending");
  const canReinspect = Boolean(
    latestCompleted &&
      workspace.data?.unit.status === "inspection_pending" &&
      new Date(workspace.data.unit.updated_at).getTime() > new Date(latestCompleted.diperiksa_at).getTime(),
  );

  useEffect(() => {
    if (current?.hasil === "pending" || current?.hasil === "normal" || current?.hasil === "issue_found") {
      setActiveSection("result");
    }
  }, [current?.pemeriksaan_id, current?.hasil]);

  useEffect(() => {
    if (!cameraOpen) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }
    let cancelled = false;
    const startCamera = async () => {
      setCameraError("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera tidak tersedia di browser ini.");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (error) {
        setCameraReady(false);
        setCameraError(humanError(error, "Izin kamera belum diberikan."));
      }
    };
    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);

  const start = async () => {
    if (!context.data || !workspace.data || !id) return;
    setStarting(true);
    setErrorFeedback("");
    setUnknownFeedback("");
    const key = createClientId();
    setCommandRef({ key, type: "start" });
    try {
      const result = await startInspection(context.data.usahaId, id, workspace.data.unit.unit_barang_id, key);
      setFeedback(result.reused_draft ? "Draft pemeriksaan ditemukan dan dilanjutkan kembali." : "Pemeriksaan dimulai. Draft belum menjadi fakta final.");
      setActiveSection("result");
      await workspace.refetch();
    } catch (error) {
      const message = humanError(error, "Pemeriksaan gagal dimulai.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(message.replace(/^UNKNOWN_OUTCOME:\s*/, ""));
      else setErrorFeedback(message);
    } finally {
      setStarting(false);
    }
  };

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !workspace.data || !current) throw new Error("Pemeriksaan belum siap.");
      if (hasil === "normal" && summaryFindings.length > 0) throw new Error("Hasil Normal tidak boleh memiliki finding.");
      if (hasil === "issue_found" && summaryFindings.length === 0) throw new Error("Jika Ada Temuan, minimal satu finding harus dicatat.");
      const key = createClientId();
      setCommandRef({ key, type: "complete" });
      return completeInspection(
        context.data.usahaId,
        {
          pemeriksaanId: current.pemeriksaan_id,
          hasil,
          kelengkapanStatus,
          keputusanOperasional: keputusan,
          catatan,
          findings: summaryFindings,
        },
        current.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => {
      setFeedback("");
      setErrorFeedback("");
      setUnknownFeedback("");
    },
    onSuccess: async (result) => {
      setCommandRef(null);
      const refreshedWorkspace = await workspace.refetch();
      setCompletionResult({
        decision: result.keputusan_operasional,
        findingCount: result.finding_count,
        evidenceCount: refreshedWorkspace.data?.currentInspection?.evidences.length ?? 0,
        maintenanceId: refreshedWorkspace.data?.linkedMaintenance?.perawatan_id ?? null,
      });
      setFeedback("Pemeriksaan tersimpan. Unit langsung masuk Perawatan.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pemeriksaan", "queue"] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
        queryClient.invalidateQueries({ queryKey: ["pengembalian"] }),
      ]);
    },
    onError: (error) => {
      const raw = error instanceof Error ? error.message : "Pemeriksaan gagal disimpan.";
      if (raw.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(raw.replace(/^UNKNOWN_OUTCOME:\s*/, ""));
      else setErrorFeedback(humanError(error, "Pemeriksaan gagal disimpan."));
    },
  });

  const reconcile = async () => {
    if (!context.data || !commandRef) return;
    setReconciling(true);
    try {
      const result = await reconcileInspectionCommand(context.data.usahaId, commandRef.key);
      if (result.state === "committed") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Perubahan sudah disimpan. Status pemeriksaan sedang diperbarui.");
        await workspace.refetch();
      } else if (result.state === "not_found") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Perubahan sebelumnya belum ditemukan. Periksa status terbaru sebelum mencoba lagi.");
        await workspace.refetch();
      } else {
        setUnknownFeedback("Hasil pemeriksaan belum dapat dipastikan. Jangan mengulang pemeriksaan.");
      }
    } catch (error) {
      setUnknownFeedback(humanError(error, "Rekonsiliasi gagal."));
    } finally {
      setReconciling(false);
    }
  };

  const uploadEvidence = async (file: File) => {
    if (!context.data || !current || !workspace.data || !canEdit) return;
    setPhotoUploading(true);
    setErrorFeedback("");
    setUnknownFeedback("");
    const key = createClientId();
    setCommandRef({ key, type: "evidence" });
    try {
      await uploadAndAttachInspectionEvidence(
        context.data.usahaId,
        current.pemeriksaan_id,
        workspace.data.unit.unit_barang_id,
        { file, jenisFoto: "overview" },
        key,
      );
      setCommandRef(null);
      setFeedback("Foto evidence berhasil ditautkan ke pemeriksaan.");
      await workspace.refetch();
      setActiveSection("evidence");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      if (raw.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(raw.replace(/^UNKNOWN_OUTCOME:\s*/, ""));
      else setErrorFeedback(humanError(error, "Foto evidence gagal disimpan."));
    } finally {
      setPhotoUploading(false);
    }
  };

  const captureCamera = async () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      setCameraError("Foto tidak dapat dibuat. Coba lagi.");
      return;
    }
    const file = new File([blob], "condition-" + Date.now() + ".jpg", { type: "image/jpeg" });
    setCameraOpen(false);
    await uploadEvidence(file);
  };

  const changeFinding = (index: number, patch: Partial<InspectionFindingInput>) => {
    setFindings((currentFindings) => currentFindings.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item));
  };

  if (context.isPending || workspace.isPending) {
    return <div className="space-y-4"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  }

  if (context.error || workspace.error || !context.data || !workspace.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl"><Link to="/pemeriksaan"><ArrowLeft />Kembali</Link></Button>
        <Alert variant="destructive">
          <AlertTitle>Workspace pemeriksaan tidak tersedia</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{context.error?.message ?? humanError(workspace.error, "Data pemeriksaan tidak ditemukan.")}</span>
            <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}><RefreshCw /> Coba lagi</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const item = workspace.data;
  const effectiveCurrent = item.currentInspection;
  const displayedState = effectiveCurrent?.hasil === "pending"
    ? "inspection_in_progress"
    : effectiveCurrent
      ? "inspection_completed"
      : item.returnDetail.status_pemeriksaan === "in_progress"
        ? "inspection_in_progress"
        : "waiting_for_inspection";

  const sectionIndex = Math.max(0, SECTIONS.findIndex(([value]) => value === activeSection));
  const editableStarted = canEdit || Boolean(effectiveCurrent?.hasil === "pending");
  const reviewBlocked = (hasil === "normal" && summaryFindings.length > 0) || (hasil === "issue_found" && summaryFindings.length === 0);
  const nextSection = () => {
    const next = SECTIONS[Math.min(sectionIndex + 1, SECTIONS.length - 1)][0];
    setActiveSection(next);
  };
  const previousSection = () => {
    const prev = SECTIONS[Math.max(sectionIndex - 1, 0)][0];
    setActiveSection(prev);
  };
  const visibleHistory = historyExpanded ? item.history : item.history.slice(0, 4);
  const hasHiddenHistory = item.history.length > 4;

  if (completionResult) {
    return (
      <div className="min-h-[calc(100dvh-7rem)] pb-6">
        <Card className="relative min-h-[min(760px,calc(100dvh-7rem))] overflow-hidden rounded-3xl border-0 bg-card shadow-sm">
          <CardContent className="relative flex min-h-[min(760px,calc(100dvh-7rem))] flex-col items-center justify-center gap-5 p-6 text-center sm:p-10">
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              <span className="absolute left-[10%] top-[18%] size-2 rounded-full bg-emerald-400/60" />
              <span className="absolute left-[26%] top-[12%] size-1.5 rounded-full bg-sky-400/60" />
              <span className="absolute right-[18%] top-[24%] size-2 rounded-full bg-amber-400/60" />
              <span className="absolute left-[20%] bottom-[24%] size-2 rounded-full bg-sky-400/50" />
              <span className="absolute right-[28%] bottom-[18%] size-1.5 rounded-full bg-fuchsia-400/50" />
            </div>
            <div className="relative grid size-24 place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
              <CheckCircle2 className="size-12" />
            </div>
            <div className="relative space-y-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-[30px]">Pemeriksaan Berhasil Disimpan</h1>
              <p className="text-sm leading-6 text-muted-foreground">Pemeriksaan telah dicatat sebagai hasil pemeriksaan.</p>
            </div>
            <div className="relative w-full max-w-md rounded-2xl border bg-muted/20 p-4 text-left">
              <p className="text-xs font-medium text-muted-foreground">Keputusan Operasional</p>
              <p className="mt-1 text-lg font-bold">{decisionLabel(completionResult.decision)}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{nextInspectionAction(completionResult.decision)}</p>
            </div>
            <div className="relative w-full max-w-md rounded-2xl border bg-background p-4 text-left">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">Temuan</p><p className="mt-1 font-semibold">{completionResult.findingCount}</p></div>
                <div><p className="text-xs text-muted-foreground">Bukti Foto</p><p className="mt-1 font-semibold">{completionResult.evidenceCount}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 font-semibold">Masuk Perawatan</p></div>
              </div>
            </div>
            <Alert className="relative w-full max-w-md text-left">
              <CheckCircle2 className="size-4" />
              <AlertTitle>Pemeriksaan selesai</AlertTitle>
              <AlertDescription>Unit sekarang masuk Perawatan. Setelah pekerjaan selesai, lakukan Verifikasi Kesiapan sebelum unit kembali Siap Disewakan.</AlertDescription>
            </Alert>
            {completionResult.maintenanceId ? (
              <Button asChild className="relative w-full max-w-md h-11 rounded-xl">
                <Link to={paths.perawatan + "/" + completionResult.maintenanceId}>Lanjutkan Perawatan <ArrowRight /></Link>
              </Button>
            ) : (
              <Alert variant="destructive" className="relative w-full max-w-md text-left">
                <ShieldAlert className="size-4" />
                <AlertTitle>Tugas Perawatan belum ditemukan</AlertTitle>
                <AlertDescription>Muat ulang data sebelum melanjutkan. Pemeriksaan sudah tersimpan.</AlertDescription>
              </Alert>
            )}
            <div className="relative flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <Button className="w-full rounded-xl" onClick={() => { setCompletionResult(null); setActiveSection("result"); void workspace.refetch(); }}>
                Lihat Detail Pemeriksaan
              </Button>
              <Button asChild variant="outline" className="w-full rounded-xl">
                <Link to="/pemeriksaan">Kembali ke Daftar</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 pb-28 sm:space-y-4 lg:pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 size-9 rounded-xl" aria-label="Kembali ke antrian pemeriksaan">
            <Link to="/pemeriksaan"><ArrowLeft /></Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Detail Pemeriksaan</p>
            <h1 className="truncate text-[20px] font-bold leading-6 tracking-tight">{item.unit.kode_unit}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {item.unit.barang_nama ?? "-"}{item.unit.varian_nama ? " · " + item.unit.varian_nama : ""}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Menu pemeriksaan">
          <MoreVertical />
        </Button>
      </header>

      {feedback ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Status diperbarui</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}
      {errorFeedback ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Pemeriksaan belum diperbarui</AlertTitle>
          <AlertDescription>{errorFeedback}</AlertDescription>
        </Alert>
      ) : null}
      {unknownFeedback ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Hasil tindakan belum dapat dipastikan</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Jangan kirim pemeriksaan kedua. Periksa status proses terlebih dahulu.</p>
            <p className="text-xs">{unknownFeedback}</p>
            <Button variant="outline" size="sm" disabled={reconciling} onClick={() => void reconcile()}>
              <RotateCcw />{reconciling ? "Memeriksa…" : "Periksa Status Tindakan"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden rounded-[22px] border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardContent className="p-3.5 sm:p-4">
          <div className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-3">
            <div className="grid size-[62px] shrink-0 place-items-center rounded-2xl border border-border/70 bg-muted/35 text-primary">
              <Package className="size-7" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[17px] font-bold leading-5">{item.unit.kode_unit}</p>
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                  {semanticInspectionLabel(item.unit.status)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {item.unit.barang_nama ?? "-"}{item.unit.varian_nama ? " · " + item.unit.varian_nama : ""}
              </p>
            </div>
            <Badge
              variant={displayedState === "inspection_completed" ? "outline" : "secondary"}
              className="max-w-[122px] justify-center rounded-xl px-2.5 py-2 text-[11px] font-semibold"
            >
              {displayedState === "inspection_in_progress" ? "Dalam Proses" : displayedState === "inspection_completed" ? "Pemeriksaan Selesai" : "Menunggu Pemeriksaan"}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x rounded-2xl bg-muted/25">
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="size-3.5 shrink-0" />
                <span>Hasil</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {effectiveCurrent ? semanticInspectionLabel(effectiveCurrent.hasil) : "Belum diperiksa"}
              </p>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="size-3.5 shrink-0" />
                <span>Kelengkapan</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {effectiveCurrent ? semanticInspectionLabel(effectiveCurrent.kelengkapan_status) : "-"}
              </p>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                <span>Diterima</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {formatInspectionDateTime(item.returnDetail.diterima_at)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <nav aria-label="Bagian detail pemeriksaan" className="flex gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-background p-1 lg:grid lg:grid-cols-6">
        {SECTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={activeSection === value}
            onClick={() => setActiveSection(value)}
            className={[
              "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition",
              activeSection === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ].join(" ")}
          >
            {label === "Konteks" ? <Package className="size-3.5" /> :
              label === "Hasil & Keputusan" ? <CheckCircle2 className="size-3.5" /> :
              label === "Temuan" ? <CircleAlert className="size-3.5" /> :
              label === "Bukti Foto" ? <ImagePlus className="size-3.5" /> :
              label === "Catatan" ? <FileText className="size-3.5" /> :
              <FileCheck2 className="size-3.5" />}
            {label === "Temuan" && (editableStarted ? summaryFindings.length : effectiveCurrent?.findings.length ?? 0) > 0
              ? `Temuan (${editableStarted ? summaryFindings.length : effectiveCurrent?.findings.length ?? 0})`
              : label}
          </button>
        ))}
      </nav>

      {activeSection === "context" ? (
        <div className="space-y-3">
          <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-2 divide-x rounded-2xl bg-muted/25">
                <div className="min-w-0 px-3 py-3">
                  <p className="text-[11px] text-muted-foreground">Pengembalian</p>
                  <p className="mt-1 truncate text-sm font-semibold">{item.returnHeader.nomor_pengembalian}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatInspectionDateTime(item.returnDetail.diterima_at)}</p>
                </div>
                <div className="min-w-0 px-3 py-3">
                  <p className="text-[11px] text-muted-foreground">Penyewa</p>
                  <p className="mt-1 truncate text-sm font-semibold">{item.renter?.nama_lengkap ?? "-"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{semanticInspectionLabel(item.returnDetail.status_pemeriksaan)}</p>
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-50/45 p-3.5 dark:bg-emerald-950/15">
                <div className="flex items-start gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                    <Info className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">Konteks Pemeriksaan</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Pastikan unit yang diperiksa sesuai dengan pengembalian yang diterima.</p>
                    <div className="mt-2 rounded-xl bg-background/75 px-3 py-2.5">
                      <p className="text-sm font-semibold">{item.unit.kode_unit}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.unit.barang_nama ?? "-"}{item.unit.varian_nama ? " · " + item.unit.varian_nama : ""}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {!editableStarted && (item.unit.status === "inspection_pending" || canReinspect) ? (
            <Card className="rounded-[22px] border-primary/15 bg-primary/[0.025] shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Clock3 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{canReinspect ? "Pemeriksaan ulang tersedia" : "Unit menunggu pemeriksaan"}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {canReinspect
                        ? "Pemeriksaan sebelumnya tetap tersimpan sebagai riwayat. Mulai pemeriksaan baru untuk pemeriksaan ulang."
                        : "Mulai pemeriksaan untuk membuat draf. Memulai pemeriksaan belum berarti pemeriksaan selesai."}
                    </p>
                    <Button className="mt-3 h-11 w-full rounded-xl" disabled={starting || Boolean(unknownFeedback)} onClick={() => void start()}>
                      {starting ? "Memulai…" : canReinspect ? "Mulai Pemeriksaan Ulang" : "Mulai Pemeriksaan"}
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeSection === "result" ? (
        <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="size-5 text-primary" />Hasil & Keputusan</CardTitle>
            <p className="text-sm text-muted-foreground">Kondisi, kelengkapan, dan keputusan operasional tetap terpisah.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {effectiveCurrent?.hasil === "pending" ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Hasil Pemeriksaan</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([["normal", "Normal", "Unit dalam kondisi baik, tidak ada kerusakan.", CheckCircle2], ["issue_found", "Ada Temuan", "Ditemukan kerusakan, kehilangan, atau kondisi tidak normal.", CircleAlert]] as const).map(([value, label, desc, Icon]) => (
                      <button key={value} type="button" className={[
                        "rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        hasil === value ? "border-primary bg-primary/[0.05] ring-1 ring-primary/20" : "bg-background hover:bg-muted/30",
                      ].join(" ")} onClick={() => setHasil(value)}>
                        <Icon className={value === "normal" ? "size-5 text-emerald-600" : "size-5 text-amber-600"} />
                        <p className="mt-2 font-semibold">{label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</p>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Kelengkapan Unit</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {([["complete", "Lengkap"], ["incomplete", "Tidak Lengkap"], ["unknown", "Belum Diketahui"]] as const).map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setKelengkapanStatus(value)} className={[
                        "min-h-11 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        kelengkapanStatus === value ? "border-primary bg-primary/[0.05] text-primary" : "bg-background hover:bg-muted/30",
                      ].join(" ")}>{label}</button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">Keputusan Operasional</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DECISIONS.map((value) => (
                      <button key={value} type="button" onClick={() => setKeputusan(value)} className={[
                        "min-h-12 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        keputusan === value ? "border-primary bg-primary/[0.05]" : "bg-background hover:bg-muted/30",
                      ].join(" ")}>
                        <p className="text-sm font-medium">{decisionLabel(value)}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{nextInspectionAction(value)}</p>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : effectiveCurrent ? (
              <>
                <p className="sr-only">Pemeriksaan selesai</p>
                <div className="grid grid-cols-3 divide-x rounded-2xl bg-muted/25">
                  <div className="min-w-0 px-3 py-3"><p className="text-[11px] text-muted-foreground">Hasil</p><p className="mt-1 truncate text-sm font-semibold">{semanticInspectionLabel(effectiveCurrent.hasil)}</p></div>
                  <div className="min-w-0 px-3 py-3"><p className="text-[11px] text-muted-foreground">Kelengkapan</p><p className="mt-1 truncate text-sm font-semibold">{semanticInspectionLabel(effectiveCurrent.kelengkapan_status)}</p></div>
                  <div className="min-w-0 px-3 py-3"><p className="text-[11px] text-muted-foreground">Keputusan</p><p className="mt-1 truncate text-sm font-semibold">{decisionLabel(effectiveCurrent.keputusan_operasional)}</p></div>
                </div>

                <div className="rounded-2xl bg-emerald-50/45 p-3.5 dark:bg-emerald-950/15">
                  <p className="text-[11px] text-muted-foreground">Aksi Berikutnya</p>
                  <p className="mt-1 text-sm font-semibold leading-5">{nextInspectionAction(effectiveCurrent.keputusan_operasional)}</p>
                </div>

                {workspace.data?.linkedMaintenance ? (
                  <Card className="rounded-2xl border-primary/15 bg-primary/[0.025] shadow-none">
                    <CardContent className="p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><ArrowRight className="size-5" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">Perawatan sudah dibuat</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {semanticInspectionLabel(workspace.data.linkedMaintenance.jenis_perawatan)} · {workspace.data.linkedMaintenance.status === "planned" ? "Menunggu dikerjakan" : workspace.data.linkedMaintenance.status === "in_progress" ? "Sedang dikerjakan" : "Selesai"}
                          </p>
                          <Button asChild className="mt-3 h-10 w-full rounded-xl">
                            <Link to={paths.perawatan + "/" + workspace.data.linkedMaintenance.perawatan_id}>Lanjutkan Perawatan<ArrowRight /></Link>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </>
            ) : (
              <Alert><AlertTitle>Belum ada draft pemeriksaan</AlertTitle><AlertDescription>Mulai pemeriksaan dari konteks unit untuk membuka hasil, kelengkapan, dan keputusan.</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "findings" ? (
        <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="p-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2 text-base"><CircleAlert className="size-5 text-primary" />Temuan</CardTitle><p className="mt-1 text-sm text-muted-foreground">Catat fakta yang dapat diamati. Potensi biaya bukan pembayaran.</p></div>
              {effectiveCurrent?.hasil === "pending" && hasil === "issue_found" ? (
                <Button type="button" variant="outline" className="h-9 shrink-0 rounded-xl px-3 text-xs" onClick={() => setFindings((list) => [...list, blankFinding()])}><Plus />Tambah</Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 p-4 pt-0">
            {effectiveCurrent?.hasil !== "pending" ? (
              effectiveCurrent?.findings.length ? effectiveCurrent.findings.map((finding, index) => (
                <div key={finding.temuan_pemeriksaan_id} className={[
                  "rounded-2xl border p-3.5",
                  index % 2 === 0 ? "bg-card" : "bg-amber-50/35 dark:bg-amber-950/10",
                ].join(" ")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">Temuan {index + 1}</p><Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">{semanticInspectionLabel(finding.jenis_temuan)}</Badge></div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.deskripsi}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{finding.status_tindak_lanjut ?? "-"}</span>
                  </div>
                  {finding.nominal_potensi_biaya != null ? <p className="mt-2 text-xs text-muted-foreground">Potensi biaya · {finding.currency_code ?? "IDR"} {finding.nominal_potensi_biaya.toLocaleString("id-ID")}</p> : null}
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed p-6 text-center">
                  <LockKeyhole className="mx-auto size-6 text-muted-foreground" />
                  <p className="mt-2 font-semibold">Belum ada temuan</p>
                  <p className="mt-1 text-sm text-muted-foreground">Tidak ada temuan bukan berarti tidak ada pemeriksaan. Hasil pemeriksaan tetap tercatat.</p>
                </div>
              )
            ) : hasil === "normal" ? (
              <Alert><CheckCircle2 className="size-4" /><AlertTitle>Normal</AlertTitle><AlertDescription>Hasil Normal tidak dapat memiliki finding. Ubah Hasil menjadi Ada Temuan untuk menambahkan fakta kondisi.</AlertDescription></Alert>
            ) : findings.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-7 text-center">
                <CircleAlert className="mx-auto size-6 text-amber-600" />
                <p className="mt-2 font-semibold">Belum ada temuan</p>
                <p className="mt-1 text-sm text-muted-foreground">Ada Temuan memerlukan minimal satu finding sebelum dapat disimpan.</p>
                <Button type="button" className="mt-3 rounded-xl" onClick={() => setFindings([blankFinding()])}><Plus />Tambah Temuan</Button>
              </div>
            ) : findings.map((finding, index) => (
              <div key={index} className="space-y-3 rounded-2xl border bg-muted/[0.02] p-3.5">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">Temuan {index + 1}</p><Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" aria-label={"Hapus temuan " + (index + 1)} onClick={() => setFindings((list) => list.filter((_, currentIndex) => currentIndex !== index))}><Trash2 /></Button></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-medium">Jenis
                    <select className="h-10 rounded-xl border bg-background px-3 text-sm" value={finding.jenis_temuan} onChange={(e) => changeFinding(index, { jenis_temuan: e.target.value as InspectionFindingInput["jenis_temuan"] })}>{FINDING_TYPES.map((type) => <option key={type} value={type}>{semanticInspectionLabel(type)}</option>)}</select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium">Tingkat
                    <Input className="h-10 rounded-xl" value={finding.tingkat ?? ""} onChange={(e) => changeFinding(index, { tingkat: e.target.value })} placeholder="Tingkat" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-medium">Deskripsi
                  <Textarea className="min-h-20 rounded-xl text-sm" value={finding.deskripsi} onChange={(e) => changeFinding(index, { deskripsi: e.target.value })} placeholder="Contoh: Resleting sisi kiri rusak" />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-medium">Status Tindak Lanjut
                    <Input className="h-10 rounded-xl" value={finding.status_tindak_lanjut ?? "open"} onChange={(e) => changeFinding(index, { status_tindak_lanjut: e.target.value })} placeholder="Status" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium">Potensi Biaya
                    <Input className="h-10 rounded-xl" type="number" min="0" value={finding.nominal_potensi_biaya ?? ""} onChange={(e) => changeFinding(index, { nominal_potensi_biaya: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Bukan pembayaran" />
                  </label>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "evidence" ? (
        <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ImagePlus className="size-5 text-primary" />Bukti Foto Kondisi</CardTitle>
            <p className="text-sm text-muted-foreground">Bukti kondisi bersifat internal. Foto tidak wajib secara universal.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {effectiveCurrent?.hasil === "pending" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" className="h-11 rounded-xl" disabled={photoUploading || Boolean(unknownFeedback)} onClick={() => setCameraOpen(true)}><Camera />Ambil Foto</Button>
                  <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={photoUploading || Boolean(unknownFeedback)} onClick={() => galleryInputRef.current?.click()}><ImagePlus />Galeri</Button>
                </div>
                <input ref={galleryInputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadEvidence(file); e.currentTarget.value = ""; }} />
              </>
            ) : null}
            {photoUploading ? <Alert><Upload className="size-4" /><AlertTitle>Mengunggah bukti foto…</AlertTitle><AlertDescription>Foto sedang disimpan sebagai bukti pemeriksaan.</AlertDescription></Alert> : null}
            {effectiveCurrent?.evidences.length ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {effectiveCurrent.evidences.map((evidence) => (
                  <figure key={evidence.bukti_foto_kondisi_id} className="overflow-hidden rounded-2xl border bg-muted/20">
                    <div className="aspect-square bg-muted">{evidence.signed_url ? <img src={evidence.signed_url} alt={"Bukti Foto " + evidence.jenis_foto} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Upload /></div>}</div>
                    <figcaption className="space-y-1 p-2.5 text-xs"><p className="font-medium">{semanticInspectionLabel(evidence.jenis_foto)}</p><p className="text-muted-foreground">{formatInspectionDateTime(evidence.captured_at)}</p></figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-center"><ImagePlus className="mx-auto size-6 text-muted-foreground" /><p className="mt-2 font-semibold">Belum ada bukti foto</p><p className="mt-1 text-sm text-muted-foreground">Ambil foto atau pilih dari galeri setelah pemeriksaan dimulai.</p></div>
            )}
            {errorFeedback && photoUploading === false ? <Alert variant="destructive"><AlertTitle>Upload gagal</AlertTitle><AlertDescription>{errorFeedback}</AlertDescription></Alert> : null}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "notes" ? (
        <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><FileText className="size-5 text-primary" />Catatan Pemeriksaan</CardTitle>
            <p className="text-sm text-muted-foreground">Catatan objektif untuk konteks, audit, dan tindak lanjut.</p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {effectiveCurrent?.hasil === "pending" ? (
              <Textarea className="min-h-32 rounded-2xl" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan objektif pemeriksaan..." />
            ) : (
              <div className="rounded-2xl border bg-muted/10 p-3.5 text-sm leading-6">{effectiveCurrent?.catatan ?? "Tidak ada catatan."}</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeSection === "review" ? (
        <div className="space-y-3">
          <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="size-5 text-primary" />Tinjau & Simpan</CardTitle>
              <p className="text-sm text-muted-foreground">Periksa kembali fakta sebelum pemeriksaan disimpan.</p>
            </CardHeader>
            <CardContent className="grid gap-2.5 p-4 pt-0 sm:grid-cols-2">
              {[
                ["Hasil Pemeriksaan", effectiveCurrent?.hasil === "pending" ? semanticInspectionLabel(hasil) : semanticInspectionLabel(effectiveCurrent?.hasil)],
                ["Kelengkapan", effectiveCurrent?.hasil === "pending" ? semanticInspectionLabel(kelengkapanStatus) : semanticInspectionLabel(effectiveCurrent?.kelengkapan_status)],
                ["Keputusan Operasional", effectiveCurrent?.hasil === "pending" ? decisionLabel(keputusan) : decisionLabel(effectiveCurrent?.keputusan_operasional ?? "-")],
                ["Jumlah Temuan", String(effectiveCurrent?.hasil === "pending" ? summaryFindings.length : effectiveCurrent?.findings.length ?? 0)],
                ["Jumlah Evidence", String(effectiveCurrent?.evidences.length ?? 0)],
                ["Catatan", effectiveCurrent?.hasil === "pending" ? (catatan || "-") : (effectiveCurrent?.catatan || "-")],
              ].map(([label, value]) => <div key={label} className="rounded-2xl bg-muted/20 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold leading-5">{value}</p></div>)}
            </CardContent>
          </Card>

          {effectiveCurrent?.hasil === "pending" ? (
            <>
              {reviewBlocked ? <Alert variant="destructive"><AlertTitle>Tinjauan belum lengkap</AlertTitle><AlertDescription>{hasil === "normal" ? "Hasil Normal tidak boleh memiliki finding." : "Ada Temuan memerlukan minimal satu finding."}</AlertDescription></Alert> : null}
              <Card className="rounded-[22px] border-primary/15 bg-primary/[0.025] shadow-sm lg:sticky lg:bottom-4">
                <CardContent className="space-y-3 p-4">
                  <Button className="h-12 w-full rounded-xl text-base" disabled={completeMutation.isPending || photoUploading || Boolean(unknownFeedback) || reviewBlocked} onClick={() => completeMutation.mutate()}>
                    {completeMutation.isPending ? "Menyimpan Pemeriksaan…" : <>Simpan Pemeriksaan <Check /></>}
                  </Button>
                  <p className="text-center text-xs leading-5 text-muted-foreground">Setelah pemeriksaan disimpan, unit masuk Perawatan. Unit baru boleh kembali Siap Disewakan setelah pekerjaan selesai dan Verifikasi Kesiapan lulus.</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Alert><FileCheck2 className="size-4" /><AlertTitle>Pemeriksaan Selesai</AlertTitle><AlertDescription>Pemeriksaan ini sudah menjadi riwayat. Pemeriksaan ulang membuat pemeriksaan baru dan tidak menimpa yang lama.</AlertDescription></Alert>
          )}
        </div>
      ) : null}

      {activeSection !== "context" && !editableStarted && !effectiveCurrent ? (
        <Alert><AlertTitle>Mulai Pemeriksaan terlebih dahulu</AlertTitle><AlertDescription>Gunakan bagian Konteks untuk memulai draft pemeriksaan.</AlertDescription></Alert>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="h-10 rounded-xl" disabled={sectionIndex === 0} onClick={previousSection}><ChevronLeft />Sebelumnya</Button>
        {sectionIndex < SECTIONS.length - 1 ? (
          <Button type="button" className="h-10 rounded-xl" onClick={nextSection}>Lanjut<ChevronRight /></Button>
        ) : (
          <span className="text-xs text-muted-foreground">Tinjauan terakhir sebelum simpan</span>
        )}
      </div>

      {(effectiveCurrent?.hasil !== "pending" && item.history.length > 0) || activeSection === "review" ? (
        <Card id="riwayat" className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="p-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base"><History className="size-5 text-primary" />Riwayat Pemeriksaan</CardTitle>
              {hasHiddenHistory ? (
                <Button type="button" variant="ghost" className="h-8 rounded-full px-3 text-xs text-primary" onClick={() => setHistoryExpanded((value) => !value)}>
                  {historyExpanded ? "Ringkas" : "Lihat Semua"}
                  <ArrowRight className={historyExpanded ? "-rotate-90" : "rotate-0"} />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {item.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada riwayat pemeriksaan.</p>
            ) : (
              <div className="space-y-2.5">
                {visibleHistory.map((history, index) => (
                  <div key={history.pemeriksaan_id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5">
                    <div className="relative flex justify-center">
                      {index < visibleHistory.length - 1 ? <span className="absolute top-5 h-full w-px bg-border" aria-hidden="true" /> : null}
                      <span className={[
                        "relative z-10 mt-1.5 size-2.5 rounded-full border-2 bg-background",
                        index === 0 ? "border-primary bg-primary/15" : "border-border",
                      ].join(" ")} />
                    </div>
                    <div className={[
                      "rounded-2xl border border-border/60 px-3 py-2.5",
                      index === 0 ? "bg-emerald-50/40 dark:bg-emerald-950/10" : index % 2 === 0 ? "bg-card" : "bg-sky-50/30 dark:bg-sky-950/10",
                    ].join(" ")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{index === 0 ? "Pemeriksaan Terbaru" : "Pemeriksaan Sebelumnya"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatInspectionDateTime(history.diperiksa_at)}</p>
                        </div>
                        <Badge variant={history.hasil === "normal" ? "outline" : "secondary"} className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
                          {semanticInspectionLabel(history.hasil)}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-3 divide-x rounded-xl bg-background/70">
                        <div className="min-w-0 px-2 py-2"><p className="text-[10px] text-muted-foreground">Kelengkapan</p><p className="mt-0.5 truncate text-[11px] font-semibold">{semanticInspectionLabel(history.kelengkapan_status)}</p></div>
                        <div className="min-w-0 px-2 py-2"><p className="text-[10px] text-muted-foreground">Temuan</p><p className="mt-0.5 text-[11px] font-semibold">{history.findings.length}</p></div>
                        <div className="min-w-0 px-2 py-2"><p className="text-[10px] text-muted-foreground">Bukti</p><p className="mt-0.5 text-[11px] font-semibold">{history.evidences.length}</p></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="hidden items-center justify-between border-t pt-3 text-xs text-muted-foreground sm:flex">
        <span>Detail dibuat ringkas untuk operasional mobile.</span>
        <span>Alur tetap: Pengembalian → Pemeriksaan → Perawatan → Verifikasi Kesiapan.</span>
      </div>
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-xl rounded-3xl p-0">
          <DialogHeader className="border-b px-4 py-3"><div className="flex items-center justify-between"><div><DialogTitle>Bukti Foto Kondisi</DialogTitle><DialogDescription>Gunakan kamera belakang untuk mengambil bukti foto kondisi unit.</DialogDescription></div><Button type="button" variant="ghost" size="icon" aria-label="Tutup kamera" className="rounded-xl" onClick={() => setCameraOpen(false)}><X /></Button></div></DialogHeader>
          <div className="space-y-3 p-4">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" aria-label="Pratinjau kamera pemeriksaan" />
              {!cameraReady ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-5 text-center text-white"><Camera className="size-8" /><p className="font-semibold">{cameraError || "Meminta izin kamera…"}</p><p className="text-sm text-white/75">Anda tetap dapat memilih foto dari galeri bila kamera tidak tersedia.</p><Button type="button" variant="secondary" className="rounded-xl" onClick={() => galleryInputRef.current?.click()}><ImagePlus /> Pilih dari Galeri</Button></div> : null}
              {cameraReady ? <div className="pointer-events-none absolute inset-x-5 top-1/2 h-px -translate-y-1/2 bg-white/55" aria-hidden="true" /> : null}
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="size-11 rounded-full" onClick={() => galleryInputRef.current?.click()} aria-label="Pilih dari galeri"><ImagePlus /></Button>
              <Button type="button" size="icon-lg" className="mx-auto size-16 rounded-full border-4 border-background ring-2 ring-primary" disabled={!cameraReady || photoUploading} onClick={() => void captureCamera()} aria-label="Ambil foto"><Camera className="size-6" /></Button>
              <Button type="button" variant="outline" size="icon" className="size-11 rounded-full" onClick={() => setCameraError("Putar perangkat bila framing belum sesuai.")} aria-label="Bantuan kamera"><Video /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
