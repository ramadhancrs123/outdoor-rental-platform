import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Boxes, Check, CircleAlert, MapPin, PackageCheck, RefreshCw, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DetailSkeleton,
  InventoryContextFacts,
  InventoryReadinessBanner,
  InventoryStatusBadge,
  UnitConflictNotice,
  UnitHistoryTimeline,
  UnitIdentity,
  UnknownOutcomeNotice,
} from "@/components/inventaris/inventory-ui";
import {
  formatInventoryDate,
  formatInventoryDateTime,
  getInventarisContext,
  getInventoryOperationalContext,
  getInventoryStateCapabilities,
  getInventoryUnit,
  listInventoryLocations,
  markInventoryUnitReady,
  correctInventoryConditionSummary,
  moveInventoryUnit,
  reconcileInventoryCommand,
} from "@/features/inventaris";
import { paths } from "@/routes/paths";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isConflictMessage(message: string) {
  return /CONFLICT|konflik|stale|berubah sejak/i.test(message);
}

type MoveStep = 1 | 2;

export function InventoryShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveStep, setMoveStep] = useState<MoveStep>(1);
  const [moveTarget, setMoveTarget] = useState("");
  const [conditionCorrectionOpen, setConditionCorrectionOpen] = useState(false);
  const [conditionDraft, setConditionDraft] = useState("");
  const [conditionReason, setConditionReason] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [unknownCommand, setUnknownCommand] = useState<"move" | "ready" | null>(null);
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [unknownReconciling, setUnknownReconciling] = useState(false);
  const [conflictReason, setConflictReason] = useState("");
  const moveCommandRef = useRef<string | null>(null);
  const readyCommandRef = useRef<string | null>(null);

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: getInventarisContext,
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: ["inventaris", "unit", context.data?.usahaId, id],
    queryFn: () => getInventoryUnit(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });
  const locations = useQuery({
    queryKey: ["inventaris", "locations", context.data?.usahaId],
    queryFn: () => listInventoryLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const operational = useQuery({
    queryKey: ["inventaris", "operational-context", context.data?.usahaId, id],
    queryFn: () => getInventoryOperationalContext(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 15_000,
  });

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !moveTarget) throw new Error("Lokasi tujuan belum dipilih.");
      if (!moveCommandRef.current) moveCommandRef.current = crypto.randomUUID();
      return moveInventoryUnit(
        context.data.usahaId,
        id,
        moveTarget,
        "Perpindahan dari detail unit.",
        {
          idempotencyKey: moveCommandRef.current,
          requestId: crypto.randomUUID(),
          expectedUpdatedAt: detail.data?.unit.updated_at,
        },
      );
    },
    onMutate: () => {
      setActionFeedback("");
      setConflictReason("");
    },
    onSuccess: async () => {
      moveCommandRef.current = null;
      setUnknownCommand(null);
      setMoveOpen(false);
      setMoveStep(1);
      setMoveTarget("");
      setActionFeedback("Lokasi unit berhasil diperbarui. Status unit tidak berubah karena perpindahan lokasi bukan perubahan status.");
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "unit", context.data?.usahaId, id] });
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "units"] });
    },
    onError: (error) => {
      const message = errorText(error, "Pemindahan unit gagal.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setUnknownCommand("move");
        setUnknownFeedback(message.replace(/^UNKNOWN_OUTCOME:\s*/, ""));
      } else {
        moveCommandRef.current = isConflictMessage(message) ? moveCommandRef.current : null;
        setConflictReason(isConflictMessage(message) ? message : "");
        setActionFeedback(isConflictMessage(message) ? "" : message);
      }
    },
  });

  const readyMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id) throw new Error("Unit tidak ditemukan.");
      if (!readyCommandRef.current) readyCommandRef.current = crypto.randomUUID();
      return markInventoryUnitReady(
        context.data.usahaId,
        id,
        "Readiness ditetapkan melalui detail Inventaris setelah verifikasi.",
        {
          idempotencyKey: readyCommandRef.current,
          requestId: crypto.randomUUID(),
          expectedUpdatedAt: detail.data?.unit.updated_at,
        },
      );
    },
    onMutate: () => {
      setActionFeedback("");
      setConflictReason("");
    },
    onSuccess: async () => {
      readyCommandRef.current = null;
      setUnknownCommand(null);
      setActionFeedback("Unit berhasil ditetapkan Siap Disewakan. Ketersediaan untuk periode sewa tetap diperiksa melalui Reservasi/Penyewaan.");
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "unit", context.data?.usahaId, id] });
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "units"] });
    },
    onError: (error) => {
      const message = errorText(error, "Penetapan Siap Disewakan gagal.");
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setUnknownCommand("ready");
        setUnknownFeedback(message);
      } else {
        readyCommandRef.current = isConflictMessage(message) ? readyCommandRef.current : null;
        setConflictReason(isConflictMessage(message) ? message : "");
        setActionFeedback(isConflictMessage(message) ? "" : message);
      }
    },
  });

  const conditionCorrectionMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !detail.data?.unit.updated_at) throw new Error("Status unit terbaru belum tersedia.");
      return correctInventoryConditionSummary(
        context.data.usahaId,
        id,
        {
          newCondition: conditionDraft,
          correctionReason: conditionReason,
          correctionNote: conditionNote,
          sourcePemeriksaanId: operational.data?.latestInspection?.pemeriksaan_id ?? null,
          expectedUpdatedAt: detail.data.unit.updated_at,
        },
        { requestId: crypto.randomUUID() },
      );
    },
    onMutate: () => {
      setActionFeedback("");
      setConflictReason("");
    },
    onSuccess: async (result) => {
      setConditionCorrectionOpen(false);
      setConditionDraft(result.kondisi_ringkas ?? "");
      setConditionReason("");
      setConditionNote("");
      setActionFeedback(result.state === "unchanged" ? "Kondisi sudah sama; tidak ada perubahan yang disimpan." : "Koreksi kondisi berhasil dicatat pada audit dan riwayat unit.");
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "unit", context.data?.usahaId, id] });
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "units"] });
    },
    onError: (error) => {
      const message = errorText(error, "Koreksi Kondisi gagal.");
      setActionFeedback(message);
    },
  });

  const reconcileUnknownCommand = async () => {
    if (!context.data?.usahaId || !id || !unknownCommand) return;
    const commandName = unknownCommand === "move" ? "move_inventory_unit" : "mark_inventory_unit_ready";
    const key = unknownCommand === "move" ? moveCommandRef.current : readyCommandRef.current;
    if (!key) return;

    setUnknownReconciling(true);
    try {
      const result = await reconcileInventoryCommand(context.data.usahaId, commandName, key);
      if (result.state === "committed") {
        if (unknownCommand === "move") moveCommandRef.current = null;
        else readyCommandRef.current = null;
        setUnknownCommand(null);
        setUnknownFeedback("");
        setActionFeedback("Perubahan sudah disimpan. Detail unit sedang diperbarui.");
        await queryClient.invalidateQueries({ queryKey: ["inventaris", "unit", context.data.usahaId, id] });
        await queryClient.invalidateQueries({ queryKey: ["inventaris", "units"] });
      } else if (result.state === "not_found") {
        if (unknownCommand === "move") moveCommandRef.current = null;
        else readyCommandRef.current = null;
        setUnknownCommand(null);
        setUnknownFeedback("");
        setActionFeedback("Perubahan sebelumnya belum ditemukan. Tindakan baru boleh dilakukan setelah status unit diperiksa kembali.");
      } else {
        setUnknownFeedback("Hasil tindakan belum dapat dipastikan. Jangan kirim tindakan yang sama lagi.");
      }
    } catch (error) {
      setUnknownFeedback(errorText(error, "Pemeriksaan status tindakan gagal."));
    } finally {
      setUnknownReconciling(false);
    }
  };

  if (context.isPending || detail.isPending) {
    return <DetailSkeleton />;
  }

  if (context.error || detail.error || !detail.data || !context.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.inventaris}><ArrowLeft />Kembali ke Inventaris</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Detail unit tidak tersedia</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{context.error?.message ?? detail.error?.message ?? "Unit tidak ditemukan atau Anda tidak memiliki akses."}</p>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void detail.refetch()}>
              <RefreshCw />Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const unit = detail.data.unit;
  const history = detail.data.history;
  const capabilities = getInventoryStateCapabilities();
  const activeLocations = (locations.data ?? []).filter((location) => location.status === "active");
  const selectedLocation = activeLocations.find((location) => location.lokasi_id === moveTarget);

  const canMarkReady =
    capabilities.mutation &&
    !["ready", "rented", "lost", "inactive", "inspection_pending", "maintenance", "damaged"].includes(unit.status);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-28 sm:space-y-5 md:pb-10">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.inventaris}><ArrowLeft />Kembali</Link>
        </Button>
        <Badge variant="secondary" className="rounded-full">{context.data.usahaNama}</Badge>
      </div>

      <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-muted/40 text-primary sm:size-20"
              aria-label={"Pratinjau " + (unit.barang?.nama ?? "barang")}
            >
              <Boxes className="size-7 sm:size-9" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Unit fisik</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{unit.kode_unit}</h1>
                <InventoryStatusBadge status={unit.status} />
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {unit.barang?.nama ?? "Barang tidak ditemukan"}
                {unit.varian?.nama ? " · " + unit.varian.nama : ""}
              </p>
              {unit.serial_number ? <p className="mt-1 text-xs text-muted-foreground">Serial {unit.serial_number}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setMoveStep(1);
                setMoveTarget("");
                setMoveOpen(true);
              }}
            >
              <MapPin />Pindahkan Lokasi
            </Button>
          </div>
        </div>
      </section>

      {unknownCommand ? (
        <UnknownOutcomeNotice
          message={unknownFeedback}
          onReconcile={() => void reconcileUnknownCommand()}
          busy={unknownReconciling}
        />
      ) : null}

      {conflictReason && !unknownCommand ? <UnitConflictNotice unit={unit} reason={conflictReason} /> : null}

      {actionFeedback && !unknownCommand && !conflictReason ? (
        <Alert>
          <Check className="size-4" />
          <AlertTitle>Perubahan tercatat</AlertTitle>
          <AlertDescription>{actionFeedback}</AlertDescription>
        </Alert>
      ) : null}

      <div id="unit-ringkasan">
        <InventoryReadinessBanner unit={unit} operational={operational.data} />
      </div>

      <nav
        className="sticky top-2 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-border/80 bg-background/95 p-1 shadow-sm backdrop-blur md:hidden"
        aria-label="Navigasi detail unit"
      >
        {[
          ["unit-ringkasan", "Ringkasan"],
          ["unit-lokasi", "Lokasi"],
          ["unit-riwayat", "Riwayat"],
          ["unit-pemeriksaan", "Pemeriksaan"],
          ["unit-perawatan", "Perawatan"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={`#${href}`}
            className="min-h-10 shrink-0 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Kode unit</p>
              <p className="mt-1 font-semibold">{unit.kode_unit}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Serial</p>
              <p className="mt-1 font-semibold">{unit.serial_number ?? "Belum dicatat"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tanggal diperoleh</p>
              <p className="mt-1 font-semibold">{formatInventoryDate(unit.tanggal_diperoleh)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="mt-1 font-semibold">{formatInventoryDateTime(unit.updated_at)}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Catatan internal</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{unit.catatan_internal ?? "Tidak ada catatan internal."}</p>
            </div>
          </CardContent>
        </Card>

        <Card id="unit-lokasi" className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Catalog & Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Barang</p>
              <p className="mt-1 font-semibold">{unit.barang?.nama ?? "Barang tidak ditemukan"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Varian</p>
              <p className="mt-1 font-semibold">{unit.varian?.nama ?? "Tanpa varian"}</p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-3">
              <MapPin className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Current location</p>
                <p className="mt-1 font-semibold">{unit.lokasi?.nama ?? "Belum ditentukan"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Lokasi tidak menentukan status unit.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Penetapan Unit & Penyewaan Saat Ini</h2>
          <p className="text-sm text-muted-foreground">
            Penetapan Unit dan penyewaan tetap dikelola oleh menu Penyewaan.
          </p>
        </div>
        {operational.isPending ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : (
          <InventoryContextFacts operational={operational.data} />
        )}
      </section>

      {operational.error ? (
        <Alert>
          <CircleAlert className="size-4" />
          <AlertTitle>Konteks lintas modul belum tersedia</AlertTitle>
          <AlertDescription>
            Status utama unit tetap berasal dari Inventaris. Data penyewaan, pengembalian, pemeriksaan, dan perawatan dapat dimuat ulang tanpa mengubah status unit.
          </AlertDescription>
        </Alert>
      ) : null}

      {capabilities.mutation ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Aksi Berikutnya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {unit.status === "damaged" ? (
                <Button asChild className="h-11 rounded-xl">
                  <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>Buka Perawatan<Wrench /></Link>
                </Button>
              ) : null}
              {unit.status === "maintenance" ? (
                <Button asChild className="h-11 rounded-xl">
                  <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>Buka Perawatan</Link>
                </Button>
              ) : null}
              {unit.status === "rented" ? (
                <Button asChild className="h-11 rounded-xl">
                  <Link to={operational.data?.activeRental ? paths.penyewaan + "/" + operational.data.activeRental.penyewaan_id : paths.penyewaan}>
                    {operational.data?.activeRental ? "Buka Penyewaan" : "Tinjau Penyewaan"}
                  </Link>
                </Button>
              ) : null}
              {canMarkReady ? (
                <Button
                  className="h-11 rounded-xl"
                  onClick={() => readyMutation.mutate()}
                  disabled={readyMutation.isPending}
                >
                  <PackageCheck />
                  {readyMutation.isPending ? "Memverifikasi…" : "Verifikasi & Tetapkan Siap Disewakan"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => {
                  setConditionDraft(unit.kondisi_ringkas ?? "");
                  setConditionCorrectionOpen(true);
                }}
              >
                Koreksi Kondisi
              </Button>
              {!["inspection_pending", "maintenance", "rented", "damaged"].includes(unit.status) && !canMarkReady ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Tidak ada tindakan yang aman untuk status ini. Tinjau detail unit dan menu terkait untuk langkah berikutnya.
                </div>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Setiap perubahan diperiksa oleh sistem sebelum disimpan. Sistem juga melindungi perubahan yang dilakukan bersamaan. Status unit tidak diubah melalui tindakan umum.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Pengembalian / Pemeriksaan / Perawatan</h2>
          <p className="text-sm text-muted-foreground">
            Penyelesaian pada satu menu tidak otomatis mengubah status fisik unit menjadi Siap Disewakan.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="shadow-none">
            <CardContent className="space-y-2 p-4">
              <p className="text-xs text-muted-foreground">Pengembalian terakhir</p>
              <p className="font-semibold">{operational.data?.latestReturn ? "Unit diterima" : "Belum ada pengembalian"}</p>
              <p className="text-xs text-muted-foreground">
                {operational.data?.latestReturn
                  ? formatInventoryDateTime(operational.data.latestReturn.diterima_at)
                  : "Tidak ada data pengembalian yang tersedia."}
              </p>
            </CardContent>
          </Card>
          <Card id="unit-pemeriksaan" className="shadow-none">
            <CardContent className="space-y-2 p-4">
              <p className="text-xs text-muted-foreground">Pemeriksaan terakhir</p>
              <p className="font-semibold">{operational.data?.latestInspection?.hasil ?? "Belum ada pemeriksaan"}</p>
              <p className="text-xs text-muted-foreground">
                {operational.data?.latestInspection
                  ? `${operational.data.latestInspection.kelengkapan_status} · ${operational.data.latestInspection.keputusan_operasional}`
                  : "Belum ada bukti pemeriksaan."}
              </p>
            </CardContent>
          </Card>
          <Card id="unit-perawatan" className="shadow-none">
            <CardContent className="space-y-2 p-4">
              <p className="text-xs text-muted-foreground">Perawatan</p>
              <p className="font-semibold">
                {operational.data?.openMaintenance.length
                  ? `${operational.data.openMaintenance.length} pekerjaan terbuka`
                  : "Tidak ada perawatan aktif"}
              </p>
              <p className="text-xs text-muted-foreground">Data utama tetap dikelola oleh modul Perawatan.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="unit-riwayat" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Riwayat Unit</h2>
            <p className="text-sm text-muted-foreground">Riwayat peristiwa unit, bukan Audit Log platform.</p>
          </div>
        </div>
        <UnitHistoryTimeline history={history} />
      </section>

      <Alert>
        <AlertTitle>Aksi Inventaris</AlertTitle>
        <AlertDescription>
          {capabilities.reason} QR hanya cara cepat menemukan unit; perubahan tetap diproses oleh sistem.
        </AlertDescription>
      </Alert>

      {capabilities.mutation && !conflictReason ? (
        <div className="fixed inset-x-2 bottom-20 z-40 md:hidden">
          <div className="rounded-2xl border border-border/80 bg-background/95 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
            {unknownCommand ? (
              <Button
                type="button"
                className="h-12 w-full rounded-xl"
                onClick={() => void reconcileUnknownCommand()}
                disabled={unknownReconciling}
              >
                {unknownReconciling ? "Memeriksa status…" : "Periksa Status Tindakan"}
              </Button>
            ) : unit.status === "damaged" ? (
              <Button asChild className="h-12 w-full rounded-xl">
                <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>
                  Buka Perawatan
                  <Wrench />
                </Link>
              </Button>
            ) : unit.status === "maintenance" ? (
              <Button asChild className="h-12 w-full rounded-xl">
                <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>
                  Buka Perawatan
                  <Wrench />
                </Link>
              </Button>
            ) : unit.status === "rented" ? (
              <Button asChild className="h-12 w-full rounded-xl">
                <Link to={operational.data?.activeRental ? paths.penyewaan + "/" + operational.data.activeRental.penyewaan_id : paths.penyewaan}>
                  {operational.data?.activeRental ? "Buka Penyewaan" : "Tinjau Penyewaan"}
                  <ArrowRight />
                </Link>
              </Button>
            ) : canMarkReady ? (
              <Button
                type="button"
                className="h-12 w-full rounded-xl"
                onClick={() => readyMutation.mutate()}
                disabled={readyMutation.isPending}
              >
                <PackageCheck />
                {readyMutation.isPending ? "Memverifikasi…" : "Verifikasi & Tetapkan Siap Disewakan"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={moveOpen}
        onOpenChange={(open) => {
          setMoveOpen(open);
          if (!open) {
            setMoveStep(1);
            setMoveTarget("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pindahkan Lokasi</DialogTitle>
            <DialogDescription>
              Pindah lokasi hanya mengubah lokasi fisik unit. Status unit tetap mengikuti domain Inventaris.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2" aria-label="Tahap perpindahan lokasi">
            {[["1", "Pilih lokasi"], ["2", "Konfirmasi"]].map(([step, label]) => (
              <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    Number(step) === moveStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step}
                </div>
                <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
                {step === "1" ? <div className="h-px flex-1 bg-border" /> : null}
              </div>
            ))}
          </div>

          {moveStep === 1 ? (
            <div className="space-y-4">
              <div className="rounded-2xl border bg-muted/20 p-4">
                <p className="text-xs text-muted-foreground">Unit</p>
                <div className="mt-2">
                  <UnitIdentity unit={unit} compact />
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span>
                    Lokasi saat ini: <strong>{unit.lokasi?.nama ?? "Belum ditentukan"}</strong>
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="inventory-location-target">
                  Lokasi tujuan
                </label>
                <Select
                  value={moveTarget || "none"}
                  onValueChange={(value) => setMoveTarget(value === "none" ? "" : value)}
                >
                  <SelectTrigger id="inventory-location-target" aria-label="Pilih lokasi tujuan" className="h-11 rounded-xl">
                    <SelectValue placeholder="Pilih lokasi…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Pilih lokasi…</SelectItem>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.lokasi_id} value={location.lokasi_id}>
                        {location.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="rounded-xl" onClick={() => setMoveOpen(false)}>
                  Batal
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={!moveTarget || moveTarget === unit.lokasi_id}
                  onClick={() => setMoveStep(2)}
                >
                  Lanjutkan
                  <ArrowRight />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border bg-muted/20 p-4">
                <p className="text-xs text-muted-foreground">Konfirmasi perpindahan</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Dari</p>
                    <p className="mt-1 font-semibold">{unit.lokasi?.nama ?? "Belum ditentukan"}</p>
                  </div>
                  <ArrowRight className="hidden size-5 justify-self-center text-muted-foreground sm:block" />
                  <div className="rounded-xl border bg-background p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">Ke</p>
                    <p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Lokasi belum dipilih"}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Status unit tidak berubah. Yang dicatat hanya perpindahan lokasi fisik dan riwayatnya.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => setMoveStep(1)}
                  disabled={moveMutation.isPending}
                >
                  Kembali
                </Button>
                <Button
                  className="rounded-xl"
                  disabled={!selectedLocation || moveMutation.isPending}
                  onClick={() => moveMutation.mutate()}
                >
                  {moveMutation.isPending ? "Memindahkan…" : "Konfirmasi & Pindahkan"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={conditionCorrectionOpen}
        onOpenChange={(open) => {
          setConditionCorrectionOpen(open);
          if (!open) {
            setConditionReason("");
            setConditionNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Koreksi Kondisi</DialogTitle>
            <DialogDescription>
              Gunakan hanya saat ringkasan kondisi Inventaris tidak sinkron. Ini adalah recovery operasional, bukan pengganti Pemeriksaan dan tidak mengubah status unit menjadi siap.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4 text-sm">
              <p className="text-xs text-muted-foreground">Kondisi saat ini</p>
              <p className="mt-1 font-semibold">{unit.kondisi_ringkas ?? "Belum diisi"}</p>
            </div>

            <label className="grid gap-2 text-sm font-medium">
              Kondisi Ringkas Baru
              <input
                className="h-11 rounded-xl border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={conditionDraft}
                onChange={(event) => setConditionDraft(event.target.value)}
                placeholder="Contoh: Baik, lengkap"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Alasan Koreksi
              <input
                className="h-11 rounded-xl border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={conditionReason}
                onChange={(event) => setConditionReason(event.target.value)}
                placeholder="Mengapa summary perlu diperbaiki?"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Catatan
              <textarea
                className="min-h-24 rounded-xl border bg-background p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={conditionNote}
                onChange={(event) => setConditionNote(event.target.value)}
                placeholder="Catatan audit tambahan (opsional)"
              />
            </label>

            <p className="text-xs leading-5 text-muted-foreground">
              Perubahan akan dicatat ke audit log dan riwayat unit, memakai expected_updated_at agar koreksi stale tidak menimpa perubahan terbaru.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-xl" onClick={() => setConditionCorrectionOpen(false)}>
                Batal
              </Button>
              <Button
                className="rounded-xl"
                disabled={conditionCorrectionMutation.isPending || !conditionDraft.trim() || !conditionReason.trim()}
                onClick={() => conditionCorrectionMutation.mutate()}
              >
                {conditionCorrectionMutation.isPending ? "Menyimpan…" : "Simpan Koreksi"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
