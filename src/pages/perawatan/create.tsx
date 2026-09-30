import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Info, MoreVertical, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createMaintenance,
  getPerawatanContext,
  listMaintenanceInspectionCandidates,
  listMaintenanceUnitCandidates,
  reconcileMaintenanceCommand,
} from "@/features/perawatan";
import { formatMaintenanceDateTime, semanticMaintenanceLabel } from "@/features/perawatan/utils";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PerawatanCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<"inspection" | "manual">(
    searchParams.get("pemeriksaan_id") ? "inspection" : "inspection",
  );
  const [inspectionSearch, setInspectionSearch] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [inspectionId, setInspectionId] = useState(searchParams.get("pemeriksaan_id") ?? "");
  const [unitId, setUnitId] = useState(searchParams.get("unit_id") ?? "");
  const [type, setType] = useState("repair");
  const [description, setDescription] = useState("");
  const [executor, setExecutor] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [errorFeedback, setErrorFeedback] = useState("");
  const [unknownKey, setUnknownKey] = useState("");

  const context = useQuery({
    queryKey: ["perawatan", "context"],
    queryFn: getPerawatanContext,
    staleTime: 60_000,
  });

  const inspections = useQuery({
    queryKey: ["perawatan", "inspection-candidates", context.data?.usahaId, inspectionSearch],
    queryFn: () => listMaintenanceInspectionCandidates(context.data!.usahaId, inspectionSearch),
    enabled: Boolean(context.data?.usahaId && source === "inspection"),
    staleTime: 10_000,
  });

  const units = useQuery({
    queryKey: ["perawatan", "manual-unit-candidates", context.data?.usahaId, unitSearch],
    queryFn: () => listMaintenanceUnitCandidates(context.data!.usahaId, unitSearch),
    enabled: Boolean(context.data?.usahaId && source === "manual"),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (searchParams.get("pemeriksaan_id")) {
      setSource("inspection");
      setInspectionId(searchParams.get("pemeriksaan_id") ?? "");
    }
    if (searchParams.get("unit_id")) setUnitId(searchParams.get("unit_id") ?? "");
  }, [searchParams]);

  const selectedInspection = useMemo(
    () => inspections.data?.find((item) => item.pemeriksaan_id === inspectionId) ?? null,
    [inspections.data, inspectionId],
  );

  const selectedManualUnit = useMemo(
    () => units.data?.find((item) => item.unit_barang_id === unitId && item.status === "ready") ?? null,
    [units.data, unitId],
  );

  useEffect(() => {
    if (selectedInspection) {
      setUnitId(selectedInspection.unit_barang_id);
      if (!description && selectedInspection.finding_summary) {
        setDescription(selectedInspection.finding_summary);
      }
    }
  }, [selectedInspection, description]);

  const selectedUnitLabel =
    source === "inspection"
      ? selectedInspection
        ? selectedInspection.kode_unit + " · " + (selectedInspection.barang_nama ?? "Barang") + (selectedInspection.varian_nama ? " · " + selectedInspection.varian_nama : "")
        : ""
      : selectedManualUnit
        ? selectedManualUnit.kode_unit + " · " + (selectedManualUnit.barang_nama ?? "Barang")
        : "";

  const sourceReady =
    source === "inspection"
      ? Boolean(selectedInspection)
      : Boolean(selectedManualUnit);

  const detailReady = Boolean(
    type.trim() &&
    description.trim() &&
    executor.trim() &&
    (source === "inspection" || notes.trim()),
  );
  const reviewReady = sourceReady && detailReady;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Usaha belum siap.");
      if (!sourceReady) throw new Error(source === "manual" ? "Unit dan alasan maintenance manual wajib diisi." : "Pilih Inspection Source.");
      const parsedCost = cost.trim() === "" ? null : Number(cost);
      if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
        throw new Error("Biaya harus berupa angka nol atau lebih.");
      }
      const key = "create-maintenance-" + crypto.randomUUID();
      setUnknownKey(key);
      return createMaintenance(
        context.data.usahaId,
        {
          unitBarangId: source === "inspection" ? selectedInspection!.unit_barang_id : selectedManualUnit!.unit_barang_id,
          pemeriksaanId: source === "inspection" ? selectedInspection!.pemeriksaan_id : null,
          jenisPerawatan: type,
          deskripsiPekerjaan: description,
          pelaksana: executor,
          biaya: parsedCost,
          currencyCode: "IDR",
          catatan: notes,
        },
        key,
      );
    },
    onMutate: () => setErrorFeedback(""),
    onSuccess: async (result) => {
      setUnknownKey("");
      await queryClient.invalidateQueries({ queryKey: ["perawatan"] });
      const id = String(result.perawatan_id ?? "");
      if (id) navigate(paths.perawatan + "/" + id);
    },
    onError: (error) => {
      const message = errorMessage(error, "Perawatan gagal dibuat.");
      setErrorFeedback(message);
    },
  });

  if (context.isPending) {
    return <div className="space-y-4"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Perawatan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error, "Usaha aktif tidak tersedia.")}</AlertDescription></Alert>;
  }

  const stepLabels = ["Sumber & Unit", "Detail Pekerjaan", "Review"];

  const renderSource = () => (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold">Sumber Perawatan</p>
        <p className="mt-1 text-sm text-muted-foreground">Tentukan konteks sebelum detail pekerjaan diisi.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${source === "inspection" ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20" : "hover:bg-accent/30"}`}
          onClick={() => { setSource("inspection"); setUnitId(""); }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-5" /></div>
            {source === "inspection" ? <Badge className="rounded-full">Dipilih</Badge> : null}
          </div>
          <p className="mt-3 font-semibold">Dari Pemeriksaan</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Buat perawatan dari hasil temuan pemeriksaan.</p>
        </button>

        <button
          type="button"
          className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${source === "manual" ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20" : "hover:bg-accent/30"}`}
          onClick={() => { setSource("manual"); setInspectionId(""); setUnitId(""); }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><Wrench className="size-5" /></div>
            {source === "manual" ? <Badge className="rounded-full">Dipilih</Badge> : null}
          </div>
          <p className="mt-3 font-semibold">Manual</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Buat perawatan tanpa Inspection Source.</p>
        </button>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertTitle>Maintenance tanpa pemeriksaan</AlertTitle>
        <AlertDescription>
          Jalur manual diperbolehkan pada fase ini, tetapi alasan wajib dicatat. Jalur manual hanya dapat memilih unit yang READY saat ini.
        </AlertDescription>
      </Alert>

      {source === "inspection" ? (
        <div className="space-y-3">
          <label className="grid gap-2 text-sm font-medium" htmlFor="inspection-search">Cari pemeriksaan</label>
          <Input id="inspection-search" value={inspectionSearch} onChange={(e) => setInspectionSearch(e.target.value)} placeholder="Nomor pemeriksaan, kode unit, atau temuan..." />
          <select
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            value={inspectionId}
            onChange={(e) => setInspectionId(e.target.value)}
            aria-label="Pilih pemeriksaan"
          >
            <option value="">Pilih Inspection Source</option>
            {(inspections.data ?? []).map((item) => (
              <option key={item.pemeriksaan_id} value={item.pemeriksaan_id}>
                {item.kode_unit} · {item.barang_nama ?? "Barang"} · {semanticMaintenanceLabel(item.keputusan_operasional)}
              </option>
            ))}
          </select>
          {selectedInspection ? (
            <div className="rounded-2xl border p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><Wrench className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{selectedInspection.kode_unit}</p><Badge variant="outline" className="rounded-full">{selectedInspection.finding_count} temuan</Badge></div>
                  <p className="text-sm text-muted-foreground">{selectedInspection.barang_nama ?? "-"}{selectedInspection.varian_nama ? " · " + selectedInspection.varian_nama : ""}</p>
                  <p className="mt-2 text-sm">{selectedInspection.finding_summary ?? "Temuan pemeriksaan tersedia."}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatMaintenanceDateTime(selectedInspection.diperiksa_at)} · {semanticMaintenanceLabel(selectedInspection.keputusan_operasional)}</p>
                </div>
              </div>
            </div>
          ) : inspections.data?.length === 0 && !inspections.isPending ? (
            <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada hasil pemeriksaan yang tersedia untuk dibuatkan maintenance.</div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="grid gap-2 text-sm font-medium" htmlFor="unit-search">Pilih Unit READY</label>
          <Input id="unit-search" value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} placeholder="Cari kode unit atau barang..." />
          <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Pilih unit READY">
            <option value="">Pilih unit</option>
            {(units.data ?? []).filter((item) => item.status === "ready").map((item) => (
              <option key={item.unit_barang_id} value={item.unit_barang_id}>{item.kode_unit} · {item.barang_nama ?? "Barang"} · READY</option>
            ))}
          </select>
          {selectedManualUnit ? <Badge variant="secondary" className="rounded-full">Unit dipilih · READY</Badge> : null}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button asChild variant="outline" className="rounded-xl"><Link to={paths.perawatan}><ArrowLeft />Batal</Link></Button>
        <Button className="rounded-xl sm:min-w-48" disabled={!sourceReady} onClick={() => setStep(2)}>Lanjut ke Detail <ArrowRight /></Button>
      </div>
    </div>
  );

  const renderDetail = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-muted/15 p-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-background"><Wrench className="size-5 text-primary" /></div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{selectedUnitLabel || "Unit belum dipilih"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{source === "inspection" ? "Source · Pemeriksaan" : "Source · Manual Maintenance"}</p>
          </div>
          <Badge variant={source === "inspection" ? "secondary" : "outline"} className="rounded-full">{source === "inspection" ? "Pemeriksaan" : "Manual"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
        <label className="grid gap-2 text-sm font-medium">Jenis Perawatan
          <select className="h-11 rounded-xl border bg-background px-3" value={type} onChange={(e) => setType(e.target.value)}><option value="repair">Repair</option><option value="cleaning">Cleaning</option><option value="replacement">Replacement</option><option value="inspection_follow_up">Tindak lanjut pemeriksaan</option><option value="other">Lainnya</option></select>
        </label>
        <label className="grid gap-2 text-sm font-medium">Deskripsi Pekerjaan
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contoh: Ganti resleting sisi kiri dan uji buka-tutup." rows={4} />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">Pelaksana
        <Input value={executor} onChange={(e) => setExecutor(e.target.value)} placeholder="Nama pelaksana" />
      </label>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <label className="grid gap-2 text-sm font-medium">Biaya Perawatan
          <Input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="150000" />
        </label>
        <label className="grid gap-2 text-sm font-medium">Currency
          <Input value="IDR" readOnly />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        {source === "inspection" ? "Catatan" : "Alasan maintenance manual *"}
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={source === "inspection" ? "Catatan pekerjaan atau konteks tambahan" : "Jelaskan kenapa maintenance dibuat tanpa Inspection Source"} rows={4} required={source === "manual"} />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" className="rounded-xl" onClick={() => setStep(1)}><ArrowLeft />Kembali</Button>
        <Button className="rounded-xl sm:min-w-48" disabled={!detailReady || (source === "manual" && !notes.trim())} onClick={() => setStep(3)}>Lanjut ke Review <ArrowRight /></Button>
      </div>
    </div>
  );

  const renderReview = () => (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Unit</CardTitle></CardHeader>
          <CardContent><p className="font-semibold">{selectedUnitLabel}</p><p className="mt-1 text-sm text-muted-foreground">{source === "inspection" ? "Source " + (selectedInspection?.pemeriksaan_id ?? "-") : "Manual Maintenance · unit READY"}</p></CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Pekerjaan</CardTitle></CardHeader>
          <CardContent><p className="font-semibold">{semanticMaintenanceLabel(type)}</p><p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{description}</p></CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Pelaksana</p><p className="mt-1 font-semibold">{executor}</p></div>
        <div className="rounded-2xl border p-4"><p className="text-xs text-muted-foreground">Biaya Perawatan</p><p className="mt-1 font-semibold">{cost ? new Intl.NumberFormat("id-ID").format(Number(cost)) + " IDR" : "Belum dicatat"}</p></div>
        <div className="rounded-2xl border p-4 sm:col-span-2"><p className="text-xs text-muted-foreground">{source === "inspection" ? "Catatan" : "Alasan maintenance manual"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{notes || "-"}</p></div>
      </div>

      <Alert>
        <Info className="size-4" />
        <AlertTitle>Review sebelum membuat</AlertTitle>
        <AlertDescription>Record akan dibuat sebagai <strong>Direncanakan</strong>. Completion tidak otomatis membuat unit READY.</AlertDescription>
      </Alert>

      {errorFeedback ? (
        <Alert variant="destructive">
          <AlertTitle>Perawatan belum tersimpan</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorFeedback}</p>{unknownKey ? <Button variant="outline" onClick={async () => {
            if (!context.data) return;
            try {
              const result = await reconcileMaintenanceCommand(context.data.usahaId, "create_maintenance", unknownKey);
              if (result.state === "committed" && result.response?.perawatan_id) navigate(paths.perawatan + "/" + String(result.response.perawatan_id));
              else if (result.state === "not_found") setErrorFeedback("Command tidak ditemukan. Muat state terbaru sebelum membuat record baru.");
              else setErrorFeedback("Command masih UNKNOWN_OUTCOME. Jangan membuat maintenance kedua.");
            } catch (error) { setErrorFeedback(errorMessage(error, "Rekonsiliasi gagal.")); }
          }}>Periksa Status Command</Button> : null}</AlertDescription>
        </Alert>
      ) : null}

      <div className="sticky bottom-2 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" className="rounded-xl" onClick={() => setStep(2)}><ArrowLeft />Kembali</Button>
          <Button className="rounded-xl sm:min-w-56" disabled={!reviewReady || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Menyimpan..." : <>Buat Perawatan <Check /></>}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      <header className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl"><Link to={paths.perawatan}><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">Perawatan</p><h1 className="text-2xl font-bold tracking-tight">Buat Perawatan</h1></div>
        <div className="flex items-center gap-2"><Badge variant="secondary" className="hidden rounded-full sm:inline-flex">Usaha · {context.data.usahaNama}</Badge><Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label="Menu perawatan"><MoreVertical /></Button></div>
      </header>

      <div className="rounded-2xl border bg-card p-2">
        <div className="grid grid-cols-3 gap-1">
          {stepLabels.map((label, index) => {
            const current = index + 1;
            const active = current === step;
            const done = current < step;
            return (
              <button key={label} type="button" className={`min-h-16 rounded-xl px-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : done ? "bg-primary/10 text-primary" : "text-muted-foreground"}`} onClick={() => { if (current < step) setStep(current); }}>
                <div className="mx-auto grid size-7 place-items-center rounded-full bg-background/80 text-xs font-semibold sm:mx-0 sm:inline-grid">{done ? <Check className="size-3.5" /> : current}</div>
                <span className="mt-1 block text-[11px] font-semibold leading-tight sm:inline sm:ml-2 sm:text-sm">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">{stepLabels[step - 1]}</CardTitle></CardHeader>
        <CardContent>{step === 1 ? renderSource() : step === 2 ? renderDetail() : renderReview()}</CardContent>
      </Card>
    </div>
  );
}
