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
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1.3fr_.7fr]"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>
        <Skeleton className="h-56 rounded-2xl" />
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
  const media = item.media.filter((entry) => entry.status === "valid" && entry.storage_bucket === CATALOG_PRODUCT_MEDIA_BUCKET).sort((a, b) => a.urutan - b.urutan);
  const unavailableMedia = item.media.filter((entry) => entry.status === "valid" && entry.storage_bucket !== CATALOG_PRODUCT_MEDIA_BUCKET);
  const cover = media.find((entry) => entry.is_cover) ?? media[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-24 lg:pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke katalog"><Link to={paths.katalog}><ArrowLeft /></Link></Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Katalog · Detail Barang</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{item.nama}</h1>
              <Badge variant={item.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(item.status)}</Badge>
              <Badge variant="outline" className="rounded-full">{item.is_public ? "Publik" : "Internal"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.kategori?.nama ?? "Tanpa kategori"} · Katalog Barang</p>
          </div>
        </div>
        <Button asChild className="rounded-xl"><Link to={paths.katalogEdit + "/" + item.barang_id}><Edit3 />Ubah Barang</Link></Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="rounded-2xl overflow-hidden shadow-sm">
          <div className="relative aspect-[16/9] bg-muted">
            {cover ? (
              <>
                <img
                  src={getCatalogMediaUrl(cover.storage_bucket, cover.storage_path)}
                  alt={"Cover " + item.nama}
                  className="size-full object-cover"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <div className="absolute inset-0 -z-0 grid place-items-center text-muted-foreground"><ImageOff className="size-8" /></div>
                <Badge className="absolute left-4 top-4 rounded-full">Cover</Badge>
              </>
            ) : (
              <div className="grid size-full place-items-center text-center text-sm text-muted-foreground"><div><ImageOff className="mx-auto size-8" /><p className="mt-2">Belum ada cover media</p></div></div>
            )}
          </div>
          <CardContent className="p-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {media.map((entry, index) => (
                <div key={entry.barang_media_id} className="relative size-20 shrink-0 overflow-hidden rounded-xl border bg-muted">
                  <img src={getCatalogMediaUrl(entry.storage_bucket, entry.storage_path)} alt={"Media " + (index + 1) + " " + item.nama} className="size-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                  {entry.is_cover ? <Badge className="absolute bottom-1 left-1 rounded-full px-1.5 text-[10px]">Cover</Badge> : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {unavailableMedia.length > 0 ? (
          <Alert>
            <AlertTitle>Referensi media lama tidak tersedia</AlertTitle>
            <AlertDescription>
              {unavailableMedia.length} referensi media menunjuk ke storage bucket lama dan tidak ditampilkan sebagai gambar. Media baru menggunakan bucket katalog publik yang aktif.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Informasi produk</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-xs text-muted-foreground">Kategori</p><p className="mt-1 font-semibold">{item.kategori?.nama ?? "Tanpa kategori"}</p></div>
            <div><p className="text-xs text-muted-foreground">Slug</p><p className="mt-1 break-all font-mono text-sm">{item.slug}</p></div>
            <div><p className="text-xs text-muted-foreground">Deskripsi</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{item.deskripsi || "Belum ada deskripsi."}</p></div>
            <div><p className="text-xs text-muted-foreground">Ringkasan publik</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{item.ringkasan_publik || "Belum ada ringkasan publik."}</p></div>
            <div className="rounded-2xl border bg-muted/20 p-4"><p className="font-semibold">Tampilan di Katalog Publik</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.is_public ? "Barang ini dapat ditampilkan pada katalog publik sesuai aturan tampilan." : "Barang ini masih internal dan belum ditawarkan di katalog publik."}</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Varian ({item.variants.length})</CardTitle></CardHeader>
          <CardContent>
            {item.variants.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">Belum ada varian. Tambahkan hanya bila ada perbedaan bermakna pada identitas, spesifikasi, atau harga.</div> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {item.variants.map((variant) => (
                  <div key={variant.varian_barang_id} className="rounded-2xl border p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{variant.nama}</p><p className="text-xs text-muted-foreground">{variant.kode_internal ?? "Tanpa kode internal"}</p></div><Badge variant={variant.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(variant.status)}</Badge></div>
                    {variant.atribut_pembeda ? <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(variant.atribut_pembeda).map(([key, value]) => <Badge key={key} variant="outline" className="rounded-full">{key}: {String(value)}</Badge>)}</div> : null}
                    {variant.deskripsi ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{variant.deskripsi}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="text-base">Tarif aktif</CardTitle></CardHeader>
          <CardContent>
            {item.active_tariff ? <div className="space-y-2"><p className="font-semibold">{item.active_tariff.nama}</p><p className="text-3xl font-bold">{formatCatalogMoney(item.active_tariff.nominal, item.active_tariff.currency_code)}</p><p className="text-sm text-muted-foreground">/ {formatTariffDuration(item.active_tariff)}</p></div> : <p className="text-sm text-muted-foreground">Belum ada tarif aktif.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Tarif Produk ({item.tariffs.length})</CardTitle></CardHeader>
        <CardContent>
          {item.tariffs.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada tarif untuk produk atau variannya.</p> : <div className="divide-y">{item.tariffs.map((tariff) => <div key={tariff.tarif_sewa_id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{tariff.nama}</p><p className="text-sm text-muted-foreground">{formatTariffDuration(tariff)} · {catalogStatusLabel(tariff.status)} · berlaku mulai {new Date(tariff.berlaku_mulai).toLocaleDateString("id-ID")}</p></div><p className="font-semibold">{formatCatalogMoney(tariff.nominal, tariff.currency_code)}</p></div>)}</div>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Relasi Paket ({item.package_references.length})</CardTitle></CardHeader>
        <CardContent>
          {item.package_references.length === 0 ? <p className="text-sm text-muted-foreground">Produk ini belum menjadi komponen paket.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{item.package_references.map((reference) => <div key={reference.komponen_paket_id} className="rounded-2xl border p-4"><p className="font-semibold">{reference.paket?.nama ?? "Paket tidak ditemukan"}</p><p className="mt-1 text-sm text-muted-foreground">Jumlah {reference.jumlah}</p><div className="mt-3 flex gap-2"><Badge variant={reference.paket?.status === "active" ? "default" : "secondary"} className="rounded-full">{reference.paket?.status ?? "unknown"}</Badge><Badge variant="outline" className="rounded-full">{reference.paket?.is_public ? "Publik" : "Internal"}</Badge></div></div>)}</div>}
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Batas Pengelolaan Data</AlertTitle>
        <AlertDescription>Halaman ini menjadi pusat informasi Barang. Unit fisik, kondisi, lokasi, Penetapan Unit, Ketersediaan aktual, Reservasi, Penyewaan, Pembayaran, Pemeriksaan, dan Perawatan dikelola pada menu masing-masing.</AlertDescription>
      </Alert>
    </div>
  );
};
