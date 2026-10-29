import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Edit3, Info, MoreVertical, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { registerInventoryUnit } from "@/features/inventaris";

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
  type PurchaseLineItem,
} from "@/features/pemasok";
import { paths } from "@/routes/paths";

export function PurchaseShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [registeringLineId, setRegisteringLineId] = useState<string | null>(null);
  const [inventoryFeedback, setInventoryFeedback] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
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
  const pendingInventoryUnits = item.lines.reduce((sum, line) => sum + Math.max(0, Number(line.remaining_unit_count ?? 0)), 0);
  const quantityReviewCount = item.lines.filter((line) => line.quantity_needs_review).length;
  const hasRegisteredUnits = item.lines.some((line) => Number(line.registered_unit_count ?? 0) > 0);

  const registerRemainingUnits = async (line: PurchaseLineItem) => {
    if (!context.data?.usahaId) return;
    const quantity = Number(line.jumlah);
    const remaining = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0) - Number(line.registered_unit_count ?? 0));
    if (line.quantity_needs_review) { setInventoryError("Periksa jumlah barang sebelum mendaftarkan unit."); return; }
    if (!line.barang_id) { setInventoryError("Item belum terhubung ke barang katalog."); return; }
    if (remaining < 1) return;
    setRegisteringLineId(line.detail_pembelian_id);
    setInventoryError(null);
    setInventoryFeedback(null);
    let done = 0;
    try {
      for (let i = 0; i < remaining; i += 1) {
        await registerInventoryUnit(context.data.usahaId, {
          barangId: line.barang_id,
          varianBarangId: line.varian_barang_id,
          kodeUnit: "",
          lokasiId: null,
          tanggalDiperoleh: item.tanggal_pembelian,
          sumberPembelianDetailId: line.detail_pembelian_id,
          catatanInternal: "Didaftarkan dari pembelian " + item.nomor_pembelian,
        });
        done += 1;
      }
      setInventoryFeedback(done + " unit berhasil didaftarkan.");
    } catch (error) {
      setInventoryError((done ? done + " unit berhasil; " : "") + (error instanceof Error ? error.message : "Pendaftaran unit gagal."));
    } finally {
      await purchase.refetch();
      await queryClient.invalidateQueries({ queryKey: ["inventaris"] });
      setRegisteringLineId(null);
    }
  };

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
          <p className="mt-1 text-sm text-muted-foreground">{item.status === "draft" ? "Draft pembelian · belum dibayar atau diselesaikan." : "Pembelian tercatat · periksa status inventaris di bawah."}</p>
        </div>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Menu pembelian"><MoreVertical /></Button>
      </header>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid size-12 place-items-center rounded-full bg-muted"><ShoppingBag className="size-5 text-muted-foreground" /></div>
          <div className="min-w-0 flex-1"><p className="font-semibold">{item.nomor_pembelian}</p><p className="mt-1 text-xs text-muted-foreground">{item.pemasok_nama ?? "Pemasok tidak dicatat"} · {formatProcurementDate(item.tanggal_pembelian)}</p></div>
          {item.status === "draft" ? <div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="sm" className="rounded-xl"><Link to={paths.keuangan + "/pengeluaran/create?sourceType=purchase&sourceId=" + encodeURIComponent(item.pembelian_id)}>Catat Pengeluaran</Link></Button>{hasRegisteredUnits ? <span className="text-xs text-muted-foreground">Detail dikunci karena unit sudah terdaftar.</span> : <Button asChild size="sm" className="rounded-xl"><Link to={paths.pembelian + "/" + item.pembelian_id + "/edit"}><Edit3 />Ubah Draf</Link></Button>}</div> : null}
        </CardContent>
      </Card>

      {pendingInventoryUnits > 0 || quantityReviewCount > 0 ? (
        <Alert className="border-amber-300 bg-amber-50/70 text-amber-950">
          <AlertCircle className="size-4" />
          <AlertTitle>Barang belum lengkap di inventaris</AlertTitle>
          <AlertDescription>
            {pendingInventoryUnits > 0 ? pendingInventoryUnits + " unit belum didaftarkan. " : ""}
            {quantityReviewCount > 0 ? quantityReviewCount + " item memiliki jumlah yang perlu diperiksa. " : ""}
            Buka tab Item, lalu daftarkan unit yang benar. Kode unit dibuat otomatis.
          </AlertDescription>
        </Alert>
      ) : null}
      {inventoryFeedback ? <Alert className="border-emerald-200 bg-emerald-50/70"><Check className="size-4 text-emerald-700" /><AlertTitle>Inventaris diperbarui</AlertTitle><AlertDescription>{inventoryFeedback}</AlertDescription></Alert> : null}
      {inventoryError ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Unit belum seluruhnya didaftarkan</AlertTitle><AlertDescription>{inventoryError}</AlertDescription></Alert> : null}

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
            <CardHeader><CardTitle className="text-base">Daftar Item</CardTitle><p className="text-sm text-muted-foreground">Harga pada detail ini adalah harga beli, bukan harga sewa.</p></CardHeader>
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
                        <InventoryProgressControl line={line} loading={registeringLineId === line.detail_pembelian_id} disabled={registeringLineId !== null} onRegister={() => void registerRemainingUnits(line)} />
                        {line.deskripsi ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{line.deskripsi}</p> : null}
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-hidden rounded-xl border md:block">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/35 text-left"><tr><th className="px-4 py-3 font-medium">Barang</th><th className="px-4 py-3 font-medium">Varian</th><th className="px-4 py-3 font-medium">Jumlah</th><th className="px-4 py-3 font-medium">Harga / unit</th><th className="px-4 py-3 font-medium">Subtotal</th><th className="px-4 py-3 font-medium">Inventaris</th></tr></thead>
                      <tbody>
                        {item.lines.map((line) => (
                          <tr key={line.detail_pembelian_id} className="border-b last:border-0">
                            <td className="px-4 py-3 font-medium">{line.barang_nama ?? "Barang tidak ditemukan"}</td>
                            <td className="px-4 py-3">{line.varian_nama ?? "-"}</td>
                            <td className="px-4 py-3">{line.jumlah}</td>
                            <td className="px-4 py-3">{formatPurchaseMoney(line.unit_price, item.currency_code)}</td>
                            <td className="px-4 py-3 font-semibold">{formatPurchaseMoney(line.subtotal, item.currency_code)}</td>
                            <td className="min-w-56 px-4 py-3"><InventoryProgressControl line={line} loading={registeringLineId === line.detail_pembelian_id} disabled={registeringLineId !== null} onRegister={() => void registerRemainingUnits(line)} /></td>
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


function InventoryProgressControl({
  line,
  loading,
  disabled,
  onRegister,
}: {
  line: PurchaseLineItem;
  loading: boolean;
  disabled: boolean;
  onRegister: () => void;
}) {
  const planned = Number(line.jumlah);
  const wholeQuantity = Number.isFinite(planned) && planned > 0 ? Math.floor(planned) : 0;
  const registered = Math.max(0, Number(line.registered_unit_count ?? 0));
  const remaining = Math.max(0, wholeQuantity - registered);

  return (
    <div className="mt-3 space-y-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Status inventaris</p>
        <Badge
          variant="outline"
          className={remaining > 0 || line.quantity_needs_review
            ? "rounded-full border-amber-300 bg-amber-50 text-amber-800"
            : "rounded-full border-emerald-200 bg-emerald-50 text-emerald-800"}
        >
          {registered}/{wholeQuantity} terdaftar
        </Badge>
      </div>

      {line.quantity_needs_review ? (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-amber-800">
            Jumlah pada catatan pembelian perlu diperiksa. Pendaftaran unit fisik tetap dapat dilakukan melalui Inventaris.
          </p>
          <Button asChild type="button" variant="outline" size="sm" className="w-full rounded-xl">
            <Link to={paths.inventarisCreate}>Daftarkan unit di Inventaris</Link>
          </Button>
        </div>
      ) : !line.barang_id ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Item belum terhubung ke barang katalog. Hubungkan barang terlebih dahulu.
        </p>
      ) : remaining > 0 ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {remaining} unit belum terdaftar di inventaris.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full rounded-xl"
            disabled={disabled || loading}
            onClick={onRegister}
          >
            {loading ? <Check className="size-3.5 animate-pulse" /> : <ShoppingBag className="size-3.5" />}
            {loading ? "Mendaftarkan unit…" : "Daftarkan " + remaining + " unit"}
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-emerald-700">
            Seluruh jumlah pada catatan pembelian sudah terhubung ke inventaris. Jika masih ada unit fisik lain, daftarkan melalui Inventaris; jumlah pembelian bukan batas stok.
          </p>
          <Button asChild type="button" variant="outline" size="sm" className="w-full rounded-xl">
            <Link to={paths.inventarisCreate}>Daftarkan unit lain</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
