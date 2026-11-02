import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit3, ImageOff, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCatalogContext, getCatalogMediaUrl, getCatalogProduct } from "@/features/katalog";
import { CATALOG_PRODUCT_MEDIA_BUCKET } from "@/features/katalog/types";
import { catalogStatusLabel, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";
import "./show.css";

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? "Detail produk gagal dimuat.");
  return "Detail produk gagal dimuat.";
};

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
    staleTime: 5_000,
    retry: false,
  });

  if (context.isPending || product.isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-3" aria-busy="true">
        <Skeleton className="h-14 rounded-2xl" />
        <div className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (context.error || product.error || !product.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Produk tidak dapat dibuka</AlertTitle>
        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{errorMessage(context.error ?? product.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void product.refetch()}><RefreshCw />Muat ulang</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const item = product.data;
  const media = item.media
    .filter((entry) => entry.status === "valid" && entry.storage_bucket === CATALOG_PRODUCT_MEDIA_BUCKET)
    .sort((a, b) => a.urutan - b.urutan);
  const unavailableMedia = item.media.filter(
    (entry) => entry.status === "valid" && entry.storage_bucket !== CATALOG_PRODUCT_MEDIA_BUCKET,
  );
  const cover = media.find((entry) => entry.is_cover) ?? media[0] ?? null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-3 overflow-x-clip pb-24 sm:space-y-4 lg:pb-10">
      <header className="flex w-full min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 size-9 shrink-0 rounded-xl"
            aria-label="Kembali ke katalog"
          >
            <Link to={paths.katalog}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <p className="text-[10px] font-medium leading-4 text-muted-foreground sm:text-xs">Katalog <span className="px-1 opacity-50">/</span> Detail barang</p>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <h1 className="min-w-0 max-w-full break-words text-[17px] font-bold leading-5 tracking-tight sm:text-2xl sm:leading-7">
                {item.nama}
              </h1>
              <Badge
                variant={item.status === "active" ? "default" : "secondary"}
                className="rounded-full px-2 py-0.5 text-[9px] leading-4 sm:text-[10px]"
              >
                {catalogStatusLabel(item.status)}
              </Badge>
              <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[9px] leading-4 sm:text-[10px]">
                {item.is_public ? "Publik" : "Internal"}
              </Badge>
            </div>
          </div>
        </div>
        <Button asChild className="h-9 shrink-0 rounded-xl px-2.5 text-[11px] sm:h-10 sm:px-4 sm:text-sm">
          <Link to={paths.katalogEdit + "/" + item.barang_id}>
            <Edit3 className="size-3.5 sm:size-4" />
            Ubah
          </Link>
        </Button>
      </header>

      {unavailableMedia.length > 0 ? (
        <Alert className="rounded-xl px-3 py-2.5">
          <AlertTitle className="text-xs">Referensi media lama tidak tersedia</AlertTitle>
          <AlertDescription className="text-[11px] leading-4">
            {unavailableMedia.length} media lama tidak dapat ditampilkan. Media baru tetap menggunakan penyimpanan katalog yang aktif.
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        className="catalog-detail-media-layout w-full min-w-0"
        aria-label="Media dan informasi produk"
      >
        <Card className="w-full min-w-0 overflow-hidden rounded-2xl border-border/70 shadow-none">
          <div className="catalog-detail-gallery-frame relative w-full min-w-0 overflow-hidden bg-muted/35">
            {cover ? (
              <>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground/60">
                  <ImageOff className="size-7" />
                </div>
                <img
                  src={getCatalogMediaUrl(cover.storage_bucket, cover.storage_path)}
                  alt={"Cover " + item.nama}
                  loading="eager"
                  decoding="async"
                  className="absolute inset-0 size-full object-contain p-2 sm:p-3"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <Badge className="absolute left-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[9px]">Foto utama</Badge>
                {media.length > 1 ? (
                  <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-background/85 px-2 py-1 text-[9px] font-medium text-foreground backdrop-blur">
                    {media.length} foto
                  </span>
                ) : null}
              </>
            ) : (
              <div className="grid size-full place-items-center text-center text-xs text-muted-foreground">
                <div><ImageOff className="mx-auto size-7" /><p className="mt-1.5">Belum ada foto barang</p></div>
              </div>
            )}
          </div>
          {media.length > 1 ? (
            <CardContent className="w-full min-w-0 p-1.5">
              <div className="flex w-full min-w-0 gap-1 overflow-x-auto pb-0.5">
                {media.map((entry, index) => (
                  <div
                    key={entry.barang_media_id}
                    className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted sm:size-14"
                  >
                    <img
                      src={getCatalogMediaUrl(entry.storage_bucket, entry.storage_path)}
                      alt={"Media " + (index + 1) + " " + item.nama}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                    {entry.is_cover ? (
                      <Badge className="absolute bottom-0.5 left-0.5 rounded px-1 py-0 text-[8px]">Utama</Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          ) : null}
        </Card>

        <Card className="w-full min-w-0 rounded-2xl border-border/70 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-1.5 px-2.5 pb-1.5 pt-2.5 sm:gap-2 sm:px-4 sm:pb-2.5 sm:pt-4">
            <div className="min-w-0">
              <CardTitle className="text-xs font-bold sm:text-sm">Informasi produk</CardTitle>
              <p className="mt-0.5 text-[9px] leading-3 text-muted-foreground sm:text-[10px]">Identitas dan deskripsi barang</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 px-2.5 pb-2.5 pt-0 sm:space-y-2.5 sm:px-4 sm:pb-4">
            <div className="grid grid-cols-1 gap-1">
              <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
                <p className="w-11 shrink-0 text-[8px] font-medium uppercase tracking-wide text-muted-foreground sm:w-14 sm:text-[9px]">Kategori</p>
                <p className="min-w-0 truncate text-[9px] font-semibold sm:text-xs">{item.kategori?.nama ?? "Tanpa kategori"}</p>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
                <p className="w-11 shrink-0 text-[8px] font-medium uppercase tracking-wide text-muted-foreground sm:w-14 sm:text-[9px]">Slug</p>
                <p className="min-w-0 truncate font-mono text-[9px] sm:text-[10px]" title={item.slug}>{item.slug}</p>
              </div>
            </div>

            <details className="group rounded-lg border border-border/70 bg-background">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-1.5 px-2 py-1.5 text-[9px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden sm:px-3 sm:text-[11px]">
                <span>Deskripsi dan ringkasan</span>
                <span className="text-[9px] font-medium text-primary group-open:hidden sm:text-[10px]">Lihat</span>
                <span className="hidden text-[9px] font-medium text-primary group-open:inline sm:text-[10px]">Tutup</span>
              </summary>
              <div className="space-y-1.5 border-t px-2.5 py-2 sm:space-y-2 sm:px-3 sm:py-2.5">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Deskripsi</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 sm:text-[11px]">
                    {item.deskripsi || "Belum ada deskripsi."}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Ringkasan publik</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 sm:text-[11px]">
                    {item.ringkasan_publik || "Belum ada ringkasan publik."}
                  </p>
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
      </section>

      <section className="grid w-full min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]" aria-label="Varian dan tarif aktif">
        <Card className="w-full min-w-0 rounded-2xl border-border/70 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3.5 pb-2.5 pt-3.5 sm:px-4 sm:pt-4">
            <div className="min-w-0">
              <CardTitle className="text-sm font-bold">Varian barang</CardTitle>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Pilihan spesifikasi produk</p>
            </div>
            <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums">
              {item.variants.length} varian
            </Badge>
          </CardHeader>
          <CardContent className="px-3.5 pb-3.5 pt-0 sm:px-4 sm:pb-4">
            {item.variants.length === 0 ? (
              <div className="rounded-xl border border-dashed px-3 py-3 text-[11px] leading-4 text-muted-foreground">
                Barang ini tidak memiliki varian.
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {item.variants.map((variant) => (
                  <article key={variant.varian_barang_id} className="min-w-0 rounded-xl border border-border/70 px-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      {(() => {
                        const variantCover = variant.media?.find((media) => media.is_cover)?.url ?? variant.media?.[0]?.url;
                        return variantCover ? (
                          <img src={variantCover} alt={"Foto " + variant.nama} className="size-12 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ImageOff className="size-4" /></div>
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-xs font-bold">{variant.nama}</p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                              {variant.kode_internal ?? "Tanpa kode internal"}
                            </p>
                          </div>
                          <Badge
                        variant={variant.status === "active" ? "default" : "secondary"}
                        className="shrink-0 rounded-full px-1.5 py-0 text-[9px]"
                          >
                            {catalogStatusLabel(variant.status)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {variant.atribut_pembeda ? (
                      <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                        {Object.entries(variant.atribut_pembeda).map(([key, value]) => (
                          <Badge key={key} variant="outline" className="max-w-full rounded-md px-1.5 py-0 text-[9px] font-medium">
                            {key}: {String(value)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {variant.deskripsi ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[9px] font-medium text-muted-foreground">
                          Lihat deskripsi
                        </summary>
                        <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{variant.deskripsi}</p>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="w-full min-w-0 rounded-2xl border-border/70 shadow-none">
          <CardHeader className="px-3.5 pb-2 pt-3.5 sm:px-4 sm:pt-4">
            <CardTitle className="text-sm font-bold">Tarif aktif</CardTitle>
          </CardHeader>
          <CardContent className="px-3.5 pb-3.5 pt-0 sm:px-4 sm:pb-4">
            {item.active_tariff ? (
              <div className="rounded-xl bg-primary/[0.045] px-3 py-3">
                <p className="text-[10px] font-medium text-muted-foreground">{item.active_tariff.nama}</p>
                <p className="mt-1 break-words text-[23px] font-bold leading-7 tracking-tight sm:text-2xl">
                  {formatCatalogMoney(item.active_tariff.nominal, item.active_tariff.currency_code)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge className="rounded-full px-2 py-0.5 text-[9px]">Aktif</Badge>
                  <span className="text-[10px] text-muted-foreground">/ {formatTariffDuration(item.active_tariff)}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed px-3 py-3 text-[11px] text-muted-foreground">
                Belum ada tarif aktif untuk barang ini.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="w-full min-w-0 rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-1.5 px-2.5 pb-1.5 pt-2.5 sm:gap-2 sm:px-4 sm:pb-2.5 sm:pt-4">
          <div className="min-w-0">
            <CardTitle className="text-sm font-bold">Daftar tarif</CardTitle>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Tarif yang terhubung ke barang dan variannya</p>
          </div>
          <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums">
            {item.tariffs.length}
          </Badge>
        </CardHeader>
        <CardContent className="px-3.5 pb-3.5 pt-0 sm:px-4 sm:pb-4">
          {item.tariffs.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-3 text-[11px] text-muted-foreground">
              Belum ada tarif untuk barang atau variannya.
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {item.tariffs.map((tariff) => (
                <div key={tariff.tarif_sewa_id} className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-1">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold sm:text-xs">{tariff.nama}</p>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-muted-foreground sm:text-[10px]">
                      <span>{formatTariffDuration(tariff)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{catalogStatusLabel(tariff.status)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Berlaku {new Date(tariff.berlaku_mulai).toLocaleDateString("id-ID")}</span>
                    </div>
                  </div>
                  <p className="shrink-0 text-right text-[11px] font-bold tabular-nums sm:text-xs">
                    {formatCatalogMoney(tariff.nominal, tariff.currency_code)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full min-w-0 rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-1.5 px-2.5 pb-1.5 pt-2.5 sm:gap-2 sm:px-4 sm:pb-2.5 sm:pt-4">
          <div className="min-w-0">
            <CardTitle className="text-sm font-bold">Paket terkait</CardTitle>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Paket sewa yang menggunakan barang ini</p>
          </div>
          <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums">
            {item.package_references.length}
          </Badge>
        </CardHeader>
        <CardContent className="px-3.5 pb-3.5 pt-0 sm:px-4 sm:pb-4">
          {item.package_references.length === 0 ? (
            <p className="rounded-xl border border-dashed px-3 py-3 text-[11px] text-muted-foreground">
              Barang ini belum menjadi komponen paket.
            </p>
          ) : (
            <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {item.package_references.map((reference) => (
                <div key={reference.komponen_paket_id} className="min-w-0 rounded-xl border border-border/70 px-3 py-2.5">
                  <p className="break-words text-xs font-semibold">{reference.paket?.nama ?? "Paket tidak ditemukan"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Jumlah {reference.jumlah}</span>
                    <Badge
                      variant={reference.paket?.status === "active" ? "default" : "secondary"}
                      className="rounded-full px-1.5 py-0 text-[9px]"
                    >
                      {reference.paket?.status ?? "unknown"}
                    </Badge>
                    <Badge variant="outline" className="rounded-full px-1.5 py-0 text-[9px]">
                      {reference.paket?.is_public ? "Publik" : "Internal"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-[10px] leading-4 text-muted-foreground">
        Pengelolaan unit fisik, lokasi, kondisi, dan kesiapan dilakukan melalui Inventaris.
      </p>
    </div>
  );
};
