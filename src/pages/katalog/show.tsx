import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { getCatalogContext, getCatalogProduct } from "@/features/katalog";
import { catalogStatusLabel, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Detail produk gagal dimuat.";

export const CatalogShow = () => {
  const { id } = useParams<{ id: string }>();
  const context = useQuery({
    queryKey: ["katalog", "context"],
    queryFn: getCatalogContext,
    staleTime: 60_000,
  });

  const product = useQuery({
    queryKey: ["katalog", "product", context.data?.usahaId, id],
    queryFn: () => getCatalogProduct(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });

  if (context.isPending || product.isPending) {
    return (
      <ShowView>
        <ShowViewHeader title="Produk" resource="katalog" />
        <Skeleton className="h-64 rounded-xl" />
      </ShowView>
    );
  }

  if (context.error || product.error || !product.data) {
    const error = context.error ?? product.error;
    return (
      <ShowView>
        <ShowViewHeader title="Produk" resource="katalog" />
        <Card>
          <CardContent className="p-6">
            <p className="font-medium">Produk tidak dapat dibuka.</p>
            <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
          </CardContent>
        </Card>
      </ShowView>
    );
  }

  const item = product.data;
  const publicMedia = item.media.filter((media) => media.status === "valid");

  return (
    <ShowView>
      <ShowViewHeader title={item.nama} resource="katalog" />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/katalog"><ArrowLeft className="mr-2 h-4 w-4" />Kembali ke katalog</Link>
        </Button>
        <Badge>{catalogStatusLabel(item.status)}</Badge>
        <Badge variant="outline">{item.is_public ? "Publik" : "Internal"}</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Informasi produk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Kategori</p>
              <p className="font-medium">{item.kategori?.nama ?? "Tanpa kategori"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Slug</p>
              <p className="font-mono text-sm">{item.slug}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Deskripsi</p>
              <p className="whitespace-pre-wrap text-sm">{item.deskripsi || "Belum ada deskripsi."}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ringkasan publik</p>
              <p className="whitespace-pre-wrap text-sm">{item.ringkasan_publik || "Belum ada ringkasan publik."}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tarif aktif</CardTitle></CardHeader>
          <CardContent>
            {item.active_tariff ? (
              <div className="space-y-1">
                <p className="font-semibold">{item.active_tariff.nama}</p>
                <p className="text-2xl font-bold">
                  {formatCatalogMoney(item.active_tariff.nominal, item.active_tariff.currency_code)}
                </p>
                <p className="text-sm text-muted-foreground">{formatTariffDuration(item.active_tariff)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada tarif aktif.</p>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Varian</CardTitle></CardHeader>
          <CardContent>
            {item.variants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Produk ini belum memiliki varian.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {item.variants.map((variant) => (
                  <div key={variant.varian_barang_id} className="rounded-lg border p-4">
                    <p className="font-medium">{variant.nama}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{catalogStatusLabel(variant.status)}</p>
                    {variant.deskripsi && <p className="mt-2 text-sm text-muted-foreground">{variant.deskripsi}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Tarif</CardTitle></CardHeader>
          <CardContent>
            {item.tariffs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada tarif untuk produk/variannya.</p>
            ) : (
              <div className="divide-y">
                {item.tariffs.map((tariff) => (
                  <div key={tariff.tarif_sewa_id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{tariff.nama}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatTariffDuration(tariff)} · {catalogStatusLabel(tariff.status)}
                      </p>
                    </div>
                    <p className="font-semibold">{formatCatalogMoney(tariff.nominal, tariff.currency_code)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Paket</CardTitle></CardHeader>
          <CardContent>
            {item.package_references.length === 0 ? (
              <p className="text-sm text-muted-foreground">Produk ini belum menjadi komponen paket.</p>
            ) : (
              <div className="space-y-3">
                {item.package_references.map((reference) => (
                  <div key={reference.komponen_paket_id} className="rounded-lg border p-3">
                    <p className="font-medium">{reference.paket?.nama ?? "Paket tidak ditemukan"}</p>
                    <p className="text-sm text-muted-foreground">Jumlah: {reference.jumlah}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Media katalog</CardTitle></CardHeader>
          <CardContent>
            {publicMedia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada media katalog yang valid.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {publicMedia.map((media) => (
                  <div key={media.barang_media_id} className="rounded-lg border p-3">
                    <p className="truncate text-sm font-medium">{media.storage_path}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {media.is_cover ? "Cover · " : ""}Urutan {media.urutan}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Boundary operasional</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Unit fisik dan availability bukan source of truth Katalog. Operasi unit tetap berada di Inventaris.
            </p>
            <Button asChild variant="outline">
              <Link to="/inventaris"><ExternalLink className="mr-2 h-4 w-4" />Buka Inventaris</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </ShowView>
  );
};
