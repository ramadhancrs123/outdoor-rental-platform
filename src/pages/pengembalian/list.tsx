import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, QrCode, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ReturnDueBadge, ReturnQrDialog, ReturnQueueCard, ReturnProgress } from "@/components/pengembalian/return-ui";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import {
  DEFAULT_RETURN_LIST_FILTERS,
  formatReturnDateTime,
  getPengembalianContext,
  listReturnQueue,
  lookupReturnRentalByQr,
  type ReturnListFilters,
} from "@/features/pengembalian";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Daftar pengembalian gagal dimuat.";
}

export function ReturnList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<ReturnListFilters>(DEFAULT_RETURN_LIST_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMessage, setQrMessage] = useState("");
  const [qrMessageTone, setQrMessageTone] = useState<"info" | "error">("info");

  const context = useQuery({
    queryKey: ["pengembalian", "context"],
    queryFn: getPengembalianContext,
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ["pengembalian", "queue", context.data?.usahaId, filters],
    queryFn: () => listReturnQueue(context.data!.usahaId, filters),
    enabled: Boolean(context.data?.usahaId),
    placeholderData: (previous) => previous,
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((query.data?.total ?? 0) / filters.pageSize)),
    [filters.pageSize, query.data?.total],
  );

  useEffect(() => {
    if (searchParams.get("scan") !== "1") return;
    setQrOpen(true);
    setSearchParams((current) => {
      current.delete("scan");
      return current;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const setFilter = <K extends keyof ReturnListFilters>(key: K, value: ReturnListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  };

  const handleQrResolved = async (identifier: string) => {
    if (!context.data) return;
    setQrMessage("");
    try {
      const result = await lookupReturnRentalByQr(context.data.usahaId, identifier);
      if (result.rental_ids.length === 1) {
        setQrOpen(false);
        navigate(paths.pengembalian + "/" + result.rental_ids[0] + "?unit=" + encodeURIComponent(result.kode_unit));
        return;
      }
      if (result.rental_ids.length === 0) {
        setQrMessage("QR ditemukan tetapi unit tidak memiliki rental aktif yang dapat diproses.");
      } else {
        setQrMessage("QR terhubung ke lebih dari satu konteks rental. Buka rental secara manual untuk memastikan konteks yang benar.");
      }
      setQrMessageTone("error");
    } catch (error) {
      setQrMessage(errorMessage(error));
      setQrMessageTone("error");
    }
  };

  if (context.isPending) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4" aria-busy="true">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Pengembalian belum dapat dibuka</AlertTitle>
        <AlertDescription>{errorMessage(context.error)}</AlertDescription>
      </Alert>
    );
  }

  const returns = query.data?.returns ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-24 sm:space-y-5 md:pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Pengembalian</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Antrian Pengembalian</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Kelola penerimaan unit yang benar-benar kembali dari rental aktif. Pemeriksaan fisik tetap menjadi tahap berikutnya.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setQrOpen(true)}>
            <QrCode />
            Scan QR
          </Button>
          <Badge variant="secondary" className="h-10 rounded-xl px-3">{context.data.usahaNama}</Badge>
        </div>
      </header>

      {qrMessage ? (
        <Alert variant={qrMessageTone === "error" ? "destructive" : "default"}>
          <QrCode className="size-4" />
          <AlertTitle>Hasil QR</AlertTitle>
          <AlertDescription>{qrMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border/80 shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label className="sr-only" htmlFor="return-search">
                Nomor penyewaan, nama penyewa, nomor telepon, kode unit, atau serial
              </label>
              <Input
                id="return-search"
                value={filters.search}
                onChange={(event) => setFilter("search", event.target.value)}
                placeholder="Cari nomor penyewaan, nama penyewa, nomor telepon, atau kode unit…"
                className="h-11 rounded-xl pl-9"
                autoComplete="off"
              />
            </div>
            <Button type="button" className="h-11 rounded-xl lg:px-5">
              <Search />
              Cari
            </Button>
          </div>

          <div className="mt-3 hidden flex-wrap gap-2 lg:flex">
            <Select value={filters.rentalStatus ?? "all"} onValueChange={(value) => setFilter("rentalStatus", value as ReturnListFilters["rentalStatus"])}>
              <SelectTrigger className="h-10 w-auto min-w-40 rounded-xl" aria-label="Saring status penyewaan">
                <SelectValue placeholder="Semua status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="return_in_progress">Pengembalian sedang diproses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.dueState ?? "all"} onValueChange={(value) => setFilter("dueState", value as ReturnListFilters["dueState"])}>
              <SelectTrigger className="h-10 w-auto min-w-44 rounded-xl" aria-label="Filter due state">
                <SelectValue placeholder="Semua Batas Pengembalian" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Batas Pengembalian</SelectItem>
                <SelectItem value="not_due">Belum Jatuh Tempo</SelectItem>
                <SelectItem value="due">Sudah Jatuh Tempo</SelectItem>
                <SelectItem value="late_within_tolerance">Masih Dalam Toleransi</SelectItem>
                <SelectItem value="tolerance_expired">Toleransi Lewat</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setFilters(DEFAULT_RETURN_LIST_FILTERS)}>
              Reset
            </Button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {([
              ["all", "Semua"],
              ["not_due", "Belum jatuh tempo"],
              ["due", "Jatuh tempo"],
              ["late_within_tolerance", "Dalam toleransi"],
              ["tolerance_expired", "Toleransi lewat"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={(filters.dueState ?? "all") === value ? "default" : "outline"}
                className="h-9 shrink-0 rounded-full px-4"
                onClick={() => setFilter("dueState", value)}
              >
                {label}
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-4" onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal />
              Filter
            </Button>
          </div>
        </CardContent>
      </Card>

      {!query.isPending && !query.error && returns.length > 0 ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{query.data?.total ?? 0} penyewaan</span>
            <span aria-hidden="true">·</span>
            <span>Halaman {filters.page} dari {totalPages}</span>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {filters.dueState && filters.dueState !== "all" ? <ReturnDueBadge state={filters.dueState} /> : null}
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}
        </div>
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data pengembalian gagal dimuat</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{errorMessage(query.error)}</p>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void query.refetch()}>
              <RefreshCw />
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : returns.length === 0 ? (
        <Card className="overflow-hidden">
          <CardContent className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <CalendarClock className="size-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">
                {filters.search || filters.dueState !== "all" || filters.rentalStatus !== "all" ? "Tidak ada hasil yang sesuai" : "Tidak ada penyewaan dalam antrian pengembalian"}
              </h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {filters.search || filters.dueState !== "all" || filters.rentalStatus !== "all"
                  ? "Coba ubah pencarian atau reset filter untuk melihat rental yang tersedia."
                  : "Penyewaan aktif atau pengembalian sebagian akan muncul di sini."}
              </p>
            </div>
            {filters.search || filters.dueState !== "all" || filters.rentalStatus !== "all" ? (
              <Button variant="outline" className="rounded-xl" onClick={() => setFilters(DEFAULT_RETURN_LIST_FILTERS)}>Atur Ulang Saringan</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {returns.map((item) => (
              <ReturnQueueCard
                key={item.penyewaan_id}
                item={item}
                href={paths.pengembalian + "/" + item.penyewaan_id}
              />
            ))}
          </div>

          <Card className="hidden overflow-hidden border-border/80 shadow-sm md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-5 py-3 font-medium">No. Penyewaan</th>
                      <th className="px-5 py-3 font-medium">Penyewa</th>
                      <th className="px-5 py-3 font-medium">Kontak</th>
                      <th className="px-5 py-3 font-medium">Jadwal Kembali</th>
                      <th className="px-5 py-3 font-medium">Batas Toleransi</th>
                      <th className="px-5 py-3 font-medium">Progress</th>
                      <th className="px-5 py-3 font-medium">Status Penyewaan</th>
                      <th className="px-5 py-3 font-medium">Batas Pengembalian</th>
                      <th className="px-5 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.map((item) => (
                      <tr key={item.penyewaan_id} className="border-b last:border-0 hover:bg-accent/20">
                        <td className="px-5 py-4 font-semibold">
                          <Link to={paths.pengembalian + "/" + item.penyewaan_id} className="hover:underline">{item.nomor_penyewaan}</Link>
                        </td>
                        <td className="px-5 py-4">{item.penyewa_nama ?? "—"}</td>
                        <td className="px-5 py-4 text-muted-foreground">{item.penyewa_telepon ?? "—"}</td>
                        <td className="px-5 py-4">{formatReturnDateTime(item.jadwal_kembali)}</td>
                        <td className="px-5 py-4">{formatReturnDateTime(item.tolerance_deadline)}</td>
                        <td className="min-w-44 px-5 py-4">
                          <ReturnProgress returned={item.returned_unit_count} total={item.total_unit_count} outstanding={item.outstanding_unit_count} compact />
                        </td>
                        <td className="px-5 py-4"><Badge variant="secondary" className="rounded-full">{item.rental_status === "return_in_progress" ? "Pengembalian sedang diproses" : "Aktif"}</Badge></td>
                        <td className="px-5 py-4"><ReturnDueBadge state={item.due_state} /></td>
                        <td className="px-5 py-4 text-right">
                          <Button asChild size="sm" className="rounded-xl">
                            <Link to={paths.pengembalian + "/" + item.penyewaan_id}>Proses Pengembalian</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted-foreground">{query.data?.total ?? 0} penyewaan</span>
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 rounded-xl" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Sebelumnya</Button>
              <Button variant="outline" className="h-10 rounded-xl" disabled={filters.page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Berikutnya</Button>
            </div>
          </div>
        </>
      )}

      <div className="fixed inset-x-3 bottom-16 z-40 md:hidden">
        {returns.length ? (
          <div className="rounded-2xl border bg-background/95 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
            <Button asChild className="h-12 w-full rounded-xl">
              <Link to={paths.pengembalian + "/" + returns[0].penyewaan_id}>
                Proses Pengembalian
                <ArrowRight />
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Filter Pengembalian</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto px-5 pb-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status Penyewaan</label>
              <Select value={filters.rentalStatus ?? "all"} onValueChange={(value) => setFilter("rentalStatus", value as ReturnListFilters["rentalStatus"])}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua status</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="return_in_progress">Pengembalian sedang diproses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Batas Pengembalian</label>
              <Select value={filters.dueState ?? "all"} onValueChange={(value) => setFilter("dueState", value as ReturnListFilters["dueState"])}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua batas waktu</SelectItem>
                  <SelectItem value="not_due">Belum jatuh tempo</SelectItem>
                  <SelectItem value="due">Sudah jatuh tempo</SelectItem>
                  <SelectItem value="late_within_tolerance">Masih dalam toleransi</SelectItem>
                  <SelectItem value="tolerance_expired">Toleransi lewat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter className="border-t bg-background/95 px-5 py-4 backdrop-blur">
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => { setFilters(DEFAULT_RETURN_LIST_FILTERS); setFilterOpen(false); }}>Atur Ulang</Button>
            <Button type="button" className="h-11 rounded-xl" onClick={() => setFilterOpen(false)}>Terapkan</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ReturnQrDialog open={qrOpen} onOpenChange={setQrOpen} onResolved={(value) => void handleQrResolved(value)} />
    </div>
  );
}
