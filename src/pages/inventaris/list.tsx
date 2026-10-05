import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import {
  ArrowRight,
  ArrowUpDown,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Download,
  EllipsisVertical,
  Filter,
  Grid2X2,
  ImagePlus,
  List,
  PackagePlus,
  PackageSearch,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  listInventoryProductOverview,
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
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") === "units"
    ? "units"
    : searchParams.get("mode") === "packages"
      ? "packages"
      : "products";
  const initialBarangId = searchParams.get("barangId");
  const [filters, setFilters] = useState<InventoryListFilters>({
    ...DEFAULT_INVENTORY_FILTERS,
    barangId: initialBarangId || DEFAULT_INVENTORY_FILTERS.barangId,
  });
  const [qrOpen, setQrOpen] = useState(false);
  const [batchQrOpen, setBatchQrOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [productFilterOpen, setProductFilterOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("all");
  const [productStatusFilter, setProductStatusFilter] = useState<"all" | "ready" | "rented" | "attention">("all");
  const [productSort, setProductSort] = useState<"latest" | "name" | "units">("latest");
  const [productLayout, setProductLayout] = useState<"grid" | "list">("grid");
  const [exporting, setExporting] = useState(false);
  const viewMode = initialMode;
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
  const productOverview = useQuery({
    queryKey: ["inventaris", "product-overview", context.data?.usahaId],
    queryFn: () => listInventoryProductOverview(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
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

  const productCategories = useMemo(
    () => Array.from(new Set((productOverview.data ?? []).map((product) => product.kategori_nama).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [productOverview.data],
  );

  const filteredProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    const next = (productOverview.data ?? []).filter((product) => {
      const matchesCategory = productCategory === "all" || product.kategori_nama === productCategory;
      const matchesSearch = !search || [product.nama, product.kategori_nama ?? ""].some((value) => value.toLowerCase().includes(search));
      const matchesStatus =
        productStatusFilter === "all"
          ? true
          : productStatusFilter === "ready"
            ? product.ready_unit > 0
            : productStatusFilter === "rented"
              ? product.rented_unit > 0
              : product.attention_unit > 0;
      return matchesCategory && matchesSearch && matchesStatus;
    });

    return next.sort((a, b) => {
      if (productSort === "name") return a.nama.localeCompare(b.nama);
      if (productSort === "units") return b.total_unit - a.total_unit;
      return (b.latest_unit_updated_at ? Date.parse(b.latest_unit_updated_at) : 0) - (a.latest_unit_updated_at ? Date.parse(a.latest_unit_updated_at) : 0);
    });
  }, [productCategory, productOverview.data, productSearch, productSort, productStatusFilter]);

  const filteredProductSummary = useMemo(
    () => ({
      total: filteredProducts.reduce((sum, product) => sum + product.total_unit, 0),
      ready: filteredProducts.reduce((sum, product) => sum + product.ready_unit, 0),
      rented: filteredProducts.reduce((sum, product) => sum + product.rented_unit, 0),
      attention: filteredProducts.reduce((sum, product) => sum + product.attention_unit, 0),
    }),
    [filteredProducts],
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
      {viewMode === "products" ? (
        <>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Cari barang, kategori, atau kode unit..."
                className="h-12 rounded-2xl border-none bg-muted/45 pl-10 shadow-none"
                autoComplete="off"
                aria-label="Cari barang, kategori, atau kode unit"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Semua", value: filteredProductSummary.total, Icon: Boxes, bg: "bg-emerald-50/55 text-emerald-700 dark:bg-emerald-950/15 dark:text-emerald-300" },
                { label: "Siap", value: filteredProductSummary.ready, Icon: CheckCircle2, bg: "bg-emerald-50/55 text-emerald-700 dark:bg-emerald-950/15 dark:text-emerald-300" },
                { label: "Disewa", value: filteredProductSummary.rented, Icon: CalendarClock, bg: "bg-amber-50/55 text-amber-700 dark:bg-amber-950/15 dark:text-amber-300" },
                { label: "Perhatian", value: filteredProductSummary.attention, Icon: CircleAlert, bg: "bg-rose-50/65 text-rose-700 dark:bg-rose-950/15 dark:text-rose-300" },
              ].map(({ label, value, Icon, bg }) => (
                <div key={label} className={"rounded-2xl px-3.5 py-3 " + bg}>
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className="grid size-8 place-items-center rounded-full bg-white/70 dark:bg-black/10">
                      <Icon className="size-4" />
                    </span>
                    <span>{label}</span>
                  </div>
                  <p className="mt-1 text-xl font-bold leading-none">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 rounded-xl bg-muted/45 px-3.5">
                    <ArrowUpDown />
                    {productSort === "latest" ? "Terbaru" : productSort === "units" ? "Unit terbanyak" : "Nama A–Z"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  <DropdownMenuItem onClick={() => setProductSort("latest")}>Terbaru</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setProductSort("units")}>Unit terbanyak</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setProductSort("name")}>Nama A–Z</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="ml-auto flex items-center rounded-xl bg-muted/45 p-1">
                <Button
                  type="button"
                  size="icon"
                  variant={productLayout === "grid" ? "default" : "ghost"}
                  className="size-9 rounded-lg"
                  onClick={() => setProductLayout("grid")}
                  aria-label="Tampilan grid"
                >
                  <Grid2X2 />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={productLayout === "list" ? "default" : "ghost"}
                  className="size-9 rounded-lg"
                  onClick={() => setProductLayout("list")}
                  aria-label="Tampilan list"
                >
                  <List />
                </Button>
              </div>

              {capabilities.mutation ? (
                <Button asChild className="h-10 rounded-xl px-4">
                  <Link to={paths.inventarisCreate}>
                    <PackagePlus />
                    Daftarkan Unit
                  </Link>
                </Button>
              ) : null}
            </div>

            <div className="border-t border-border/70 pt-3">
              <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1" aria-label="Filter kategori barang">
                <button
                  type="button"
                  onClick={() => setProductCategory("all")}
                  className={[
                    "h-10 shrink-0 rounded-xl px-4 text-sm font-semibold transition",
                    productCategory === "all"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/55 text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  Semua
                </button>
                {productCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setProductCategory(category)}
                    className={[
                      "h-10 shrink-0 rounded-xl bg-muted/55 px-4 text-sm font-medium transition hover:bg-muted",
                      productCategory === category ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary" : "",
                    ].join(" ")}
                  >
                    {category}
                  </button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="ml-auto size-10 shrink-0 rounded-xl border-none bg-muted/55"
                  onClick={() => setProductFilterOpen(true)}
                  aria-label="Filter inventaris"
                  title="Filter inventaris"
                >
                  <Filter />
                </Button>
              </div>
            </div>
          </div>

          <Sheet open={productFilterOpen} onOpenChange={setProductFilterOpen}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
              <SheetHeader className="border-b px-5 pb-4 pt-5">
                <SheetTitle>Filter Inventaris</SheetTitle>
                <p className="text-sm text-muted-foreground">Atur kategori dan keadaan unit yang ingin diringkas.</p>
              </SheetHeader>
              <div className="space-y-5 px-5 py-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Kategori</label>
                  <Select value={productCategory} onValueChange={setProductCategory}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua kategori</SelectItem>
                      {productCategories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Kesiapan</label>
                  <Select value={productStatusFilter} onValueChange={(value) => setProductStatusFilter(value as typeof productStatusFilter)}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua</SelectItem>
                      <SelectItem value="ready">Ada unit siap</SelectItem>
                      <SelectItem value="rented">Ada unit disewa</SelectItem>
                      <SelectItem value="attention">Perlu perhatian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <SheetFooter className="border-t px-5 py-4">
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setProductCategory("all"); setProductStatusFilter("all"); setProductSearch(""); setProductFilterOpen(false); }}>
                  Reset
                </Button>
                <Button className="h-11 rounded-xl" onClick={() => setProductFilterOpen(false)}>Terapkan</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Inventaris</p>
            <h1 className="text-xl font-bold tracking-tight">{viewMode === "units" ? "Semua Unit" : "Paket"}</h1>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => void handleExport()} disabled={exporting}>
              <Download />
              {exporting ? "Menyiapkan…" : "Ekspor"}
            </Button>
            {capabilities.mutation ? (
              <Button asChild className="h-10 rounded-xl">
                <Link to={paths.inventarisCreate}><PackagePlus />Daftarkan Unit</Link>
              </Button>
            ) : null}
          </div>
        </header>
      )}

      {viewMode === "products" ? (
        productOverview.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-64 rounded-[24px]" />
            ))}
          </div>
        ) : productOverview.error ? (
          <Alert variant="destructive">
            <AlertTitle>Ringkasan barang Inventaris belum dapat dimuat</AlertTitle>
            <AlertDescription className="gap-3">
              <p>{errorMessage(productOverview.error)}</p>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void productOverview.refetch()}>
                <RefreshCw />
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <section className="space-y-3" aria-label="Barang dalam Inventaris">
            {filteredProducts.length === 0 ? (
              <Card className="rounded-[24px] border-border/70 shadow-none">
                <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
                  <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
                    <PackageSearch className="size-7" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Barang tidak ditemukan</h2>
                    <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Coba ubah kategori, pencarian, atau filter kesiapan.</p>
                  </div>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => { setProductCategory("all"); setProductStatusFilter("all"); setProductSearch(""); }}>Reset filter</Button>
                </CardContent>
              </Card>
            ) : productLayout === "list" ? (
              <div className="space-y-2.5">
                {filteredProducts.map((product) => (
                  <Card key={product.barang_id} className="overflow-hidden rounded-[22px] border-border/70 shadow-none">
                    <div className="flex min-w-0 items-center gap-3 p-3">
                      <Link to={paths.inventarisBarang + "/" + product.barang_id} className="size-20 shrink-0 overflow-hidden rounded-2xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {product.cover_url ? <img src={product.cover_url} alt={product.nama} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-primary/70"><ImagePlus className="size-7" /></div>}
                      </Link>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{product.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">{product.kategori_nama ?? "Tanpa kategori"}</p>
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{product.total_unit} unit</span>
                          <span className="text-emerald-600">{product.ready_unit} siap</span>
                          <span className="text-amber-600">{product.rented_unit} disewa</span>
                          <span className="text-rose-600">{product.attention_unit} perhatian</span>
                        </div>
                      </div>
                      <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl">
                        <Link to={paths.inventarisBarang + "/" + product.barang_id} aria-label={"Buka " + product.nama}><ArrowRight /></Link>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredProducts.map((product) => {
                  const displayState =
                    product.attention_unit > 0 && product.attention_unit >= Math.min(product.ready_unit || 1, product.rented_unit || product.attention_unit)
                      ? { label: "Perhatian", badge: "bg-rose-500 text-white" }
                      : product.rented_unit > product.ready_unit
                        ? { label: "Disewa", badge: "bg-amber-400 text-amber-950" }
                        : { label: "Siap", badge: "bg-emerald-500 text-white" };

                  return (
                    <Card key={product.barang_id} className="group overflow-hidden rounded-[20px] border-border/70 bg-card shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                      <CardContent className="p-0">
                        <div className="relative aspect-[1.08] overflow-hidden bg-muted">
                          <Link to={paths.inventarisBarang + "/" + product.barang_id} className="absolute inset-0">
                            {product.cover_url ? <img src={product.cover_url} alt={product.nama} className="size-full object-cover transition duration-300 group-hover:scale-[1.02]" /> : <div className="grid size-full place-items-center bg-primary/[0.035] text-primary/70"><ImagePlus className="size-10" /></div>}
                          </Link>
                          <span className={"absolute left-2.5 top-2.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold shadow-sm " + displayState.badge}>{displayState.label}</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="secondary" size="icon" className="absolute right-2.5 top-2.5 size-9 rounded-xl bg-background/95 shadow-sm" aria-label={"Menu " + product.nama}>
                                <EllipsisVertical />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem asChild><Link to={paths.inventarisBarang + "/" + product.barang_id}>Buka detail</Link></DropdownMenuItem>
                              <DropdownMenuItem asChild><Link to={paths.inventaris + "?mode=units&barangId=" + product.barang_id}>Lihat unit fisik</Link></DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild><Link to={paths.katalog + "/show/" + product.barang_id}>Buka katalog</Link></DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <Link to={paths.inventarisBarang + "/" + product.barang_id} className="block px-3.5 pb-3.5 pt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                          <p className="truncate text-[14px] font-bold leading-5">{product.nama}</p>
                          <p className="truncate text-xs text-muted-foreground">{product.kategori_nama ?? "Tanpa kategori"}</p>
                          <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-muted/45 px-2.5 py-2">
                            <Boxes className="size-4 shrink-0" />
                            <span className="text-xs font-semibold">{product.total_unit} unit</span>
                            <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                          </div>
                          <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[11px]">
                            <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="size-3.5" /> {product.ready_unit}</span>
                            <span className="flex items-center gap-1 font-semibold text-amber-600"><CalendarClock className="size-3.5" /> {product.rented_unit}</span>
                            <span className="flex items-center gap-1 font-semibold text-rose-600"><CircleAlert className="size-3.5" /> {product.attention_unit}</span>
                          </div>
                        </Link>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>        )
      ) : null}

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
