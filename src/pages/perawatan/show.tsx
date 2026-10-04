import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
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
  ShieldAlert,
  Tag,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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

type CompletionSuccess = {
  findingCount: number;
  cost: number | null;
  decision: string;
  pengeluaranId: string | null;
  settlementAllocations: Array<{ akun_keuangan_id: string; amount: number }>;
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
  const [cashoutAt, setCashoutAt] = useState("");
  const [accountAllocations, setAccountAllocations] = useState<Record<string, string>>({});
  const [reconciling, setReconciling] = useState(false);
  const [completionSuccess, setCompletionSuccess] = useState<CompletionSuccess | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

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

  useEffect(() => {
    if (!executor.trim() && context.data?.akunAdminNama?.trim()) {
      setExecutor(context.data.akunAdminNama.trim());
    }
  }, [context.data?.akunAdminNama, executor]);

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
    onMutate: () => { setFeedback(""); setErrorFeedback(""); setUnknownFeedback(""); },
    onSuccess: async () => { setCommandRef(null); setFeedback("Perawatan dimulai."); await invalidate(); },
    onError: (error) => {
      const message = errorMessage(error, "Perawatan gagal dimulai.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil mulai perawatan belum dapat dipastikan. Jangan memulai perawatan kedua.");
      else setErrorFeedback(message);
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
    onMutate: () => { setFeedback(""); setErrorFeedback(""); setUnknownFeedback(""); },
    onSuccess: async (result) => {
      setCommandRef(null);
      const settlement = (result.settlement as { allocations?: Array<{ akun_keuangan_id: string; amount: number }> } | null) ?? null;
      setCompletionSuccess({
        findingCount: workspace.data?.findings.length ?? 0,
        cost: typeof result.biaya === "number" ? result.biaya : Number(cost),
        decision: "maintenance_completed",
        pengeluaranId: typeof result.pengeluaran_id === "string" ? result.pengeluaran_id : null,
        settlementAllocations: settlement?.allocations ?? [],
      });
      setAccountAllocations({});
      await invalidate();
    },
    onError: async (error) => {
      const message = errorMessage(error, "Perawatan gagal diselesaikan.");
      await financeAccounts.refetch();
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil penyelesaian, pengeluaran, atau cash out belum dapat dipastikan. Jangan mengulang tindakan.");
      else setErrorFeedback(message);
    },
  });

  const verificationMutation = useMutation({
    mutationFn: async (verificationResult: "passed" | "failed") => {
      if (!context.data || !workspace.data) throw new Error("Perawatan belum siap.");
      const key = "verify-maintenance-" + createClientId();
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
      setFeedback(result.verification_result === "passed" ? "Verifikasi LULUS. Inventaris menetapkan unit Siap Disewakan." : "Verifikasi GAGAL. Unit tetap belum Siap Disewakan.");
      setVerificationNote("");
      await invalidate();
    },
    onError: (error) => {
      const message = errorMessage(error, "Verifikasi gagal diproses.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) setUnknownFeedback("Hasil verifikasi belum dapat dipastikan. Periksa status tindakan.");
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
    return <div className="space-y-4"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-[500px] rounded-2xl" /></div>;
  }

  if (context.error || workspace.error || !context.data || !workspace.data) {
    return <Alert variant="destructive"><AlertTitle>Workspace perawatan tidak tersedia</AlertTitle><AlertDescription className="flex flex-col gap-3"><span>{context.error?.message ?? errorMessage(workspace.error, "Data perawatan tidak ditemukan.")}</span><Button variant="outline" size="sm" onClick={() => void workspace.refetch()}><RefreshCw />Muat ulang</Button></AlertDescription></Alert>;
  }

  const { maintenance, unit, sourceInspection, findings, history, verification_result } = workspace.data;
  const isStartable = maintenance.status === "planned";
  const isCompletable = maintenance.status === "in_progress";
  const progressIndex =
    maintenance.status === "planned"
      ? 0
      : maintenance.status === "in_progress"
        ? 1
        : maintenance.status === "completed"
          ? 2
          : 0;
  const reasonText =
    sourceInspection?.catatan?.trim() ||
    findings[0]?.deskripsi?.trim() ||
    maintenance.catatan?.trim() ||
    null;
  const visibleHistory = timelineExpanded ? history : history.slice(0, 4);
  const hasHiddenHistory = history.length > 4;

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
                <div><p className="text-xs text-muted-foreground">Biaya</p><p className="mt-1 text-sm font-semibold">{completionSuccess.cost == null ? "-" : "Rp " + new Intl.NumberFormat("id-ID").format(completionSuccess.cost)}</p></div>
              </div>
            </div>
            {completionSuccess.pengeluaranId ? (
              <Alert className="relative w-full max-w-md text-left">
                <CheckCircle2 className="size-4" />
                <AlertTitle>Pengeluaran & cash out sudah tercatat</AlertTitle>
                <AlertDescription>
                  <p>Biaya aktual sudah menjadi pengeluaran Finance dan dibayar dari akun uang sebelum status perawatan diselesaikan.</p>
                  {completionSuccess.settlementAllocations.length > 0 ? (
                    <div className="mt-2 space-y-1 text-xs">
                      {completionSuccess.settlementAllocations.map((item) => <p key={item.akun_keuangan_id}>Akun {item.akun_keuangan_id.slice(0, 8).toUpperCase()} · Rp {new Intl.NumberFormat("id-ID").format(Number(item.amount))}</p>)}
                    </div>
                  ) : null}
                  <Button asChild variant="outline" size="sm" className="mt-3 rounded-xl">
                    <Link to={paths.keuangan + "/pengeluaran/" + completionSuccess.pengeluaranId}>Buka Pengeluaran Finance <ExternalLink /></Link>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Alert className="relative w-full max-w-md text-left">
              <Info className="size-4" />
              <AlertTitle>Pekerjaan selesai — tinggal konfirmasi kesiapan</AlertTitle>
              <AlertDescription>Konfirmasi ini menjalankan Verifikasi Kesiapan. Bila lulus, Inventaris langsung menetapkan unit menjadi Siap Disewakan.</AlertDescription>
            </Alert>
            <div className="relative flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 rounded-xl"
                disabled={verificationMutation.isPending}
                onClick={() => {
                  verificationMutation.mutate("passed");
                }}
              >
                <PackageCheck />
                {verificationMutation.isPending ? "Menetapkan Siap Disewakan…" : "Konfirmasi Siap Disewakan"}
              </Button>
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setCompletionSuccess(null)}><Wrench />Lihat Detail</Button>
            </div>
            <Button asChild variant="ghost" className="relative w-full max-w-md rounded-xl">
              <Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}><ExternalLink />Buka Pemeriksaan Ulang</Link>
            </Button>
            <Button asChild variant="ghost" className="relative rounded-xl"><Link to={paths.perawatan}>Kembali ke Daftar</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 pb-28 sm:space-y-4 lg:pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 size-9 rounded-xl" aria-label="Kembali ke Perawatan">
            <Link to={paths.perawatan}><ArrowLeft /></Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Detail Perawatan</p>
            <h1 className="truncate text-[20px] font-bold leading-6 tracking-tight">{unit.kode_unit}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {unit.barang_nama ?? "Barang"}{unit.varian_nama ? " · " + unit.varian_nama : ""}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Menu perawatan">
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
          <AlertTitle>Perawatan belum diperbarui</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorFeedback}</p>
            <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
              <RefreshCw />Muat Data Terbaru
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {unknownFeedback ? (
        <Alert variant="destructive">
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

      <Card className="overflow-hidden rounded-[22px] border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardContent className="p-3.5 sm:p-4">
          <div className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-3">
            <div className="grid size-[62px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-border/70 bg-muted/35 text-primary">
              <Package className="size-7" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[17px] font-bold leading-5">{unit.kode_unit}</p>
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                  {semanticMaintenanceLabel(unit.status)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {unit.barang_nama ?? "Barang"}{unit.varian_nama ? " · " + unit.varian_nama : ""}
              </p>
            </div>

            <Badge
              variant={maintenance.status === "completed" ? "outline" : "secondary"}
              className="max-w-[118px] justify-center rounded-xl px-2.5 py-2 text-[11px] font-semibold"
            >
              {semanticMaintenanceLabel(maintenance.status)}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x rounded-2xl bg-muted/25">
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="size-3.5 shrink-0" />
                <span>Jenis</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {semanticMaintenanceLabel(maintenance.jenis_perawatan)}
              </p>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PackageCheck className="size-3.5 shrink-0" />
                <span>Unit</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {semanticMaintenanceLabel(unit.status)}
              </p>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                <span>Dibuat</span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold">
                {formatMaintenanceDateTime(maintenance.created_at)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <nav aria-label="Bagian detail perawatan" className="grid grid-cols-3 rounded-2xl border border-border/70 bg-background p-1">
        <a href="#ringkasan" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-2 text-xs font-semibold text-primary-foreground shadow-sm">
          <FileText className="size-3.5" />Informasi
        </a>
        <a href="#pekerjaan" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold text-muted-foreground">
          <Wrench className="size-3.5" />Pekerjaan
        </a>
        <a href="#timeline" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold text-muted-foreground">
          <History className="size-3.5" />Timeline
        </a>
      </nav>

      <Card id="ringkasan" className="scroll-mt-4 rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader className="space-y-1 p-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-5 text-primary" />
              Ringkasan
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {sourceInspection ? "Pemeriksaan" : "Manual"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="grid grid-cols-2 divide-x rounded-2xl bg-muted/25">
            <div className="flex min-w-0 items-start gap-2.5 px-3 py-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-background text-primary">
                <Wrench className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Jenis Perawatan</p>
                <p className="mt-1 truncate text-sm font-semibold">{semanticMaintenanceLabel(maintenance.jenis_perawatan)}</p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2.5 px-3 py-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-background text-primary">
                <Package className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Sumber</p>
                <p className="mt-1 truncate text-sm font-semibold">{sourceInspection ? "Pemeriksaan" : "Manual"}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-emerald-50/45 p-3.5 dark:bg-emerald-950/15">
            <div className="flex items-start gap-2.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                <Info className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Alasan Perawatan</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Mengapa unit perlu dirawat.</p>
                <div className="mt-2 rounded-xl bg-background/75 px-3 py-2.5 text-sm leading-5 text-muted-foreground">
                  {reasonText ?? "-"}
                </div>
              </div>
            </div>
          </div>

          {findings.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Temuan</p>
                <Badge variant="outline" className="rounded-full">{findings.length} temuan</Badge>
              </div>
              <div className="grid gap-2">
                {findings.slice(0, 2).map((finding) => (
                  <div key={finding.temuan_pemeriksaan_id} className="rounded-xl border border-border/60 bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{semanticMaintenanceLabel(finding.jenis_temuan)}</p>
                      <span className="text-[11px] text-muted-foreground">{finding.status_tindak_lanjut}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.deskripsi}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader className="space-y-1 p-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-5 text-primary" />
              Status Pekerjaan
            </CardTitle>
            <Badge variant={maintenance.status === "completed" ? "outline" : "secondary"} className="rounded-full px-2.5 py-1 text-[11px]">
              {semanticMaintenanceLabel(maintenance.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div className="grid grid-cols-4">
            {[
              { label: "Direncanakan", active: progressIndex >= 0, current: maintenance.status === "planned" },
              { label: "Dalam Proses", active: progressIndex >= 1, current: maintenance.status === "in_progress" },
              { label: "Selesai", active: progressIndex >= 2, current: maintenance.status === "completed" },
              { label: "Siap Disewakan", active: unit.status === "ready", current: unit.status === "ready" },
            ].map((step, index, list) => (
              <div key={step.label} className="relative min-w-0">
                {index < list.length - 1 ? <span className="absolute left-[calc(50%+10px)] right-[calc(-50%+10px)] top-3.5 h-px bg-border" aria-hidden="true" /> : null}
                <div className="relative z-10 flex flex-col items-center gap-1.5 text-center">
                  <div className={[
                    "grid size-7 place-items-center rounded-full border-2 bg-background",
                    step.current ? "border-primary text-primary" : step.active ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground",
                  ].join(" ")}>
                    {step.active ? <CheckCircle2 className="size-4" /> : <Circle className="size-3.5" />}
                  </div>
                  <p className={step.current ? "text-[10px] font-semibold text-primary" : "text-[10px] text-muted-foreground"}>
                    {step.label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-muted/20 px-3 py-2.5">
              <p className="text-muted-foreground">Mulai</p>
              <p className="mt-1 font-semibold">{maintenance.dimulai_at ? formatMaintenanceDateTime(maintenance.dimulai_at) : "-"}</p>
            </div>
            <div className="rounded-xl bg-muted/20 px-3 py-2.5">
              <p className="text-muted-foreground">Selesai</p>
              <p className="mt-1 font-semibold">{maintenance.selesai_at ? formatMaintenanceDateTime(maintenance.selesai_at) : "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card id="pekerjaan" className="scroll-mt-4 rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader className="space-y-1 p-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-5 text-primary" />
            Detail Pekerjaan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="rounded-2xl bg-muted/20 p-3.5">
            <p className="text-[11px] text-muted-foreground">Deskripsi pekerjaan</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{maintenance.deskripsi_pekerjaan}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><UserRound className="size-3.5" />Dikerjakan oleh</div>
              <p className="mt-1 text-sm font-semibold">{maintenance.pelaksana ?? "-"}</p>
            </div>
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><CalendarDays className="size-3.5" />Biaya</div>
              <p className="mt-1 text-sm font-semibold">{maintenance.biaya == null ? "-" : "Rp " + new Intl.NumberFormat("id-ID").format(Number(maintenance.biaya))}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background p-3">
            <p className="text-[11px] text-muted-foreground">Catatan</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{maintenance.catatan || "-"}</p>
          </div>

          {isStartable ? (
            <Card className="rounded-2xl border-primary/15 bg-emerald-50/45 shadow-none dark:bg-emerald-950/15">
              <CardContent className="p-3.5">
                <p className="font-semibold">Perawatan Direncanakan</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Mulai pekerjaan untuk mengubah status menjadi Berjalan. Waktu mulai dicatat otomatis oleh sistem.
                </p>
                <Button className="mt-3 h-11 w-full rounded-xl" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
                  {startMutation.isPending ? "Memulai..." : "Mulai Perawatan"}
                  <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {isCompletable ? (
            <Card className="rounded-2xl border-sky-200/60 bg-sky-50/35 shadow-none dark:border-sky-900/30 dark:bg-sky-950/10">
              <CardContent className="space-y-3 p-3.5">
                <div>
                  <p className="font-semibold">Selesaikan Perawatan + Finance</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Biaya aktual harus sudah tercatat sebagai pengeluaran dan cash out selesai sebelum status menjadi Selesai.</p>
                </div>
                <div className="grid gap-2">
                  <label className="grid gap-1.5 text-xs font-medium">
                    Pelaksana
                    <input aria-label="Pelaksana penyelesaian" className="h-10 rounded-xl border bg-background px-3 text-sm" value={executor} onChange={(e) => setExecutor(e.target.value)} placeholder={maintenance.pelaksana ?? "Nama pelaksana"} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium">
                    Biaya aktual
                    <input aria-label="Biaya aktual" type="number" min="0" className="h-10 rounded-xl border bg-background px-3 text-sm" value={cost} onChange={(e) => { setCost(e.target.value); setAccountAllocations({}); }} placeholder={maintenance.biaya == null ? "Isi 0 bila tidak ada biaya" : String(maintenance.biaya)} />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium">
                    Waktu cash out
                    <input aria-label="Waktu cash out" type="datetime-local" className="h-10 rounded-xl border bg-background px-3 text-sm" value={cashoutAt} onChange={(e) => setCashoutAt(e.target.value)} />
                    <span className="text-[11px] font-normal text-muted-foreground">Zona waktu usaha: {context.data.businessTimezone}</span>
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-medium">
                  Catatan penyelesaian
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan pekerjaan" rows={3} />
                </label>
                <MaintenanceFinanceCashout
                  accounts={availableFinanceAccounts}
                  amount={cashoutAmount}
                  allocations={accountAllocations}
                  onAllocationsChange={setAccountAllocations}
                  onProceed={() => completeMutation.mutate()}
                  disabled={financeAccounts.isPending || completeMutation.isPending || Boolean(financeAccounts.error)}
                  isPending={completeMutation.isPending}
                  setupHref={paths.keuangan + "/akun"}
                />
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>

      {maintenance.status === "completed" ? (
        <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          {verification_result === "passed" ? (
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Verifikasi Sudah Lulus</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Pekerjaan ini sudah pernah lolos Verifikasi Kesiapan.</p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-10 w-full rounded-xl">
                <Link to={paths.inventaris + "/" + unit.unit_barang_id}>Buka Inventaris<ArrowRight /></Link>
              </Button>
            </CardContent>
          ) : verification_result === "failed" ? (
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                  <ShieldAlert className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Verifikasi Tidak Lulus</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Unit tetap belum siap dan memerlukan tindak lanjut.</p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-10 w-full rounded-xl">
                <Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}><ExternalLink />Buka Pemeriksaan</Link>
              </Button>
            </CardContent>
          ) : unit.status === "ready" ? (
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <PackageCheck className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Unit Siap Disewakan</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Unit saat ini sudah dinyatakan siap oleh Inventaris.</p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-10 w-full rounded-xl">
                <Link to={paths.inventaris + "/" + unit.unit_barang_id}>Buka Inventaris<ArrowRight /></Link>
              </Button>
            </CardContent>
          ) : (
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                  <Clock3 className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Verifikasi Kesiapan</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Pekerjaan selesai tetapi hasil verifikasi belum tercatat.</p>
                </div>
              </div>
              <Textarea value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Catatan hasil uji setelah perawatan" aria-label="Catatan verifikasi" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button className="h-11 rounded-xl" disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("passed")}>
                  Verifikasi Lulus
                </Button>
                <Button variant="outline" className="h-11 rounded-xl" disabled={verificationMutation.isPending || unit.status !== "maintenance"} onClick={() => verificationMutation.mutate("failed")}>
                  Verifikasi Gagal
                </Button>
              </div>
              <Button asChild variant="ghost" className="h-10 w-full rounded-xl">
                <Link to={paths.pemeriksaan + "?unit_id=" + encodeURIComponent(unit.unit_barang_id)}><ExternalLink />Buka Pemeriksaan</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      ) : null}

      <Card id="timeline" className="scroll-mt-4 rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader className="p-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-5 text-primary" />
              Riwayat Unit
            </CardTitle>
            {hasHiddenHistory ? (
              <Button type="button" variant="ghost" className="h-8 rounded-full px-3 text-xs text-primary" onClick={() => setTimelineExpanded((value) => !value)}>
                {timelineExpanded ? "Ringkas" : "Lihat Semua"}
                <ArrowRight className={timelineExpanded ? "-rotate-90" : "rotate-0"} />
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada riwayat unit.</p>
          ) : (
            <div className="space-y-2.5">
              {visibleHistory.map((entry, index) => (
                <div key={entry.riwayat_unit_id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5">
                  <div className="relative flex justify-center">
                    {index < visibleHistory.length - 1 ? <span className="absolute top-5 h-full w-px bg-border" aria-hidden="true" /> : null}
                    <span className={[
                      "relative z-10 mt-1.5 size-2.5 rounded-full border-2 bg-background",
                      index === 0 ? "border-primary bg-primary/15" : "border-border",
                    ].join(" ")} />
                  </div>
                  <div className={[
                    "rounded-2xl border border-border/60 px-3 py-2.5",
                    index === 0 ? "bg-emerald-50/40 dark:bg-emerald-950/10" : "bg-background",
                  ].join(" ")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{semanticMaintenanceLabel(entry.jenis_kejadian)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatMaintenanceDateTime(entry.terjadi_at)}</p>
                      </div>
                      <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    {entry.catatan ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.catatan}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

}
