import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ClipboardList, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_RESERVATION_LIST_FILTERS,
  getReservasiContext,
  getReservationCapabilities,
  listRequests,
  type ReservationListFilters,
  type RequestListItem,
} from "@/features/reservasi";
import {
  formatReservationDate,
  requestSourceLabel,
  semanticStatusLabel,
  statusVariant,
} from "@/features/reservasi";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Permintaan gagal dimuat.";
}

export function RequestList() {
  const [filters, setFilters] = useState<ReservationListFilters>(DEFAULT_RESERVATION_LIST_FILTERS);
  const context = useQuery({ queryKey: ["permintaan", "context"], queryFn: getReservasiContext, staleTime: 60_000 });
  const requests = useQuery({
    queryKey: ["permintaan", "list", context.data?.usahaId, filters],
    queryFn: () => listRequests(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
  });
  const totalPages = useMemo(() => Math.max(1, Math.ceil((requests.data?.total ?? 0) / filters.pageSize)), [filters.pageSize, requests.data?.total]);
  const capabilities = getReservationCapabilities();

  const updateSearch = (value: string) => setFilters((current) => ({ ...current, search: value, page: 1 }));

  if (context.isPending) return <div className="space-y-5"><header><p className="text-sm text-muted-foreground">Permintaan Sewa</p><h1 className="text-2xl font-bold">Daftar Permintaan</h1></header><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div></div>;
  if (context.error) return <div className="space-y-5"><header><p className="text-sm text-muted-foreground">Permintaan Sewa</p><h1 className="text-2xl font-bold">Daftar Permintaan</h1></header><Alert variant="destructive"><AlertTitle>Permintaan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert></div>;

  return <div className="space-y-5 pb-10">
    <header className="space-y-1"><p className="text-sm text-muted-foreground">Permintaan Sewa</p><div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Daftar Permintaan</h1><p className="text-sm text-muted-foreground">Kebutuhan awal penyewa sebelum menjadi commitment reservation.</p></div><Badge variant="secondary" className="w-fit">Usaha: {context.data.usahaNama}</Badge></div></header>
    <Card><CardHeader className="pb-4"><CardTitle className="text-base">Cari permintaan</CardTitle></CardHeader><CardContent><div className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="request-search">Cari nomor permintaan, penyewa, atau item</label>
      <Input id="request-search" placeholder="Nomor, nama penyewa, atau item" value={filters.search} onChange={(e) => updateSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setFilters((current) => ({ ...current, page: 1 })); }} autoComplete="off" />
      <Button onClick={() => setFilters((current) => ({ ...current, page: 1 }))}><Search />Cari</Button>
    </div></CardContent></Card>

    {requests.isPending ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> : requests.error ? <Alert variant="destructive"><AlertTitle>Data permintaan belum dapat ditampilkan</AlertTitle><AlertDescription className="gap-3"><p>{errorMessage(requests.error)}</p><Button variant="outline" size="sm" onClick={() => void requests.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert> : requests.data.requests.length === 0 ? <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center"><ClipboardList className="size-10 text-muted-foreground" /><h2 className="font-semibold">Belum ada permintaan</h2><p className="max-w-md text-sm text-muted-foreground">Tidak ada permintaan yang cocok dalam Usaha ini.</p></CardContent></Card> : <>
      <div className="grid gap-3 md:hidden">{requests.data.requests.map((request) => <Link key={request.permintaan_sewa_id} to={paths.permintaan + "/" + request.permintaan_sewa_id}><Card className="transition-colors hover:bg-accent/40"><CardContent className="space-y-3 pt-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{request.nomor_permintaan}</h2><p className="text-sm text-muted-foreground">{request.penyewa_nama ?? "Penyewa tidak ditemukan"}</p></div><Badge variant={statusVariant()}>{semanticStatusLabel(request.status)}</Badge></div><div className="grid gap-1 text-sm"><p className="text-muted-foreground">Periode: <span className="text-foreground">{formatReservationDate(request.mulai_rencana)} – {formatReservationDate(request.selesai_rencana)}</span></p><p className="text-muted-foreground">Sumber: <span className="text-foreground">{requestSourceLabel(request.sumber)}</span></p><p className="text-muted-foreground">Detail: <span className="text-foreground">{request.detail_count}</span></p></div></CardContent></Card></Link>)}</div>
      <Card className="hidden md:block"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left"><tr><th className="px-6 py-3 font-medium">Nomor</th><th className="px-6 py-3 font-medium">Penyewa</th><th className="px-6 py-3 font-medium">Periode</th><th className="px-6 py-3 font-medium">Sumber</th><th className="px-6 py-3 font-medium">Status</th><th className="px-6 py-3 font-medium">Reservation</th></tr></thead><tbody>{requests.data.requests.map((request: RequestListItem) => <tr key={request.permintaan_sewa_id} className="border-b last:border-0"><td className="px-6 py-4 font-medium"><Link className="hover:underline" to={paths.permintaan + "/" + request.permintaan_sewa_id}>{request.nomor_permintaan}</Link></td><td className="px-6 py-4">{request.penyewa_nama ?? "-"}</td><td className="px-6 py-4">{formatReservationDate(request.mulai_rencana)} – {formatReservationDate(request.selesai_rencana)}</td><td className="px-6 py-4">{requestSourceLabel(request.sumber)}</td><td className="px-6 py-4"><Badge variant={statusVariant()}>{semanticStatusLabel(request.status)}</Badge></td><td className="px-6 py-4">{request.reservasi_id ? <Link className="hover:underline" to={paths.reservasi + "/" + request.reservasi_id}>{request.nomor_reservasi}</Link> : <span className="text-muted-foreground">Belum menjadi reservasi</span>}</td></tr>)}</tbody></table></div></CardContent></Card>
      <div className="flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">{requests.data.total} permintaan · Halaman {filters.page} dari {totalPages}</span><div className="flex gap-2"><Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters((c) => ({ ...c, page: c.page - 1 }))}>Sebelumnya</Button><Button variant="outline" disabled={filters.page >= totalPages} onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}>Berikutnya</Button></div></div>
    </>}

    <Alert><AlertTitle>Command aktif</AlertTitle><AlertDescription>{capabilities.reason}</AlertDescription></Alert>
  </div>;
}
