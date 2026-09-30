import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ReservationItemVisual } from "@/components/reservasi/reservation-item-visual";
import { ReservationStatusBadge, StockLockBadge } from "@/components/reservasi/reservation-ui";
import {
  DEFAULT_RESERVATION_LIST_FILTERS,
  getReservationCapabilities,
  getReservasiContext,
  listReservations,
  type ReservationListFilters,
} from "@/features/reservasi";
import { paths } from "@/routes/paths";

const filters = [
  { key: "all", label: "Semua" },
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

function cardArt(index: number) {
  const colors = [
    "from-emerald-100 via-stone-50 to-white text-emerald-700 dark:from-emerald-950/50 dark:via-slate-900 dark:to-slate-950 dark:text-emerald-300",
    "from-amber-100 via-stone-50 to-white text-amber-700 dark:from-amber-950/50 dark:via-slate-900 dark:to-slate-950 dark:text-amber-300",
    "from-slate-100 via-stone-50 to-white text-slate-700 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 dark:text-slate-200",
    "from-rose-100 via-stone-50 to-white text-rose-700 dark:from-rose-950/50 dark:via-slate-900 dark:to-slate-950 dark:text-rose-300",
  ];
  return colors[index % colors.length];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Reservasi gagal dimuat.";
}

export function ReservationList() {
  const [listFilters, setListFilters] = useState<ReservationListFilters>(DEFAULT_RESERVATION_LIST_FILTERS);
  const context = useQuery({
    queryKey: ["reservasi", "context"],
    queryFn: getReservasiContext,
    staleTime: 60_000,
  });
  const reservations = useQuery({
    queryKey: ["reservasi", "list", context.data?.usahaId, listFilters],
    queryFn: () => listReservations(context.data!.usahaId, listFilters),
    enabled: Boolean(context.data?.usahaId),
  });
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((reservations.data?.total ?? 0) / listFilters.pageSize)),
    [listFilters.pageSize, reservations.data?.total],
  );
  const capabilities = getReservationCapabilities();

  if (context.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-24">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-11 w-56" />
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (context.error) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-24">
        <Alert variant="destructive">
          <AlertTitle>Reservasi belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-24">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/75">Operasional · Commitment</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservasi</h1>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              Kelola komitmen rental dan pantau statusnya.
            </p>
          </div>
          <div className="hidden rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground sm:block">
            Usaha: <span className="text-foreground">{context.data.usahaNama}</span>
          </div>
        </div>
      </header>

      <Card className="shadow-sm">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="reservation-search"
              aria-label="Cari nomor reservasi, penyewa, atau barang"
              placeholder="Cari nomor, penyewa, atau barang..."
              value={listFilters.search}
              onChange={(event) => setListFilters((current) => ({ ...current, search: event.target.value, page: 1 }))}
              autoComplete="off"
              className="h-11 border-0 bg-muted/60 pl-9 shadow-none focus-visible:ring-1"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {filters.map((filter) => {
              const active = listFilters.status === filter.key;
              return (
                <Button
                  key={filter.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={cn("shrink-0 rounded-full px-4", active && "shadow-sm")}
                  onClick={() => setListFilters((current) => ({ ...current, status: filter.key, page: 1 }))}
                >
                  {filter.label}
                </Button>
              );
            })}
            <Button variant="ghost" size="icon" className="ml-auto hidden shrink-0 sm:inline-flex" aria-label="Filter lanjutan">
              <SlidersHorizontal className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {reservations.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : reservations.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data reservasi belum dapat ditampilkan</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{errorMessage(reservations.error)}</p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => void reservations.refetch()}>Coba lagi</Button>
          </AlertDescription>
        </Alert>
      ) : reservations.data.reservations.length === 0 ? (
        <Card className="overflow-hidden border-dashed shadow-sm">
          <CardContent className="flex min-h-[380px] flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><CalendarCheck className="size-7" /></div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Belum ada reservasi</h2>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                Commitment yang dibuat dari Permintaan akan muncul di sini.
              </p>
            </div>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to={paths.permintaan}>Buka Permintaan <ArrowRightSmall /></Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {reservations.data.reservations.map((reservation, index) => (
              <Link key={reservation.reservasi_id} to={paths.reservasi + "/" + reservation.reservasi_id} className="block">
                <Card className="overflow-hidden border shadow-sm transition-all active:scale-[0.995]">
                  <CardContent className="p-3.5">
                    <div className="flex gap-3">
                      <ReservationItemVisual
                        variant={index % 4 === 0 ? "tent" : index % 4 === 1 ? "carrier" : index % 4 === 2 ? "stove" : "gear"}
                        compact
                        className={cn("shrink-0", cardArt(index))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reservasi</p>
                            <h2 className="mt-0.5 truncate text-sm font-bold">{reservation.nomor_reservasi}</h2>
                            <p className="truncate text-xs text-muted-foreground">{reservation.penyewa_nama ?? "Penyewa tidak ditemukan"}</p>
                          </div>
                          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ReservationStatusBadge status={reservation.status} />
                          <StockLockBadge status={reservation.stock_lock_status} />
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {formatReservationDate(reservation.mulai_reservasi)} – {formatReservationDate(reservation.selesai_reservasi)} · {reservation.detail_count} item
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="hidden overflow-hidden shadow-sm md:block">
            <CardHeader className="flex-row items-end justify-between border-b bg-muted/20 px-5 py-4">
              <div>
                <CardTitle className="text-base">Daftar Reservasi</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{reservations.data.total} reservasi · halaman {listFilters.page} dari {totalPages}</p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-left">
                    <tr>
                      <th className="px-5 py-3 font-medium">Nomor Reservasi</th>
                      <th className="px-5 py-3 font-medium">Penyewa</th>
                      <th className="px-5 py-3 font-medium">Periode</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Stock Lock</th>
                      <th className="px-5 py-3 text-right font-medium">Buka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.data.reservations.map((reservation) => (
                      <tr key={reservation.reservasi_id} className="border-b last:border-0 transition-colors hover:bg-muted/20">
                        <td className="px-5 py-4">
                          <Link className="font-semibold hover:text-primary hover:underline" to={paths.reservasi + "/" + reservation.reservasi_id}>
                            {reservation.nomor_reservasi}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted-foreground">{reservation.detail_count} line barang</p>
                        </td>
                        <td className="px-5 py-4">{reservation.penyewa_nama ?? "-"}</td>
                        <td className="px-5 py-4">{formatReservationDate(reservation.mulai_reservasi)} – {formatReservationDate(reservation.selesai_reservasi)}</td>
                        <td className="px-5 py-4"><ReservationStatusBadge status={reservation.status} /></td>
                        <td className="px-5 py-4"><StockLockBadge status={reservation.stock_lock_status} /></td>
                        <td className="px-5 py-4 text-right"><Button asChild variant="ghost" size="sm"><Link to={paths.reservasi + "/" + reservation.reservasi_id}>Detail <ChevronRight className="size-4" /></Link></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted-foreground">{reservations.data.total} reservasi · halaman {listFilters.page} dari {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={listFilters.page <= 1} onClick={() => setListFilters((current) => ({ ...current, page: current.page - 1 }))}>Sebelumnya</Button>
              <Button variant="outline" disabled={listFilters.page >= totalPages} onClick={() => setListFilters((current) => ({ ...current, page: current.page + 1 }))}>Berikutnya</Button>
            </div>
          </div>
        </>
      )}

      <Alert className="border-primary/10 bg-primary/[0.03]">
        <AlertTitle>{capabilities.mutation ? "Otoritas transaksi aktif" : "Mode baca"}</AlertTitle>
        <AlertDescription>{capabilities.reason}</AlertDescription>
      </Alert>
    </div>
  );
}

function ArrowRightSmall() {
  return <span aria-hidden="true">→</span>;
}

function formatReservationDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

ReservationList.displayName = "ReservationList";
