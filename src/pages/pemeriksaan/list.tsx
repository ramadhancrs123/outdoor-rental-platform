import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Filter, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getPemeriksaanContext, listInspectionQueue } from "@/features/pemeriksaan";
import { formatInspectionDateTime, semanticInspectionLabel } from "@/features/pemeriksaan/utils";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Daftar pemeriksaan gagal dimuat.";
}
function stateLabel(state: string) {
  if (state === "waiting") return "Menunggu Pemeriksaan";
  if (state === "in_progress") return "Pemeriksaan Berjalan";
  if (state === "completed") return "Pemeriksaan Selesai";
  return semanticInspectionLabel(state);
}
function resultLabel(value: string | null) {
  if (value === "normal") return "Normal";
  if (value === "issue_found") return "Ada Temuan";
  return "Belum Ada";
}

export function InspectionList() {
  const [searchParams] = useSearchParams();
  const unitFilter = searchParams.get("unit_id")?.trim() ?? "";
  const [search, setSearch] = useState(unitFilter);
  const [activeState, setActiveState] = useState<"all" | "waiting" | "in_progress" | "completed">("all");

  const context = useQuery({
    queryKey: ["pemeriksaan", "context"],
    queryFn: getPemeriksaanContext,
    staleTime: 60_000,
  });
  const queue = useQuery({
    queryKey: ["pemeriksaan", "queue", context.data?.usahaId, search],
    queryFn: () => listInspectionQueue(context.data!.usahaId, search),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (unitFilter) setSearch(unitFilter);
  }, [unitFilter]);

  const rows = useMemo(
    () => activeState === "all" ? (queue.data ?? []) : (queue.data ?? []).filter((item) => item.inspection_state === activeState),
    [activeState, queue.data],
  );

  if (context.isPending) {
    return <div className="space-y-4"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div></div>;
  }
  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pemeriksaan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4 pb-28 sm:space-y-5 lg:pb-10">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Pemeriksaan</p>
          <h1 className="text-[28px] font-bold tracking-tight">Antrian Pemeriksaan</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Periksa kondisi unit yang benar-benar sudah diterima sebelum keputusan operasional berikutnya.</p>
        </div>
        <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">Usaha Aktif · {context.data.usahaNama}</Badge>
      </header>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="relative min-w-0 flex-1" htmlFor="inspection-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="inspection-search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void queue.refetch(); }} className="h-11 rounded-xl pl-9" placeholder="Cari kode unit, barang, nomor return, atau nama penyewa..." />
            </label>
            <Button type="button" className="h-11 rounded-xl lg:w-auto" onClick={() => void queue.refetch()}><Search /> Cari</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><SlidersHorizontal className="size-4" aria-hidden="true" />Filter state</div>
            {([
              ["all", "Semua"],
              ["waiting", "Menunggu"],
              ["in_progress", "Dalam Proses"],
              ["completed", "Selesai"],
            ] as const).map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={activeState === value ? "default" : "outline"} className="rounded-xl" onClick={() => setActiveState(value)}>{label}</Button>
            ))}
            <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={() => { setSearch(""); setActiveState("all"); }}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      {queue.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Queue gagal dimuat</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{errorMessage(queue.error)}</span><Button variant="outline" size="sm" onClick={() => void queue.refetch()}><RefreshCw /> Coba lagi</Button></AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardCheck className="size-6" /></div>
            <p className="font-semibold">{activeState === "all" && !search ? "Tidak ada unit menunggu pemeriksaan" : "Tidak ada hasil sesuai filter"}</p>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">{activeState === "all" && !search ? "Unit yang benar-benar sudah diterima dan masuk konteks inspection_pending akan muncul di sini." : "Ubah kata pencarian atau filter state untuk melihat unit lain."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:hidden">
            {rows.map((item) => (
              <Link key={item.detail_pengembalian_id} to={paths.pemeriksaan + "/" + item.detail_pengembalian_id} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Card className="rounded-2xl shadow-sm transition-colors hover:bg-accent/25">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-base font-bold">{item.kode_unit}</p><p className="mt-1 text-sm text-muted-foreground">{item.barang_nama ?? "Barang tidak ditemukan"}</p><p className="text-xs text-muted-foreground">{item.varian_nama ?? "Tanpa varian"} · {item.nomor_pengembalian}</p></div>
                      <Badge variant={item.inspection_state === "completed" ? "outline" : "secondary"} className="shrink-0 rounded-full">{stateLabel(item.inspection_state)}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Penyewa</p><p className="mt-1 font-medium">{item.penyewa_nama ?? "-"}</p></div>
                      <div className="rounded-xl bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Diterima</p><p className="mt-1 font-medium">{formatInspectionDateTime(item.diterima_at)}</p></div>
                    </div>
                    <div className="flex flex-wrap gap-2"><Badge variant="outline" className="rounded-full">Hasil: {resultLabel(item.latest_hasil)}</Badge>{item.latest_keputusan_operasional ? <Badge variant="secondary" className="rounded-full">{semanticInspectionLabel(item.latest_keputusan_operasional)}</Badge> : null}</div>
                    <div className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{item.inspection_state === "in_progress" ? "Lanjutkan Pemeriksaan" : item.inspection_state === "completed" ? "Lihat Pemeriksaan" : "Periksa Unit"}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="hidden rounded-2xl shadow-sm lg:block">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">Daftar Pemeriksaan</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/35 text-left"><tr>
                    <th className="px-5 py-3 font-medium">No. Return</th><th className="px-5 py-3 font-medium">Kode Unit</th><th className="px-5 py-3 font-medium">Barang / Varian</th><th className="px-5 py-3 font-medium">Penyewa</th><th className="px-5 py-3 font-medium">Diterima</th><th className="px-5 py-3 font-medium">Hasil Terakhir</th><th className="px-5 py-3 font-medium">Keputusan</th><th className="px-5 py-3 font-medium">State</th><th className="px-5 py-3 text-right font-medium">Aksi</th>
                  </tr></thead>
                  <tbody>{rows.map((item) => <tr key={item.detail_pengembalian_id} className="border-b last:border-0">
                    <td className="px-5 py-4 font-medium">{item.nomor_pengembalian}</td>
                    <td className="px-5 py-4"><p className="font-semibold">{item.kode_unit}</p><p className="text-xs text-muted-foreground">Unit fisik</p></td>
                    <td className="px-5 py-4"><p className="font-medium">{item.barang_nama ?? "-"}</p><p className="text-xs text-muted-foreground">{item.varian_nama ?? "Tanpa varian"}</p></td>
                    <td className="px-5 py-4">{item.penyewa_nama ?? "-"}</td>
                    <td className="px-5 py-4 whitespace-nowrap">{formatInspectionDateTime(item.diterima_at)}</td>
                    <td className="px-5 py-4"><Badge variant="outline" className="rounded-full">{resultLabel(item.latest_hasil)}</Badge></td>
                    <td className="px-5 py-4">{item.latest_keputusan_operasional ? semanticInspectionLabel(item.latest_keputusan_operasional) : "-"}</td>
                    <td className="px-5 py-4"><Badge variant={item.inspection_state === "completed" ? "outline" : "secondary"} className="rounded-full">{stateLabel(item.inspection_state)}</Badge></td>
                    <td className="px-5 py-4 text-right"><Button asChild size="sm" className="rounded-xl"><Link to={paths.pemeriksaan + "/" + item.detail_pengembalian_id}>{item.inspection_state === "in_progress" ? "Lanjutkan" : item.inspection_state === "completed" ? "Lihat" : "Periksa"}</Link></Button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Menampilkan {rows.length} unit pemeriksaan</span><span className="hidden sm:inline-flex items-center gap-1"><Filter className="size-3.5" /> State tidak mengubah ownership domain.</span></div>
    </div>
  );
}
