import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  SearchCheck,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listInspectionQueue } from "@/features/pemeriksaan";
import { semanticInspectionLabel } from "@/features/pemeriksaan/utils";
import { getMaintenanceOverview, getPerawatanContext, listMaintenanceQueue } from "@/features/perawatan";
import { formatMaintenanceDateTime, semanticMaintenanceLabel } from "@/features/perawatan/utils";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data perawatan tidak tersedia.";
}

function sourceLabel(pemeriksaanId: string | null) {
  return pemeriksaanId ? "Pemeriksaan" : "Manual";
}

function queueStatusLabel(item: { status: string; unit_status: string; verification_result: "passed" | "failed" | null }) {
  if (item.status === "completed" && item.verification_result === "failed") return "Tidak Lulus Verifikasi";
  if (item.status === "completed" && item.unit_status === "maintenance" && item.verification_result === null) return "Menunggu Verifikasi";
  return semanticMaintenanceLabel(item.status);
}

function MaintenanceCard({ item }: { item: Awaited<ReturnType<typeof listMaintenanceQueue>>[number] }) {
  return (
    <Link
      to={paths.perawatan + "/" + item.perawatan_id}
      className="block rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="gap-0 overflow-hidden rounded-2xl border-border/70 bg-card py-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition hover:border-primary/25">
        <CardContent className="p-3">
          <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary/[0.08] text-primary">
              <Wrench className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-[15px] font-semibold">{item.kode_unit}</p>
                <Badge variant={item.status === "completed" ? "outline" : "secondary"} className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
                  {queueStatusLabel(item)}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{item.barang_nama ?? "Barang tidak ditemukan"}</p>
              <p className="mt-1 truncate text-[12px] font-medium">{semanticMaintenanceLabel(item.jenis_perawatan)}</p>
            </div>
            <ArrowRight className="mt-1 size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{item.deskripsi_pekerjaan}</p>
          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[11px]">
            <span className="truncate text-muted-foreground">{sourceLabel(item.pemeriksaan_id)} · {formatMaintenanceDateTime(item.created_at)}</span>
            <span className="shrink-0 font-medium">{item.biaya == null ? "Tanpa biaya" : `Rp ${new Intl.NumberFormat("id-ID").format(Number(item.biaya))}`}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function InspectionCard({ item }: { item: Awaited<ReturnType<typeof listInspectionQueue>>[number] }) {
  const inProgress = item.inspection_state === "in_progress";
  const completed = item.inspection_state === "completed";

  return (
    <Card className="gap-0 overflow-hidden rounded-2xl border-border/70 bg-card py-0 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition hover:border-primary/25">
      <CardContent className="p-3">
        <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary/[0.08] text-primary">
            <SearchCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-semibold">{item.kode_unit}</p>
              <Badge variant={completed ? "outline" : "secondary"} className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
                {inProgress ? "Sedang diperiksa" : completed ? "Pemeriksaan Selesai" : "Menunggu Pemeriksaan"}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {item.barang_nama ?? "Barang tidak ditemukan"}{item.varian_nama ? " · " + item.varian_nama : ""}
            </p>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">{item.nomor_pengembalian} · {item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p>
          </div>
          <CheckCircle2 className={completed ? "mt-1 size-4 text-primary" : "mt-1 size-4 text-muted-foreground"} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-background/70 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Diterima</p>
            <p className="mt-1 truncate text-[12px] font-semibold">{item.diterima_at}</p>
          </div>
          <div className="rounded-xl bg-background/70 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Hasil terakhir</p>
            <p className="mt-1 truncate text-[12px] font-semibold">{item.latest_hasil ? semanticInspectionLabel(item.latest_hasil) : "Belum ada"}</p>
          </div>
        </div>
        {item.latest_keputusan_operasional ? (
          <div className="mt-2 rounded-xl border border-border/60 bg-background/55 px-2.5 py-2">
            <p className="text-[11px] text-muted-foreground">Keputusan operasional</p>
            <p className="mt-0.5 truncate text-[12px] font-medium">{semanticInspectionLabel(item.latest_keputusan_operasional)}</p>
          </div>
        ) : null}
        <Button asChild className="mt-3 h-10 w-full rounded-xl">
          <Link to={paths.pemeriksaan + "/" + item.detail_pengembalian_id}>
            {inProgress ? "Lanjutkan Pemeriksaan" : completed ? "Lihat Pemeriksaan" : "Mulai Pemeriksaan"}
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function PerawatanList() {
  const [search, setSearch] = useState("");
  const [inspectionSearch, setInspectionSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [activeTab, setActiveTab] = useState<"maintenance" | "inspection">("maintenance");

  const context = useQuery({
    queryKey: ["perawatan", "context"],
    queryFn: getPerawatanContext,
    staleTime: 60_000,
  });

  const overview = useQuery({
    queryKey: ["perawatan", "overview", context.data?.usahaId],
    queryFn: () => getMaintenanceOverview(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });

  const queue = useQuery({
    queryKey: ["perawatan", "queue", context.data?.usahaId, status, search],
    queryFn: () => listMaintenanceQueue(context.data!.usahaId, { status, search }),
    enabled: Boolean(context.data?.usahaId && activeTab === "maintenance"),
    staleTime: 10_000,
  });

  const inspectionQueue = useQuery({
    queryKey: ["perawatan", "inspection-queue", context.data?.usahaId, inspectionSearch],
    queryFn: () => listInspectionQueue(context.data!.usahaId, inspectionSearch),
    enabled: Boolean(context.data?.usahaId && activeTab === "inspection"),
    staleTime: 5_000,
  });

  if (context.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[66px] rounded-xl" />)}</div>
        <Skeleton className="h-10 rounded-xl" />
        <div className="grid gap-2 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Perawatan/Pemeriksaan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  const inspectionItems = inspectionQueue.data ?? [];
  const maintenanceFilterActive = search.length > 0 || status !== "active";
  const inspectionFilterActive = inspectionSearch.length > 0;

  return (
    <div className="space-y-4 pb-28 sm:space-y-5 lg:pb-10">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight sm:text-[25px]">Perawatan</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Kondisi unit · {context.data.usahaNama}</p>
        </div>
        {activeTab === "maintenance" ? (
          <Button asChild className="h-9 shrink-0 rounded-xl px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
            <Link to={paths.perawatan + "/create"}><Plus className="size-4" />Buat Perawatan</Link>
          </Button>
        ) : null}
      </header>

      <div role="group" aria-label="Ringkasan perawatan" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ["Total", overview.data?.total],
          ["Terjadwal", overview.data?.planned],
          ["Berjalan", overview.data?.inProgress],
          ["Selesai kerja", overview.data?.completed],
        ] as const).map(([label, value]) => (
          <Card key={label} className="gap-0 rounded-xl border-border/70 py-0 shadow-none">
            <CardContent className="px-3 py-2.5">
              <p className="truncate text-[10px] font-medium text-muted-foreground sm:text-xs">{label}</p>
              <p className="mt-0.5 text-lg font-semibold leading-5 tabular-nums sm:text-xl">
                {overview.isPending || overview.isError ? "—" : value ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div role="tablist" aria-label="Alur kondisi unit" className="grid w-full grid-cols-2 rounded-xl bg-muted/45 p-1 sm:flex sm:w-fit sm:rounded-2xl">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "maintenance"}
          onClick={() => setActiveTab("maintenance")}
          className={[
            "flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:rounded-xl sm:px-5 sm:text-sm",
            activeTab === "maintenance" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <Wrench className="size-4" />Perawatan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "inspection"}
          onClick={() => setActiveTab("inspection")}
          className={[
            "flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:rounded-xl sm:px-5 sm:text-sm",
            activeTab === "inspection" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <SearchCheck className="size-4" />Pemeriksaan
        </button>
      </div>

      {activeTab === "maintenance" ? (
        <div className="space-y-4">
          <Card className="gap-0 overflow-hidden rounded-2xl border-border/70 py-0 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <CardContent className="space-y-2.5 p-3 sm:p-3.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="maintenance-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari kode unit, barang, pelaksana, atau pekerjaan..."
                  className="h-10 rounded-xl bg-background pl-10 pr-10 text-sm"
                  autoComplete="off"
                />
                {search ? (
                  <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground" aria-label="Hapus pencarian perawatan" onClick={() => setSearch("")}>
                    <X />
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden text-xs font-medium text-muted-foreground sm:block">Status</span>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger aria-label="Status perawatan" className="h-9 w-full rounded-xl bg-background text-xs sm:max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Perlu Tindakan</SelectItem>
                    <SelectItem value="planned">Direncanakan</SelectItem>
                    <SelectItem value="in_progress">Berjalan</SelectItem>
                    <SelectItem value="completed">Selesai</SelectItem>
                    <SelectItem value="all">Semua Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {maintenanceFilterActive ? (
                <div className="flex items-center justify-between gap-2 px-1 text-xs">
                  <span className="text-muted-foreground">Filter aktif diterapkan pada antrean perawatan.</span>
                  <Button type="button" variant="ghost" className="h-7 rounded-full px-2.5 text-xs text-primary" onClick={() => { setSearch(""); setStatus("active"); }}>Reset</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {queue.isPending ? (
            <div className="grid gap-2.5 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-[20px]" />)}</div>
          ) : queue.error ? (
            <Alert variant="destructive">
              <AlertTitle>Daftar perawatan gagal dimuat</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage(queue.error)}</span>
                <Button variant="outline" size="sm" onClick={() => void queue.refetch()}><RefreshCw />Coba lagi</Button>
              </AlertDescription>
            </Alert>
          ) : queue.data.length === 0 ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Wrench className="size-6" /></div>
                <div>
                  <p className="font-semibold">{status === "all" ? "Tidak ada perawatan yang sesuai" : "Tidak ada perawatan pada status ini"}</p>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">Pekerjaan ditampilkan sesuai status dan pencarian yang dipilih.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between px-0.5 text-sm">
                <span className="text-muted-foreground">{queue.data.length} pekerjaan ditampilkan</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">Perlu tindakan: {queue.data.filter((item) => item.status === "planned" || item.status === "in_progress" || (item.status === "completed" && item.unit_status === "maintenance")).length}</span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {queue.data.map((item) => <MaintenanceCard key={item.perawatan_id} item={item} />)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden rounded-2xl border-primary/15 bg-primary/[0.025] shadow-none">
            <CardContent className="space-y-3 p-3.5 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><SearchCheck className="size-5" /></div>
                <div className="min-w-0">
                  <p className="font-semibold">Pemeriksaan setelah pengembalian</p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">Pastikan kondisi unit sudah diterima sebelum keputusan operasional berikutnya. Temuan dapat diteruskan ke Perawatan.</p>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="inspection-search-workspace"
                  value={inspectionSearch}
                  onChange={(e) => setInspectionSearch(e.target.value)}
                  placeholder="Cari kode unit, penyewa, atau nomor pengembalian..."
                  className="h-10 rounded-xl bg-background pl-10 pr-10 text-sm"
                  autoComplete="off"
                />
                {inspectionSearch ? (
                  <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground" aria-label="Hapus pencarian pemeriksaan" onClick={() => setInspectionSearch("")}>
                    <X />
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {inspectionFilterActive ? (
            <div className="flex items-center justify-between gap-2 px-1 text-xs">
              <span className="text-muted-foreground">Pencarian aktif diterapkan pada antrean pemeriksaan.</span>
              <Button type="button" variant="ghost" className="h-7 rounded-full px-2.5 text-xs text-primary" onClick={() => setInspectionSearch("")}>Reset</Button>
            </div>
          ) : null}

          {inspectionQueue.isPending ? (
            <div className="grid gap-2.5 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-[20px]" />)}</div>
          ) : inspectionQueue.error ? (
            <Alert variant="destructive">
              <AlertTitle>Antrean pemeriksaan gagal dimuat</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage(inspectionQueue.error)}</span>
                <Button variant="outline" size="sm" onClick={() => void inspectionQueue.refetch()}><RefreshCw />Coba lagi</Button>
              </AlertDescription>
            </Alert>
          ) : inspectionItems.length === 0 ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><SearchCheck className="size-6" /></div>
                <div>
                  <p className="font-semibold">Tidak ada unit yang menunggu pemeriksaan</p>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">Antrean ini berasal dari unit yang sudah diterima melalui Pengembalian.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between px-0.5 text-sm">
                <span className="text-muted-foreground">{inspectionItems.length} unit pemeriksaan</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">Sumber: Pengembalian</span>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {inspectionItems.map((item) => <InspectionCard key={item.detail_pengembalian_id} item={item} />)}
              </div>
            </>
          )}
        </div>
      )}

      <div className="hidden items-center justify-between border-t pt-3 text-xs text-muted-foreground sm:flex">
        <span>Prioritaskan unit yang masih membutuhkan tindak lanjut.</span>
        <span>Alur tetap: Pengembalian → Pemeriksaan → Perawatan → verifikasi kesiapan.</span>
      </div>
    </div>
  );
}
