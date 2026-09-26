import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Search, SlidersHorizontal, PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { getCatalogContext, listCatalogCategories, listCatalogProducts } from "@/features/katalog";
import { DEFAULT_CATALOG_FILTERS, type CatalogListFilters } from "@/features/katalog/types";
import { catalogStatusLabel, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";

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
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((products.data?.total ?? 0) / filters.pageSize)),
    [products.data?.total, filters.pageSize],
  );

  const updateFilter = <K extends keyof CatalogListFilters>(
    key: K,
    value: CatalogListFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? Number(value) : 1 }));

  if (context.isPending) {
    return (
      <ListView>
        <ListViewHeader title="Katalog" canCreate={false} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-xl" />)}
        </div>
      </ListView>
    );
  }

  if (context.error) {
    return (
      <ListView>
        <ListViewHeader title="Katalog" canCreate={false} />
        <Card>
          <CardContent className="flex flex-col gap-2 p-6">
            <h3 className="font-semibold">Katalog belum dapat dibuka</h3>
            <p className="text-sm text-muted-foreground">{errorMessage(context.error)}</p>
          </CardContent>
        </Card>
      </ListView>
    );
  }

  return (
    <ListView>
      <ListViewHeader title="Katalog" canCreate={false} />

      <div className="rounded-xl border bg-card p-3 md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Cari nama barang atau slug..."
              className="pl-9"
              aria-label="Cari katalog"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={filters.categoryId} onValueChange={(value) => updateFilter("categoryId", value)}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Filter kategori">
                <SelectValue placeholder="Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua kategori</SelectItem>
                {(categories.data ?? []).map((category) => (
                  <SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>
                    {category.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(value) => updateFilter("status", value as CatalogListFilters["status"])}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.visibility} onValueChange={(value) => updateFilter("visibility", value as CatalogListFilters["visibility"])}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter visibilitas">
                <SelectValue placeholder="Public" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua visibilitas</SelectItem>
                <SelectItem value="public">Publik</SelectItem>
                <SelectItem value="private">Internal</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.sort} onValueChange={(value) => updateFilter("sort", value as CatalogListFilters["sort"])}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Urutkan katalog">
                <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">Terbaru</SelectItem>
                <SelectItem value="updated_asc">Terlama</SelectItem>
                <SelectItem value="name_asc">Nama A–Z</SelectItem>
                <SelectItem value="name_desc">Nama Z–A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {products.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-xl" />)}
        </div>
      ) : products.error ? (
        <Card>
          <CardContent className="p-6">
            <p className="font-medium">Produk gagal dimuat.</p>
            <p className="mt-1 text-sm text-muted-foreground">{errorMessage(products.error)}</p>
          </CardContent>
        </Card>
      ) : products.data?.products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <PackageOpen className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div>
              <h3 className="font-semibold">Belum ada barang</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Katalog belum memiliki produk rental pada Usaha ini.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.data?.products.map((product) => (
              <Card key={product.barang_id} className="overflow-hidden">
                <CardContent className="flex min-h-44 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{product.nama}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {product.kategori?.nama ?? "Tanpa kategori"}
                      </p>
                    </div>
                    <Badge variant={product.status === "active" ? "default" : "secondary"}>
                      {catalogStatusLabel(product.status)}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{product.is_public ? "Publik" : "Internal"}</Badge>
                    {product.active_tariff ? (
                      <span className="truncate text-muted-foreground">
                        {formatCatalogMoney(product.active_tariff.nominal, product.active_tariff.currency_code)}
                        {" / "}
                        {formatTariffDuration(product.active_tariff)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Belum ada tarif aktif</span>
                    )}
                  </div>

                  <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {product.ringkasan_publik || product.deskripsi || "Belum ada deskripsi publik."}
                  </p>

                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/katalog/show/${product.barang_id}`}>Buka produk</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted-foreground">
              {products.data?.total ?? 0} produk · Halaman {filters.page} dari {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>
                Sebelumnya
              </Button>
              <Button variant="outline" disabled={filters.page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>
                Berikutnya
              </Button>
            </div>
          </div>
        </>
      )}
    </ListView>
  );
};
