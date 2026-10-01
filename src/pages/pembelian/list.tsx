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

  const totalPages = useMemo(() => Math.max(1, Math.ceil((purchases.data?.total ?? 0) / filters.pageSize)), [filters.pageSize, purchases.data?.total]);
  const setFilter = <K extends keyof PurchaseListFilters>(key: K, value: PurchaseListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? Number(value) : 1 }));
  };

  if (context.isPending) {
    return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-11 rounded-2xl" /><div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pembelian belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4 pb-24 lg:space-y-5 lg:pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Pembelian</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight">Pembelian</h1>
          <p className="mt-1 text-sm text-muted-foreground">Kelola draft pembelian usaha Anda.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" className="h-10 rounded-xl"><Link to={paths.pemasok}><Building2 /><span className="hidden sm:inline">Master Pemasok</span><span className="sm:hidden">Pemasok</span></Link></Button>
          <Button asChild className="h-10 rounded-xl px-3 sm:px-4"><Link to={paths.pembelian + "/create"}><Plus /><span>Buat Draft Pembelian</span></Link></Button>
        </div>
      </header>

      <div className="space-y-2">
        <label className="relative block" htmlFor="purchase-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="purchase-search"
            placeholder="Cari nomor, pemasok, atau tanggal..."
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="h-11 rounded-xl pl-9"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter status pembelian">
          {[
            ["all", "Semua"],
            ["draft", "Draft"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filters.status === value}
              onClick={() => setFilter("status", value as PurchaseListFilters["status"])}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold",
                filters.status === value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {purchases.isPending ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : purchases.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data pembelian belum dapat ditampilkan</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorMessage(purchases.error)}</p><Button variant="outline" size="sm" onClick={() => void purchases.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : purchases.data.purchases.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardList className="size-7" /></div>
            <div><h2 className="font-semibold">Belum ada draft pembelian</h2><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Buat draft pengadaan baru tanpa otomatis membuat receiving, unit inventaris, atau pembayaran.</p></div>
            <Button asChild className="rounded-xl"><Link to={paths.pembelian + "/create"}><Plus />Buat Draft Pembelian</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {purchases.data.purchases.map((purchase) => (
              <Link key={purchase.pembelian_id} to={paths.pembelian + "/" + purchase.pembelian_id}>
                <Card className="rounded-2xl shadow-sm transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h2 className="font-bold">{purchase.nomor_pembelian}</h2><p className="mt-1 text-sm text-muted-foreground">{purchase.pemasok_nama ?? "Pemasok tidak dicatat"}</p></div>
                      <Badge variant={purchaseStatusVariant()} className="shrink-0 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">{purchaseStatusLabel(purchase.status)}</Badge>
                    </div>
                    <div className="border-t pt-3 text-xs text-muted-foreground">
                      <span>{formatProcurementDate(purchase.tanggal_pembelian)}</span><span className="mx-2">•</span><span>{purchase.line_count} item</span>
                    </div>
                    <div className="flex items-center justify-between"><p className="text-base font-bold">{formatPurchaseMoney(purchase.total_amount, purchase.currency_code)}</p><ChevronRight className="size-4 text-muted-foreground" /></div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/35 text-left"><tr><th className="px-5 py-3 font-medium">Nomor</th><th className="px-5 py-3 font-medium">Pemasok</th><th className="px-5 py-3 font-medium">Tanggal</th><th className="px-5 py-3 font-medium">Item</th><th className="px-5 py-3 font-medium">Total</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
              <tbody>
                {purchases.data.purchases.map((purchase) => (
                  <tr key={purchase.pembelian_id} className="border-b last:border-0">
                    <td className="px-5 py-4 font-semibold"><Link className="hover:underline" to={paths.pembelian + "/" + purchase.pembelian_id}>{purchase.nomor_pembelian}</Link></td>
                    <td className="px-5 py-4">{purchase.pemasok_nama ?? "-"}</td>
                    <td className="px-5 py-4">{formatProcurementDate(purchase.tanggal_pembelian)}</td>
                    <td className="px-5 py-4">{purchase.line_count}</td>
                    <td className="px-5 py-4 font-semibold">{formatPurchaseMoney(purchase.total_amount, purchase.currency_code)}</td>
                    <td className="px-5 py-4"><Badge variant={purchaseStatusVariant()} className="rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">{purchaseStatusLabel(purchase.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hidden flex-col gap-2 border-t pt-3 text-sm sm:flex md:flex-row md:items-center md:justify-between">
            <span className="text-muted-foreground">{purchases.data.total} pembelian · Halaman {filters.page} dari {totalPages}</span>
            <div className="flex gap-2"><Button variant="outline" className="rounded-xl" disabled={filters.page <= 1} onClick={() => setFilter("page", filters.page - 1)}>Sebelumnya</Button><Button variant="outline" className="rounded-xl" disabled={filters.page >= totalPages} onClick={() => setFilter("page", filters.page + 1)}>Berikutnya</Button></div>
          </div>
        </>
      )}
    </div>
  );
}
