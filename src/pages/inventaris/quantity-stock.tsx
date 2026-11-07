import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, History, Package, PencilLine, RefreshCw, Search, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  adjustQuantityInventoryStock,
  listQuantityInventoryStocks,
  listQuantityStockMovements,
  type InventoryQuantityStock,
  type InventoryQuantityStockMovement,
} from "@/features/inventaris";

function money(value: number | null) {
  if (value == null) return "Belum diketahui";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function quantity(value: number, unit: string) {
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)} ${unit || "pcs"}`;
}

function movementLabel(item: InventoryQuantityStockMovement) {
  if (item.jenis_pergerakan === "opening") return "Stok awal";
  if (item.jenis_pergerakan === "purchase_receipt") return "Penerimaan pembelian";
  if (item.jenis_pergerakan === "sale") return "Penjualan";
  if (item.jenis_pergerakan === "sale_return") return "Retur penjualan";
  if (item.jenis_pergerakan === "adjustment") return "Penyesuaian";
  return item.jenis_pergerakan.replaceAll("_", " ");
}

function movementSource(item: InventoryQuantityStockMovement) {
  if (item.source_type === "purchase_receipt") return "Pembelian";
  if (item.source_type === "sale") return "POS";
  if (item.source_type === "stock_adjustment") return "Penyesuaian inventaris";
  if (item.source_type === "quick_item_onboarding") return "Katalog cepat";
  return item.source_type.replaceAll("_", " ");
}

function StockMovementHistory({ movements, isPending, error }: {
  movements: InventoryQuantityStockMovement[];
  isPending: boolean;
  error: Error | null;
}) {
  if (isPending) return <div className="space-y-2 py-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div>;
  if (error) return <p className="py-3 text-xs text-destructive">Riwayat stok tidak dapat dimuat: {error.message}</p>;
  if (!movements.length) return <p className="py-3 text-xs text-muted-foreground">Belum ada pergerakan stok.</p>;

  return (
    <div className="divide-y divide-border/70">
      {movements.map((item) => {
        const incoming = item.quantity_delta > 0;
        return (
          <div key={item.pergerakan_stok_id} className="flex items-start gap-3 py-3 first:pt-2">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${incoming ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
              {incoming ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{movementLabel(item)}</p>
                <span className={`text-xs font-bold tabular-nums ${incoming ? "text-emerald-600" : "text-rose-600"}`}>
                  {incoming ? "+" : ""}{new Intl.NumberFormat("id-ID").format(item.quantity_delta)}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{movementSource(item)} · {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</p>
              {item.catatan ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.catatan}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function QuantityStockInventoryView({ usahaId, canMutate }: { usahaId: string; canMutate: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InventoryQuantityStock | null>(null);
  const [nextQuantity, setNextQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);

  const stocks = useQuery({
    queryKey: ["inventaris", "quantity-stocks", usahaId],
    queryFn: () => listQuantityInventoryStocks(usahaId),
    staleTime: 15_000,
  });
  const history = useQuery({
    queryKey: ["inventaris", "quantity-stock-movements", usahaId, historyId],
    queryFn: () => listQuantityStockMovements(usahaId, historyId!),
    enabled: Boolean(historyId),
    staleTime: 10_000,
  });

  const adjustment = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Barang stok belum dipilih.");
      return adjustQuantityInventoryStock({
        usahaId,
        barangId: selected.barang_id,
        varianBarangId: selected.varian_barang_id,
        jumlahBaru: Number(nextQuantity),
        alasan: reason,
        expectedUpdatedAt: selected.stok_barang_id ? selected.updated_at : null,
      });
    },
    onSuccess: async (result) => {
      toast.success(result.state === "unchanged" ? "Saldo stok tidak berubah." : "Saldo stok berhasil disesuaikan.");
      setSelected(null);
      setReason("");
      setNextQuantity("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventaris", "quantity-stocks", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris", "quantity-stock-movements", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
        queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Stok gagal disesuaikan."),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("id-ID");
    return (stocks.data ?? []).filter((item) => !term || `${item.barang_nama} ${item.varian_nama ?? ""}`.toLocaleLowerCase("id-ID").includes(term));
  }, [search, stocks.data]);
  const totals = useMemo(() => ({
    withStock: filtered.filter((item) => item.stock_quantity > 0).length,
    value: filtered.reduce((sum, item) => sum + (item.stock_value ?? 0), 0),
    unknown: filtered.filter((item) => item.stock_quantity > 0 && item.average_unit_cost == null).length,
  }), [filtered]);

  const openAdjustment = (item: InventoryQuantityStock) => {
    setSelected(item);
    setNextQuantity(String(item.stock_quantity));
    setReason("");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-primary/[0.06] px-3 py-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Barang / varian</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{stocks.data?.length ?? 0}</p>
        </div>
        <div className="rounded-xl bg-primary/[0.06] px-3 py-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">SKU bersaldo</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{new Intl.NumberFormat("id-ID").format(totals.withStock)}</p>
        </div>
        <div className="col-span-2 rounded-xl bg-primary/[0.06] px-3 py-2.5 sm:col-span-1">
          <p className="text-[11px] font-medium text-muted-foreground">Nilai HPP terdata</p>
          <p className="mt-1 text-base font-bold tabular-nums">{money(totals.value)}</p>
          {totals.unknown > 0 ? <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">Parsial · {totals.unknown} SKU belum memiliki HPP</p> : <p className="mt-0.5 text-[10px] text-muted-foreground">HPP rata-rata tersedia untuk seluruh saldo</p>}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari barang atau varian…" className="h-10 rounded-xl bg-muted/40 pl-9" />
      </div>

      {stocks.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}</div>
      ) : stocks.error ? (
        <Alert variant="destructive"><AlertTitle>Stok kuantitas belum dapat dimuat</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{stocks.error.message}</span><Button size="sm" variant="outline" onClick={() => void stocks.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl border-dashed shadow-none"><CardContent className="flex min-h-52 flex-col items-center justify-center gap-2 p-6 text-center"><Boxes className="size-8 text-muted-foreground" /><p className="text-sm font-semibold">Belum ada barang dengan stok kuantitas</p><p className="max-w-md text-xs leading-5 text-muted-foreground">Pilih mode Stok kuantitas pada Katalog Cepat untuk mulai mencatat persediaan per barang atau varian.</p></CardContent></Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={`${item.barang_id}:${item.varian_barang_id ?? "product"}`} className="overflow-hidden rounded-2xl border-border/70 shadow-none">
              <CardContent className="space-y-3 p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/[0.07] text-primary"><Package className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.barang_nama}</p>
                    {item.varian_nama ? <p className="truncate text-xs text-muted-foreground">{item.varian_nama}</p> : <p className="text-[10px] text-muted-foreground">Tanpa varian</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="secondary" className="rounded-full text-[10px]">Kuantitas</Badge>
                    {item.status !== "active" ? <Badge variant="outline" className="rounded-full text-[10px]">Nonaktif</Badge> : null}
                  </div>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground">Saldo tersedia</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums">{quantity(item.stock_quantity, item.satuan_jual)}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>HPP rata-rata · {money(item.average_unit_cost)}</span>
                    <span>Nilai · {money(item.stock_value)}</span>
                  </div>
                </div>
                {item.stock_quantity > 0 && item.average_unit_cost == null ? <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">HPP belum lengkap; periksa harga perolehan pada pembelian atau saldo awal.</p> : null}
                <div className="flex items-center gap-2">
                  {canMutate ? <Button size="sm" variant="outline" className="h-8 flex-1 rounded-lg text-xs" onClick={() => openAdjustment(item)}><PencilLine className="size-3.5" />Atur stok</Button> : null}
                  {item.stok_barang_id ? <Button size="sm" variant="ghost" className="h-8 flex-1 rounded-lg text-xs" onClick={() => setHistoryId(historyId === item.stok_barang_id ? null : item.stok_barang_id)}><History className="size-3.5" />Riwayat</Button> : <span className="flex-1 text-right text-[10px] text-muted-foreground">Belum ada mutasi</span>}
                </div>
                {historyId && historyId === item.stok_barang_id ? <StockMovementHistory movements={history.data ?? []} isPending={history.isPending} error={history.error instanceof Error ? history.error : null} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Penyesuaian stok kuantitas</SheetTitle>
            <SheetDescription>{selected ? [selected.barang_nama, selected.varian_nama].filter(Boolean).join(" · ") : "Atur saldo persediaan."}</SheetDescription>
          </SheetHeader>
          {selected ? <div className="space-y-4 px-4 py-5">
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Saldo saat ini</p>
              <p className="mt-1 text-lg font-bold">{quantity(selected.stock_quantity, selected.satuan_jual)}</p>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">Saldo baru ({selected.satuan_jual})
              <Input type="number" min="0" step="1" inputMode="numeric" value={nextQuantity} onChange={(event) => setNextQuantity(event.target.value)} className="h-11 rounded-xl" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">Alasan penyesuaian
              <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contoh: koreksi hasil stok opname" className="h-11 rounded-xl" maxLength={240} />
              <span className="text-[10px] font-normal text-muted-foreground">Minimal 5 karakter. Selisih akan dicatat dalam riwayat stok.</span>
            </label>
          </div> : null}
          <SheetFooter className="sticky bottom-0 mt-auto border-t bg-background/95 p-4 backdrop-blur">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setSelected(null)}>Batal</Button>
            <Button type="button" className="rounded-xl" disabled={!selected || adjustment.isPending || !/^\d+$/.test(nextQuantity) || reason.trim().length < 5} onClick={() => adjustment.mutate()}>
              {adjustment.isPending ? "Menyimpan…" : "Simpan saldo"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
