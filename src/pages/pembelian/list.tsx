import { useQuery } from "@tanstack/react-query";
import { Building2, ClipboardList, Plus, RefreshCw, Search, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_PURCHASE_LIST_FILTERS,
  getPemasokContext,
  getPurchaseOverview,
  listPurchases,
  type PurchaseListFilters,
  formatProcurementDate,
  formatPurchaseMoney,
  purchaseStatusLabel,
  purchaseStatusVariant,
} from "@/features/pemasok";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data pembelian gagal dimuat.";
}

export function PurchaseList() {
  const [filters, setFilters] = useState<PurchaseListFilters>(DEFAULT_PURCHASE_LIST_FILTERS);
  const context = useQuery({ queryKey: ["pembelian", "context"], queryFn: getPemasokContext, staleTime: 60_000 });
  const purchases = useQuery({
    queryKey: ["pembelian", "list", context.data?.usahaId, filters],
    queryFn: () => listPurchases(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
  });
  const overview = useQuery({
    queryKey: ["pembelian", "overview", context.data?.usahaId],
    queryFn: () => getPurchaseOverview(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil((purchases.data?.total ?? 0) / filters.pageSize)), [filters.pageSize, purchases.data?.total]);
  const setFilter = <K extends keyof PurchaseListFilters>(key: K, value: PurchaseListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? Number(value) : 1 }));
  };

  if (context.isPending) {
    return <div className="space-y-3"><Skeleton className="h-12 rounded-xl" /><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[66px] rounded-xl" />)}</div><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-2 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pembelian belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-3 pb-24 lg:space-y-4 lg:pb-8">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight sm:text-[25px]">Pembelian</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{context.data.usahaNama}</p>
        </div>
        <div className="flex shrink-0 gap-1.5 sm:gap-2">
          <Button asChild variant="outline" className="h-9 rounded-xl px-2.5 text-xs sm:h-10 sm:px-3 sm:text-sm"><Link to={paths.pemasok}><Building2 className="size-4" /><span className="hidden sm:inline">Master Pemasok</span><span className="sm:hidden">Pemasok</span></Link></Button>
          <Button asChild className="h-9 rounded-xl px-2.5 text-xs sm:h-10 sm:px-4 sm:text-sm"><Link to={paths.pembelian + "/create"}><Plus className="size-4" /><span>Buat Pembelian</span></Link></Button>
        </div>
      </header>

      <div role="group" aria-label="Ringkasan pembelian" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ["Total", overview.data?.total],
          ["Draf", overview.data?.draft],
          ["Selesai", overview.data?.completed],
          ["Belum masuk", overview.data?.pendingUnits],
        ] as const).map(([label, value]) => (
          <Card key={label} className="gap-0 rounded-xl border-border/70 py-0 shadow-none">
            <CardContent className="px-3 py-2.5">
              <p className="truncate text-[10px] font-medium text-muted-foreground sm:text-xs">{label}</p>
              <p className="mt-0.5 text-lg font-semibold leading-5 tabular-nums sm:text-xl">
                {overview.isPending || overview.isError ? "—" : value ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-0 rounded-2xl border-border/70 py-0 shadow-none">
        <CardContent className="space-y-2.5 p-3">
          <label className="relative block" htmlFor="purchase-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="purchase-search"
            placeholder="Cari nomor pembelian atau pemasok..."
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="h-10 rounded-xl pl-9 text-sm"
          />
        </label>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Filter status pembelian">
            {[
              ["all", "Semua"],
              ["draft", "Draf"],
              ["completed", "Selesai"],
              ["cancelled", "Dibatalkan"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filters.status === value}
                onClick={() => setFilter("status", value as PurchaseListFilters["status"])}
                className={[
                  "h-8 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition-colors",
                  filters.status === value ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {purchases.isPending ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : purchases.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data pembelian belum dapat ditampilkan</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorMessage(purchases.error)}</p><Button variant="outline" size="sm" onClick={() => void purchases.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : purchases.data.purchases.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2.5 p-4 text-center sm:min-h-56 sm:p-6">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardList className="size-7" /></div>
            <div><h2 className="font-semibold">{filters.status === "all" ? "Belum ada pembelian" : "Tidak ada pembelian pada status ini"}</h2><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Status pembayaran dan penerimaan inventaris akan ditampilkan di sini.</p></div>
            <Button asChild className="rounded-xl"><Link to={paths.pembelian + "/create"}><Plus />Buat Draft Pembelian</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2.5 lg:grid-cols-2 2xl:hidden">
            {purchases.data.purchases.map((purchase) => (
              <Link key={purchase.pembelian_id} to={paths.pembelian + "/" + purchase.pembelian_id}>
                <Card className="gap-0 rounded-2xl border-border/70 py-0 shadow-none transition-colors hover:border-primary/25">
                  <CardContent className="space-y-2.5 p-3 sm:p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h2 className="font-bold">{purchase.nomor_pembelian}</h2><p className="mt-1 text-sm text-muted-foreground">{purchase.pemasok_nama ?? "Pemasok tidak dicatat"}</p></div>
                      <Badge variant={purchaseStatusVariant()} className="shrink-0 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">{purchaseStatusLabel(purchase.status)}</Badge>
                    </div>
                    <div className="border-t pt-3 text-xs text-muted-foreground">
                      <span>{formatProcurementDate(purchase.tanggal_pembelian)}</span><span className="mx-2">•</span><span>{purchase.line_count} item</span>
                    </div>
                    {(purchase.inventory_pending_units ?? 0) > 0 || (purchase.inventory_quantity_review_count ?? 0) > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(purchase.inventory_pending_units ?? 0) > 0 ? <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-800">{purchase.inventory_pending_units} unit belum didaftarkan</Badge> : null}
                        {(purchase.inventory_quantity_review_count ?? 0) > 0 ? <Badge variant="outline" className="rounded-full border-orange-300 bg-orange-50 text-orange-800">Periksa jumlah barang</Badge> : null}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between"><p className="text-base font-bold">{formatPurchaseMoney(purchase.total_amount, purchase.currency_code)}</p><ChevronRight className="size-4 text-muted-foreground" /></div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm 2xl:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/35 text-left"><tr><th className="px-5 py-3 font-medium">Nomor</th><th className="px-5 py-3 font-medium">Pemasok</th><th className="px-5 py-3 font-medium">Tanggal</th><th className="px-5 py-3 font-medium">Item</th><th className="px-5 py-3 font-medium">Total</th><th className="px-5 py-3 font-medium">Inventaris</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
              <tbody>
                {purchases.data.purchases.map((purchase) => (
                  <tr key={purchase.pembelian_id} className="border-b last:border-0">
                    <td className="px-5 py-4 font-semibold"><Link className="hover:underline" to={paths.pembelian + "/" + purchase.pembelian_id}>{purchase.nomor_pembelian}</Link></td>
                    <td className="px-5 py-4">{purchase.pemasok_nama ?? "-"}</td>
                    <td className="px-5 py-4">{formatProcurementDate(purchase.tanggal_pembelian)}</td>
                    <td className="px-5 py-4">{purchase.line_count}</td>
                    <td className="px-5 py-4 font-semibold">{formatPurchaseMoney(purchase.total_amount, purchase.currency_code)}</td>
                    <td className="px-5 py-4">
                      {(purchase.inventory_pending_units ?? 0) > 0 ? <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-800">{purchase.inventory_pending_units} belum masuk</Badge> : (purchase.inventory_quantity_review_count ?? 0) > 0 ? <Badge variant="outline" className="rounded-full border-orange-300 bg-orange-50 text-orange-800">Periksa jumlah</Badge> : <span className="text-xs text-muted-foreground">Terdaftar / tidak perlu unit</span>}
                    </td>
                    <td className="px-5 py-4"><Badge variant={purchaseStatusVariant()} className="rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">{purchaseStatusLabel(purchase.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:text-sm">
            <span className="text-muted-foreground">{purchases.data.total} pembelian · Halaman {filters.page} dari {totalPages}</span>
            <div className="flex gap-2"><Button variant="outline" size="sm" className="h-8 rounded-lg px-3" disabled={filters.page <= 1} onClick={() => setFilter("page", filters.page - 1)}>Sebelumnya</Button><Button variant="outline" size="sm" className="h-8 rounded-lg px-3" disabled={filters.page >= totalPages} onClick={() => setFilter("page", filters.page + 1)}>Berikutnya</Button></div>
          </div>
        </>
      )}
    </div>
  );
}
