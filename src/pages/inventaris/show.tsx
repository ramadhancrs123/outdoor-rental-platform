import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Ban, Boxes, Check, CircleAlert, Clock3, FileText, History, MapPin, PackageCheck, QrCode, RefreshCw, Settings2, Tag, TriangleAlert, Wrench } from "lucide-react";
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
  setInventoryUnitOperationalStatus,
  correctInventoryConditionSummary,
  moveInventoryUnit,
  reconcileInventoryCommand,
} from "@/features/inventaris";
import { QrPreviewDialog } from "@/components/qr-operasional/qr-operasional";
import { getQrUnitRecord, buildUnitQrUrl } from "@/features/qr-operasional";
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
  const [qrOpen, setQrOpen] = useState(false);
  const [conditionCorrectionOpen, setConditionCorrectionOpen] = useState(false);
  const [conditionDraft, setConditionDraft] = useState("");
  const [conditionReason, setConditionReason] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [operationalStatusOpen, setOperationalStatusOpen] = useState(false);
  const [operationalStatus, setOperationalStatus] = useState<"damaged" | "lost" | "inactive">("damaged");
  const [operationalStatusReason, setOperationalStatusReason] = useState("");
  const [operationalStatusNote, setOperationalStatusNote] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [unknownCommand, setUnknownCommand] = useState<"move" | "ready" | null>(null);
  const [unknownFeedback, setUnknownFeedback] = useState("");
  const [unknownReconciling, setUnknownReconciling] = useState(false);
  const [detailTab, setDetailTab] = useState<"info" | "actions" | "history">("info");
  const [historyExpanded, setHistoryExpanded] = useState(false);
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
  const unitQr = useQuery({
    queryKey: ["qr-operasional", "unit", context.data?.usahaId, id],
    queryFn: () => getQrUnitRecord(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5 * 60_000,
  });


  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !moveTarget) throw new Error("Lokasi tujuan belum dipilih.");
      if (!moveCommandRef.current) moveCommandRef.current = createClientId();
      return moveInventoryUnit(
        context.data.usahaId,
        id,
        moveTarget,
        "Perpindahan dari detail unit.",
        {
          idempotencyKey: moveCommandRef.current,
          requestId: createClientId(),
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
      if (!readyCommandRef.current) readyCommandRef.current = createClientId();
      return markInventoryUnitReady(
        context.data.usahaId,
        id,
        "Readiness ditetapkan melalui detail Inventaris setelah verifikasi.",
        {
          idempotencyKey: readyCommandRef.current,
          requestId: createClientId(),
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

  const operationalStatusMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !id || !detail.data?.unit.updated_at) throw new Error("Status unit terbaru belum tersedia.");
      if (unit.status === "rented") throw new Error("Unit sedang disewa dan status operasional tidak dapat diubah dari sini.");
      return setInventoryUnitOperationalStatus(
        context.data.usahaId,
        id,
        {
          status: operationalStatus,
          reason: operationalStatusReason,
          note: operationalStatusNote,
          expectedUpdatedAt: detail.data.unit.updated_at,
        },
        { requestId: createClientId() },
      );
    },
    onMutate: () => {
      setActionFeedback("");
      setConflictReason("");
    },
    onSuccess: async (result) => {
      setOperationalStatusOpen(false);
      setOperationalStatusReason("");
      setOperationalStatusNote("");
      setActionFeedback(
        result.status === "inactive"
          ? "Unit dinonaktifkan. Unit tetap tersimpan dalam riwayat dan tidak lagi dapat dipilih untuk penyewaan baru."
          : result.status === "lost"
            ? "Unit ditandai Hilang. Unit tidak lagi dapat dipilih untuk penyewaan baru."
            : "Unit ditandai Rusak. Unit tidak lagi dapat dipilih untuk penyewaan baru dan dapat ditindaklanjuti melalui Perawatan.",
      );
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "unit", context.data?.usahaId, id] });
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "units"] });
      await queryClient.invalidateQueries({ queryKey: ["penyewaan"] });
    },
    onError: (error) => {
      const message = errorText(error, "Perubahan status unit gagal.");
      setActionFeedback(message);
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
        { requestId: createClientId() },
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
  const latestMaintenance = operational.data?.latestMaintenance ?? null;
  const maintenanceActionLabel =
    latestMaintenance?.status === "completed"
      ? "Verifikasi Kesiapan"
      : latestMaintenance
        ? "Lanjutkan Perawatan"
        : "Buka Perawatan";
  const maintenanceActionHref = latestMaintenance
    ? paths.perawatan + "/" + latestMaintenance.perawatan_id
    : paths.perawatan + "?unit_id=" + unit.unit_barang_id;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 pb-28 sm:space-y-4 lg:pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 size-9 rounded-xl" aria-label="Kembali ke Inventaris">
            <Link to={paths.inventaris}><ArrowLeft /></Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Detail Unit Barang</p>
            <h1 className="truncate text-[20px] font-bold leading-6 tracking-tight">{unit.kode_unit}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {unit.barang?.nama ?? "Barang tidak ditemukan"}{unit.varian?.nama ? " · " + unit.varian.nama : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={detailTab === "actions" ? "default" : "outline"}
          className="h-9 shrink-0 rounded-xl px-3 text-xs"
          onClick={() => setDetailTab("actions")}
        >
          <Settings2 />
          Aksi
        </Button>
      </header>

      <Card className="overflow-hidden rounded-[22px] border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardContent className="p-3.5 sm:p-4">
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
            <div
              className="grid size-[82px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-primary/10 bg-primary/[0.045] text-primary sm:size-24"
              aria-label={"Pratinjau " + (unit.barang?.nama ?? "barang")}
            >
              <Boxes className="size-9 sm:size-11" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">Barang</p>
                  <h2 className="mt-0.5 truncate text-[18px] font-bold leading-6">
                    {unit.barang?.nama ?? "Barang tidak ditemukan"}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{unit.kode_unit}</p>
                </div>
                <InventoryStatusBadge status={unit.status} />
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                  {unit.varian?.nama ?? "Tanpa varian"}
                </Badge>
                {unit.serial_number ? (
                  <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
                    Serial {unit.serial_number}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl bg-emerald-50/55 px-3 py-2.5 dark:bg-emerald-950/15">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <PackageCheck className="size-3.5" />
                Status
              </div>
              <p className="mt-1 truncate text-sm font-semibold">{unit.status}</p>
            </div>
            <div className="rounded-2xl bg-sky-50/55 px-3 py-2.5 dark:bg-sky-950/15">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <MapPin className="size-3.5" />
                Lokasi
              </div>
              <p className="mt-1 truncate text-sm font-semibold">{unit.lokasi?.nama ?? "Belum ditentukan"}</p>
            </div>
            <div className="rounded-2xl bg-amber-50/55 px-3 py-2.5 dark:bg-amber-950/15">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CircleAlert className="size-3.5" />
                Kondisi
              </div>
              <p className="mt-1 truncate text-sm font-semibold">{unit.kondisi_ringkas ?? "Belum dicatat"}</p>
            </div>
            <div className="rounded-2xl bg-violet-50/55 px-3 py-2.5 dark:bg-violet-950/15">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock3 className="size-3.5" />
                Diperoleh
              </div>
              <p className="mt-1 truncate text-sm font-semibold">{formatInventoryDate(unit.tanggal_diperoleh)}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Catatan internal</p>
              <p className="mt-1 truncate text-sm">{unit.catatan_internal ?? "Tidak ada catatan internal."}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 rounded-xl px-3 text-xs"
              onClick={() => {
                setMoveStep(1);
                setMoveTarget("");
                setMoveOpen(true);
              }}
            >
              <MapPin />
              Pindahkan
            </Button>
          </div>
        </CardContent>
      </Card>

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

      <InventoryReadinessBanner unit={unit} operational={operational.data} />

      <nav
        className="sticky top-2 z-20 grid grid-cols-3 rounded-2xl border border-border/80 bg-background/95 p-1 shadow-sm backdrop-blur"
        aria-label="Bagian detail unit"
      >
        {([
          ["info", "Informasi", FileText],
          ["actions", "Aksi", Settings2],
          ["history", "Riwayat", History],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-selected={detailTab === value}
            onClick={() => setDetailTab(value as "info" | "actions" | "history")}
            className={[
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition",
              detailTab === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      {detailTab === "info" ? (
        <div className="space-y-3">
          <Card className="rounded-[22px] border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="size-5 text-primary" />
                Informasi Utama
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 p-4 pt-0">
              {[
                ["Nama Barang", unit.barang?.nama ?? "Barang tidak ditemukan"],
                ["Kode Unit", unit.kode_unit],
                ["Varian", unit.varian?.nama ?? "Tanpa varian"],
                ["Serial", unit.serial_number ?? "Belum dicatat"],
                ["Tanggal Diperoleh", formatInventoryDate(unit.tanggal_diperoleh)],
                ["Lokasi", unit.lokasi?.nama ?? "Belum ditentukan"],
                ["Kondisi", unit.kondisi_ringkas ?? "Belum dicatat"],
              ].map(([label, value], index) => (
                <div key={label} className={[
                  "grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5",
                  index % 2 === 0 ? "bg-muted/20" : "bg-background",
                ].join(" ")}>
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <section className="space-y-3" aria-label="Konteks operasional">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Konteks Operasional</h2>
                <p className="text-sm text-muted-foreground">Fakta lintas modul yang relevan untuk unit ini.</p>
              </div>
            </div>

            {operational.isPending ? (
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="h-28 animate-pulse rounded-2xl bg-muted" />
                <div className="h-28 animate-pulse rounded-2xl bg-muted" />
                <div className="h-28 animate-pulse rounded-2xl bg-muted" />
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Card className="rounded-[20px] border-emerald-200/60 bg-emerald-50/30 shadow-none dark:border-emerald-900/30 dark:bg-emerald-950/10">
                  <CardContent className="space-y-1 p-3.5">
                    <p className="text-[11px] text-muted-foreground">Pengembalian</p>
                    <p className="truncate text-sm font-semibold">{operational.data?.latestReturn ? "Unit sudah diterima" : "Belum ada"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {operational.data?.latestReturn ? formatInventoryDateTime(operational.data.latestReturn.diterima_at) : "Belum ada fakta pengembalian."}
                    </p>
                  </CardContent>
                </Card>
                <Card id="unit-pemeriksaan" className="rounded-[20px] border-sky-200/60 bg-sky-50/30 shadow-none dark:border-sky-900/30 dark:bg-sky-950/10">
                  <CardContent className="space-y-1 p-3.5">
                    <p className="text-[11px] text-muted-foreground">Pemeriksaan</p>
                    <p className="truncate text-sm font-semibold">{operational.data?.latestInspection?.hasil ?? "Belum ada"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {operational.data?.latestInspection ? operational.data.latestInspection.keputusan_operasional : "Belum ada pemeriksaan."}
                    </p>
                  </CardContent>
                </Card>
                <Card id="unit-perawatan" className="rounded-[20px] border-amber-200/60 bg-amber-50/30 shadow-none dark:border-amber-900/30 dark:bg-amber-950/10">
                  <CardContent className="space-y-1 p-3.5">
                    <p className="text-[11px] text-muted-foreground">Perawatan</p>
                    <p className="truncate text-sm font-semibold">
                      {latestMaintenance?.status === "completed"
                        ? "Menunggu verifikasi"
                        : operational.data?.openMaintenance.length
                          ? operational.data.openMaintenance.length + " pekerjaan terbuka"
                          : "Tidak ada"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {latestMaintenance?.status === "completed" ? "Perawatan selesai" : "Data utama dikelola Perawatan."}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </section>

          {operational.error ? (
            <Alert>
              <CircleAlert className="size-4" />
              <AlertTitle>Konteks lintas modul belum tersedia</AlertTitle>
              <AlertDescription>
                Status utama unit tetap berasal dari Inventaris. Data modul lain dapat dimuat ulang tanpa mengubah status unit.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {detailTab === "actions" ? (
        <div className="space-y-3">
          <Card className="rounded-[22px] border-primary/15 bg-primary/[0.025] shadow-sm">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-5 text-primary" />
                Aksi Berikutnya
              </CardTitle>
              <p className="text-sm text-muted-foreground">Pilih tindakan sesuai keadaan unit saat ini.</p>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {unit.status === "damaged" ? (
                <Button asChild className="h-11 w-full rounded-xl justify-between">
                  <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>Buka Perawatan<Wrench /></Link>
                </Button>
              ) : null}

              {unit.status === "maintenance" ? (
                <Button asChild className="h-11 w-full rounded-xl justify-between">
                  <Link to={maintenanceActionHref}>
                    {maintenanceActionLabel}
                    {latestMaintenance?.status === "completed" ? <PackageCheck /> : <Wrench />}
                  </Link>
                </Button>
              ) : null}

              {unit.status === "rented" ? (
                <Button asChild className="h-11 w-full rounded-xl justify-between">
                  <Link to={operational.data?.activeRental ? paths.penyewaan + "/" + operational.data.activeRental.penyewaan_id : paths.penyewaan}>
                    {operational.data?.activeRental ? "Buka Penyewaan" : "Tinjau Penyewaan"}
                    <ArrowRight />
                  </Link>
                </Button>
              ) : null}

              {canMarkReady ? (
                <Button className="h-11 w-full rounded-xl justify-between" onClick={() => readyMutation.mutate()} disabled={readyMutation.isPending}>
                  <span className="inline-flex items-center gap-2">
                    <PackageCheck />
                    {readyMutation.isPending ? "Memverifikasi…" : "Verifikasi & Tetapkan Siap Disewakan"}
                  </span>
                  <ArrowRight />
                </Button>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
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
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl"
                  onClick={() => setQrOpen(true)}
                  disabled={!unitQr.data || unitQr.isPending}
                >
                  <QrCode />
                  Lihat QR Unit
                </Button>

                {unit.status !== "rented" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => {
                      setOperationalStatus("damaged");
                      setOperationalStatusReason("");
                      setOperationalStatusNote("");
                      setOperationalStatusOpen(true);
                    }}
                  >
                    <Ban />
                    Ubah Status Unit
                  </Button>
                ) : null}
              </div>

              {unit.status === "rented" ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm leading-5 text-muted-foreground">
                  Unit sedang disewa. Perubahan status Rusak, Hilang, atau Dinonaktifkan diproses melalui alur Penyewaan/Pengembalian agar histori tetap benar.
                </div>
              ) : null}

              {!["inspection_pending", "maintenance", "rented", "damaged"].includes(unit.status) && !canMarkReady ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Tidak ada tindakan aman yang tersedia untuk status ini.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[22px] border-border/70 bg-muted/[0.03] shadow-none">
            <CardContent className="flex items-start gap-3 p-3.5">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-xs leading-5 text-muted-foreground">
                Inventaris tetap menjadi pemilik status fisik dan readiness unit. Pemeriksaan, Perawatan, Penyewaan, dan Pengembalian menyediakan fakta lintas modul tanpa mengambil alih status Inventaris.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {detailTab === "history" ? (
        <section id="unit-riwayat" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Riwayat Unit</h2>
              <p className="text-sm text-muted-foreground">Riwayat peristiwa unit, bukan Audit Log platform.</p>
            </div>
            {history.length > 4 ? (
              <Button type="button" variant="ghost" className="h-9 rounded-full px-3 text-xs text-primary" onClick={() => setHistoryExpanded((value) => !value)}>
                {historyExpanded ? "Ringkas" : "Lihat Semua"}
                <ArrowRight className={historyExpanded ? "-rotate-90" : ""} />
              </Button>
            ) : null}
          </div>
          <UnitHistoryTimeline history={historyExpanded ? history : history.slice(0, 4)} />
        </section>
      ) : null}

      {capabilities.mutation ? (
        <div className="fixed inset-x-3 bottom-16 z-40 lg:hidden">
          <div className="rounded-2xl border bg-background/95 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
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
                <Link to={paths.perawatan + "?unit_id=" + unit.unit_barang_id}>Buka Perawatan<Wrench /></Link>
              </Button>
            ) : unit.status === "maintenance" ? (
              <Button asChild className="h-12 w-full rounded-xl">
                <Link to={maintenanceActionHref}>
                  {maintenanceActionLabel}
                  {latestMaintenance?.status === "completed" ? <PackageCheck /> : <Wrench />}
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
              <Button type="button" className="h-12 w-full rounded-xl" onClick={() => readyMutation.mutate()} disabled={readyMutation.isPending}>
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

      <QrPreviewDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title="QR Unit"
        description="QR ini tetap melekat pada identity unit dan membuka detail Inventaris."
        code={unit.kode_unit}
        kind="unit"
        url={unitQr.data ? buildUnitQrUrl(window.location.origin, unitQr.data.token_qr) : ""}
        labelData={unitQr.data ? {
          kode_unit: unit.kode_unit,
          nama_barang: unit.barang?.nama ?? "Barang",
          nama_varian: unit.varian?.nama ?? null,
          token_qr: unitQr.data.token_qr,
          url: buildUnitQrUrl(window.location.origin, unitQr.data.token_qr),
        } : null}
      />

      <Dialog
        open={operationalStatusOpen}
        onOpenChange={(open) => {
          setOperationalStatusOpen(open);
          if (!open && !operationalStatusMutation.isPending) {
            setOperationalStatusReason("");
            setOperationalStatusNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ubah Status Unit</DialogTitle>
            <DialogDescription>
              Gunakan status ini untuk mengeluarkan unit dari penyewaan normal tanpa menghapus riwayat fisiknya.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Unit</p>
              <p className="mt-1 font-semibold">{unit.kode_unit}</p>
              <p className="text-sm text-muted-foreground">{unit.barang?.nama ?? "Barang tidak ditemukan"}</p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="inventory-operational-status">Status baru</label>
              <Select value={operationalStatus} onValueChange={(value) => setOperationalStatus(value as "damaged" | "lost" | "inactive")}>
                <SelectTrigger id="inventory-operational-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="damaged">Rusak</SelectItem>
                  <SelectItem value="lost">Hilang</SelectItem>
                  <SelectItem value="inactive">Dinonaktifkan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
              {operationalStatus === "damaged"
                ? "Unit tidak akan tersedia untuk penyewaan baru dan dapat ditindaklanjuti melalui Perawatan."
                : operationalStatus === "lost"
                  ? "Unit dianggap hilang dan tidak akan tersedia untuk penyewaan baru."
                  : "Unit tidak lagi dianggap siap disewakan. Riwayat unit tetap tersimpan dan status ini tidak otomatis membuat unit aktif kembali."}
            </div>

            <label className="grid gap-2 text-sm font-medium">
              Alasan
              <textarea
                className="min-h-24 rounded-xl border bg-background p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={operationalStatusReason}
                onChange={(event) => setOperationalStatusReason(event.target.value)}
                placeholder="Contoh: rangka patah, unit tidak ditemukan, atau tidak ekonomis untuk digunakan."
              />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Catatan tambahan
              <textarea
                className="min-h-20 rounded-xl border bg-background p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={operationalStatusNote}
                onChange={(event) => setOperationalStatusNote(event.target.value)}
                placeholder="Opsional"
              />
            </label>

            <p className="text-xs leading-5 text-muted-foreground">
              Perubahan dicatat pada riwayat unit dan audit. Unit tidak dihapus.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-xl" onClick={() => setOperationalStatusOpen(false)}>
                Batal
              </Button>
              <Button
                className="rounded-xl"
                disabled={operationalStatusMutation.isPending || !operationalStatusReason.trim()}
                onClick={() => operationalStatusMutation.mutate()}
              >
                <TriangleAlert />
                {operationalStatusMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
              </Button>
            </div>
          </div>
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
