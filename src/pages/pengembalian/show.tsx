import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, QrCode, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ReturnConfirmationDialog,
  ReturnDueBadge,
  ReturnHistoryTimeline,
  ReturnProgress,
  ReturnQrDialog,
  ReturnStateNotice,
  ReturnUnitCard,
  ReturnWorkspaceHeader,
  SuccessReturnPanel,
} from "@/components/pengembalian/return-ui";
import {
  formatReturnDateTime,
  getPengembalianContext,
  getReturnCapabilities,
  getReturnWorkspace,
  lookupReturnRentalByQr,
  processUnitReturn,
  reconcileReturnCommand,
  semanticReturnLabel,
} from "@/features/pengembalian";
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
      body: "Hasil pengembalian belum dapat dipastikan. Jangan kirim pengembalian kedua. Periksa status command untuk mengetahui state terbaru.",
    };
  }
  if (normalized.includes("STALE") || normalized.includes("BERUBAH SEJAK") || normalized.includes("UPDATED_AT")) {
    return {
      kind: "stale" as const,
      title: "Data Berubah Sejak Halaman Dibuka",
      body: "State rental sudah berubah. Muat ulang data terbaru sebelum memproses pengembalian.",
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
      body: "Rental, unit, atau konteks tenant tidak lagi tersedia. Muat ulang untuk memeriksa state terbaru.",
    };
  }
  if (normalized.includes("NETWORK") || normalized.includes("FETCH") || normalized.includes("TIMEOUT")) {
    return {
      kind: "network" as const,
      title: "Koneksi Tidak Stabil",
      body: "Permintaan tidak dapat dipastikan selesai. Jangan membuat command kedua sebelum state sumber kebenaran diverifikasi.",
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

  const item = workspace.data;
  const outstandingUnits = useMemo(
    () => item?.units.filter((unit) => !unit.returned && unit.unit_status === "rented") ?? [],
    [item?.units],
  );
  const selectedUnits = useMemo(
    () => item?.units.filter((unit) => selectedUnitIds.includes(unit.unit_barang_id)) ?? [],
    [item?.units, selectedUnitIds],
  );

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !item) throw new Error("Workspace pengembalian belum siap.");
      if (!commandRef.current) {
        commandRef.current = {
          key: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
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
        setUnknownFeedback("Tidak ditemukan commitment untuk command tersebut. Verifikasi state terbaru sebelum membuat command baru.");
      } else {
        setUnknownFeedback("Command masih UNKNOWN_OUTCOME. Jangan mengirim command kedua.");
      }
    } catch {
      setUnknownFeedback("Status command belum dapat diverifikasi. Jangan mengirim pengembalian kedua.");
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
  const capabilities = getReturnCapabilities();

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
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-28 sm:space-y-5 md:pb-10">
      <Button asChild variant="ghost" className="-ml-3 rounded-xl">
        <Link to={paths.pengembalian}><ArrowLeft />Kembali ke antrian</Link>
      </Button>

      <ReturnWorkspaceHeader workspace={item} dueState={dueState} />

      {mappedError ? (
        <ReturnStateNotice tone="danger" title={mappedError.title} actionLabel="Muat ulang" onAction={() => void workspace.refetch()}>
          {mappedError.body}
        </ReturnStateNotice>
      ) : null}

      {unknownFeedback ? (
        <ReturnStateNotice tone="warning" title="Hasil command tidak diketahui" actionLabel={reconciling ? "Memeriksa…" : "Periksa Status Command"} onAction={() => void reconcile()}>
          {unknownFeedback}
        </ReturnStateNotice>
      ) : null}

      {qrFeedback ? (
        <ReturnStateNotice tone={qrFeedback.includes("cocok") ? "success" : "warning"} title="Hasil QR">
          {qrFeedback}
        </ReturnStateNotice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Informasi Rental</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Scheduled return dan actual return adalah fakta yang berbeda.</p>
              </div>
              <ReturnDueBadge state={dueState} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Jadwal mulai</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.jadwal_mulai)}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Jadwal kembali</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.jadwal_kembali)}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Batas toleransi</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.tolerance_deadline)}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Pickup aktual</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.actual_pickup_at)}</p>
            </div>
            <div className="rounded-2xl border bg-primary/[0.03] p-4">
              <p className="text-[11px] text-muted-foreground">Actual return mulai</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.actual_return_started_at)}</p>
            </div>
            <div className="rounded-2xl border bg-primary/[0.03] p-4">
              <p className="text-[11px] text-muted-foreground">Actual return selesai</p>
              <p className="mt-1 font-semibold">{formatReturnDateTime(item.rental.actual_return_completed_at)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader><CardTitle className="text-base">Informasi Penyewa</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Nama renter</p>
              <p className="mt-1 text-lg font-semibold">{item.renter?.nama_lengkap ?? "Tidak ditemukan"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.renter?.nomor_telepon ?? "Nomor telepon tidak tersedia"}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Nomor rental</p>
              <p className="mt-1 font-semibold">{item.rental.nomor_penyewaan}</p>
            </div>
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl" onClick={() => setQrOpen(true)}>
              <QrCode /> Scan QR Unit
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Progress Pengembalian</CardTitle>
        </CardHeader>
        <CardContent>
          <ReturnProgress returned={returnedCount} total={totalCount} outstanding={Math.max(0, totalCount - returnedCount)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pilih Unit yang Dikembalikan</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pilih hanya unit yang benar-benar sudah diterima. Selection bukan authorization; command server tetap memvalidasi konteks rental.
            </p>
          </CardHeader>
          <CardContent>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium"><span className="sr-only">Pilih</span></th>
                    <th className="px-4 py-3 font-medium">Kode Unit</th>
                    <th className="px-4 py-3 font-medium">Barang</th>
                    <th className="px-4 py-3 font-medium">Varian</th>
                    <th className="px-4 py-3 font-medium">Status Unit</th>
                    <th className="px-4 py-3 font-medium">Status Return</th>
                    <th className="px-4 py-3 font-medium">Status Pemeriksaan</th>
                  </tr>
                </thead>
                <tbody>
                  {item.units.map((unit) => {
                    const canSelect = !unit.returned && unit.unit_status === "rented";
                    return (
                      <tr key={unit.unit_barang_id} className={["border-b last:border-0", canSelect ? "hover:bg-accent/20" : "opacity-70"].join(" ")}>
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedUnitIds.includes(unit.unit_barang_id)}
                            disabled={!canSelect || Boolean(returnMutation.isPending) || Boolean(unknownFeedback)}
                            onChange={(event) => toggleUnit(unit.unit_barang_id, event.target.checked)}
                            aria-label={"Pilih unit " + unit.kode_unit}
                            className="size-4 accent-primary"
                          />
                        </td>
                        <td className="px-4 py-4 font-semibold">{unit.kode_unit}</td>
                        <td className="px-4 py-4">{unit.barang_nama ?? "—"}</td>
                        <td className="px-4 py-4">{unit.varian_nama ?? "—"}</td>
                        <td className="px-4 py-4"><Badge variant="secondary" className="rounded-full">{semanticReturnLabel(unit.unit_status)}</Badge></td>
                        <td className="px-4 py-4"><Badge variant={unit.returned ? "outline" : "secondary"} className="rounded-full">{unit.returned ? "Sudah diterima" : "Belum diterima"}</Badge></td>
                        <td className="px-4 py-4"><Badge variant="outline" className="rounded-full">{unit.inspection_status ? semanticReturnLabel(unit.inspection_status) : "Menunggu return"}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {item.units.map((unit) => (
                <ReturnUnitCard
                  key={unit.unit_barang_id}
                  unit={unit}
                  selected={selectedUnitIds.includes(unit.unit_barang_id)}
                  disabled={Boolean(returnMutation.isPending) || Boolean(unknownFeedback)}
                  onChange={(checked) => toggleUnit(unit.unit_barang_id, checked)}
                />
              ))}
            </div>

            {!item.units.length ? (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
                <p className="font-medium">Belum ada unit pada rental ini</p>
                <p className="mt-1 text-sm text-muted-foreground">Tidak ada unit fisik yang dapat diproses di workspace ini.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="hidden border-border/80 shadow-sm lg:block lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <CardTitle className="text-base">Konfirmasi Pengembalian</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-[11px] text-muted-foreground">Unit dipilih</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">{selectedUnitIds.length} unit</p>
            </div>
            <div className="text-sm">
              <p className="font-medium">{outstandingUnits.length} unit masih outstanding</p>
              <p className="mt-1 text-xs text-muted-foreground">Hanya unit yang dipilih akan dikirim ke trusted command.</p>
            </div>
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              disabled={selectedUnitIds.length === 0 || returnMutation.isPending || Boolean(unknownFeedback)}
              onClick={() => setConfirmOpen(true)}
            >
              Lanjut ke Konfirmasi
              <ArrowRight />
            </Button>
            <ReturnStateNotice tone="info" title="Waktu server">
              Waktu actual return ditentukan server. Return tidak memperpanjang rental dan tidak menetapkan unit READY.
            </ReturnStateNotice>
            <p className="text-[11px] leading-5 text-muted-foreground">{capabilities.reason}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-border/80 shadow-sm">
          <CardHeader><CardTitle className="text-base">Catatan Penerimaan</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">Catatan serah-terima / penerimaan, bukan temuan damage atau keputusan maintenance.</p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Catatan penerimaan unit…"
              disabled={returnMutation.isPending || Boolean(unknownFeedback)}
              className="min-h-28 w-full resize-y rounded-2xl border bg-background px-3 py-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Catatan penerimaan"
            />
          </CardContent>
        </Card>

        <Card id="return-history" className="border-border/80 shadow-sm">
          <CardHeader><CardTitle className="text-base">Inspection Handoff</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ReturnStateNotice tone="info" title="Setelah return">
              Unit yang diterima masuk ke tahap pemeriksaan. Return menyediakan context; hasil inspection tetap dimiliki modul Pemeriksaan.
            </ReturnStateNotice>
            {returnedCount > 0 ? (
              <Button asChild variant="outline" className="h-11 w-full rounded-xl">
                <Link to={paths.pemeriksaan + "?unit_id=" + item.units.find((unit) => unit.returned)?.unit_barang_id}>
                  Mulai Pemeriksaan
                  <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Riwayat Pengembalian</CardTitle>
          <p className="text-sm text-muted-foreground">Riwayat bersifat append-oriented dan tidak diedit dari surface ini.</p>
        </CardHeader>
        <CardContent>
          <ReturnHistoryTimeline workspace={item} />
        </CardContent>
      </Card>

      <div className="fixed inset-x-3 bottom-16 z-40 lg:hidden">
        <div className="rounded-2xl border bg-background/95 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
          {selectedUnitIds.length ? (
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              disabled={returnMutation.isPending || Boolean(unknownFeedback)}
              onClick={() => setConfirmOpen(true)}
            >
              Terima Pengembalian · {selectedUnitIds.length}
              <Check />
            </Button>
          ) : (
            <Button type="button" variant="outline" className="h-12 w-full rounded-xl" onClick={() => setQrOpen(true)}>
              <QrCode />
              Scan QR Unit
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
