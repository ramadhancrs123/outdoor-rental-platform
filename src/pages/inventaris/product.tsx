import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  History,
  ImagePlus,
  MapPin,
  PackageCheck,
  PackageOpen,
  Search,
  Settings2,
  Tag,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatInventoryDateTime,
  inventoryEventLabel,
  inventoryStatusLabel,
  getInventoryProductDetail,
  type InventoryProductDetail as InventoryProductDetailType,
  type InventoryUnit,
} from "@/features/inventaris";
import { paths } from "@/routes/paths";

type DetailTab = "info" | "units" | "history";

function ProductDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
      <div className="h-10 w-52 animate-pulse rounded-xl bg-muted" />
      <div className="h-64 animate-pulse rounded-[28px] bg-muted" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-60 animate-pulse rounded-[24px] bg-muted lg:col-span-2" />
        <div className="h-60 animate-pulse rounded-[24px] bg-muted" />
      </div>
    </div>
  );
}

function statusTone(status: string) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300";
  if (status === "rented") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300";
  if (status === "damaged" || status === "lost" || status === "inspection_pending" || status === "maintenance") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

function UnitCompactRow({ unit }: { unit: InventoryUnit }) {
  return (
    <Link
      to={paths.inventaris + "/" + unit.unit_barang_id}
      className="group box-border flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card px-3.5 py-3 outline-none transition hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary/[0.055] text-primary">
        <Boxes className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-semibold">{unit.kode_unit}</p>
          <Badge className={"shrink-0 rounded-full border px-2.5 py-1 text-[11px] " + statusTone(unit.status)}>
            {inventoryStatusLabel(unit.status)}
          </Badge>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            {unit.lokasi?.nama ?? "Lokasi belum ditentukan"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CircleAlert className="size-3.5" />
            {unit.kondisi_ringkas ?? "Kondisi belum dicatat"}
          </span>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function ProductActivityTimeline({ detail }: { detail: InventoryProductDetailType }) {
  if (!detail.recentHistory.length) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex min-h-32 items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <History className="size-5" />
          Belum ada aktivitas unit untuk barang ini.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative space-y-1">
      {detail.recentHistory.map((item, index) => (
        <div key={item.riwayat_unit_id} className="relative flex gap-3">
          <div className="relative flex w-7 shrink-0 justify-center">
            <span className="z-10 mt-3 size-2.5 rounded-full border-2 border-background bg-primary" />
            {index < detail.recentHistory.length - 1 ? <span className="absolute top-5 h-full w-px bg-border" /> : null}
          </div>
          <Card className="mb-3 min-w-0 flex-1 shadow-none">
            <CardContent className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full">{inventoryEventLabel(item.jenis_kejadian)}</Badge>
                <span className="text-xs text-muted-foreground">{formatInventoryDateTime(item.terjadi_at)}</span>
              </div>
              <p className="text-sm font-semibold">{item.unit_kode}</p>
              <p className="text-sm text-muted-foreground">
                {item.status_sebelum || "—"} → {item.status_sesudah || "—"}
              </p>
              {item.catatan ? <p className="text-xs leading-5 text-muted-foreground">{item.catatan}</p> : null}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

export function InventoryProductShow() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<DetailTab>("info");
  const [unitSearch, setUnitSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<"all" | "ready" | "rented" | "attention">("all");

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: async () => {
      const mod = await import("@/features/inventaris");
      return mod.getInventarisContext();
    },
    staleTime: 60_000,
  });

  const detail = useQuery({
    queryKey: ["inventaris", "product", context.data?.usahaId, id],
    queryFn: () => getInventoryProductDetail(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 30_000,
  });

  const visibleUnits = useMemo(() => {
    const allUnits = detail.data?.units.units ?? [];
    const search = unitSearch.trim().toLowerCase();
    return allUnits.filter((unit) => {
      const matchesSearch = !search || [
        unit.kode_unit,
        unit.serial_number ?? "",
        unit.lokasi?.nama ?? "",
        unit.kondisi_ringkas ?? "",
      ].some((value) => value.toLowerCase().includes(search));
      const matchesFilter =
        unitFilter === "all"
          ? true
          : unitFilter === "ready"
            ? unit.status === "ready"
            : unitFilter === "rented"
              ? unit.status === "rented"
              : ["inspection_pending", "maintenance", "damaged", "lost"].includes(unit.status);
      return matchesSearch && matchesFilter;
    });
  }, [detail.data?.units.units, unitSearch, unitFilter]);

  if (context.isPending || detail.isPending) return <ProductDetailSkeleton />;

  if (context.error || detail.error || !detail.data || !context.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.inventaris}><ArrowLeft />Kembali ke Inventaris</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Detail barang Inventaris belum tersedia</AlertTitle>
          <AlertDescription>{context.error?.message ?? detail.error?.message ?? "Barang tidak ditemukan."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = detail.data;
  const { product, summary } = data;
  const activeMedia = data.media.filter((media) => media.status === "valid" || media.status === "active");
  const cover = activeMedia.find((media) => media.is_cover) ?? activeMedia[0] ?? null;
  const attentionSummary = [
    ["Pemeriksaan", summary.inspection_pending_unit],
    ["Perawatan", summary.maintenance_unit],
    ["Rusak", summary.damaged_unit],
    ["Hilang", summary.lost_unit],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-20 sm:space-y-5 lg:pb-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 size-9 rounded-xl" aria-label="Kembali ke Inventaris">
            <Link to={paths.inventaris}><ArrowLeft /></Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Detail Inventaris</p>
            <h1 className="truncate text-[20px] font-bold tracking-tight">{product.nama}</h1>
            <p className="truncate text-sm text-muted-foreground">{product.kategori?.nama ?? "Tanpa kategori"}</p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-9 shrink-0 rounded-xl px-3 text-xs">
          <Link to={paths.katalog + "/show/" + product.barang_id}>
            <Tag />
            Katalog
          </Link>
        </Button>
      </header>

      <Card className="overflow-hidden rounded-[26px] border-border/70 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <CardContent className="p-3.5 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch">
            <div className="flex min-w-0 gap-4">
              <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl bg-muted sm:size-36">
                {cover?.url || summary.cover_url ? (
                  <img
                    src={cover?.url ?? summary.cover_url ?? ""}
                    alt={product.nama}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-primary/70">
                    <ImagePlus className="size-9" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <h2 className="min-w-0 flex-1 text-xl font-bold tracking-tight sm:text-2xl">{product.nama}</h2>
                  <Badge variant={product.status === "active" ? "default" : "secondary"} className="rounded-full px-3 py-1">
                    {product.status === "active" ? "Aktif" : "Nonaktif"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{product.slug}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                    {product.kategori?.nama ?? "Tanpa kategori"}
                  </Badge>
                  <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
                    {summary.variant_count} varian
                  </Badge>
                  {summary.attention_unit > 0 ? (
                    <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                      {summary.attention_unit} perlu perhatian
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {product.ringkasan_publik || product.deskripsi || "Belum ada deskripsi barang."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
              {[
                { label: "Total Unit", value: summary.total_unit, Icon: PackageOpen, bg: "bg-muted/30" },
                { label: "Siap", value: summary.ready_unit, Icon: CheckCircle2, bg: "bg-emerald-50/55 dark:bg-emerald-950/15" },
                { label: "Disewa", value: summary.rented_unit, Icon: CalendarClock, bg: "bg-sky-50/55 dark:bg-sky-950/15" },
                { label: "Perhatian", value: summary.attention_unit, Icon: CircleAlert, bg: "bg-amber-50/55 dark:bg-amber-950/15" },
              ].map(({ label, value, Icon, bg }) => {
                const IconComponent = Icon as LucideIcon;
                return (
                <div key={String(label)} className={"rounded-2xl px-3.5 py-3 " + bg}>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <IconComponent className="size-3.5" />
                    {label}
                  </div>
                  <p className="mt-1 text-lg font-bold">{value as number}</p>
                </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <nav className="sticky top-2 z-20 grid grid-cols-3 rounded-2xl border border-border/80 bg-background/95 p-1 shadow-sm backdrop-blur" aria-label="Bagian detail barang Inventaris">
        {([
          ["info", "Informasi", FileText],
          ["units", "Unit", Boxes],
          ["history", "Riwayat", History],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={[
              "flex h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition",
              tab === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      {tab === "info" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <Card className="rounded-[22px] border-border/70 shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="size-5 text-primary" />
                  Informasi Utama
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-4 pt-0">
                {[
                  ["Nama Barang", product.nama],
                  ["Kategori", product.kategori?.nama ?? "Tanpa kategori"],
                  ["Status Katalog", product.status === "active" ? "Aktif" : "Nonaktif"],
                  ["Visibilitas", product.is_public ? "Publik" : "Internal"],
                  ["Jumlah Unit", summary.total_unit + " unit fisik"],
                  ["Terakhir Diperbarui", formatInventoryDateTime(product.updated_at)],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className={[
                      "grid grid-cols-[132px_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5",
                      index % 2 === 0 ? "bg-muted/20" : "bg-background",
                    ].join(" ")}
                  >
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="min-w-0 truncate text-sm font-medium">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-border/70 shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-5 text-primary" />
                  Deskripsi
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-sm leading-7 text-muted-foreground">
                  {product.deskripsi || "Belum ada deskripsi barang."}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-border/70 shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImagePlus className="size-5 text-primary" />
                  Media Produk
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {activeMedia.length ? (
                  <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
                    {activeMedia.map((media) => (
                      <img
                        key={media.barang_media_id}
                        src={media.url}
                        alt={product.nama}
                        className={"aspect-square w-full rounded-2xl object-cover " + (media.is_cover ? "ring-2 ring-primary ring-offset-2" : "")}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Belum ada media produk di Katalog.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="min-w-0 overflow-hidden rounded-[22px] border-border/70 shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="size-5 text-primary" />
                  Kesiapan Inventaris
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-4 pt-0">
                <div className="rounded-2xl bg-emerald-50/55 p-3.5 dark:bg-emerald-950/15">
                  <p className="text-xs text-muted-foreground">Siap secara fisik</p>
                  <p className="mt-1 text-2xl font-bold">{summary.ready_unit}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Status unit siap, terpisah dari ketersediaan periode sewa.
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50/55 p-3.5 dark:bg-amber-950/15">
                  <p className="text-xs text-muted-foreground">Perlu perhatian</p>
                  <p className="mt-1 text-2xl font-bold">{summary.attention_unit}</p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {attentionSummary.map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <span>{label}</span>
                        <span className="font-semibold text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {summary.inactive_unit > 0 ? (
                  <div className="rounded-2xl border bg-muted/25 p-3.5 text-xs leading-5 text-muted-foreground">
                    {summary.inactive_unit} unit dinonaktifkan dan tetap dipertahankan dalam riwayat.
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-primary/15 bg-primary/[0.025] shadow-none">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <Settings2 className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Operasional unit tetap di Inventaris</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Perubahan status, lokasi, kondisi, kesiapan, dan foto fisik dilakukan pada level unit. Katalog tetap menjadi sumber identitas barang.
                    </p>
                  </div>
                </div>
                <Button asChild className="w-full rounded-xl">
                  <Link to={paths.inventaris + "?mode=units&barangId=" + product.barang_id}>
                    Lihat Semua Unit
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-[22px] border-border/70 shadow-none">
              <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Boxes className="size-5 text-primary" />
                    Daftar Unit Fisik
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Preview unit terbaru langsung di detail barang.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-full px-3 text-xs text-primary"
                  onClick={() => setTab("units")}
                >
                  Lihat semua
                  <ChevronRight />
                </Button>
              </CardHeader>
              <CardContent className="grid gap-2.5 p-4 pt-0">
                {(data.units.units ?? []).slice(0, 6).map((unit) => (
                  <UnitCompactRow key={unit.unit_barang_id} unit={unit} />
                ))}
                {!data.units.units.length ? (
                  <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                    Belum ada unit fisik untuk barang ini.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "units" ? (
        <div className="space-y-3">
          <Card className="rounded-[22px] border-border/70 shadow-none">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Daftar Unit ({summary.total_unit})</h2>
                  <p className="text-xs text-muted-foreground">Unit fisik adalah sumber kebenaran kesiapan dan operasional.</p>
                </div>
                <Button asChild variant="outline" className="h-9 rounded-xl px-3 text-xs">
                  <Link to={paths.inventaris + "?mode=units&barangId=" + product.barang_id}>
                    Kelola Unit
                    <Settings2 />
                  </Link>
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={unitSearch}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder="Cari kode unit, serial, lokasi…"
                    className="h-11 rounded-xl pl-9"
                  />
                </div>
              </div>
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
                {([
                  ["all", "Semua", summary.total_unit],
                  ["ready", "Siap", summary.ready_unit],
                  ["rented", "Disewa", summary.rented_unit],
                  ["attention", "Perhatian", summary.attention_unit],
                ] as const).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUnitFilter(value)}
                    className={[
                      "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      unitFilter === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {label} {count}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {visibleUnits.length ? (
            <div className="grid gap-2.5">
              {visibleUnits.map((unit) => <UnitCompactRow key={unit.unit_barang_id} unit={unit} />)}
            </div>
          ) : (
            <Card className="shadow-none">
              <CardContent className="flex min-h-40 flex-col items-center justify-center p-6 text-center">
                <Search className="size-6 text-muted-foreground" />
                <p className="mt-3 font-semibold">Unit tidak ditemukan</p>
                <p className="mt-1 text-sm text-muted-foreground">Coba ubah pencarian atau filter unit.</p>
              </CardContent>
            </Card>
          )}

          {data.units.total > data.units.units.length ? (
            <Button asChild variant="outline" className="w-full rounded-xl">
              <Link to={paths.inventaris + "?mode=units&barangId=" + product.barang_id}>
                Lihat Semua Unit ({data.units.total})
                <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Riwayat Aktivitas</h2>
              <p className="text-sm text-muted-foreground">Aktivitas terbaru dari unit-unit barang ini.</p>
            </div>
            <Button asChild variant="ghost" className="h-9 rounded-full px-3 text-xs text-primary">
              <Link to={paths.inventaris + "?mode=units&barangId=" + product.barang_id}>
                Unit
                <ChevronRight />
              </Link>
            </Button>
          </div>
          <ProductActivityTimeline detail={data} />
        </div>
      ) : null}

    </div>
  );
}
