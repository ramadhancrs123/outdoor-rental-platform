import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RentalPolicyDialog } from "@/components/penyewaan/rental-policy-dialog";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_RENTAL_LIST_FILTERS, getPenyewaanContext, listRentals, type RentalListFilters } from "@/features/penyewaan";
import { formatRentalDateTime, formatRentalMoney, semanticRentalLabel, rentalStatusVariant } from "@/features/penyewaan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Penyewaan gagal dimuat."; }

export function RentalList() {
  const [filters, setFilters] = useState<RentalListFilters>(DEFAULT_RENTAL_LIST_FILTERS);
  const context = useQuery({ queryKey: ["penyewaan", "context"], queryFn: getPenyewaanContext, staleTime: 60_000 });
  const query = useQuery({ queryKey: ["penyewaan", "list", context.data?.usahaId, filters], queryFn: () => listRentals(context.data!.usahaId, filters), enabled: Boolean(context.data?.usahaId) });
  const totalPages = useMemo(() => Math.max(1, Math.ceil((query.data?.total ?? 0) / filters.pageSize)), [filters.pageSize, query.data?.total]);
  if (context.isPending) return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;
  if (context.error) return <Alert variant="destructive"><AlertTitle>Penyewaan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  return <div className="space-y-5 pb-10">
    <header><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="text-sm text-muted-foreground">Penyewaan</p><h1 className="text-2xl font-bold tracking-tight">Daftar Penyewaan</h1><p className="text-sm text-muted-foreground">Data Penyewaan: penggunaan barang oleh penyewa dan alur penyewaan.</p></div><div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="w-fit">Usaha: {context.data.usahaNama}</Badge>
          <RentalPolicyDialog
            usahaId={context.data.usahaId}
            currentToleranceHours={context.data.defaultToleranceHours}
            currentLateFeeEnabled={context.data.lateFeeEnabled}
            currentLateFeePerHour={context.data.lateFeePerHour}
            onSaved={() => void context.refetch()}
          />
          <Button asChild className="rounded-xl"><Link to={paths.penyewaanWalkIn}><Plus />Penyewaan Langsung</Link></Button>
        </div></div></header>
    <Card><CardHeader className="pb-4"><CardTitle className="text-base">Cari penyewaan</CardTitle></CardHeader><CardContent><div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="rental-search">Cari nomor penyewaan, penyewa, atau unit</label><Input id="rental-search" value={filters.search} onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value, page: 1 }))} placeholder="Nomor penyewaan, penyewa, atau unit" autoComplete="off" /><Button onClick={() => setFilters((c) => ({ ...c, page: 1 }))}><Search />Cari</Button></div></CardContent></Card>
    {query.isPending ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> : query.error ? <Alert variant="destructive"><AlertTitle>Data penyewaan gagal dimuat</AlertTitle><AlertDescription className="gap-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert> : query.data.rentals.length === 0 ? <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><CalendarClock className="size-8 text-muted-foreground" /><p className="font-semibold">Belum ada penyewaan</p><p className="text-sm text-muted-foreground">Tidak ada penyewaan yang cocok dalam Usaha ini.</p></CardContent></Card> : <><div className="grid gap-3 md:hidden">{query.data.rentals.map((item) => <Link key={item.penyewaan_id} to={paths.penyewaan + "/" + item.penyewaan_id}><Card className="transition-colors hover:bg-accent/40"><CardContent className="space-y-2 pt-6"><div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">{item.nomor_penyewaan}</h2><p className="text-sm text-muted-foreground">{item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p></div><Badge variant={rentalStatusVariant()}>{semanticRentalLabel(item.status)}</Badge></div><p className="text-sm">{formatRentalDateTime(item.jadwal_mulai)} → {formatRentalDateTime(item.jadwal_kembali)}</p>
          {item.status === "active" || item.status === "return_in_progress" ? (
            <RentalTimingSummary
              scheduleAt={item.jadwal_kembali}
              toleranceDeadline={item.tolerance_deadline}
              actualReturnAt={item.actual_return_completed_at}
              lateFeeEnabled={context.data.lateFeeEnabled}
              lateFeePerHour={context.data.lateFeePerHour}
              compact
              refreshMs={30_000}
            />
          ) : null}
          <div className="flex gap-3 text-xs text-muted-foreground"><span>Detail {item.detail_count}</span><span>Unit ditetapkan {item.assignment_count}</span></div></CardContent></Card></Link>)}</div><Card className="hidden md:block"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left"><tr><th className="px-6 py-3 font-medium">Nomor</th><th className="px-6 py-3 font-medium">Penyewa</th><th className="px-6 py-3 font-medium">Jadwal</th><th className="px-6 py-3 font-medium">Waktu</th><th className="px-6 py-3 font-medium">Status</th><th className="px-6 py-3 font-medium">Detail</th><th className="px-6 py-3 font-medium">Unit ditetapkan</th><th className="px-6 py-3 font-medium">Total</th></tr></thead><tbody>{query.data.rentals.map((item) => <tr key={item.penyewaan_id} className="border-b last:border-0"><td className="px-6 py-4 font-medium"><Link className="hover:underline" to={paths.penyewaan + "/" + item.penyewaan_id}>{item.nomor_penyewaan}</Link></td><td className="px-6 py-4">{item.penyewa_nama ?? "-"}</td><td className="px-6 py-4"><div>{formatRentalDateTime(item.jadwal_mulai)}</div><div className="text-xs text-muted-foreground">→ {formatRentalDateTime(item.jadwal_kembali)}</div></td><td className="min-w-56 px-6 py-4">{item.status === "active" || item.status === "return_in_progress" ? <RentalTimingSummary scheduleAt={item.jadwal_kembali} toleranceDeadline={item.tolerance_deadline} actualReturnAt={item.actual_return_completed_at} lateFeeEnabled={context.data.lateFeeEnabled} lateFeePerHour={context.data.lateFeePerHour} compact refreshMs={30_000} /> : <span className="text-xs text-muted-foreground">—</span>}</td><td className="px-6 py-4"><Badge variant={rentalStatusVariant()}>{semanticRentalLabel(item.status)}</Badge></td><td className="px-6 py-4">{item.detail_count}</td><td className="px-6 py-4">{item.assignment_count}</td><td className="px-6 py-4">{formatRentalMoney(item.total_amount,item.currency_code)}</td></tr>)}</tbody></table></div></CardContent></Card><div className="flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">{query.data.total} penyewaan · Halaman {filters.page} dari {totalPages}</span><div className="flex gap-2"><Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((c) => ({ ...c, page: c.page - 1 }))}>Sebelumnya</Button><Button variant="outline" disabled={filters.page >= totalPages} onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}>Berikutnya</Button></div></div></>}</div>;
}
