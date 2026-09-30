import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit3, Info, MoreVertical, ShoppingBag } from "lucide-react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  getPemasokContext,
  getPurchase,
  getProcurementCapabilities,
  formatProcurementDate,
  formatProcurementDateTime,
  formatPurchaseMoney,
  purchaseStatusLabel,
  purchaseStatusVariant,
} from "@/features/pemasok";
import { paths } from "@/routes/paths";

export function PurchaseShow() {
  const { id } = useParams<{ id: string }>();
  const context = useQuery({ queryKey: ["pembelian", "context"], queryFn: getPemasokContext, staleTime: 60_000 });
  const purchase = useQuery({
    queryKey: ["pembelian", "detail", context.data?.usahaId, id],
    queryFn: () => getPurchase(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    retry: false,
  });

  if (context.isPending || purchase.isPending) {
    return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-64 animate-pulse rounded-2xl bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div>;
  }

  if (context.error || purchase.error || !purchase.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="icon" className="rounded-xl"><Link to={paths.pembelian} aria-label="Kembali ke pembelian"><ArrowLeft /></Link></Button>
        <Alert variant="destructive"><AlertTitle>Detail pembelian tidak tersedia</AlertTitle><AlertDescription>{context.error?.message ?? purchase.error?.message ?? "Pembelian tidak ditemukan atau Anda tidak memiliki akses."}</AlertDescription></Alert>
      </div>
    );
  }

  const item = purchase.data;
  const capabilities = getProcurementCapabilities();

  return (
    <div className="space-y-4 pb-24 lg:space-y-5 lg:pb-10">
      <header className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke pembelian"><Link to={paths.pembelian}><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Pembelian</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight">{item.nomor_pembelian}</h1>
            <Badge variant={purchaseStatusVariant()} className="rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">{purchaseStatusLabel(item.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Draft pembelian · dapat diedit selama status draft.</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Menu pembelian"><MoreVertical /></Button>
      </header>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid size-12 place-items-center rounded-full bg-muted"><ShoppingBag className="size-5 text-muted-foreground" /></div>
          <div className="min-w-0 flex-1"><p className="font-semibold">{item.nomor_pembelian}</p><p className="mt-1 text-xs text-muted-foreground">{item.pemasok_nama ?? "Pemasok tidak dicatat"} · {formatProcurementDate(item.tanggal_pembelian)}</p></div>
          {item.status === "draft" ? <Button asChild size="sm" className="rounded-xl"><Link to={paths.pembelian + "/" + item.pembelian_id + "/edit"}><Edit3 />Edit Draft</Link></Button> : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 rounded-xl">
          <TabsTrigger value="summary">Ringkasan</TabsTrigger>
          <TabsTrigger value="items">Item</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-3">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Ringkasan Pembelian</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <InfoRow label="Pemasok" value={item.pemasok_nama ?? "Tidak dicatat"} />
              <InfoRow label="Tanggal" value={formatProcurementDate(item.tanggal_pembelian)} />
              <InfoRow label="Catatan" value={item.catatan ?? "-"} />
              <div className="border-t pt-4">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="mt-1 text-[28px] font-bold tracking-tight">{formatPurchaseMoney(item.total_amount, item.currency_code)}</p>
                <p className="mt-1 text-xs text-muted-foreground">({item.line_count} item)</p>
              </div>
            </CardContent>
          </Card>

          <Alert><Info /><AlertTitle>Fakta procurement</AlertTitle><AlertDescription>{capabilities.reason} Pembelian tidak otomatis berarti receiving, unit fisik, unit ready, atau pembayaran.</AlertDescription></Alert>

          <Card className="rounded-2xl">
            <CardContent className="flex items-center justify-between gap-3 p-4 text-xs text-muted-foreground">
              <span>Diperbarui {formatProcurementDateTime(item.updated_at)}</span>
              <Badge variant="outline" className="rounded-full">{item.currency_code}</Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items" className="space-y-3">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Daftar Item</CardTitle><p className="text-sm text-muted-foreground">Harga pada detail ini adalah purchase price, bukan harga sewa.</p></CardHeader>
            <CardContent className="space-y-3">
              {item.lines.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center"><ShoppingBag className="size-7 text-muted-foreground" /><p className="font-semibold">Belum ada item</p><p className="text-sm text-muted-foreground">Draft ini belum memiliki line item.</p></div>
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {item.lines.map((line) => (
                      <div key={line.detail_pembelian_id} className="rounded-2xl border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className="font-semibold">{line.barang_nama ?? "Barang tidak ditemukan"}</p><p className="mt-1 text-sm text-muted-foreground">{line.varian_nama ?? "Tanpa varian"}</p></div>
                          <p className="shrink-0 text-sm font-bold">{formatPurchaseMoney(line.subtotal, item.currency_code)}</p>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                          <div><p className="text-xs text-muted-foreground">Jumlah</p><p className="mt-1 font-medium">{line.jumlah}</p></div>
                          <div><p className="text-xs text-muted-foreground">Harga / unit</p><p className="mt-1 font-medium">{formatPurchaseMoney(line.unit_price, item.currency_code)}</p></div>
                        </div>
                        {line.deskripsi ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{line.deskripsi}</p> : null}
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-hidden rounded-xl border md:block">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/35 text-left"><tr><th className="px-4 py-3 font-medium">Barang</th><th className="px-4 py-3 font-medium">Varian</th><th className="px-4 py-3 font-medium">Jumlah</th><th className="px-4 py-3 font-medium">Harga / unit</th><th className="px-4 py-3 font-medium">Subtotal</th></tr></thead>
                      <tbody>
                        {item.lines.map((line) => (
                          <tr key={line.detail_pembelian_id} className="border-b last:border-0">
                            <td className="px-4 py-3 font-medium">{line.barang_nama ?? "Barang tidak ditemukan"}</td>
                            <td className="px-4 py-3">{line.varian_nama ?? "-"}</td>
                            <td className="px-4 py-3">{line.jumlah}</td>
                            <td className="px-4 py-3">{formatPurchaseMoney(line.unit_price, item.currency_code)}</td>
                            <td className="px-4 py-3 font-semibold">{formatPurchaseMoney(line.subtotal, item.currency_code)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium whitespace-pre-wrap">{value}</p></div>;
}
