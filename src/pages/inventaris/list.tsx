import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Download,
  Filter,
  MapPin,
  PackagePlus,
  PackageSearch,
  QrCode,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_INVENTORY_FILTERS,
  getInventarisContext,
  getInventoryStateCapabilities,
  listInventoryLocations,
  listInventoryPackageAvailability,
  listInventoryProducts,
  listInventoryUnits,
  listInventoryVariants,
  type InventoryListFilters,
} from "@/features/inventaris";
import { formatInventoryDateTime } from "@/features/inventaris";
import {
  InventoryListSummary,
  InventoryStatusBadge,
  QrLookupDialog,
  UnitCard,
  UnitIdentity,
} from "@/components/inventaris/inventory-ui";
import { paths } from "@/routes/paths";
import { InventoryPackageAvailabilityView } from "@/components/inventaris/package-availability";
import { UnitQrBatchPrintDialog } from "@/components/qr-operasional/qr-operasional";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Inventaris gagal dimuat.";
}

export function InventoryList() {
  const [filters, setFilters] = useState<InventoryListFilters>(DEFAULT_INVENTORY_FILTERS);
  const [qrOpen, setQrOpen] = useState(false);
  const [batchQrOpen, setBatchQrOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"units" | "packages">("units");
  const capabilities = getInventoryStateCapabilities();

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: getInventarisContext,
    staleTime: 60_000,
  });
  const locations = useQuery({
    queryKey: ["inventaris", "locations", context.data?.usahaId],
    queryFn: () => listInventoryLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["inventaris", "products", context.data?.usahaId],
    queryFn: () => listInventoryProducts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const variants = useQuery({
    queryKey: ["inventaris", "variants", context.data?.usahaId],
    queryFn: () => listInventoryVariants(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const units = useQuery({
    queryKey: ["inventaris", "units", context.data?.usahaId, filters],
    queryFn: () => listInventoryUnits(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
    placeholderData: (previous) => previous,
  });
  const packages = useQuery({
    queryKey: ["inventaris", "packages", context.data?.usahaId],
    queryFn: () => listInventoryPackageAvailability(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((units.data?.total ?? 0) / filters.pageSize)),
    [filters.pageSize, units.data?.total],
  );

  const selectedVariants = (variants.data ?? []).filter(
    (variant) => filters.barangId === "all" || variant.barang_id === filters.barangId,
  );

  const handleExport = async () => {
    if (exporting || !context.data) return;
    setExporting(true);
    try {
      const { exportInventoryToExcel } = await import("@/features/inventaris/excel");
      await exportInventoryToExcel(context.data.usahaId, filters);
      toast.success("File Excel Inventaris berhasil diunduh.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ekspor Excel Inventaris gagal.");
    } finally {
      setExporting(false);
    }
  };

  const updateFilter = <K extends keyof InventoryListFilters>(
    key: K,
    value: InventoryListFilters[K],
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1,
      ...(key === "barangId" ? { varianBarangId: "all" } : {}),
    }));
  };

  if (context.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4" aria-busy="true">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (context.error || !context.data) {
    return (
      <div className="space-y-4">
        <header>
          <p className="text-sm text-muted-foreground">Inventaris</p>
          <h1 className="text-2xl font-bold tracking-tight">Unit Barang</h1>
        </header>
        <Alert variant="destructive">
          <AlertTitle>Inventaris belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-10 sm:space-y-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Inventaris</p>
          <h1 className="mt-0.5 text-[25px] font-bold leading-tight tracking-tight sm:text-[28px]">
            Unit Barang
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 rounded-xl px-4"
            onClick={() => void handleExport()}
            disabled={exporting}
            title="Ekspor Inventaris ke Excel"
          >
            <Download />
            {exporting ? "Menyiapkan…" : "Ekspor Excel"}
          </Button>
          {capabilities.mutation ? (
            <Button asChild className="h-10 shrink-0 rounded-xl px-4">
              <Link to={paths.inventarisCreate}>
                <PackagePlus />
                Daftarkan Unit
              </Link>
            </Button>
          ) : null}
        </div>

        <p className="col-span-2 max-w-2xl text-sm leading-5 text-muted-foreground">
          Kondisi dan informasi fisik setiap unit dalam konteks Usaha yang dipilih.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="Aksi inventaris">
        <Button asChild variant="outline" className="h-10 rounded-xl px-4">
          <Link to={paths.inventarisLocations}>
            <MapPin />
            Kelola Lokasi
          </Link>
        </Button>
        <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setQrOpen(true)}>
          <QrCode />
          Pindai QR
        </Button>
        {units.data?.units.length ? (
          <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setBatchQrOpen(true)}>
            <QrCode />
            Cetak QR Unit
          </Button>
        ) : null}
      </div>

      <div
        className="grid w-full max-w-[240px] grid-cols-2 gap-1 rounded-2xl bg-muted/45 p-1"
        role="tablist"
        aria-label="Mode inventaris"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={viewMode === "units"}
          variant={viewMode === "units" ? "default" : "ghost"}
          className="h-9 rounded-xl px-4"
          onClick={() => setViewMode("units")}
        >
          Unit
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={viewMode === "packages"}
          variant={viewMode === "packages" ? "default" : "ghost"}
          className="h-9 rounded-xl px-4"
          onClick={() => setViewMode("packages")}
        >
          Paket
        </Button>
      </div>

      {viewMode === "units" ? (
      <section className="space-y-3" aria-label="Pencarian dan filter inventaris">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <label className="sr-only" htmlFor="inventory-search">
              Cari kode unit, serial, barang, varian, lokasi, atau status
            </label>
            <Input
              id="inventory-search"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Cari kode unit, serial, barang, varian, ..."
              className="h-11 rounded-xl bg-background pl-9"
              autoComplete="off"
            />
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 overscroll-contain" aria-label="Filter cepat inventaris">
            {([
              ["all", "Semua unit"],
              ["ready_now", "Sewakan"],
              ["rental_active", "Sedang Disewa"],
              ["attention", "Perhatian"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filters.availabilityContext === value ? "default" : "outline"}
                className="h-9 shrink-0 rounded-full px-4"
                onClick={() =>
                  updateFilter(
                    "availabilityContext",
                    value as InventoryListFilters["availabilityContext"],
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="hidden flex-wrap gap-2 pt-1 lg:flex">
            <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
              <SelectTrigger aria-label="Filter status" className="h-10 w-full rounded-xl sm:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="ready">Siap disewakan</SelectItem>
                <SelectItem value="rented">Sedang disewa</SelectItem>
                <SelectItem value="inspection_pending">Perlu pemeriksaan</SelectItem>
                <SelectItem value="maintenance">Perawatan</SelectItem>
                <SelectItem value="damaged">Rusak</SelectItem>
                <SelectItem value="lost">Hilang</SelectItem>
                <SelectItem value="inactive">Dinonaktifkan</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.barangId} onValueChange={(value) => updateFilter("barangId", value)}>
              <SelectTrigger aria-label="Filter barang" className="h-10 w-full rounded-xl sm:w-52">
                <SelectValue placeholder="Barang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua barang</SelectItem>
                {(products.data ?? []).map((product) => (
                  <SelectItem key={product.barang_id} value={product.barang_id}>
                    {product.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.varianBarangId}
              onValueChange={(value) => updateFilter("varianBarangId", value)}
              disabled={filters.barangId === "all"}
            >
              <SelectTrigger aria-label="Filter varian" className="h-10 w-full rounded-xl sm:w-48">
                <SelectValue placeholder={filters.barangId === "all" ? "Pilih barang dulu" : "Varian"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua varian</SelectItem>
                {selectedVariants.map((variant) => (
                  <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>
                    {variant.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.locationId} onValueChange={(value) => updateFilter("locationId", value)}>
              <SelectTrigger aria-label="Filter lokasi" className="h-10 w-full rounded-xl sm:w-48">
                <SelectValue placeholder="Lokasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua lokasi</SelectItem>
                {(locations.data ?? []).map((location) => (
                  <SelectItem key={location.lokasi_id} value={location.lokasi_id}>
                    {location.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.availabilityContext}
              onValueChange={(value) =>
                updateFilter(
                  "availabilityContext",
                  value as InventoryListFilters["availabilityContext"],
                )
              }
            >
              <SelectTrigger aria-label="Filter konteks ketersediaan saat ini" className="h-10 w-full rounded-xl sm:w-56">
                <SelectValue placeholder="Konteks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua konteks</SelectItem>
                <SelectItem value="ready_now">Siap secara fisik</SelectItem>
                <SelectItem value="rental_active">Sedang disewa</SelectItem>
                <SelectItem value="attention">Perlu perhatian</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.sort}
              onValueChange={(value) => updateFilter("sort", value as InventoryListFilters["sort"])}
            >
              <SelectTrigger aria-label="Urutkan" className="h-10 w-full rounded-xl sm:w-48">
                <SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">Terbaru diubah</SelectItem>
                <SelectItem value="updated_asc">Terlama diubah</SelectItem>
                <SelectItem value="code_asc">Kode A–Z</SelectItem>
                <SelectItem value="status_asc">Status lalu kode</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
      ) : null}

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 pb-4 pt-5">
            <SheetTitle>Saring Inventaris</SheetTitle>
            <p className="text-sm text-muted-foreground">Persempit unit tanpa meninggalkan daftar.</p>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
                <SelectTrigger aria-label="Status" className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua status</SelectItem>
                  <SelectItem value="ready">Siap disewakan</SelectItem>
                  <SelectItem value="rented">Sedang disewa</SelectItem>
                  <SelectItem value="inspection_pending">Perlu pemeriksaan</SelectItem>
                  <SelectItem value="maintenance">Perawatan</SelectItem>
                  <SelectItem value="damaged">Rusak</SelectItem>
                  <SelectItem value="lost">Hilang</SelectItem>
                  <SelectItem value="inactive">Dinonaktifkan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Barang</label>
              <Select value={filters.barangId} onValueChange={(value) => updateFilter("barangId", value)}>
                <SelectTrigger aria-label="Barang" className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Pilih barang…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua barang</SelectItem>
                  {(products.data ?? []).map((product) => (
                    <SelectItem key={product.barang_id} value={product.barang_id}>
                      {product.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Varian</label>
              <Select
                value={filters.varianBarangId}
                onValueChange={(value) => updateFilter("varianBarangId", value)}
                disabled={filters.barangId === "all"}
              >
                <SelectTrigger aria-label="Varian" className="h-11 w-full rounded-xl">
                  <SelectValue placeholder={filters.barangId === "all" ? "Pilih barang dulu" : "Pilih varian…"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua varian</SelectItem>
                  {selectedVariants.map((variant) => (
                    <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>
                      {variant.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Lokasi</label>
              <Select value={filters.locationId} onValueChange={(value) => updateFilter("locationId", value)}>
                <SelectTrigger aria-label="Lokasi" className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Pilih lokasi…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua lokasi</SelectItem>
                  {(locations.data ?? []).map((location) => (
                    <SelectItem key={location.lokasi_id} value={location.lokasi_id}>
                      {location.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Konteks ketersediaan</label>
              <Select
                value={filters.availabilityContext}
                onValueChange={(value) =>
                  updateFilter(
                    "availabilityContext",
                    value as InventoryListFilters["availabilityContext"],
                  )
                }
              >
                <SelectTrigger aria-label="Konteks ketersediaan" className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Pilih konteks…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua konteks</SelectItem>
                  <SelectItem value="ready_now">Siap secara fisik</SelectItem>
                  <SelectItem value="rental_active">Sedang disewa</SelectItem>
                  <SelectItem value="attention">Perlu perhatian</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Urutkan</label>
              <Select value={filters.sort} onValueChange={(value) => updateFilter("sort", value as InventoryListFilters["sort"])}>
                <SelectTrigger aria-label="Urutkan" className="h-11 w-full rounded-xl">
                  <SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated_desc">Terbaru diubah</SelectItem>
                  <SelectItem value="updated_asc">Terlama diubah</SelectItem>
                  <SelectItem value="code_asc">Kode A–Z</SelectItem>
                  <SelectItem value="status_asc">Status lalu kode</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter className="border-t bg-background/95 px-5 py-4 backdrop-blur">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => {
                setFilters(DEFAULT_INVENTORY_FILTERS);
                setFilterOpen(false);
              }}
            >
              Reset
            </Button>
            <Button type="button" className="h-11 rounded-xl" onClick={() => setFilterOpen(false)}>
              Terapkan
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {viewMode === "units" ? (
      <>
      {!units.isPending && !units.error ? (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <InventoryListSummary
            count={units.data?.total ?? 0}
            availabilityContext={filters.availabilityContext}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 rounded-xl px-3 lg:hidden"
            onClick={() => setFilterOpen(true)}
          >
            <Filter />
            Filter
          </Button>
        </div>
      ) : null}

      {units.isPending ? (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : units.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data unit belum dapat ditampilkan</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{errorMessage(units.error)}</p>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void units.refetch()}>
              <RefreshCw />
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : units.data?.units.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <PackageSearch className="size-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">Belum ada unit barang</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Tidak ada unit fisik yang cocok dengan search atau filter saat ini.
              </p>
            </div>
            {capabilities.mutation && !filters.search && filters.availabilityContext === "all" ? (
              <Button asChild className="rounded-xl">
                <Link to={paths.inventarisCreate}>Daftarkan Unit Pertama</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:hidden">
            {units.data!.units.map((unit) => (
              <UnitCard
                key={unit.unit_barang_id}
                unit={unit}
                href={paths.inventaris + "/" + unit.unit_barang_id}
              />
            ))}
          </div>

          <Card className="hidden min-w-0 overflow-hidden lg:block">
            <div className="min-w-0 overflow-x-auto">
              <table className="min-w-[1040px] w-full text-sm">
                <thead className="border-b bg-muted/35 text-left">
                  <tr>
                    <th className="px-5 py-3 font-medium">Kode Unit</th>
                    <th className="px-5 py-3 font-medium">Barang</th>
                    <th className="px-5 py-3 font-medium">Varian</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Lokasi</th>
                    <th className="px-5 py-3 font-medium">Kondisi</th>
                    <th className="px-5 py-3 font-medium">Penyewaan</th>
                    <th className="px-5 py-3 font-medium">Updated</th>
                    <th className="px-5 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {units.data!.units.map((unit) => (
                    <tr key={unit.unit_barang_id} className="border-b last:border-0">
                      <td className="px-5 py-4">
                        <Link
                          to={paths.inventaris + "/" + unit.unit_barang_id}
                          className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {unit.kode_unit}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <UnitIdentity unit={unit} compact />
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{unit.varian?.nama ?? "Tanpa varian"}</td>
                      <td className="px-5 py-4"><InventoryStatusBadge status={unit.status} /></td>
                      <td className="px-5 py-4">{unit.lokasi?.nama ?? "Belum ditentukan"}</td>
                      <td className="px-5 py-4">{unit.kondisi_ringkas ?? "Belum dicatat"}</td>
                      <td className="px-5 py-4">
                        {unit.status === "rented" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                            Penyewaan aktif
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {formatInventoryDateTime(unit.updated_at)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button asChild variant="ghost" size="sm" className="rounded-lg">
                          <Link to={paths.inventaris + "/" + unit.unit_barang_id}>Lihat detail</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
            <span className="whitespace-nowrap text-muted-foreground">
              {units.data!.total} unit · Halaman {filters.page} dari {totalPages}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="outline"
                className="h-9 rounded-xl px-3 text-xs"
                disabled={filters.page <= 1}
                onClick={() => updateFilter("page", filters.page - 1)}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                className="h-9 rounded-xl px-3 text-xs"
                disabled={filters.page >= totalPages}
                onClick={() => updateFilter("page", filters.page + 1)}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </>
      )}
      </>
      ) : null}

      {viewMode === "packages" ? (
        packages.isPending ? (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : packages.error ? (
          <Alert variant="destructive">
            <AlertTitle>Ringkasan paket belum dapat dimuat</AlertTitle>
            <AlertDescription>{errorMessage(packages.error)}</AlertDescription>
          </Alert>
        ) : (
          <InventoryPackageAvailabilityView packages={packages.data ?? []} usahaId={context.data.usahaId} />
        )
      ) : null}

      <QrLookupDialog open={qrOpen} onOpenChange={setQrOpen} context={context.data} />
      <UnitQrBatchPrintDialog
        open={batchQrOpen}
        onOpenChange={setBatchQrOpen}
        context={context.data}
        units={units.data?.units ?? []}
      />
    </div>
  );
}
