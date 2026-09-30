import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  ImagePlus,
  LockKeyhole,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
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

const FINDING_TYPES = ["damage", "loss", "missing_component", "dirty", "other"] as const;
const DECISIONS = ["ready_review", "cleaning_required", "maintenance_required", "unavailable", "follow_up_required", "no_action", "readiness_review"] as const;
const SECTIONS = [
  ["context", "Konteks"],
  ["result", "Hasil & Keputusan"],
  ["findings", "Temuan"],
  ["evidence", "Bukti Foto"],
  ["notes", "Catatan"],
  ["review", "Review & Simpan"],
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
    ready_review: "Readiness Review",
    readiness_review: "Readiness Review",
    cleaning_required: "Cleaning Required",
    maintenance_required: "Maintenance Required",
    unavailable: "Unavailable",
    follow_up_required: "Follow Up Required",
    no_action: "No Action",
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
  const [completionResult, setCompletionResult] = useState<{ decision: string; findingCount: number; evidenceCount: number } | null>(null);
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
    const key = crypto.randomUUID();
    setCommandRef({ key, type: "start" });
    try {
      const result = await startInspection(context.data.usahaId, id, workspace.data.unit.unit_barang_id, key);
      setFeedback(result.reused_draft ? "Draft pemeriksaan ditemukan dan dilanjutkan kembali." : "Pemeriksaan dimulai. Draft belum menjadi fakta final.");
      setActiveSection("result");
      await workspace.refetch();
    } catch (error) {
      const message = humanError(error, "Pemeriksaan gagal dimulai.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(message);
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
      const key = crypto.randomUUID();
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
      setCompletionResult({
        decision: result.keputusan_operasional,
        findingCount: result.finding_count,
        evidenceCount: workspace.data?.currentInspection?.evidences.length ?? 0,
      });
      setFeedback("Pemeriksaan tersimpan.");
      await Promise.all([
        workspace.refetch(),
        queryClient.invalidateQueries({ queryKey: ["pemeriksaan", "queue"] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
        queryClient.invalidateQueries({ queryKey: ["pengembalian"] }),
      ]);
    },
    onError: (error) => {
      const raw = error instanceof Error ? error.message : "Pemeriksaan gagal disimpan.";
      if (raw.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(raw);
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
        setFeedback("Command sudah committed. State pemeriksaan sedang disegarkan.");
        await workspace.refetch();
      } else if (result.state === "not_found") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Commitment belum ditemukan. Verifikasi state terbaru sebelum command baru.");
        await workspace.refetch();
      } else {
        setUnknownFeedback("Command masih UNKNOWN_OUTCOME. Jangan mengirim pemeriksaan kedua.");
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
    const key = crypto.randomUUID();
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
      if (raw.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback(raw);
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
              <p className="text-sm leading-6 text-muted-foreground">Pemeriksaan telah dicatat sebagai fakta inspection.</p>
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
                <div><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 font-semibold">Completed</p></div>
              </div>
            </div>
            <Alert className="relative w-full max-w-md text-left">
              <CircleAlert className="size-4" />
              <AlertTitle>Pemeriksaan selesai tidak otomatis membuat unit READY</AlertTitle>
              <AlertDescription>Keputusan berikutnya tetap mengikuti ownership Inventaris atau Perawatan.</AlertDescription>
            </Alert>
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
    <div className="space-y-4 pb-28 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl"><Link to="/pemeriksaan"><ArrowLeft />Kembali ke antrian</Link></Button>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Menu pemeriksaan"><MoreVertical /></Button>
      </div>

      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Pemeriksaan · {item.returnHeader.nomor_pengembalian}</p>
          <h1 className="truncate text-[26px] font-bold tracking-tight">{item.unit.kode_unit}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{item.unit.barang_nama ?? "-"}{item.unit.varian_nama ? " · " + item.unit.varian_nama : ""}</p>
        </div>
        <Badge variant={displayedState === "inspection_completed" ? "outline" : "secondary"} className="w-fit rounded-full px-3 py-1">{displayedState === "inspection_in_progress" ? "Dalam Proses" : displayedState === "inspection_completed" ? "Pemeriksaan Selesai" : "Menunggu Pemeriksaan"}</Badge>
      </header>

      {feedback ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>Status</AlertTitle><AlertDescription>{feedback}</AlertDescription></Alert> : null}
      {errorFeedback ? <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Pemeriksaan ditolak</AlertTitle><AlertDescription>{errorFeedback}</AlertDescription></Alert> : null}
      {unknownFeedback ? <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Command belum dapat dipastikan</AlertTitle><AlertDescription className="space-y-3"><p>Jangan kirim pemeriksaan kedua. Periksa state command terlebih dahulu.</p><p className="text-xs">{unknownFeedback}</p><Button variant="outline" size="sm" disabled={reconciling} onClick={() => void reconcile()}><RotateCcw />{reconciling ? "Memeriksa…" : "Periksa Status Command"}</Button></AlertDescription></Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden rounded-2xl border bg-card p-2 shadow-sm lg:block lg:self-start lg:sticky lg:top-4">
          <div className="px-3 py-3"><p className="text-xs font-medium text-muted-foreground">Workflow Pemeriksaan</p><p className="mt-1 text-sm font-semibold">{item.unit.kode_unit}</p></div>
          <nav aria-label="Bagian pemeriksaan" className="space-y-1">
            {SECTIONS.map(([value, label]) => {
              const active = activeSection === value;
              return <button key={value} type="button" onClick={() => setActiveSection(value)} className={`flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{label === "Temuan" ? `Temuan (${editableStarted ? summaryFindings.length : effectiveCurrent?.findings.length ?? 0})` : label}</button>;
            })}
          </nav>
          <div className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground"><p>Inspection completed tidak otomatis membuat unit READY.</p></div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1 shadow-sm lg:hidden" role="tablist" aria-label="Tahap pemeriksaan">
            {SECTIONS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeSection === value} onClick={() => setActiveSection(value)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeSection === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{label}</button>)}
          </div>

          {activeSection === "context" ? (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <Card className="rounded-2xl shadow-sm"><CardContent className="space-y-2 p-4"><p className="text-xs font-medium text-muted-foreground">Informasi Return</p><p className="text-lg font-bold">{item.returnHeader.nomor_pengembalian}</p><p className="text-sm text-muted-foreground">Diterima {formatInspectionDateTime(item.returnDetail.diterima_at)}</p><Badge variant="outline" className="rounded-full">Status: {semanticInspectionLabel(item.returnDetail.status_pemeriksaan)}</Badge></CardContent></Card>
                <Card className="rounded-2xl shadow-sm"><CardContent className="space-y-2 p-4"><p className="text-xs font-medium text-muted-foreground">Informasi Penyewa</p><p className="text-lg font-bold">{item.renter?.nama_lengkap ?? "-"}</p><p className="text-sm text-muted-foreground">{item.renter?.nomor_telepon ?? "Nomor telepon tidak tersedia"}</p></CardContent></Card>
                <Card className="rounded-2xl shadow-sm"><CardContent className="space-y-2 p-4"><p className="text-xs font-medium text-muted-foreground">Informasi Unit</p><p className="text-lg font-bold">{item.unit.kode_unit}</p><p className="text-sm text-muted-foreground">{item.unit.barang_nama ?? "-"}{item.unit.varian_nama ? " · " + item.unit.varian_nama : ""}</p><div className="flex flex-wrap gap-2"><Badge variant="secondary" className="rounded-full">Inventory: {semanticInspectionLabel(item.unit.status)}</Badge><Badge variant="outline" className="rounded-full">Inspection Pending</Badge></div></CardContent></Card>
              </div>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle className="text-base">Konteks Pemeriksaan</CardTitle><p className="text-sm text-muted-foreground">Pastikan informasi berikut sesuai dengan unit yang akan diperiksa.</p></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Detail Unit</p><p className="mt-2 text-sm font-semibold">{item.unit.kode_unit}</p><p className="mt-1 text-sm">{item.unit.barang_nama ?? "-"}</p><p className="text-sm text-muted-foreground">{item.unit.varian_nama ?? "Tanpa varian"}</p></div>
                  <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Riwayat Pemakaian</p><p className="mt-2 text-sm font-semibold">{item.returnHeader.penyewaan_id}</p><p className="mt-1 text-sm text-muted-foreground">Return terkait tercatat pada rental ini.</p></div>
                  <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Status Return</p><p className="mt-2 text-sm font-semibold">{semanticInspectionLabel(item.returnHeader.status)}</p><p className="mt-1 text-sm text-muted-foreground">Waktu diterima {formatInspectionDateTime(item.returnDetail.diterima_at)}</p></div>
                </CardContent>
              </Card>

              {!editableStarted && (item.unit.status === "inspection_pending" || canReinspect) ? (
                <Card className="rounded-2xl border-primary/20 bg-primary/[0.035] shadow-sm">
                  <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="font-semibold">{canReinspect ? "Pemeriksaan ulang tersedia" : "Unit menunggu pemeriksaan"}</p><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{canReinspect ? "Inspection sebelumnya tetap dipertahankan sebagai history. Mulai draft baru untuk pemeriksaan ulang." : "Mulai membuat draft inspection server-side. Start bukan completed dan belum membuat fakta final."}</p></div>
                    <Button className="h-11 rounded-xl sm:min-w-52" disabled={starting || Boolean(unknownFeedback)} onClick={() => void start()}>{starting ? "Memulai…" : canReinspect ? "Mulai Pemeriksaan Ulang" : "Mulai Pemeriksaan"}<ChevronRight /></Button>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}

          {activeSection === "result" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="text-base">Hasil & Keputusan</CardTitle><p className="text-sm text-muted-foreground">Nyatakan condition truth secara eksplisit. Evidence membantu pembuktian, bukan menjadi source of truth.</p></CardHeader>
              <CardContent className="space-y-6">
                {effectiveCurrent?.hasil === "pending" ? (
                  <>
                    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Hasil Pemeriksaan</legend><div className="grid gap-3 sm:grid-cols-2">
                      {([["normal", "Normal", "Unit dalam kondisi baik, tidak ada kerusakan.", CheckCircle2], ["issue_found", "Ada Temuan", "Ditemukan kerusakan, kehilangan, atau kondisi tidak normal.", CircleAlert]] as const).map(([value, label, desc, Icon]) => (
                        <button key={value} type="button" className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasil === value ? "border-primary bg-primary/[0.05] ring-1 ring-primary/25" : "hover:bg-accent/30"}`} onClick={() => setHasil(value)}>
                          <Icon className={`size-5 ${value === "normal" ? "text-emerald-600" : "text-amber-600"}`} /><p className="mt-3 font-semibold">{label}</p><p className="mt-1 text-sm leading-5 text-muted-foreground">{desc}</p>
                        </button>
                      ))}
                    </div></fieldset>

                    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Kelengkapan Unit</legend><div className="grid gap-2 sm:grid-cols-3">
                      {([["complete", "Lengkap"], ["incomplete", "Tidak Lengkap"], ["unknown", "Belum Diketahui"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setKelengkapanStatus(value)} className={`min-h-12 rounded-xl border px-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kelengkapanStatus === value ? "border-primary bg-primary/[0.05]" : "hover:bg-accent/30"}`}><span className="mr-2 inline-block size-2 rounded-full bg-primary align-middle" aria-hidden="true" />{label}</button>)}
                    </div></fieldset>

                    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Keputusan Operasional</legend><div className="grid gap-2 md:grid-cols-2">
                      {DECISIONS.map((value) => <button key={value} type="button" onClick={() => setKeputusan(value)} className={`min-h-14 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${keputusan === value ? "border-primary bg-primary/[0.05]" : "hover:bg-accent/30"}`}><p className="font-medium">{decisionLabel(value)}</p><p className="mt-1 text-xs text-muted-foreground">{nextInspectionAction(value)}</p></button>)}
                    </div></fieldset>
                  </>
                ) : effectiveCurrent ? (
                  <>
                    <Alert className="sm:col-span-3"><CircleAlert className="size-4" /><AlertTitle>Pemeriksaan selesai tidak otomatis membuat unit READY</AlertTitle><AlertDescription>Keputusan berikutnya tetap mengikuti ownership Inventaris atau Perawatan.</AlertDescription></Alert>
                    <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Hasil</p><p className="mt-1 font-semibold">{semanticInspectionLabel(effectiveCurrent.hasil)}</p></div>
                    <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Kelengkapan</p><p className="mt-1 font-semibold">{semanticInspectionLabel(effectiveCurrent.kelengkapan_status)}</p></div>
                    <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Keputusan</p><p className="mt-1 font-semibold">{decisionLabel(effectiveCurrent.keputusan_operasional)}</p></div>
                    </div>
                    <div className="rounded-2xl border bg-muted/20 p-4 sm:col-span-3"><p className="text-xs text-muted-foreground">Next Action</p><p className="mt-1 font-semibold">{nextInspectionAction(effectiveCurrent.keputusan_operasional)}</p></div>
                  </>
                ) : (
                  <Alert><AlertTitle>Belum ada draft pemeriksaan</AlertTitle><AlertDescription>Mulai pemeriksaan dari konteks unit untuk membuka hasil, kelengkapan, dan keputusan.</AlertDescription></Alert>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeSection === "findings" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Temuan / Finding</CardTitle><p className="text-sm text-muted-foreground">Catat fakta yang dapat diamati. Potential Cost bukan payment.</p></div>{effectiveCurrent?.hasil === "pending" && hasil === "issue_found" ? <Button type="button" variant="outline" className="rounded-xl" onClick={() => setFindings((list) => [...list, blankFinding()])}><Plus />Tambah Temuan</Button> : null}</CardHeader>
              <CardContent className="space-y-3">
                {effectiveCurrent?.hasil !== "pending" ? (
                  effectiveCurrent?.findings.length ? effectiveCurrent.findings.map((finding, index) => <div key={finding.temuan_pemeriksaan_id} className="rounded-2xl border p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Temuan {index + 1}</p><Badge variant="secondary" className="mt-2 rounded-full">{semanticInspectionLabel(finding.jenis_temuan)}</Badge></div><span className="text-xs text-muted-foreground">{finding.status_tindak_lanjut ?? "-"}</span></div><p className="mt-3 text-sm leading-6">{finding.deskripsi}</p>{finding.nominal_potensi_biaya != null ? <p className="mt-2 text-xs text-muted-foreground">Potensi biaya · {finding.currency_code ?? "IDR"} {finding.nominal_potensi_biaya.toLocaleString("id-ID")}</p> : null}</div>) : <div className="rounded-2xl border border-dashed p-6 text-center"><LockKeyhole className="mx-auto size-7 text-muted-foreground" /><p className="mt-2 font-semibold">Belum ada finding</p><p className="mt-1 text-sm text-muted-foreground">No Finding ≠ No Inspection. Hasil pemeriksaan tetap tercatat sebagai inspection truth.</p></div>
                ) : hasil === "normal" ? (
                  <Alert><CheckCircle2 className="size-4" /><AlertTitle>Normal</AlertTitle><AlertDescription>Hasil Normal tidak dapat memiliki finding. Ubah Hasil menjadi Ada Temuan untuk menambahkan fakta kondisi.</AlertDescription></Alert>
                ) : findings.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-8 text-center"><CircleAlert className="mx-auto size-7 text-amber-600" /><p className="mt-2 font-semibold">Belum ada temuan</p><p className="mt-1 text-sm text-muted-foreground">Ada Temuan memerlukan minimal satu finding sebelum dapat disimpan.</p><Button type="button" className="mt-4 rounded-xl" onClick={() => setFindings([blankFinding()])}><Plus /> Tambah Temuan</Button></div>
                ) : findings.map((finding, index) => (
                  <div key={index} className="space-y-4 rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3"><p className="font-semibold">Temuan {index + 1}</p><Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label={"Hapus temuan " + (index + 1)} onClick={() => setFindings((list) => list.filter((_, currentIndex) => currentIndex !== index))}><Trash2 /></Button></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">Jenis
                        <select className="h-11 rounded-xl border bg-background px-3" value={finding.jenis_temuan} onChange={(e) => changeFinding(index, { jenis_temuan: e.target.value as InspectionFindingInput["jenis_temuan"] })}>{FINDING_TYPES.map((type) => <option key={type} value={type}>{semanticInspectionLabel(type)}</option>)}</select>
                      </label>
                      <label className="grid gap-2 text-sm font-medium">Tingkat
                        <Input className="h-11 rounded-xl" value={finding.tingkat ?? ""} onChange={(e) => changeFinding(index, { tingkat: e.target.value })} placeholder="Catatan tingkat sesuai taxonomy" />
                      </label>
                    </div>
                    <label className="grid gap-2 text-sm font-medium">Deskripsi
                      <Textarea className="min-h-24 rounded-xl" value={finding.deskripsi} onChange={(e) => changeFinding(index, { deskripsi: e.target.value })} placeholder="Contoh: Resleting sisi kiri rusak" />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">Status Tindak Lanjut
                        <Input className="h-11 rounded-xl" value={finding.status_tindak_lanjut ?? "open"} onChange={(e) => changeFinding(index, { status_tindak_lanjut: e.target.value })} placeholder="Status sesuai contract" />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">Potensi Biaya
                        <Input className="h-11 rounded-xl" type="number" min="0" value={finding.nominal_potensi_biaya ?? ""} onChange={(e) => changeFinding(index, { nominal_potensi_biaya: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Bukan payment" />
                      </label>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {activeSection === "evidence" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="text-base">Bukti Foto Kondisi</CardTitle><p className="text-sm text-muted-foreground">Foto adalah evidence private, bukan source of truth. Bucket: rental-private-condition.</p></CardHeader>
              <CardContent className="space-y-4">
                {effectiveCurrent?.hasil === "pending" ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" className="h-12 rounded-xl" disabled={photoUploading || Boolean(unknownFeedback)} onClick={() => setCameraOpen(true)}><Camera />Ambil Foto</Button>
                      <Button type="button" variant="outline" className="h-12 rounded-xl" disabled={photoUploading || Boolean(unknownFeedback)} onClick={() => galleryInputRef.current?.click()}><ImagePlus />Pilih dari Galeri</Button>
                    </div>
                    <input ref={galleryInputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadEvidence(file); e.currentTarget.value = ""; }} />
                    <div className="rounded-2xl border border-dashed p-4 text-sm leading-6 text-muted-foreground"><LockKeyhole className="mb-2 size-4" /> Evidence disimpan private dengan path <code className="break-all text-xs">usaha_id/pemeriksaan_id/bukti_foto_kondisi_id/filename</code>. Tidak ada public image URL.</div>
                  </>
                ) : null}
                {photoUploading ? <Alert><Upload className="size-4" /><AlertTitle>Mengunggah evidence…</AlertTitle><AlertDescription>Object disimpan terlebih dahulu, kemudian metadata attachment dicatat lewat trusted command.</AlertDescription></Alert> : null}
                {effectiveCurrent?.evidences.length ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {effectiveCurrent.evidences.map((evidence) => <figure key={evidence.bukti_foto_kondisi_id} className="overflow-hidden rounded-2xl border bg-muted/20"><div className="aspect-square bg-muted">{evidence.signed_url ? <img src={evidence.signed_url} alt={"Evidence " + evidence.jenis_foto} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Upload /></div>}</div><figcaption className="space-y-1 p-3 text-xs"><p className="font-medium">{semanticInspectionLabel(evidence.jenis_foto)}</p><p className="text-muted-foreground">{formatInspectionDateTime(evidence.captured_at)}</p></figcaption></figure>)}
                  </div>
                ) : <div className="rounded-2xl border border-dashed p-8 text-center"><ImagePlus className="mx-auto size-7 text-muted-foreground" /><p className="mt-2 font-semibold">Belum ada evidence</p><p className="mt-1 text-sm text-muted-foreground">Ambil foto atau pilih dari galeri setelah draft inspection dimulai.</p></div>}
                {errorFeedback && photoUploading === false ? <Alert variant="destructive"><AlertTitle>Upload gagal</AlertTitle><AlertDescription>{errorFeedback}</AlertDescription></Alert> : null}
              </CardContent>
            </Card>
          ) : null}

          {activeSection === "notes" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="text-base">Catatan Pemeriksaan</CardTitle><p className="text-sm text-muted-foreground">Gunakan catatan untuk fakta yang membantu audit dan tindak lanjut.</p></CardHeader>
              <CardContent>
                {effectiveCurrent?.hasil === "pending" ? <Textarea className="min-h-40 rounded-2xl" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan objektif pemeriksaan..." /> : <div className="rounded-2xl border p-4 text-sm leading-6">{effectiveCurrent?.catatan ?? "Tidak ada catatan."}</div>}
              </CardContent>
            </Card>
          ) : null}

          {activeSection === "review" ? (
            <div className="space-y-4">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle className="text-base">Review & Simpan</CardTitle><p className="text-sm text-muted-foreground">Periksa kembali fakta sebelum command completion dikirim.</p></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Hasil Pemeriksaan", effectiveCurrent?.hasil === "pending" ? semanticInspectionLabel(hasil) : semanticInspectionLabel(effectiveCurrent?.hasil)],
                    ["Kelengkapan", effectiveCurrent?.hasil === "pending" ? semanticInspectionLabel(kelengkapanStatus) : semanticInspectionLabel(effectiveCurrent?.kelengkapan_status)],
                    ["Keputusan Operasional", effectiveCurrent?.hasil === "pending" ? decisionLabel(keputusan) : decisionLabel(effectiveCurrent?.keputusan_operasional ?? "-")],
                    ["Jumlah Temuan", String(effectiveCurrent?.hasil === "pending" ? summaryFindings.length : effectiveCurrent?.findings.length ?? 0)],
                    ["Jumlah Evidence", String(effectiveCurrent?.evidences.length ?? 0)],
                    ["Catatan", effectiveCurrent?.hasil === "pending" ? (catatan || "-") : (effectiveCurrent?.catatan || "-")],
                  ].map(([label, value]) => <div key={label} className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold leading-6">{value}</p></div>)}
                </CardContent>
              </Card>
              {effectiveCurrent?.hasil === "pending" ? (
                <>
                  {reviewBlocked ? <Alert variant="destructive"><AlertTitle>Review belum valid</AlertTitle><AlertDescription>{hasil === "normal" ? "Hasil Normal tidak boleh memiliki finding." : "Ada Temuan memerlukan minimal satu finding."}</AlertDescription></Alert> : null}
                  <Card className="rounded-2xl border-primary/15 bg-primary/[0.025] shadow-sm lg:sticky lg:bottom-4">
                    <CardContent className="space-y-3 p-4">
                      <Button className="h-12 w-full rounded-xl text-base" disabled={completeMutation.isPending || photoUploading || Boolean(unknownFeedback) || reviewBlocked} onClick={() => completeMutation.mutate()}>
                        {completeMutation.isPending ? "Menyimpan Pemeriksaan…" : <>Simpan Pemeriksaan <Check /></>}
                      </Button>
                      <p className="text-center text-xs leading-5 text-muted-foreground">Pemeriksaan selesai tidak otomatis membuat unit READY. Keputusan akan diteruskan ke readiness review atau Perawatan sesuai contract.</p>
                    </CardContent>
                  </Card>
                </>
              ) : <Alert><FileCheck2 className="size-4" /><AlertTitle>Pemeriksaan Completed</AlertTitle><AlertDescription>Pemeriksaan ini sudah menjadi fakta historis. Reinspection membuat record baru, bukan overwrite.</AlertDescription></Alert>}
            </div>
          ) : null}

          {activeSection !== "context" && !editableStarted && !effectiveCurrent ? <Alert><AlertTitle>Mulai Pemeriksaan terlebih dahulu</AlertTitle><AlertDescription>Context tersedia. Gunakan tombol Mulai Pemeriksaan untuk membuat draft server-side.</AlertDescription></Alert> : null}

          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" className="rounded-xl" disabled={sectionIndex === 0} onClick={previousSection}><ChevronLeft />Sebelumnya</Button>
            {sectionIndex < SECTIONS.length - 1 ? <Button type="button" className="rounded-xl" onClick={nextSection}>Lanjut <ChevronRight /></Button> : <span className="text-xs text-muted-foreground">Review terakhir sebelum simpan</span>}
          </div>

          {(effectiveCurrent?.hasil !== "pending" && item.history.length > 0) || activeSection === "review" ? (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="text-base">Inspection History</CardTitle><p className="text-sm text-muted-foreground">Current result dan historical inspection tidak saling menghapus.</p></CardHeader>
              <CardContent className="space-y-4">
                {item.history.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada history.</p> : item.history.map((history, index) => (
                  <div key={history.pemeriksaan_id} className="relative pl-7">
                    {index < item.history.length - 1 ? <div className="absolute left-2.5 top-7 h-[calc(100%+16px)] w-px bg-border" aria-hidden="true" /> : null}
                    <div className={`absolute left-0 top-1 grid size-5 place-items-center rounded-full border-2 ${index === 0 ? "border-primary bg-primary/10" : "border-muted-foreground/25 bg-background"}`}><span className="size-2 rounded-full bg-primary" /></div>
                    <div className="rounded-2xl border p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{index === 0 ? "Latest Inspection" : "Inspection " + (index + 1)}</p><p className="text-xs text-muted-foreground">{formatInspectionDateTime(history.diperiksa_at)} · {history.pemeriksaan_id}</p></div><Badge variant={history.hasil === "normal" ? "outline" : "secondary"} className="w-fit rounded-full">{semanticInspectionLabel(history.hasil)}</Badge></div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Kelengkapan</p><p className="mt-1 text-sm font-medium">{semanticInspectionLabel(history.kelengkapan_status)}</p></div><div><p className="text-xs text-muted-foreground">Keputusan</p><p className="mt-1 text-sm font-medium">{decisionLabel(history.keputusan_operasional)}</p></div><div><p className="text-xs text-muted-foreground">Finding</p><p className="mt-1 text-sm font-medium">{history.findings.length}</p></div><div><p className="text-xs text-muted-foreground">Evidence</p><p className="mt-1 text-sm font-medium">{history.evidences.length}</p></div></div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-xl rounded-3xl p-0">
          <DialogHeader className="border-b px-4 py-3"><div className="flex items-center justify-between"><div><DialogTitle>Bukti Foto Kondisi</DialogTitle><DialogDescription>Gunakan kamera belakang untuk menangkap evidence fisik.</DialogDescription></div><Button type="button" variant="ghost" size="icon" aria-label="Tutup kamera" className="rounded-xl" onClick={() => setCameraOpen(false)}><X /></Button></div></DialogHeader>
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
