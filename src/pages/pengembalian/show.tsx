import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, History, Info, MoreHorizontal, Package, PackageCheck, QrCode, ReceiptText, RefreshCw, ShieldAlert, UsersRound, WalletCards } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { ToleranceExtensionDialog } from "@/components/penyewaan/tolerance-extension-dialog";
import { RentalConsequenceList } from "@/components/keuangan/rental-consequence-list";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ReturnConfirmationDialog,
  ReturnDueBadge,
  ReturnHistoryTimeline,
  ReturnProgress,
  ReturnQrDialog,
  ReturnStateNotice,
  ReturnUnitCard,
  SuccessReturnPanel,
} from "@/components/pengembalian/return-ui";
import {
  formatReturnDateTime,
  getPengembalianContext,
  getReturnWorkspace,
  lookupReturnRentalByQr,
  processUnitReturn,
  reconcileReturnCommand,
  semanticReturnLabel,
} from "@/features/pengembalian";
import { listRentalToleranceHistory } from "@/features/penyewaan";
import { listRentalConsequenceReviews } from "@/features/keuangan";
import type { ReturnWorkspace as ReturnWorkspaceData } from "@/features/pengembalian";
import { deriveReturnDueState } from "@/features/pengembalian/utils";
import { paths } from "@/routes/paths";

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Pengembalian gagal diproses.";
}

function mapReturnError(message: string) {
  const normalized = message.toUpperCase();
  if (normalized.startsWith("UNKNOWN_OUTCOME:")) {
    return {
      kind: "unknown" as const,
      title: "Hasil Command Belum Dapat Dipastikan",
      body: "Hasil pengembalian belum dapat dipastikan. Jangan proses pengembalian kedua. Periksa status terbaru terlebih dahulu.",
    };
  }
  if (normalized.includes("STALE") || normalized.includes("BERUBAH SEJAK") || normalized.includes("UPDATED_AT")) {
    return {
      kind: "stale" as const,
      title: "Data Berubah Sejak Halaman Dibuka",
      body: "Status penyewaan sudah berubah. Muat ulang data terbaru sebelum memproses pengembalian.",
    };
  }
  if (normalized.includes("CONFLICT") || normalized.includes("SUDAH DIKEMBALIKAN") || normalized.includes("TIDAK LAGI TERKAIT")) {
    return {
      kind: "conflict" as const,
      title: "Pengembalian Mengalami Konflik",
      body: "Unit atau rental sudah berubah dari konteks yang sedang dibuka. Muat ulang data sebelum mengambil tindakan.",
    };
  }
  if (normalized.includes("AUTHORIZATION") || normalized.includes("FORBIDDEN") || normalized.includes("AKSES")) {
    return {
      kind: "permission" as const,
      title: "Akses Tidak Diizinkan",
      body: "Akun admin saat ini tidak memiliki otorisasi untuk memproses pengembalian pada konteks ini.",
    };
  }
  if (normalized.includes("NOT_FOUND") || normalized.includes("TIDAK DITEMUKAN")) {
    return {
      kind: "not_found" as const,
      title: "Data Tidak Ditemukan",
      body: "Penyewaan, unit, atau Usaha tidak lagi tersedia. Muat ulang untuk memeriksa status terbaru.",
    };
  }
  if (normalized.includes("NETWORK") || normalized.includes("FETCH") || normalized.includes("TIMEOUT")) {
    return {
      kind: "network" as const,
      title: "Koneksi Tidak Stabil",
      body: "Tindakan belum dapat dipastikan selesai. Jangan mengulang sebelum status sumber datanya diverifikasi.",
    };
  }
  return {
    kind: "server" as const,
    title: "Pengembalian Belum Berhasil",
    body: message,
  };
}

function workspaceDueState(workspace: ReturnWorkspaceData) {
  const outstanding = workspace.units.filter((unit) => !unit.returned).length;
  if (outstanding === 0) return "returned" as const;
  return deriveReturnDueState(workspace.rental.jadwal_kembali, workspace.rental.tolerance_deadline);
}

export function ReturnShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrFeedback, setQrFeedback] = useState("");
  const [errorFeedback, setErrorFeedback] = useState<"conflict" | "stale" | "permission" | "not_found" | "network" | "server" | null>(null);
  const [errorText, setErrorText] = useState("");
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [successResult, setSuccessResult] = useState<{
    nomor_pengembalian: string;
    actual_return_at: string;
    returned_unit_count: number;
  } | null>(null);
  const commandRef = useRef<{ key: string; requestId: string } | null>(null);

  const context = useQuery({
    queryKey: ["pengembalian", "context"],
    queryFn: getPengembalianContext,
    staleTime: 60_000,
  });
  const workspace = useQuery({
    queryKey: ["pengembalian", "workspace", context.data?.usahaId, id],
    queryFn: () => getReturnWorkspace(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 10_000,
  });
  const toleranceHistory = useQuery({
    queryKey: ["pengembalian", "tolerance-history", context.data?.usahaId, id],
    queryFn: () => listRentalToleranceHistory(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });
  const consequenceReviews = useQuery({
    queryKey: ["keuangan", "rental-consequence", context.data?.usahaId, id],
    queryFn: () => listRentalConsequenceReviews(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
  });

  const item = workspace.data;
  const selectedUnits = useMemo(
    () => item?.units.filter((unit) => selectedUnitIds.includes(unit.unit_barang_id)) ?? [],
    [item?.units, selectedUnitIds],
  );

  const packageProgress = useMemo(() => {
    const groups = new Map<string, { name: string; total: number; returned: number }>();
    for (const unit of item?.units ?? []) {
      if (!unit.paket_sewa_id) continue;
      const current = groups.get(unit.paket_sewa_id) ?? {
        name: unit.paket_nama ?? "Paket",
        total: 0,
        returned: 0,
      };
      current.total += 1;
      if (unit.returned) current.returned += 1;
      groups.set(unit.paket_sewa_id, current);
    }
    return Array.from(groups.values());
  }, [item?.units]);

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !item) throw new Error("Workspace pengembalian belum siap.");
      if (!commandRef.current) {
        commandRef.current = {
          key: createClientId(),
          requestId: createClientId(),
        };
      }
      return processUnitReturn(
        context.data.usahaId,
        { rentalId: id, unitBarangIds: selectedUnitIds, catatan: note },
        {
          idempotencyKey: commandRef.current.key,
          requestId: commandRef.current.requestId,
          expectedRentalUpdatedAt: item.rental.updated_at,
        },
      );
    },
    onMutate: () => {
      setErrorFeedback(null);
      setErrorText("");
      setUnknownFeedback("");
    },
    onSuccess: async (result) => {
      commandRef.current = null;
      setConfirmOpen(false);
      setSelectedUnitIds([]);
      setNote("");
      setUnknownFeedback("");
      setErrorFeedback(null);
      setSuccessResult({
        nomor_pengembalian: result.nomor_pengembalian,
        actual_return_at: result.actual_return_at,
        returned_unit_count: result.returned_unit_count,
      });
      await queryClient.invalidateQueries({ queryKey: ["pengembalian", "workspace", context.data?.usahaId, id] });
      await queryClient.invalidateQueries({ queryKey: ["pengembalian", "queue", context.data?.usahaId] });
      await queryClient.invalidateQueries({ queryKey: ["inventaris"] });
      await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });
    },
    onError: (error) => {
      setConfirmOpen(false);
      const message = rawErrorMessage(error);
      const mapped = mapReturnError(message);
      if (mapped.kind === "unknown") {
        setUnknownFeedback(mapped.body);
        setErrorFeedback(null);
        return;
      }
      setErrorFeedback(mapped.kind);
      setErrorText(mapped.body);
    },
  });

  const reconcile = async () => {
    if (!context.data?.usahaId || !commandRef.current) return;
    setReconciling(true);
    try {
      const result = await reconcileReturnCommand(context.data.usahaId, commandRef.current.key);
      if (result.state === "committed" && result.response) {
        commandRef.current = null;
        setUnknownFeedback("");
        setSuccessResult({
          nomor_pengembalian: result.response.nomor_pengembalian,
          actual_return_at: result.response.actual_return_at,
          returned_unit_count: result.response.returned_unit_count,
        });
        await queryClient.invalidateQueries({ queryKey: ["pengembalian", "workspace", context.data.usahaId, id] });
        await queryClient.invalidateQueries({ queryKey: ["pengembalian", "queue", context.data.usahaId] });
        await queryClient.invalidateQueries({ queryKey: ["inventaris"] });
      } else if (result.state === "not_found") {
        commandRef.current = null;
        setUnknownFeedback("Perubahan sebelumnya belum ditemukan. Periksa status terbaru sebelum membuat tindakan baru.");
      } else {
        setUnknownFeedback("Hasil tindakan belum dapat dipastikan. Jangan mengulang tindakan.");
      }
    } catch {
      setUnknownFeedback("Status tindakan belum dapat diverifikasi. Jangan mengulang pengembalian.");
    } finally {
      setReconciling(false);
    }
  };

  const handleQrResolved = useCallback(async (identifier: string) => {
    if (!context.data || !id || !item) return;
    setQrFeedback("");
    try {
      const result = await lookupReturnRentalByQr(context.data.usahaId, identifier);
      if (!result.rental_ids.includes(id)) {
        setQrFeedback("Unit ditemukan tetapi bukan bagian dari rental ini. Konteks halaman tidak diubah.");
        return;
      }
      const unit = item.units.find((row) => row.unit_barang_id === result.unit_barang_id);
      if (!unit) {
        setQrFeedback("Unit ditemukan tetapi tidak tersedia pada workspace rental ini.");
        return;
      }
      if (unit.returned || unit.unit_status !== "rented") {
        setQrFeedback("Unit sudah diterima atau tidak lagi berada pada state rented.");
        return;
      }
      setSelectedUnitIds((current) => current.includes(unit.unit_barang_id) ? current : [...current, unit.unit_barang_id]);
      setSearchParams((current) => {
        current.set("unit", unit.kode_unit);
        return current;
      });
      setQrFeedback("QR cocok dengan rental ini. Unit dipilih dan belum menjalankan mutation.");
      setQrOpen(false);
    } catch (error) {
      setQrFeedback(rawErrorMessage(error));
    }
  }, [context.data, id, item, setSearchParams]);

  if (context.isPending || workspace.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-32 rounded-xl" />
        <Skeleton className="h-28 rounded-3xl" />
        <RentalConsequenceList items={consequenceReviews.data ?? []} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (context.error || workspace.error || !context.data || !item) {
    const message = context.error ? rawErrorMessage(context.error) : rawErrorMessage(workspace.error);
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.pengembalian}><ArrowLeft />Kembali ke antrian</Link>
        </Button>
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Workspace pengembalian tidak tersedia</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{message}</p>
            <Button variant="outline" className="w-fit rounded-xl" onClick={() => void workspace.refetch()}><RefreshCw />Muat ulang</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (successResult) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 pb-12">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.pengembalian}><ArrowLeft />Pengembalian</Link>
        </Button>
        <SuccessReturnPanel
          workspace={item}
          returnNumber={successResult.nomor_pengembalian}
          returnedCount={successResult.returned_unit_count}
          receivedAt={successResult.actual_return_at}
          onOpenDetail={() => setSuccessResult(null)}
          onBack={() => navigate(paths.pengembalian)}
        />
      </div>
    );
  }

  const returnedCount = item.units.filter((unit) => unit.returned).length;
  const totalCount = item.units.length;
  const dueState = workspaceDueState(item);

  const toggleUnit = (unitId: string, checked: boolean) => {
    setSelectedUnitIds((current) => checked ? (current.includes(unitId) ? current : [...current, unitId]) : current.filter((idValue) => idValue !== unitId));
  };

  const mappedError = errorFeedback
    ? ({
        conflict: { title: "Conflict pada Pengembalian", body: errorText },
        stale: { title: "Data Berubah Sejak Halaman Dibuka", body: errorText },
        permission: { title: "Akses Tidak Diizinkan", body: errorText },
        not_found: { title: "Data Tidak Ditemukan", body: errorText },
        network: { title: "Koneksi Tidak Stabil", body: errorText },
        server: { title: "Pengembalian Belum Berhasil", body: errorText },
      } as Record<string, { title: string; body: string }>)[errorFeedback] ?? { title: "Pengembalian Belum Berhasil", body: errorText }
    : null;

  return (
    <div data-testid="return-detail-root" className="mx-auto w-full max-w-3xl space-y-2.5 pb-28 sm:space-y-3.5 lg:pb-10">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_32px_rgba(23,68,55,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#0b5c4b]/76 via-[#0d4f43]/46 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-3.5 text-white sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-xl bg-white/12 text-white hover:bg-white/20 hover:text-white" aria-label="Kembali ke penyewaan">
                <Link to={paths.penyewaan}><ArrowLeft className="size-4" /></Link>
              </Button>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78">Selesaikan Sewa</p>
                <h1 className="mt-1 truncate text-[21px] font-bold leading-6 tracking-[-0.03em]">{item.rental.nomor_penyewaan}</h1>
                <p className="mt-0.5 truncate text-[11px] text-white/82">{item.renter?.nama_lengkap ?? "Penyewa tidak ditemukan"}</p>
              </div>
            </div>
            <ReturnDueBadge state={dueState} />
          </div>
          <div className="mt-5 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-white/86 text-[#0d5e4b] shadow-sm backdrop-blur">
              <PackageCheck className="size-4.5" />
            </span>
            <div>
              <p className="text-[20px] font-bold leading-5 tracking-[-0.03em]">Pengembalian</p>
              <p className="mt-0.5 text-[10px] text-white/82">Terima unit yang benar-benar kembali, lalu lanjutkan ke pemeriksaan.</p>
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Detail pengembalian" className="grid grid-cols-4 gap-1.5 rounded-2xl border border-border/60 bg-card p-1.5 shadow-[0_4px_16px_rgba(30,68,57,.05)]">
        <button type="button" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0a6b55] px-2 text-[10px] font-semibold text-white shadow-sm">
          <PackageCheck className="size-3.5" />Pengembalian
        </button>
        <button type="button" onClick={() => setQrOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground hover:bg-muted">
          <QrCode className="size-3.5" />QR
        </button>
        <button type="button" onClick={() => document.getElementById("return-history")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground hover:bg-muted">
          <History className="size-3.5" />Riwayat
        </button>
        <button type="button" onClick={() => document.getElementById("return-related")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground hover:bg-muted">
          <MoreHorizontal className="size-3.5" />Lainnya
        </button>
      </nav>

      {mappedError ? (
        <ReturnStateNotice tone="danger" title={mappedError.title} actionLabel="Muat ulang" onAction={() => void workspace.refetch()}>
          {mappedError.body}
        </ReturnStateNotice>
      ) : null}

      {unknownFeedback ? (
        <ReturnStateNotice tone="warning" title="Hasil tindakan tidak diketahui" actionLabel={reconciling ? "Memeriksa…" : "Periksa Status Tindakan"} onAction={() => void reconcile()}>
          {unknownFeedback}
        </ReturnStateNotice>
      ) : null}

      {qrFeedback ? (
        <ReturnStateNotice tone={qrFeedback.includes("cocok") ? "success" : "warning"} title="Hasil QR">
          {qrFeedback}
        </ReturnStateNotice>
      ) : null}

      <section className="rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.055)]">
        <div className="flex items-start justify-between gap-3 px-3.5 pb-2.5 pt-3.5 sm:px-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
              <Package className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-bold tracking-tight">{item.rental.nomor_penyewaan}</p>
                <Badge variant="secondary" className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">{semanticReturnLabel(item.rental.status)}</Badge>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Konteks rental untuk proses penerimaan unit.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => setQrOpen(true)} aria-label="Pindai QR Unit">
            <QrCode className="size-3.5" />
          </Button>
        </div>

        <div className="mx-3.5 mb-3.5 grid grid-cols-3 divide-x overflow-hidden rounded-2xl border border-border/60 bg-muted/10 sm:mx-4">
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[8px] text-muted-foreground">Kembali</p>
            <p className="mt-1 truncate text-[10px] font-semibold">{formatReturnDateTime(item.rental.jadwal_kembali)}</p>
          </div>
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[8px] text-muted-foreground">Toleransi</p>
            <p className="mt-1 truncate text-[10px] font-semibold">{formatReturnDateTime(item.rental.tolerance_deadline)}</p>
          </div>
          <div className="min-w-0 px-2.5 py-2.5">
            <p className="text-[8px] text-muted-foreground">Unit</p>
            <p className="mt-1 truncate text-[10px] font-semibold">{returnedCount}/{totalCount} diterima</p>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><UsersRound className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold">Informasi Penyewa</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Konteks penyewa tersedia pada header.</p>
          </div>
          <Button asChild variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground" aria-label="Menu penyewa">
            <Link to={paths.penyewaan + "/" + item.rental.penyewaan_id}><MoreHorizontal className="size-4" /></Link>
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 divide-x rounded-2xl bg-muted/15">
          <div className="px-3 py-2.5"><p className="text-[9px] text-muted-foreground">Pengambilan aktual</p><p className="mt-1 truncate text-[10px] font-semibold">{formatReturnDateTime(item.rental.actual_pickup_at)}</p></div>
          <div className="px-3 py-2.5"><p className="text-[9px] text-muted-foreground">Nomor telepon</p><p className="mt-1 truncate text-[10px] font-semibold">{item.renter?.nomor_telepon ?? "Tidak tersedia"}</p></div>
        </div>
      </section>

      <section className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><PackageCheck className="size-4.5" /></span>
            <div>
              <h2 className="text-[15px] font-bold">Progress Pengembalian</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{returnedCount} dari {totalCount} unit sudah diterima.</p>
            </div>
          </div>
          <span className="text-[15px] font-bold text-primary">{totalCount ? Math.round((returnedCount / totalCount) * 100) : 0}%</span>
        </div>
        <div className="mt-3"><ReturnProgress returned={returnedCount} total={totalCount} outstanding={Math.max(0, totalCount - returnedCount)} /></div>
      </section>

      <section className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/40 text-primary"><Clock3 className="size-4.5" /></span>
          <div>
            <h2 className="text-[15px] font-bold">Status Pengembalian</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Jadwal kembali dan batas toleransi.</p>
          </div>
        </div>
        <RentalTimingSummary
          scheduleAt={item.rental.jadwal_kembali}
          toleranceDeadline={item.rental.tolerance_deadline}
          actualReturnAt={item.rental.actual_return_completed_at}
          compact
          className="mt-3"
        />
        <div className="mt-2.5 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5 text-[9px] leading-4 text-muted-foreground">
          Jadwal pengembalian dan pengembalian aktual adalah fakta yang berbeda.
        </div>
      </section>

      {(item.rental.status === "active" || item.rental.status === "return_in_progress") ? (
        <section id="return-tolerance" className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300"><Clock3 className="size-4.5" /></span>
              <div className="min-w-0">
                <h2 className="text-[13px] font-bold">Batas toleransi</h2>
                <p className="truncate text-[9px] text-muted-foreground">{formatReturnDateTime(item.rental.tolerance_deadline)}</p>
              </div>
            </div>
            <ToleranceExtensionDialog
              usahaId={context.data.usahaId}
              penyewaanId={item.rental.penyewaan_id}
              currentDeadline={item.rental.tolerance_deadline}
              history={toleranceHistory.data ?? []}
              onSaved={async () => { await Promise.all([workspace.refetch(), toleranceHistory.refetch()]); }}
            />
          </div>
        </section>
      ) : null}

      <ReturnStateNotice tone="info" title="Batas toleransi pengembalian">
        {"Pengembalian pada penyewaan ini memiliki batas toleransi sampai " + formatReturnDateTime(item.rental.tolerance_deadline) + ". Batas ini hanya menjelaskan waktu toleransi; penerimaan tetap mencatat waktu aktual saat unit diterima."}
      </ReturnStateNotice>

      {packageProgress.length ? (
        <details className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><PackageCheck className="size-4.5" /></span>
              <span className="min-w-0"><span className="block text-[13px] font-bold">Progress Paket</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Penerimaan tetap dicatat per unit fisik.</span></span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-2 border-t border-border/60 px-3.5 py-3.5 sm:grid-cols-2">
            {packageProgress.map((group) => (
              <div key={group.name} className="rounded-2xl border border-border/60 bg-muted/[0.02] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-[11px] font-semibold">{group.name}</p><p className="mt-1 text-[9px] text-muted-foreground">{group.returned} dari {group.total} unit diterima</p></div>
                  <Badge variant={group.returned === group.total ? "secondary" : "outline"} className="rounded-full text-[9px]">{group.returned}/{group.total}</Badge>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <section className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><Package className="size-4.5" /></span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">Unit yang dikembalikan</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Pilih hanya unit yang benar-benar sudah diterima.</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground" onClick={() => setQrOpen(true)} aria-label="Pindai QR Unit">
            <QrCode className="size-4" />
          </Button>
        </div>
        <div className="mt-3 grid gap-2.5">
          {item.units.map((unit) => (
            <ReturnUnitCard
              key={unit.unit_barang_id}
              unit={unit}
              selected={selectedUnitIds.includes(unit.unit_barang_id)}
              disabled={Boolean(returnMutation.isPending) || Boolean(unknownFeedback)}
              onChange={(checked) => toggleUnit(unit.unit_barang_id, checked)}
            />
          ))}
          {!item.units.length ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
              <p className="font-medium">Belum ada unit pada penyewaan ini</p>
              <p className="mt-1 text-sm text-muted-foreground">Tidak ada unit fisik yang dapat diproses di workspace ini.</p>
            </div>
          ) : null}
        </div>
      </section>

      {selectedUnitIds.length ? (
        <section className="rounded-[20px] border border-emerald-200/80 bg-emerald-50/60 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-[12px] font-bold text-emerald-900 dark:text-emerald-100">{selectedUnitIds.length} unit dipilih</p><p className="mt-0.5 text-[9px] text-emerald-900/65 dark:text-emerald-100/65">Tinjau unit sebelum menyimpan pengembalian.</p></div>
            <Button type="button" className="h-10 shrink-0 rounded-xl bg-[#0a6b55] px-3 text-[10px] font-semibold hover:bg-[#075944]" disabled={returnMutation.isPending || Boolean(unknownFeedback)} onClick={() => setConfirmOpen(true)}>Lanjut ke Konfirmasi<ArrowRight className="size-3.5" /></Button>
          </div>
        </section>
      ) : null}

      <details className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/50 text-primary"><ReceiptText className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Catatan Penerimaan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Catatan penerimaan, bukan temuan kerusakan.</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 px-3.5 py-3.5">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Catatan penerimaan unit…"
            disabled={returnMutation.isPending || Boolean(unknownFeedback)}
            className="min-h-24 w-full resize-y rounded-2xl border bg-background px-3 py-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Catatan penerimaan"
          />
        </div>
      </details>

      <details id="return-inspection" className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/25 dark:text-blue-300"><ShieldAlert className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Diserahkan ke Pemeriksaan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Unit yang diterima masuk ke tahap pemeriksaan.</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2.5 border-t border-border/60 px-3.5 py-3.5">
          <ReturnStateNotice tone="info" title="Setelah Pengembalian">
            Unit yang diterima masuk ke tahap pemeriksaan. Pengembalian menyediakan konteks awal; Pemeriksaan dilanjutkan langsung dari halaman ini.
          </ReturnStateNotice>
          {item.units.filter((unit) => unit.returned && unit.detail_pengembalian_id).length ? (
            <div className="space-y-1.5">
              {item.units.filter((unit) => unit.returned && unit.detail_pengembalian_id).map((unit) => (
                <Link
                  key={unit.detail_pengembalian_id}
                  to={paths.pemeriksaan + "/" + unit.detail_pengembalian_id}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2.5 transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0"><p className="text-[10px] font-semibold">{unit.kode_unit}</p><p className="truncate text-[9px] text-muted-foreground">{unit.barang_nama ?? "Barang"}{unit.varian_nama ? " · " + unit.varian_nama : ""}</p></div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-primary">{unit.inspection_status === "in_progress" ? "Lanjutkan" : "Periksa"}<ArrowRight className="size-3.5" /></span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </details>

      <details id="return-history" className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/50 text-primary"><History className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Riwayat Pengembalian</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Timeline penerimaan dan proses lanjutan.</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 px-3.5 py-3.5"><ReturnHistoryTimeline workspace={item} /></div>
      </details>

      {consequenceReviews.data?.length ? (
        <details id="return-related" className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.035)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300"><WalletCards className="size-4.5" /></span>
              <span className="min-w-0"><span className="block text-[13px] font-bold">Tindak Lanjut Keuangan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Konsekuensi yang diteruskan ke Keuangan.</span></span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3.5"><RentalConsequenceList items={consequenceReviews.data} /></div>
        </details>
      ) : null}

      <section className="rounded-[20px] border border-primary/10 bg-primary/[0.025]">
        <div className="flex items-start gap-2.5 px-3.5 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-[9px] leading-4 text-muted-foreground">Waktu pengembalian aktual dicatat otomatis oleh sistem. Pengembalian tidak memperpanjang penyewaan dan tidak menetapkan unit menjadi Siap Disewakan.</p>
        </div>
      </section>

      <div className="fixed inset-x-3 bottom-16 z-40 lg:hidden">
        <div className="rounded-2xl border border-white/60 bg-background/92 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
          {selectedUnitIds.length ? (
            <Button type="button" className="h-11 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold hover:bg-[#075944]" disabled={returnMutation.isPending || Boolean(unknownFeedback)} onClick={() => setConfirmOpen(true)}>
              Lanjut ke Konfirmasi · {selectedUnitIds.length}<ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-xs font-semibold" onClick={() => setQrOpen(true)}>
              <QrCode className="size-4" />Pindai QR Unit
            </Button>
          )}
        </div>
      </div>

      <ReturnConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        workspace={item}
        selectedUnits={selectedUnits}
        note={note}
        onNoteChange={setNote}
        pending={returnMutation.isPending}
        onConfirm={() => returnMutation.mutate()}
      />
      <ReturnQrDialog open={qrOpen} onOpenChange={setQrOpen} onResolved={(value) => void handleQrResolved(value)} />
    </div>
  );

}
