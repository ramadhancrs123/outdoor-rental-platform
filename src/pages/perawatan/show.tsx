import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Info,
  MoreVertical,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRound,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { listInventoryUnitMedia } from "@/features/inventaris";
import {
  completeMaintenanceWithFinanceCashout,
  getMaintenanceWorkspace,
  getPerawatanContext,
  reconcileMaintenanceCommand,
  startMaintenance,
  verifyMaintenanceReadiness,
} from "@/features/perawatan";
import { getFinanceAccountSummary } from "@/features/keuangan";
import { localDateTimeToUtcIso } from "@/features/keuangan/utils";
import { MaintenanceFinanceCashout } from "@/components/perawatan/maintenance-finance-cashout";
import { formatMaintenanceDateTime, semanticMaintenanceLabel } from "@/features/perawatan/utils";
import { paths } from "@/routes/paths";

type CommandRef = {
  command: "start_maintenance" | "complete_maintenance" | "complete_maintenance_with_finance_cashout" | "verify_maintenance_readiness";
  key: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function durationLabel(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const start = new Date(startedAt).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return remainder + "m";
  return hours + "j " + String(remainder).padStart(2, "0") + "m";
}

function prettyDate(value: string | null) {
  if (!value) return "-";
  return formatMaintenanceDateTime(value);
}

function StatusTimeline({
  maintenanceStatus,
  unitStatus,
  startedAt,
  finishedAt,
  createdAt,
}: {
  maintenanceStatus: "planned" | "in_progress" | "completed" | "cancelled";
  unitStatus: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}) {
  const stages = [
    { label: "Direncanakan", short: createdAt ? prettyDate(createdAt) : "-", at: null, active: true },
    { label: "Dikerjakan", short: startedAt ? prettyDate(startedAt) : "-", active: maintenanceStatus !== "planned" && maintenanceStatus !== "cancelled" },
    { label: "Selesai", short: finishedAt ? prettyDate(finishedAt) : "-", active: maintenanceStatus === "completed" },
    { label: "Verifikasi", short: unitStatus === "ready" ? "Lulus" : "-", active: unitStatus === "ready" },
  ];

  const currentIndex =
    maintenanceStatus === "planned"
      ? 0
      : maintenanceStatus === "in_progress"
        ? 1
        : maintenanceStatus === "completed"
          ? 2
          : 0;

  return (
    <div className="px-1 py-1">
      <div className="grid grid-cols-4">
        {stages.map((stage, index) => {
          const passed = stage.active && index < currentIndex;
          const current = index === currentIndex;
          return (
            <div key={stage.label} className="relative min-w-0">
              {index < stages.length - 1 ? (
                <span
                  className={[
                    "absolute left-[calc(50%+9px)] right-[calc(-50%+9px)] top-2.5 h-px",
                    index < currentIndex ? "bg-emerald-500" : "bg-border",
                  ].join(" ")}
                  aria-hidden="true"
                />
              ) : null}
              <div className="relative z-10 flex flex-col items-center text-center">
                <div
                  className={[
                    "grid size-5 place-items-center rounded-full border-2 bg-background",
                    current
                      ? maintenanceStatus === "planned"
                        ? "border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-950/25"
                        : maintenanceStatus === "in_progress"
                          ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/25"
                          : "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/25"
                      : passed
                        ? "border-emerald-500 text-emerald-600"
                        : "border-border text-muted-foreground",
                  ].join(" ")}
                >
                  {passed || current && maintenanceStatus === "completed" ? (
                    <Check className="size-3" />
                  ) : current ? (
                    <span className="size-1.5 rounded-full bg-current" />
                  ) : (
                    <Circle className="size-2.5" />
                  )}
                </div>
                <p className={["mt-1.5 text-[10px]", current ? "font-semibold text-foreground" : "text-muted-foreground"].join(" ")}>
                  {stage.label}
                </p>
                <p className="mt-0.5 max-w-[78px] truncate text-[9px] text-muted-foreground">{stage.short}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactRow({
  icon,
  title,
  meta,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  value?: string;
  onClick?: () => void;
}) {
  const body = (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/45 text-foreground/80">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {meta ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      {value ? <span className="max-w-[45%] truncate text-xs font-medium text-muted-foreground">{value}</span> : null}
      {onClick ? <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground" /> : null}
    </div>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full text-left">
      {body}
    </button>
  ) : (
    <div>{body}</div>
  );
}

export function PerawatanShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [feedback, setFeedback] = useState("");
  const [errorFeedback, setErrorFeedback] = useState("");
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [commandRef, setCommandRef] = useState<CommandRef | null>(null);
  const [executor, setExecutor] = useState("");
  const [executorSearch, setExecutorSearch] = useState("");
  const [executorOpen, setExecutorOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [cashoutAt, setCashoutAt] = useState("");
  const [accountAllocations, setAccountAllocations] = useState<Record<string, string>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

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

  const unitMedia = useQuery({
    queryKey: ["perawatan", "unit-media", context.data?.usahaId, workspace.data?.unit.unit_barang_id],
    queryFn: () => listInventoryUnitMedia(context.data!.usahaId, workspace.data!.unit.unit_barang_id),
    enabled: Boolean(context.data?.usahaId && workspace.data?.unit.unit_barang_id),
    staleTime: 30_000,
  });

  const financeAccounts = useQuery({
    queryKey: ["perawatan", "finance-accounts", context.data?.usahaId],
    queryFn: () => getFinanceAccountSummary(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && workspace.data?.maintenance.status === "in_progress"),
    staleTime: 5_000,
  });

  const availableFinanceAccounts = financeAccounts.data?.accounts ?? [];
  const selectedCost = Number(cost);
  const cashoutAmount = Number.isFinite(selectedCost) && selectedCost >= 0 ? selectedCost : 0;
  const currentBusinessDateTime = useMemo(() => {
    if (!context.data?.businessTimezone) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: context.data.businessTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return String(map.year) + "-" + String(map.month) + "-" + String(map.day) + "T" + (map.hour === "24" ? "00" : map.hour) + ":" + String(map.minute);
  }, [context.data?.businessTimezone]);

  useEffect(() => {
    if (!cashoutAt && currentBusinessDateTime) setCashoutAt(currentBusinessDateTime);
  }, [cashoutAt, currentBusinessDateTime]);

  const invalidate = async () => {
    await Promise.all([
      workspace.refetch(),
      financeAccounts.refetch(),
      queryClient.invalidateQueries({ queryKey: ["perawatan", "queue"] }),
      queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
      queryClient.invalidateQueries({ queryKey: ["pemeriksaan"] }),
      queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !workspace.data) throw new Error("Perawatan belum siap.");
      const key = "start-maintenance-" + createClientId();
      setCommandRef({ command: "start_maintenance", key });
      return startMaintenance(
        context.data.usahaId,
        workspace.data.maintenance.perawatan_id,
        workspace.data.maintenance.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => {
      setFeedback("");
      setErrorFeedback("");
      setUnknownFeedback("");
    },
    onSuccess: async () => {
      setCommandRef(null);
      setFeedback("Perawatan dimulai.");
      await invalidate();
    },
    onError: (error) => {
      const message = errorMessage(error, "Perawatan gagal dimulai.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setUnknownFeedback("Hasil mulai perawatan belum dapat dipastikan. Jangan memulai perawatan kedua.");
      } else {
        setErrorFeedback(message);
      }
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !workspace.data) throw new Error("Perawatan belum siap.");
      const parsedCost = cost.trim() === "" ? null : Number(cost);
      if (parsedCost === null || !Number.isFinite(parsedCost) || parsedCost < 0) {
        throw new Error("Biaya aktual wajib diisi dengan angka nol atau lebih.");
      }
      const allocations = Object.entries(accountAllocations)
        .map(([akunKeuanganId, value]) => ({ akunKeuanganId, amount: Number(value) }))
        .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
      if (parsedCost > 0 && allocations.length === 0) {
        throw new Error("Biaya aktual di atas nol membutuhkan akun uang untuk cash out.");
      }
      if (parsedCost > 0 && Math.abs(allocations.reduce((sum, item) => sum + item.amount, 0) - parsedCost) > 0.000001) {
        throw new Error("Total alokasi akun harus sama dengan biaya aktual.");
      }

      const key = "complete-maintenance-finance-cashout-" + createClientId();
      setCommandRef({ command: "complete_maintenance_with_finance_cashout", key });
      const diselesaikanAt = cashoutAt ? localDateTimeToUtcIso(cashoutAt, context.data.businessTimezone) : null;

      return completeMaintenanceWithFinanceCashout(
        context.data.usahaId,
        {
          perawatanId: workspace.data.maintenance.perawatan_id,
          pelaksana: executor,
          biaya: parsedCost,
          currencyCode: "IDR",
          catatan: note,
          allocations,
          diselesaikanAt,
        },
        workspace.data.maintenance.updated_at,
        workspace.data.unit.updated_at,
        key,
      );
    },
    onMutate: () => {
      setFeedback("");
      setErrorFeedback("");
      setUnknownFeedback("");
    },
    onSuccess: async () => {
      setCommandRef(null);
      setCompletionOpen(false);
      setFeedback("Perawatan selesai dicatat. Lanjutkan ke verifikasi kesiapan.");
      setAccountAllocations({});
      await invalidate();
    },
    onError: async (error) => {
      const message = errorMessage(error, "Perawatan gagal diselesaikan.");
      await financeAccounts.refetch();
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setUnknownFeedback("Hasil penyelesaian, pengeluaran, atau cash out belum dapat dipastikan. Jangan mengulang tindakan.");
      } else {
        setErrorFeedback(message);
      }
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async (verificationResult: "passed" | "failed") => {
      if (!context.data || !workspace.data) throw new Error("Perawatan belum siap.");
      const key = "verify-maintenance-" + createClientId();
      setCommandRef({ command: "verify_maintenance_readiness", key });
      return verifyMaintenanceReadiness(
        context.data.usahaId,
        {
          perawatanId: workspace.data.maintenance.perawatan_id,
          verificationResult,
          catatan: verificationNote,
        },
        workspace.data.maintenance.updated_at,
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
      setFeedback(
        result.verification_result === "passed"
          ? "Verifikasi LULUS. Inventaris menetapkan unit Siap Disewakan."
          : "Verifikasi GAGAL. Unit tetap belum Siap Disewakan.",
      );
      setVerificationNote("");
      await invalidate();
      navigate(paths.perawatan, { replace: true });
    },
    onError: (error) => {
      const message = errorMessage(error, "Verifikasi gagal diproses.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setUnknownFeedback("Hasil verifikasi belum dapat dipastikan. Periksa status tindakan.");
      } else {
        setErrorFeedback(message);
      }
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
        setFeedback("Perubahan sudah disimpan. Status terbaru sedang diperbarui.");
        await workspace.refetch();
      } else if (result.state === "not_found") {
        setCommandRef(null);
        setUnknownFeedback("");
        setFeedback("Command tidak ditemukan. Muat data terbaru sebelum mencoba lagi.");
        await workspace.refetch();
      } else {
        setUnknownFeedback("Hasil tindakan belum dapat dipastikan. Jangan mengulang tindakan.");
      }
    } catch (error) {
      setUnknownFeedback(errorMessage(error, "Rekonsiliasi gagal."));
    } finally {
      setReconciling(false);
    }
  };

  if (context.isPending || workspace.isPending) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3 pb-20">
        <Skeleton className="h-8 rounded-xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (context.error || workspace.error || !context.data || !workspace.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Workspace perawatan tidak tersedia</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{context.error?.message ?? errorMessage(workspace.error, "Data perawatan tidak ditemukan.")}</span>
          <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
            <RefreshCw />
            Muat ulang
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { maintenance, unit, sourceInspection, findings, history, verification_result } = workspace.data;
  const isPlanned = maintenance.status === "planned";
  const isInProgress = maintenance.status === "in_progress";
  const isCompleted = maintenance.status === "completed";
  const duration = durationLabel(maintenance.dimulai_at, maintenance.selesai_at);
  const coverUrl = unitMedia.data?.find((media) => media.is_cover)?.signed_url ?? unitMedia.data?.[0]?.signed_url ?? null;
  const reasonText = sourceInspection?.catatan?.trim() || findings[0]?.deskripsi?.trim() || maintenance.catatan?.trim() || "-";
  const activeAccounts = availableFinanceAccounts.filter((account) => account.status === "active" && account.mata_uang === "IDR");
  const selectedAccount = activeAccounts.find((account) => account.akun_keuangan_id === selectedAccountId) ?? activeAccounts[0] ?? null;
  const visibleHistory = timelineOpen ? history : history.slice(0, 4);
  const executorOptions = Array.from(
    new Set(
      [context.data.akunAdminNama, maintenance.pelaksana, executor]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const filteredExecutorOptions = executorOptions.filter((value) =>
    value.toLowerCase().includes(executorSearch.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto w-full max-w-xl pb-28 sm:pb-10">
      <header className="flex items-center justify-between gap-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" aria-label="Kembali ke Perawatan">
            <Link to={paths.perawatan}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">Detail Perawatan</p>
            <p className="truncate text-[11px] text-muted-foreground">{unit.kode_unit}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Menu perawatan">
          <MoreVertical />
        </Button>
      </header>

      {feedback ? (
        <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <p>{feedback}</p>
          </div>
        </div>
      ) : null}

      {errorFeedback ? (
        <Alert variant="destructive" className="mt-2 rounded-2xl">
          <ShieldAlert className="size-4" />
          <AlertTitle>Perawatan belum diperbarui</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorFeedback}</p>
            <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
              <RefreshCw />
              Muat Data Terbaru
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {unknownFeedback ? (
        <Alert variant="destructive" className="mt-2 rounded-2xl">
          <ShieldAlert className="size-4" />
          <AlertTitle>Permintaan belum dapat dipastikan</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Perubahan mungkin sudah diproses, tetapi hasil belum diterima perangkat. Jangan mengulang tindakan.</p>
            <Button variant="outline" size="sm" disabled={reconciling} onClick={() => void reconcile()}>
              {reconciling ? "Memeriksa..." : "Periksa Status Tindakan"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="mt-2 rounded-2xl border border-border/70 bg-background px-3.5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-[64px] shrink-0 place-items-center overflow-hidden rounded-2xl border bg-muted/30">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <Package className="size-7 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-[16px] font-bold">{unit.kode_unit}</p>
              <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px]">
                {semanticMaintenanceLabel(unit.status)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {unit.barang_nama ?? "Barang"}{unit.varian_nama ? " · " + unit.varian_nama : ""}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-xl px-3 text-xs">
            <Link to={paths.inventaris + "/" + unit.unit_barang_id}>
              Lihat Unit <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        <div className="mt-4">
          <StatusTimeline
            maintenanceStatus={maintenance.status}
            unitStatus={unit.status}
            startedAt={maintenance.dimulai_at}
            finishedAt={maintenance.selesai_at}
            createdAt={maintenance.created_at}
          />
        </div>
      </section>

      {isInProgress ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-blue-200/70 bg-blue-50/55 px-3.5 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
              <Wrench className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Sedang Dikerjakan</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Perawatan sedang berlangsung.</p>
            </div>
          </div>
          {duration ? (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-700 dark:text-blue-200">
              <Clock3 className="mr-1 inline size-3.5" />
              {duration}
            </span>
          ) : null}
        </div>
      ) : null}

      {isCompleted ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-3.5 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
              <CheckCircle2 className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Perawatan Selesai</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Pekerjaan perawatan telah diselesaikan.</p>
            </div>
          </div>
          {duration ? <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-200">Durasi {duration}</span> : null}
        </div>
      ) : null}

      {isPlanned ? (
        <>
          <section className="mt-3 rounded-2xl border border-amber-200/70 bg-amber-50/55 px-3.5 py-3 dark:border-amber-900/40 dark:bg-amber-950/15">
            <div className="flex items-start gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/45 dark:text-amber-200">
                <Wrench className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">Perlu Perawatan</p>
                  <Badge className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-200/70">Perbaikan</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{reasonText}</p>
              </div>
            </div>
          </section>

          <section className="mt-3 rounded-2xl border border-border/70 px-3.5">
            <CompactRow
              icon={<FileText className="size-4" />}
              title="Detail Pekerjaan"
              meta={maintenance.deskripsi_pekerjaan}
            />
            <div className="border-t border-border/60">
              <CompactRow
                icon={<UserRound className="size-4" />}
                title="Pelaksana"
                meta={executor || "Belum ditentukan"}
                value={executor ? "Ubah" : "Pilih"}
                onClick={() => {
                  setExecutorSearch("");
                  setExecutorOpen(true);
                }}
              />
            </div>
            <div className="border-t border-border/60">
              <CompactRow
                icon={<Info className="size-4" />}
                title="Informasi Tambahan"
                meta={sourceInspection ? "Berasal dari Pemeriksaan" : "Perawatan dibuat manual"}
                value={infoOpen ? "Tutup" : "Buka"}
                onClick={() => setInfoOpen((value) => !value)}
              />
            </div>
            <div className="border-t border-border/60">
              <CompactRow
                icon={<History className="size-4" />}
                title="Riwayat Unit"
                meta={history.length + " aktivitas tersimpan"}
                onClick={() => setTimelineOpen((value) => !value)}
              />
            </div>
          </section>
        </>
      ) : null}

      {isInProgress ? (
        <section className="mt-3 rounded-2xl border border-border/70 px-3.5 py-1">
          <div className="py-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <p className="text-sm font-semibold">Pekerjaan</p>
            </div>
            <div className="mt-2 rounded-xl border bg-background px-3 py-2.5">
              <p className="text-sm leading-5 text-muted-foreground">{maintenance.deskripsi_pekerjaan}</p>
            </div>
          </div>

          <div className="border-t border-border/60 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-primary" />
                <p className="text-sm font-semibold">Pelaksana</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg px-2.5 text-xs"
                onClick={() => {
                  setExecutorSearch("");
                  setExecutorOpen(true);
                }}
              >
                {executor ? "Ubah" : "Pilih"}
              </Button>
            </div>
            <p className="mt-1.5 text-sm font-semibold">{executor || "Belum ditentukan"}</p>
          </div>

          <div className="border-t border-border/60 py-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <p className="text-sm font-semibold">Catatan Pekerjaan</p>
            </div>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-24 rounded-xl"
              placeholder="Catat pekerjaan yang sudah dilakukan dan diuji."
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">{note.length}/500</p>
          </div>

          <div className="border-t border-border/60 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <WalletCards className="size-4 text-primary" />
                <p className="text-sm font-semibold">Biaya & Keuangan</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1.5 text-xs font-medium">
                Biaya Aktual
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">Rp</span>
                  <Input
                    aria-label="Biaya aktual"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    className="h-11 rounded-xl pl-10 text-right font-semibold"
                    value={cost}
                    onChange={(event) => {
                      setCost(event.target.value);
                      setAccountAllocations({});
                    }}
                    placeholder="0"
                  />
                </div>
              </label>

              <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50/55 px-3 py-2.5 dark:bg-emerald-950/15">
                <div className="flex min-w-0 items-center gap-2">
                  <WalletCards className="size-4 shrink-0 text-emerald-700 dark:text-emerald-200" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">Sumber Uang</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {selectedAccount ? selectedAccount.nama_akun : "Akan dipilih saat menyelesaikan"}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                  {selectedAccount ? "Saldo " + new Intl.NumberFormat("id-ID").format(Number(selectedAccount.saldo)) : "-"}
                </span>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Pengeluaran dan cash out akan dicatat dalam tindakan penyelesaian yang sama.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {isCompleted ? (
        <>
          <section className="mt-3 rounded-2xl border border-border/70 px-3.5">
            <div className="py-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <p className="text-sm font-semibold">Ringkasan Hasil</p>
              </div>
              <div className="mt-2 rounded-xl border bg-background px-3 py-2.5 text-sm leading-5 text-muted-foreground">
                {note || maintenance.catatan || "Pekerjaan perawatan sudah selesai dicatat."}
              </div>
            </div>
            <div className="border-t border-border/60">
              <CompactRow icon={<UserRound className="size-4" />} title="Pelaksana" value={executor || maintenance.pelaksana || "-"} />
            </div>
            <div className="border-t border-border/60 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <WalletCards className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Biaya & Keuangan</p>
                </div>
                {maintenance.biaya != null ? (
                  <span className="text-sm font-bold tabular-nums">Rp {new Intl.NumberFormat("id-ID").format(Number(maintenance.biaya))}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Tanpa biaya</span>
                )}
              </div>
              {maintenance.biaya != null && Number(maintenance.biaya) > 0 ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50/55 px-3 py-2.5 text-xs text-emerald-900 dark:bg-emerald-950/15 dark:text-emerald-100">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Pengeluaran Dicatat</p>
                    <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">Cash out merupakan bagian dari penyelesaian perawatan.</p>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="border-t border-border/60">
              <CompactRow
                icon={<Info className="size-4" />}
                title="Informasi Lainnya"
                meta={sourceInspection ? "Sumber Pemeriksaan" : "Perawatan Manual"}
                value={infoOpen ? "Tutup" : "Buka"}
                onClick={() => setInfoOpen((value) => !value)}
              />
            </div>
            <div className="border-t border-border/60">
              <CompactRow
                icon={<History className="size-4" />}
                title="Riwayat Unit"
                meta={history.length + " aktivitas terakhir"}
                onClick={() => setTimelineOpen((value) => !value)}
              />
            </div>
          </section>
        </>
      ) : null}

      {infoOpen ? (
        <section className="mt-2 rounded-2xl border border-border/70 px-3.5 py-3">
          <div className="grid gap-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Sumber</span>
              <span className="font-semibold">{sourceInspection ? "Pemeriksaan" : "Manual"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Jenis</span>
              <span className="font-semibold">{semanticMaintenanceLabel(maintenance.jenis_perawatan)}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Dibuat</span>
              <span className="text-right font-semibold">{prettyDate(maintenance.created_at)}</span>
            </div>
            {sourceInspection?.catatan ? (
              <div className="border-t border-border/60 pt-2">
                <p className="text-muted-foreground">Catatan Pemeriksaan</p>
                <p className="mt-1 leading-5">{sourceInspection.catatan}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {timelineOpen ? (
        <section className="mt-2 rounded-2xl border border-border/70 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Riwayat Unit</p>
              <p className="text-[11px] text-muted-foreground">Urutan kejadian unit yang tercatat di sistem.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => setTimelineOpen(false)} aria-label="Tutup riwayat">
              <X className="size-4" />
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {visibleHistory.map((entry) => (
              <div key={entry.riwayat_unit_id} className="flex items-start gap-2.5 border-t border-border/60 pt-2.5 first:border-t-0 first:pt-0">
                <div className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-muted">
                  <Clock3 className="size-3 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold">{semanticMaintenanceLabel(entry.jenis_kejadian)}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{prettyDate(entry.terjadi_at)}</span>
                  </div>
                  {entry.catatan ? <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{entry.catatan}</p> : null}
                </div>
              </div>
            ))}
            {history.length > 4 ? (
              <Button type="button" variant="ghost" className="h-8 w-full rounded-lg text-xs" onClick={() => setTimelineOpen((value) => !value)}>
                {timelineOpen ? "Ringkas" : "Lihat Semua"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {isCompleted ? (
        <section id="verifikasi" className="mt-3 scroll-mt-4 rounded-2xl border border-border/70 px-3.5 py-3">
          {verification_result === "passed" ? (
            <div className="flex items-start gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                <PackageCheck className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Unit Siap Disewakan</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Verifikasi kesiapan sudah lulus dan Inventaris menetapkan unit siap digunakan untuk rental.</p>
              </div>
            </div>
          ) : verification_result === "failed" ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                  <ShieldAlert className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Verifikasi Tidak Lulus</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Unit tetap belum siap dan memerlukan tindak lanjut.</p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-10 w-full rounded-xl">
                <Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}>
                  Buka Pemeriksaan <ExternalLink />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                  <Clock3 className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Verifikasi Kesiapan</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Pekerjaan selesai, tetapi unit belum dianggap siap tanpa verifikasi.</p>
                </div>
              </div>
              <Textarea
                value={verificationNote}
                onChange={(event) => setVerificationNote(event.target.value)}
                placeholder="Catatan hasil uji setelah perawatan"
                aria-label="Catatan verifikasi"
                className="min-h-20 rounded-xl"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-11 rounded-xl" disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("passed")}>
                  Verifikasi Lulus
                </Button>
                <Button variant="outline" className="h-11 rounded-xl" disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("failed")}>
                  Verifikasi Gagal
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 py-3 backdrop-blur lg:static lg:mt-3 lg:rounded-2xl lg:border lg:bg-background lg:px-4">
        <div className="mx-auto w-full max-w-xl">
          {isPlanned ? (
            <Button className="h-12 w-full rounded-2xl text-sm font-semibold" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
              {startMutation.isPending ? "Memulai Perawatan..." : "Mulai Perawatan"}
              <ArrowRight />
            </Button>
          ) : null}

          {isInProgress ? (
            <Button
              className="h-12 w-full rounded-2xl text-sm font-semibold"
              disabled={completeMutation.isPending}
              onClick={() => setCompletionOpen(true)}
            >
              <CheckCircle2 />
              Selesaikan Perawatan
              <ArrowRight />
            </Button>
          ) : null}

          {isCompleted ? (
            <Button
              className="h-12 w-full rounded-2xl text-sm font-semibold"
              onClick={() => document.getElementById("verifikasi")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Lanjut ke Verifikasi
              <ArrowRight />
            </Button>
          ) : null}
        </div>
      </div>

      <Drawer open={executorOpen} onOpenChange={setExecutorOpen}>
        <DrawerContent className="rounded-t-[28px]">
          <DrawerHeader className="border-b px-4 pb-3 pt-2 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DrawerTitle className="text-lg">Pilih Pelaksana</DrawerTitle>
                <DrawerDescription>Pilih dari nama yang sudah ada atau masukkan nama pelaksana.</DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Tutup pilih pelaksana">
                  <X />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={executorSearch}
                onChange={(event) => setExecutorSearch(event.target.value)}
                placeholder="Cari nama pelaksana..."
                className="h-11 rounded-2xl pl-9"
              />
            </div>

            <div className="mt-3 divide-y rounded-2xl border">
              {filteredExecutorOptions.map((name) => {
                const selected = executor === name;
                return (
                  <button
                    type="button"
                    key={name}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                    onClick={() => {
                      setExecutor(name);
                      setExecutorOpen(false);
                    }}
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase())
                        .join("")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{name}</p>
                      <p className="text-[11px] text-muted-foreground">{name === context.data.akunAdminNama ? "Akun admin aktif" : "Nama pelaksana tersimpan"}</p>
                    </div>
                    {selected ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}

              {executorSearch.trim() && !executorOptions.some((name) => name.toLowerCase() === executorSearch.trim().toLowerCase()) ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-primary"
                  onClick={() => {
                    setExecutor(executorSearch.trim());
                    setExecutorOpen(false);
                  }}
                >
                  <div className="grid size-9 place-items-center rounded-full bg-primary/10">
                    <UserRound className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Gunakan “{executorSearch.trim()}”</p>
                    <p className="text-[11px] text-muted-foreground">Nama ini akan disimpan sebagai pelaksana.</p>
                  </div>
                </button>
              ) : null}
            </div>

            {filteredExecutorOptions.length === 0 && !executorSearch.trim() ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Belum ada nama pelaksana lain yang tersedia.</div>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={completionOpen} onOpenChange={setCompletionOpen}>
        <DrawerContent className="max-h-[88vh] rounded-t-[28px]">
          <DrawerHeader className="border-b px-4 pb-3 pt-2 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DrawerTitle className="text-lg">Selesaikan Perawatan</DrawerTitle>
                <DrawerDescription>Catat hasil akhir, biaya aktual, dan sumber uang sebelum pekerjaan ditetapkan selesai.</DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Tutup penyelesaian perawatan">
                  <X />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="max-h-[calc(88vh-110px)] overflow-y-auto px-4 pb-4 pt-3">
            <div className="space-y-4">
              <label className="grid gap-1.5 text-xs font-medium">
                Catatan Akhir
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Perbaikan selesai, unit sudah diuji dan normal. Siap digunakan kembali."
                  className="min-h-24 rounded-2xl"
                />
                <span className="text-right text-[10px] font-normal text-muted-foreground">{note.length}/500</span>
              </label>

              <label className="grid gap-1.5 text-xs font-medium">
                Biaya Aktual
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">Rp</span>
                  <Input
                    aria-label="Biaya aktual penyelesaian"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={cost}
                    onChange={(event) => {
                      setCost(event.target.value);
                      setAccountAllocations({});
                    }}
                    placeholder="0"
                    className="h-12 rounded-2xl pl-10 text-right font-semibold"
                  />
                </div>
              </label>

              <MaintenanceFinanceCashout
                accounts={availableFinanceAccounts}
                amount={cashoutAmount}
                allocations={accountAllocations}
                onAllocationsChange={setAccountAllocations}
                selectedAccountId={selectedAccountId}
                onSelectedAccountChange={setSelectedAccountId}
                onProceed={() => completeMutation.mutate()}
                disabled={financeAccounts.isPending || Boolean(financeAccounts.error) || !cost.trim()}
                isPending={completeMutation.isPending}
                setupHref={paths.keuangan + "/akun"}
              />

              <details className="rounded-2xl border border-border/60 px-3.5 py-3">
                <summary className="cursor-pointer text-xs font-semibold">Waktu transaksi</summary>
                <div className="mt-3 grid gap-1.5">
                  <label className="grid gap-1.5 text-xs font-medium">
                    Waktu cash out
                    <Input type="datetime-local" value={cashoutAt} onChange={(event) => setCashoutAt(event.target.value)} className="h-11 rounded-xl" />
                  </label>
                  <p className="text-[10px] text-muted-foreground">Zona waktu usaha: {context.data.businessTimezone}</p>
                </div>
              </details>
            </div>
          </div>

          <DrawerFooter className="border-t bg-background px-4 py-3">
            <p className="text-[11px] leading-5 text-muted-foreground">
              Penyelesaian akan memperbarui status perawatan dan menjalankan cash out Finance sesuai aturan yang sama seperti form sebelumnya.
            </p>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
