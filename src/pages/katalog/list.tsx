import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Boxes,
  CheckCircle2,
  EllipsisVertical,
  Filter,
  Layers3,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ListView } from "@/components/refine-ui/views/list-view";
import {
  getCatalogContext,
  getCatalogPackageDetails,
  getCatalogSummary,
  listCatalogCategories,
  listCatalogPackages,
  listCatalogProductCovers,
  listCatalogProducts,
  listCatalogReadyStock,
  setCatalogPackageState,
} from "@/features/katalog";
import { DEFAULT_CATALOG_FILTERS, type CatalogListFilters, type CatalogProduct } from "@/features/katalog/types";
import { catalogErrorMessage, catalogStatusLabel, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

const errorMessage = (error: unknown) => catalogErrorMessage(error, "Katalog gagal dimuat.");

function CatalogProductCard({
  product,
  coverUrl,
  totalUnits,
  readyUnits,
}: {
  product: CatalogProduct;
  coverUrl: string | null;
  totalUnits: number;
  readyUnits: number;
}) {
  return (
    <Card className="overflow-hidden rounded-[20px] border-border/70 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition hover:-translate-y-px hover:bg-accent/[0.02]">
      <CardContent className="p-3 sm:p-3.5">
        <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3">
          <div className="grid size-[76px] place-items-center overflow-hidden rounded-2xl border border-border/70 bg-muted/40 text-primary">
            {coverUrl ? (
              <img src={coverUrl} alt={product.nama} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <Boxes className="size-8" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to={paths.katalog + "/show/" + product.barang_id}
                  className="block truncate text-[15px] font-semibold leading-5 hover:text-primary"
                >
                  {product.nama}
                </Link>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {product.kategori?.nama ?? "Tanpa kategori"} · {product.slug}
                </p>
              </div>
              <Badge
                variant={product.status === "active" ? "default" : "secondary"}
                className="shrink-0 rounded-full px-2.5 py-1 text-[11px]"
              >
                {catalogStatusLabel(product.status)}
              </Badge>
            </div>

            <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden text-[12px] text-muted-foreground">
              <span className="inline-flex shrink-0 items-center gap-1">
                <Boxes className="size-3.5" aria-hidden="true" />
                {totalUnits} unit
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
                {readyUnits} tersedia
              </span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">
                {product.active_tariff
                  ? formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code) +
                    " / " +
                    formatTariffDuration(product.active_tariff)
                  : "Belum ada tarif aktif"}
              </span>
            </div>
          </div>
        </div>

        {product.ringkasan_publik || product.deskripsi ? (
          <p className="mt-2 line-clamp-1 pl-[88px] text-[12px] leading-5 text-muted-foreground">
            {product.ringkasan_publik || product.deskripsi}
          </p>
        ) : null}

        <div className="mt-2.5 flex items-center justify-end gap-2">
          <Link
            to={paths.katalog + "/show/" + product.barang_id}
            aria-label={"Lihat detail " + product.nama}
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <EllipsisVertical className="size-4" />
          </Link>
          <Button asChild className="h-9 rounded-xl px-4">
            <Link to={paths.katalog + "/show/" + product.barang_id}>
              Lihat
              <span aria-hidden="true">→</span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export const CatalogList = () => {
  const [filters, setFilters] = useState<CatalogListFilters>(DEFAULT_CATALOG_FILTERS);
  const [catalogView, setCatalogView] = useState<"products" | "packages">("products");
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const queryClient = useQueryClient();

  const context = useQuery({
    queryKey: ["katalog", "context"],
    queryFn: getCatalogContext,
    staleTime: 60_000,
  });

  const categories = useQuery({
    queryKey: ["katalog", "categories", context.data?.usahaId],
    queryFn: () => listCatalogCategories(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });

  const summary = useQuery({
    queryKey: ["katalog", "summary", context.data?.usahaId],
    queryFn: () => getCatalogSummary(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const products = useQuery({
    queryKey: ["katalog", "products", context.data?.usahaId, filters],
    queryFn: () => listCatalogProducts(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 5_000,
  });

  const productIds = useMemo(
    () => (products.data?.products ?? []).map((product) => product.barang_id),
    [products.data?.products],
  );

  const productCovers = useQuery({
    queryKey: ["katalog", "product-covers", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogProductCovers(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length),
    staleTime: 60_000,
  });

  const readyStock = useQuery({
    queryKey: ["katalog", "ready-stock", context.data?.usahaId, productIds.join(",")],
    queryFn: () => listCatalogReadyStock(context.data!.usahaId, productIds),
    enabled: Boolean(context.data?.usahaId && productIds.length),
    staleTime: 10_000,
  });

  const packages = useQuery({
    queryKey: ["katalog", "packages", context.data?.usahaId],
    queryFn: () => listCatalogPackages(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId && catalogView === "packages"),
    staleTime: 10_000,
  });

  const packageDetails = useQuery({
    queryKey: ["katalog", "package-detail", context.data?.usahaId, selectedPackageId],
    queryFn: () => getCatalogPackageDetails(context.data!.usahaId, selectedPackageId!),
    enabled: Boolean(context.data?.usahaId && catalogView === "packages" && selectedPackageId),
    staleTime: 10_000,
  });

  const packageState = useMutation({
    mutationFn: ({ status, isPublic, updatedAt }: { status: "draft" | "active" | "inactive"; isPublic: boolean; updatedAt: string }) => {
      if (!context.data || !selectedPackageId) throw new Error("Paket belum dipilih.");
      return setCatalogPackageState(context.data.usahaId, selectedPackageId, status, isPublic, updatedAt, {
        idempotencyKey: "catalog-package-state-" + createClientId(),
      });
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["katalog", "packages"] }),
        queryClient.invalidateQueries({ queryKey: ["katalog", "package-detail"] }),
      ]);
      await packages.refetch();
      toast.success(variables.status === "active" ? "Paket diaktifkan." : "Paket dinonaktifkan.");
    },
    onError: (error) => toast.error(catalogErrorMessage(error)),
  });

  useEffect(() => {
    if (catalogView === "packages" && !selectedPackageId && packages.data?.[0]) {
      setSelectedPackageId(packages.data[0].paket_sewa_id);
    }
  }, [catalogView, packages.data, selectedPackageId]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((products.data?.total ?? 0) / filters.pageSize)),
    [products.data?.total, filters.pageSize],
  );

  const updateFilter = <K extends keyof CatalogListFilters>(key: K, value: CatalogListFilters[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 1,
    }));
  };

  const resetFilters = () => setFilters(DEFAULT_CATALOG_FILTERS);
  const filtersActive =
    Boolean(filters.search) ||
    filters.categoryId !== "all" ||
    filters.status !== "all" ||
    filters.visibility !== "all" ||
    filters.sort !== "updated_desc";

  const coverByProduct = useMemo(
    () => new Map((productCovers.data ?? []).map((item) => [item.barang_id, item.url])),
    [productCovers.data],
  );

  const readyByProduct = readyStock.data?.byProduct ?? {};
  const totalUnitsByProduct = readyStock.data?.byProductTotal ?? {};

  if (context.isPending) {
    return (
      <ListView>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}</div>
      </ListView>
    );
  }

  if (context.error || !context.data) {
    return (
      <ListView>
        <Alert variant="destructive">
          <AlertTitle>Katalog belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </ListView>
    );
  }

  return (
    <ListView className="pb-24 lg:pb-8">
      <Tabs value={catalogView} onValueChange={(value) => { const next = value as "products" | "packages"; setCatalogView(next); if (next === "packages" && !selectedPackageId && packages.data?.[0]) setSelectedPackageId(packages.data[0].paket_sewa_id); }} className="space-y-4">
        <TabsContent value="products" className="space-y-4">
          <header className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary">Katalog</p>
                <h1 className="text-[25px] font-bold leading-tight tracking-tight sm:text-[28px]">Katalog</h1>
              </div>
              <Button asChild className="h-10 shrink-0 rounded-xl px-4">
                <Link to={paths.katalog + "/manage?tab=product"}>
                  <Plus />
                  Tambah Barang
                </Link>
              </Button>
            </div>
            <p className="max-w-2xl text-sm leading-5 text-muted-foreground">
              Daftar barang dan paket yang tersedia untuk disewakan. Kelola informasi, harga, dan ketersediaan.
            </p>
          </header>

          <div className="flex flex-wrap gap-2">
            <div className="inline-flex h-10 items-center gap-2 rounded-full border bg-background px-3.5 text-sm font-medium">
              <Tag className="size-4 text-primary" />
              Usaha: {context.data.usahaName}
            </div>
            <Button asChild variant="outline" className="h-10 rounded-full px-4">
              <Link to={paths.katalog + "/manage"}>Kelola Kategori</Link>
            </Button>
          </div>

          <TabsList className="w-fit rounded-2xl bg-muted/45 p-1">
            <TabsTrigger value="products" className="h-9 rounded-xl px-5">Barang</TabsTrigger>
            <TabsTrigger value="packages" className="h-9 rounded-xl px-5">Paket</TabsTrigger>
          </TabsList>

          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible" aria-label="Ringkasan katalog">
            <Card className="min-w-[116px] flex-1 rounded-2xl border-emerald-200/70 bg-emerald-50/45 shadow-none dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:min-w-0">
              <CardContent className="p-3">
                <div className="flex items-start gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                    <Tag className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-muted-foreground">Kategori</p>
                    <p className="mt-0.5 text-[22px] font-bold leading-none">{summary.data?.categoryCount ?? "—"}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">semua kategori</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-[116px] flex-1 rounded-2xl border-sky-200/70 bg-sky-50/45 shadow-none dark:border-sky-900/40 dark:bg-sky-950/20 sm:min-w-0">
              <CardContent className="p-3">
                <div className="flex items-start gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200">
                    <Boxes className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-muted-foreground">Barang</p>
                    <p className="mt-0.5 text-[22px] font-bold leading-none">{summary.data?.productCount ?? "—"}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">total barang</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-[116px] flex-1 rounded-2xl border-rose-200/70 bg-rose-50/45 shadow-none dark:border-rose-900/40 dark:bg-rose-950/20 sm:min-w-0">
              <CardContent className="p-3">
                <div className="flex items-start gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-muted-foreground">Status</p>
                    <p className="mt-0.5 text-[22px] font-bold leading-none">{summary.data?.activeCount ?? "—"}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {summary.data ? summary.data.inactiveCount + " nonaktif" : "status katalog"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-2xl border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="catalog-search"
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Cari nama barang, kategori, atau deskripsi..."
                  className="h-11 rounded-xl bg-background pl-10 pr-3"
                  autoComplete="off"
                />
                {filters.search ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground"
                    aria-label="Hapus pencarian"
                    onClick={() => updateFilter("search", "")}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>

              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Filter katalog">
                <Button
                  type="button"
                  variant="outline"
                  className={[
                    "h-10 shrink-0 rounded-full px-4 shadow-none",
                    !filtersActive ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
                  ].join(" ")}
                  onClick={resetFilters}
                >
                  <Boxes />
                  Semua
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={[
                    "h-10 shrink-0 rounded-full px-4 shadow-none",
                    filters.categoryId !== "all" ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
                  ].join(" ")}
                  onClick={() => setFilterOpen(true)}
                >
                  <Tag />
                  Kategori
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={[
                    "h-10 shrink-0 rounded-full px-4 shadow-none",
                    filters.status !== "all" ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
                  ].join(" ")}
                  onClick={() => setFilterOpen(true)}
                >
                  <Layers3 />
                  Status
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={[
                    "h-10 shrink-0 rounded-full px-4 shadow-none",
                    filters.sort !== "updated_desc" ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
                  ].join(" ")}
                  onClick={() => setFilterOpen(true)}
                >
                  <SlidersHorizontal />
                  Urutkan
                </Button>
                <Button type="button" variant="outline" className="h-10 shrink-0 rounded-full px-4 shadow-none" onClick={() => setFilterOpen(true)}>
                  <Filter />
                  Filter
                </Button>
              </div>

              {filtersActive ? (
                <div className="flex items-center justify-between gap-2 px-1 text-xs">
                  <span className="text-muted-foreground">Filter aktif diterapkan pada katalog.</span>
                  <Button type="button" variant="ghost" className="h-7 rounded-full px-2.5 text-xs text-primary" onClick={resetFilters}>
                    Reset
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
            <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl p-0">
              <SheetHeader className="border-b px-4 py-4 text-left">
                <SheetTitle>Filter Katalog</SheetTitle>
                <SheetDescription>Gunakan filter untuk mempersempit daftar barang tanpa mengubah data katalog.</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 overflow-y-auto p-4">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Kategori</span>
                  <Select value={filters.categoryId} onValueChange={(value) => updateFilter("categoryId", value)}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Semua kategori" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua kategori</SelectItem>
                      {(categories.data ?? []).map((category) => (
                        <SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>{category.nama}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Status</span>
                  <Select value={filters.status} onValueChange={(value) => updateFilter("status", value as CatalogListFilters["status"])}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Semua status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua status</SelectItem>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Tampilan</span>
                  <Select value={filters.visibility} onValueChange={(value) => updateFilter("visibility", value as CatalogListFilters["visibility"])}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Semua tampilan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua tampilan</SelectItem>
                      <SelectItem value="public">Publik</SelectItem>
                      <SelectItem value="private">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Urutkan</span>
                  <Select value={filters.sort} onValueChange={(value) => updateFilter("sort", value as CatalogListFilters["sort"])}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="updated_desc">Terbaru</SelectItem>
                      <SelectItem value="updated_asc">Terlama</SelectItem>
                      <SelectItem value="name_asc">Nama A–Z</SelectItem>
                      <SelectItem value="name_desc">Nama Z–A</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <div className="flex gap-2 border-t pt-4">
                  <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl" onClick={() => { resetFilters(); setFilterOpen(false); }}>
                    Reset
                  </Button>
                  <Button type="button" className="h-11 flex-1 rounded-xl" onClick={() => setFilterOpen(false)}>
                    Tampilkan Hasil
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {!products.isPending && !products.error ? (
            <div className="flex items-center justify-between gap-2 px-0.5 text-sm">
              <span className="text-muted-foreground">{products.data?.total ?? 0} barang · Halaman {filters.page} dari {totalPages}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">Usaha: {context.data.usahaName}</span>
            </div>
          ) : null}

          {products.isPending ? (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-[20px]" />)}
            </div>
          ) : products.error ? (
            <Alert variant="destructive">
              <AlertTitle>Barang gagal dimuat</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage(products.error)}</span>
                <Button variant="outline" size="sm" onClick={() => void products.refetch()}><RefreshCw />Coba lagi</Button>
              </AlertDescription>
            </Alert>
          ) : products.data?.products.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><PackageOpen className="size-6" /></div>
                <div>
                  <p className="font-semibold">{filtersActive ? "Tidak ada barang yang cocok" : "Belum ada barang di katalog"}</p>
                  <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                    {filtersActive ? "Coba ubah filter atau reset pencarian." : "Tambahkan barang untuk mulai mengelola katalog rental."}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {filtersActive ? <Button variant="outline" className="rounded-xl" onClick={resetFilters}>Reset Filter</Button> : null}
                  <Button asChild className="rounded-xl"><Link to={paths.katalog + "/manage?tab=product"}><Plus />Tambah Barang</Link></Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {products.data.products.map((product) => (
                <CatalogProductCard
                  key={product.barang_id}
                  product={product}
                  coverUrl={coverByProduct.get(product.barang_id) ?? null}
                  totalUnits={totalUnitsByProduct[product.barang_id] ?? 0}
                  readyUnits={readyByProduct[product.barang_id] ?? 0}
                />
              ))}
            </div>
          )}

          {products.data?.products.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">{products.data.total} barang · Halaman {filters.page} dari {totalPages}</span>
              <div className="flex gap-1.5">
                <Button variant="outline" className="h-9 rounded-xl px-3 text-xs" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>
                  Sebelumnya
                </Button>
                <Button variant="outline" className="h-9 rounded-xl px-3 text-xs" disabled={filters.page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>
                  Berikutnya
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="packages" className="space-y-4">
          <TabsList className="w-fit rounded-2xl bg-muted/45 p-1">
            <TabsTrigger value="products" className="h-9 rounded-xl px-5">Barang</TabsTrigger>
            <TabsTrigger value="packages" className="h-9 rounded-xl px-5">Paket</TabsTrigger>
          </TabsList>

          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Katalog · Paket Sewa</p>
              <h2 className="text-[26px] font-bold tracking-tight">Paket Sewa</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Lihat paket yang ditawarkan, barang/varian yang termasuk, jumlah komponen, dan tarif paket yang tercatat.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-xl"><Link to={paths.katalog + "/manage?tab=package"}>Kelola Paket</Link></Button>
              <Button asChild className="rounded-xl"><Link to={paths.katalog + "/manage?tab=package"}><Plus />Buat Paket</Link></Button>
            </div>
          </header>
          <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Boxes className="size-5" />Paket Sewa</CardTitle>
                <p className="text-sm text-muted-foreground">Daftar paket yang sudah dibuat untuk usaha ini. Pilih paket untuk melihat komponen dan tarifnya.</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {packages.isPending ? (
                  <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}</div>
                ) : packages.error ? (
                  <Alert variant="destructive"><AlertTitle>Paket gagal dimuat</AlertTitle><AlertDescription className="space-y-3"><p>{errorMessage(packages.error)}</p><Button variant="outline" size="sm" onClick={() => void packages.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>
                ) : packages.data?.length ? (
                  packages.data.map((item) => (
                    <button key={item.paket_sewa_id} type="button" onClick={() => setSelectedPackageId(item.paket_sewa_id)} className={[
                      "w-full rounded-xl border p-4 text-left transition-colors",
                      selectedPackageId === item.paket_sewa_id ? "border-primary bg-primary/[0.04] ring-1 ring-primary/20" : "hover:bg-muted/40",
                    ].join(" ")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate font-semibold">{item.nama}</p><p className="mt-1 text-xs text-muted-foreground">{item.slug}</p></div>
                        <Badge variant={item.status === "active" ? "default" : "secondary"} className="shrink-0 rounded-full">{catalogStatusLabel(item.status)}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full">{item.is_public ? "Publik" : "Internal"}</Badge>
                        <Badge variant="secondary" className="rounded-full">{item.harga_dasar == null ? "Tanpa harga dasar" : formatCatalogMoney(item.harga_dasar, item.currency_code)}</Badge>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-center"><Boxes className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-semibold">Belum ada Paket Sewa</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Buat paket dari Kelola Katalog untuk kemudian melihat rincian paket di sini.</p><Button asChild className="mt-4 rounded-xl"><Link to={paths.katalog + "/manage?tab=package"}><Plus />Buat Paket</Link></Button></div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              {!selectedPackageId ? (
                <CardContent className="flex min-h-72 flex-col items-center justify-center p-6 text-center"><Boxes className="size-9 text-muted-foreground" /><p className="mt-3 font-semibold">Pilih Paket Sewa</p><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Rincian paket akan menampilkan barang/varian yang menjadi komponen, jumlahnya, deskripsi, dan tarif paket yang tercatat.</p></CardContent>
              ) : packageDetails.isPending ? (
                <CardContent className="space-y-3 p-5"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /></CardContent>
              ) : packageDetails.error ? (
                <CardContent className="p-5"><Alert variant="destructive"><AlertTitle>Detail paket gagal dimuat</AlertTitle><AlertDescription className="space-y-3"><p>{errorMessage(packageDetails.error)}</p><Button variant="outline" size="sm" onClick={() => void packageDetails.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert></CardContent>
              ) : packageDetails.data ? (
                <CardContent className="space-y-5 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">Paket Sewa</p><h2 className="text-xl font-bold tracking-tight">{packageDetails.data.package.nama}</h2><p className="mt-1 break-words text-sm text-muted-foreground">{packageDetails.data.package.deskripsi || "Belum ada deskripsi paket."}</p></div>
                    <div className="flex flex-wrap items-center gap-2"><Badge variant={packageDetails.data.package.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(packageDetails.data.package.status)}</Badge><Badge variant="outline" className="rounded-full">{packageDetails.data.package.is_public ? "Publik" : "Internal"}</Badge>{packageDetails.data.package.status !== "active" ? <Button size="sm" className="rounded-xl" disabled={packageState.isPending} onClick={() => packageState.mutate({ status: "active", isPublic: packageDetails.data.package.is_public, updatedAt: packageDetails.data.package.updated_at })}>Aktifkan</Button> : <Button size="sm" variant="outline" className="rounded-xl" disabled={packageState.isPending} onClick={() => packageState.mutate({ status: "inactive", isPublic: false, updatedAt: packageDetails.data.package.updated_at })}>Nonaktifkan</Button>}</div>
                  </div>

                  <section className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">Harga dasar</p><p className="text-2xl font-bold">{packageDetails.data.package.harga_dasar == null ? "Belum ditetapkan" : formatCatalogMoney(packageDetails.data.package.harga_dasar, packageDetails.data.package.currency_code)}</p></div><Button asChild variant="outline" className="rounded-xl"><Link to={paths.katalogManage + "?tab=package&editPackage=" + packageDetails.data.package.paket_sewa_id}>Ubah Paket</Link></Button></div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">Komponen Paket ({packageDetails.data.components.length})</h3></div>
                    {packageDetails.data.components.length === 0 ? <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada komponen. Paket belum mendefinisikan barang/varian yang termasuk.</div> : <div className="grid gap-2 sm:grid-cols-2">{packageDetails.data.components.map((component) => <div key={component.komponen_paket_id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{component.barang?.nama ?? component.varian?.nama ?? "Komponen tidak tersedia"}</p><p className="mt-1 text-xs text-muted-foreground">{component.varian ? "Varian · " + component.varian.nama : "Barang"}</p></div><Badge variant="secondary" className="shrink-0 rounded-full">× {component.jumlah}</Badge></div>{component.catatan ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{component.catatan}</p> : null}</div>)}</div>}
                  </section>

                  <section>
                    <h3 className="mb-3 font-semibold">Tarif Paket ({packageDetails.data.tariffs.length})</h3>
                    {packageDetails.data.tariffs.length === 0 ? <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada tarif yang terikat langsung ke paket.</div> : <div className="space-y-2">{packageDetails.data.tariffs.map((tariff) => <div key={tariff.tarif_sewa_id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{tariff.nama}</p><p className="text-xs text-muted-foreground">{formatTariffDuration(tariff)} · {catalogStatusLabel(tariff.status)}</p></div><p className="font-semibold">{formatCatalogMoney(tariff.nominal, tariff.currency_code)}</p></div>)}</div>}
                  </section>
                </CardContent>
              ) : null}
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </ListView>
  );
};
