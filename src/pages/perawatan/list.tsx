import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Filter, Plus, RefreshCw, Search, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPerawatanContext,
  listMaintenanceQueue,
} from "@/features/perawatan";
import { formatMaintenanceDateTime, semanticMaintenanceLabel } from "@/features/perawatan/utils";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data perawatan tidak tersedia.";
}

function sourceLabel(pemeriksaanId: string | null) {
  return pemeriksaanId ? "Pemeriksaan" : "Manual";
}

export function PerawatanList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const context = useQuery({
    queryKey: ["perawatan", "context"],
    queryFn: getPerawatanContext,
    staleTime: 60_000,
  });

  const queue = useQuery({
    queryKey: ["perawatan", "queue", context.data?.usahaId, status, search],
    queryFn: () => listMaintenanceQueue(context.data!.usahaId, { status, search }),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  const summary = useMemo(() => {
    const rows = queue.data ?? [];
    return {
      total: rows.length,
      planned: rows.filter((item) => item.status === "planned").length,
      inProgress: rows.filter((item) => item.status === "in_progress").length,
      completed: rows.filter((item) => item.status === "completed").length,
    };
  }, [queue.data]);

  if (context.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Perawatan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4 pb-28 lg:space-y-5 lg:pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Perawatan</p>
          <h1 className="text-[28px] font-bold tracking-tight">Perawatan</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Kelola pekerjaan unit dan pantau progresnya.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1">Usaha Aktif · {context.data.usahaNama}</Badge>
          <Button asChild className="rounded-xl"><Link to={paths.perawatan + "/create"}><Plus />Buat Perawatan</Link></Button>
        </div>
      </header>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="relative min-w-0 flex-1" htmlFor="maintenance-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="maintenance-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kode unit, barang, nomor pemeriksaan, pelaksana, atau deskripsi pekerjaan..." className="h-11 rounded-xl pl-9" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select className="h-10 rounded-xl border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status perawatan">
              <option value="all">Semua Status</option>
              <option value="planned">Direncanakan</option>
              <option value="in_progress">Berjalan</option>
              <option value="completed">Selesai</option>
              <option value="cancelled">Dibatalkan</option>
            </select>
            <select className="h-10 rounded-xl border bg-background px-3 text-sm" aria-label="Filter jenis perawatan">
              <option>Semua Jenis</option>
              <option>Repair</option>
              <option>Cleaning</option>
              <option>Replacement</option>
            </select>
            <select className="h-10 rounded-xl border bg-background px-3 text-sm" aria-label="Filter sumber">
              <option>Semua Sumber</option>
              <option>Pemeriksaan</option>
              <option>Manual</option>
            </select>
            <Button type="button" variant="outline" size="sm" className="rounded-xl"><CalendarDays />Tanggal Dibuat</Button>
            <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => { setSearch(""); setStatus("all"); }}><Filter />Reset</Button>
          </div>
        </CardContent>
      </Card>

      {queue.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Queue gagal dimuat</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{errorMessage(queue.error)}</span><Button variant="outline" size="sm" onClick={() => void queue.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Wrench className="size-6" /></div>
            <p className="font-semibold">Tidak ada pekerjaan yang cocok</p>
            <p className="max-w-lg text-sm leading-6 text-muted-foreground">Gunakan Buat Perawatan untuk maintenance manual, atau mulai dari hasil Pemeriksaan yang memerlukan maintenance.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:hidden">
            {queue.data.map((item) => (
              <Link key={item.perawatan_id} to={paths.perawatan + "/" + item.perawatan_id} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Card className="rounded-2xl shadow-sm transition-colors hover:bg-accent/25">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold">{item.kode_unit}</p>
                        <p className="text-sm text-muted-foreground">{item.barang_nama ?? "Barang tidak ditemukan"}</p>
                        <p className="text-xs text-muted-foreground">{sourceLabel(item.pemeriksaan_id)}</p>
                      </div>
                      <Badge variant={item.status === "completed" ? "outline" : "secondary"} className="shrink-0 rounded-full">{semanticMaintenanceLabel(item.status)}</Badge>
                    </div>
                    <div>
                      <p className="font-medium">{semanticMaintenanceLabel(item.jenis_perawatan)}</p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.deskripsi_pekerjaan}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Pelaksana</p><p className="mt-1 font-medium">{item.pelaksana ?? "-"}</p></div>
                      <div className="rounded-xl bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Biaya</p><p className="mt-1 font-medium">{item.biaya == null ? "-" : `Rp ${new Intl.NumberFormat("id-ID").format(Number(item.biaya))}`}</p></div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{formatMaintenanceDateTime(item.created_at)}</span><span className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-primary-foreground font-semibold">Buka</span></div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="hidden rounded-2xl shadow-sm lg:block">
            <CardHeader className="border-b py-4"><div className="flex items-center justify-between"><CardTitle className="text-base">Daftar Perawatan</CardTitle><span className="text-xs text-muted-foreground">Menampilkan 1–{queue.data.length} dari {queue.data.length} perawatan</span></div></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/35 text-left">
                    <tr>
                      <th className="px-5 py-3 font-medium">No. Perawatan</th>
                      <th className="px-5 py-3 font-medium">Unit</th>
                      <th className="px-5 py-3 font-medium">Jenis Perawatan</th>
                      <th className="px-5 py-3 font-medium">Sumber</th>
                      <th className="px-5 py-3 font-medium">Pelaksana</th>
                      <th className="px-5 py-3 font-medium">Biaya</th>
                      <th className="px-5 py-3 font-medium">Dibuat</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.data.map((item) => (
                      <tr key={item.perawatan_id} className="border-b last:border-0">
                        <td className="px-5 py-4 font-medium">{item.perawatan_id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-5 py-4"><p className="font-semibold">{item.kode_unit}</p><p className="text-xs text-muted-foreground">{item.barang_nama ?? "-"}</p></td>
                        <td className="px-5 py-4"><p>{semanticMaintenanceLabel(item.jenis_perawatan)}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{item.deskripsi_pekerjaan}</p></td>
                        <td className="px-5 py-4 text-xs">{sourceLabel(item.pemeriksaan_id)}</td>
                        <td className="px-5 py-4">{item.pelaksana ?? "-"}</td>
                        <td className="px-5 py-4">{item.biaya == null ? "-" : `Rp ${new Intl.NumberFormat("id-ID").format(Number(item.biaya))}`}</td>
                        <td className="px-5 py-4 whitespace-nowrap">{formatMaintenanceDateTime(item.created_at)}</td>
                        <td className="px-5 py-4"><Badge variant={item.status === "completed" ? "outline" : "secondary"} className="rounded-full">{semanticMaintenanceLabel(item.status)}</Badge></td>
                        <td className="px-5 py-4 text-right"><Button asChild size="sm" className="rounded-xl"><Link to={paths.perawatan + "/" + item.perawatan_id}>{item.status === "in_progress" ? "Buka" : item.status === "completed" ? "Lihat" : "Buka"}</Link></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="hidden items-center justify-between text-xs text-muted-foreground lg:flex">
            <div>Menampilkan {queue.data.length} perawatan</div>
            <div className="flex items-center gap-3"><span>Direncanakan {summary.planned}</span><span>Berjalan {summary.inProgress}</span><span>Selesai {summary.completed}</span></div>
          </div>
        </>
      )}
    </div>
  );
}
