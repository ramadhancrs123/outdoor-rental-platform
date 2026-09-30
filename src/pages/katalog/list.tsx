import { useQuery } from "@tanstack/react-query";
import { ArrowDownAZ, ArrowUpAZ, PackageOpen, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ListView } from "@/components/refine-ui/views/list-view";
import { getCatalogContext, listCatalogCategories, listCatalogProducts } from "@/features/katalog";
import { DEFAULT_CATALOG_FILTERS, type CatalogListFilters } from "@/features/katalog/types";
import { catalogStatusLabel, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Katalog gagal dimuat.";

export const CatalogList = () => {
  const [filters, setFilters] = useState<CatalogListFilters>(DEFAULT_CATALOG_FILTERS);

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

  const products = useQuery({
    queryKey: ["katalog", "products", context.data?.usahaId, filters],
    queryFn: () => listCatalogProducts(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 5_000,
  });

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

  const activeCount = products.data?.products.filter((product) => product.status === "active").length ?? 0;
  const publicCount = products.data?.products.filter((product) => product.is_public).length ?? 0;

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
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Product Truth</p>
          <h1 className="text-[28px] font-bold tracking-tight">Katalog</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Kelola produk rental, kategori, varian, paket, tarif, dan media tanpa mencampurkan fakta unit fisik.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1">Usaha Aktif · {context.data.usahaName}</Badge>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to={paths.katalog + "/manage"}>Kelola Katalog</Link>
          </Button>
          <Button asChild className="rounded-xl">
            <Link to={paths.katalog + "/manage?tab=product"}><Plus />Buat Barang</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Produk terlihat</p><p className="mt-1 text-2xl font-bold">{products.data?.total ?? "—"}</p><p className="text-xs text-muted-foreground">hasil sesuai filter</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Aktif</p><p className="mt-1 text-2xl font-bold">{activeCount}</p><p className="text-xs text-muted-foreground">dari halaman aktif</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Publik</p><p className="mt-1 text-2xl font-bold">{publicCount}</p><p className="text-xs text-muted-foreground">public visibility</p></CardContent></Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base">Cari & Filter</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="relative min-w-0 flex-1" htmlFor="catalog-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="catalog-search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Cari nama barang atau slug..." className="h-11 rounded-xl pl-9" />
            </label>
            <Button variant="outline" className="h-11 rounded-xl" disabled={!filtersActive} onClick={resetFilters}><X />Reset</Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={filters.categoryId} onValueChange={(value) => updateFilter("categoryId", value)}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Filter kategori"><SelectValue placeholder="Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua kategori</SelectItem>
                {(categories.data ?? []).map((category) => <SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>{category.nama}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(value) => updateFilter("status", value as CatalogListFilters["status"])}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Filter status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua status</SelectItem><SelectItem value="active">Aktif</SelectItem><SelectItem value="inactive">Nonaktif</SelectItem></SelectContent>
            </Select>

            <Select value={filters.visibility} onValueChange={(value) => updateFilter("visibility", value as CatalogListFilters["visibility"])}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Filter visibilitas"><SelectValue placeholder="Visibility" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua visibility</SelectItem><SelectItem value="public">Publik</SelectItem><SelectItem value="private">Internal</SelectItem></SelectContent>
            </Select>

            <Select value={filters.sort} onValueChange={(value) => updateFilter("sort", value as CatalogListFilters["sort"])}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Urutkan katalog"><SlidersHorizontal className="mr-2 size-4" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">Terbaru</SelectItem>
                <SelectItem value="updated_asc"><ArrowUpAZ className="mr-2 inline size-4" />Terlama</SelectItem>
                <SelectItem value="name_asc"><ArrowDownAZ className="mr-2 inline size-4" />Nama A–Z</SelectItem>
                <SelectItem value="name_desc">Nama Z–A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {products.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}</div>
      ) : products.error ? (
        <Alert variant="destructive">
          <AlertTitle>Produk gagal dimuat</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{errorMessage(products.error)}</span>
            <Button variant="outline" size="sm" onClick={() => void products.refetch()}><RefreshCw />Coba lagi</Button>
          </AlertDescription>
        </Alert>
      ) : products.data?.products.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><PackageOpen className="size-7" /></div>
            <div><p className="font-semibold">{filtersActive ? "Tidak ada produk yang cocok" : "Belum ada barang di katalog"}</p><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{filtersActive ? "Coba ubah filter atau reset pencarian." : "Mulai dari Barang, lalu lanjutkan dengan varian, tarif, paket, dan media."}</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">{filtersActive ? <Button variant="outline" className="rounded-xl" onClick={resetFilters}>Reset Filter</Button> : null}<Button asChild className="rounded-xl"><Link to={paths.katalog + "/manage?tab=product"}><Plus />Buat Barang</Link></Button></div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm lg:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/35 text-left"><tr><th className="px-5 py-3 font-medium">Produk</th><th className="px-5 py-3 font-medium">Kategori</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Visibility</th><th className="px-5 py-3 font-medium">Tarif</th><th className="px-5 py-3 text-right font-medium">Aksi</th></tr></thead>
              <tbody>
                {products.data.products.map((product) => (
                  <tr key={product.barang_id} className="border-b last:border-0">
                    <td className="px-5 py-4"><p className="font-semibold">{product.nama}</p><p className="text-xs text-muted-foreground">{product.slug}</p></td>
                    <td className="px-5 py-4">{product.kategori?.nama ?? "Tanpa kategori"}</td>
                    <td className="px-5 py-4"><Badge variant={product.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(product.status)}</Badge></td>
                    <td className="px-5 py-4"><Badge variant="outline" className="rounded-full">{product.is_public ? "Publik" : "Internal"}</Badge></td>
                    <td className="px-5 py-4">{product.active_tariff ? <span>{formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code)}<span className="block text-xs text-muted-foreground">/ {formatTariffDuration(product.active_tariff)}</span></span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Button asChild size="sm" variant="outline" className="rounded-xl"><Link to={paths.katalog + "/show/" + product.barang_id}>Detail</Link></Button><Button asChild size="sm" className="rounded-xl"><Link to={paths.katalogEdit + "/" + product.barang_id}>Edit</Link></Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {products.data.products.map((product) => (
              <Card key={product.barang_id} className="rounded-2xl shadow-sm">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-base font-bold">{product.nama}</p><p className="mt-1 text-sm text-muted-foreground">{product.kategori?.nama ?? "Tanpa kategori"}</p></div>
                    <Badge variant={product.status === "active" ? "default" : "secondary"} className="shrink-0 rounded-full">{catalogStatusLabel(product.status)}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2"><Badge variant="outline" className="rounded-full">{product.is_public ? "Publik" : "Internal"}</Badge>{product.active_tariff ? <Badge variant="secondary" className="rounded-full">{formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code)} / {formatTariffDuration(product.active_tariff)}</Badge> : <span className="text-sm text-muted-foreground">Belum ada tarif aktif</span>}</div>
                  <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{product.ringkasan_publik || product.deskripsi || "Belum ada deskripsi publik."}</p>
                  <div className="grid grid-cols-2 gap-2"><Button asChild variant="outline" className="h-11 rounded-xl"><Link to={paths.katalog + "/show/" + product.barang_id}>Detail</Link></Button><Button asChild className="h-11 rounded-xl"><Link to={paths.katalogEdit + "/" + product.barang_id}>Edit</Link></Button></div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">{products.data.total} produk · Halaman {filters.page} dari {totalPages}</span><div className="flex gap-2"><Button variant="outline" className="rounded-xl" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Sebelumnya</Button><Button variant="outline" className="rounded-xl" disabled={filters.page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Berikutnya</Button></div></div>
        </>
      )}
    </ListView>
  );
};
