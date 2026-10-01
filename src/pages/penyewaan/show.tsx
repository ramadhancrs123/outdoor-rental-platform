import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { ToleranceExtensionDialog } from "@/components/penyewaan/tolerance-extension-dialog";
import { getPenyewaanContext, getRentalCapabilities, getRental, listRentalToleranceHistory } from "@/features/penyewaan";
import { formatRentalDateTime, formatRentalMoney, semanticRentalLabel, rentalStatusVariant } from "@/features/penyewaan";
import { paths } from "@/routes/paths";
import { RentalPhase2Actions } from "./phase2-actions";

export function RentalShow() {
  const { id } = useParams<{ id: string }>();
  const context = useQuery({ queryKey: ["penyewaan", "context"], queryFn: getPenyewaanContext, staleTime: 60_000 });
  const query = useQuery({ queryKey: ["penyewaan", "detail", context.data?.usahaId, id], queryFn: () => getRental(context.data!.usahaId, id!), enabled: Boolean(context.data?.usahaId && id) });
  const toleranceHistory = useQuery({
    queryKey: ["penyewaan", "tolerance-history", context.data?.usahaId, id],
    queryFn: () => listRentalToleranceHistory(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });
  if (context.isPending || query.isPending) return <Card><CardContent className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">Memuat detail penyewaan…</CardContent></Card>;
  if (context.error || query.error || !query.data) return <Alert variant="destructive"><AlertTitle>Detail penyewaan tidak tersedia</AlertTitle><AlertDescription className="gap-3"><p>{context.error?.message ?? query.error?.message ?? "Penyewaan tidak ditemukan atau Anda tidak memiliki akses."}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>;
  const item=query.data; const capabilities=getRentalCapabilities();
  return <div className="space-y-5 pb-10">
    <Button asChild variant="ghost" className="-ml-3"><Link to={paths.penyewaan}><ArrowLeft />Kembali ke penyewaan</Link></Button>
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="text-sm text-muted-foreground">Usaha: {context.data.usahaNama}</p><h1 className="text-2xl font-bold">{item.nomor_penyewaan}</h1><p className="mt-1 text-sm text-muted-foreground">{item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p></div><Badge variant={rentalStatusVariant()}>{semanticRentalLabel(item.status)}</Badge></header>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <RentalTimingSummary
          scheduleAt={item.jadwal_kembali}
          toleranceDeadline={item.tolerance_deadline}
          actualReturnAt={item.actual_return_completed_at}
          lateFeeEnabled={context.data.lateFeeEnabled}
          lateFeePerHour={context.data.lateFeePerHour}
        />
        {item.status === "active" || item.status === "return_in_progress" ? (
          <div className="flex flex-wrap gap-2">
            <ToleranceExtensionDialog
              usahaId={context.data.usahaId}
              penyewaanId={item.penyewaan_id}
              currentDeadline={item.tolerance_deadline}
              history={toleranceHistory.data ?? []}
              onSaved={async () => {
                await Promise.all([query.refetch(), toleranceHistory.refetch()]);
              }}
            />
          </div>
        ) : null}
      </div><Card><CardHeader><CardTitle className="text-base">Alur Penyewaan</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Jadwal mulai</p><p className="mt-1 font-medium">{formatRentalDateTime(item.jadwal_mulai)}</p></div><div><p className="text-xs text-muted-foreground">Jadwal kembali</p><p className="mt-1 font-medium">{formatRentalDateTime(item.jadwal_kembali)}</p></div><div><p className="text-xs text-muted-foreground">Batas toleransi</p><p className="mt-1 font-medium">{formatRentalDateTime(item.tolerance_deadline)}</p></div><div><p className="text-xs text-muted-foreground">Pengambilan Aktual</p><p className="mt-1 font-medium">{formatRentalDateTime(item.actual_pickup_at)}</p></div><div><p className="text-xs text-muted-foreground">Pengembalian Dimulai</p><p className="mt-1 font-medium">{formatRentalDateTime(item.actual_return_started_at)}</p></div><div><p className="text-xs text-muted-foreground">Pengembalian Selesai</p><p className="mt-1 font-medium">{formatRentalDateTime(item.actual_return_completed_at)}</p></div></CardContent></Card></div><div><Card><CardHeader><CardTitle className="text-base">Nilai transaksi</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Total snapshot</p><p className="mt-1 text-2xl font-bold">{formatRentalMoney(item.total_amount,item.currency_code)}</p><p className="mt-2 text-xs text-muted-foreground">Pembayaran tetap dikelola oleh Keuangan.</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-base">Detail Penyewaan</CardTitle></CardHeader><CardContent>{item.lines.length===0 ? <p className="text-sm text-muted-foreground">Belum ada detail penyewaan.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left"><tr><th className="px-4 py-3 font-medium">Target</th><th className="px-4 py-3 font-medium">Jumlah</th><th className="px-4 py-3 font-medium">Harga/unit</th><th className="px-4 py-3 font-medium">Subtotal</th></tr></thead><tbody>{item.lines.map((line)=> <tr key={line.detail_penyewaan_id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{line.barang_nama ?? line.varian_nama ?? line.paket_nama ?? "Target tidak ditemukan"}</td><td className="px-4 py-3">{line.jumlah}</td><td className="px-4 py-3">{formatRentalMoney(line.unit_price,line.currency_code)}</td><td className="px-4 py-3">{formatRentalMoney(line.subtotal,line.currency_code)}</td></tr>)}</tbody></table></div>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Penetapan unit</CardTitle><p className="text-sm text-muted-foreground">Penetapan Unit adalah fakta transaksi; kondisi fisik tetap dikelola oleh Inventaris.</p></CardHeader><CardContent>{item.assignments.length===0 ? <p className="text-sm text-muted-foreground">Belum ada unit yang ditetapkan.</p> : <div className="space-y-3">{item.assignments.map((assignment)=><div key={assignment.penetapan_unit_id} className="rounded-lg border p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{assignment.kode_unit ?? "Unit tidak ditemukan"}</p><p className="text-xs text-muted-foreground">{semanticRentalLabel(assignment.status)} · {formatRentalDateTime(assignment.ditetapkan_at)}</p></div>{assignment.dibatalkan_at && <Badge variant="outline">Dibatalkan {formatRentalDateTime(assignment.dibatalkan_at)}</Badge>}</div>{assignment.alasan_substitusi && <p className="mt-2 text-sm text-muted-foreground">Substitusi: {assignment.alasan_substitusi}</p>}</div>)}</div>}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Serah-terima</CardTitle></CardHeader><CardContent>{item.handover ? <div className="space-y-2 text-sm"><p>Status: <span className="font-medium">{semanticRentalLabel(item.handover.status)}</span></p><p>Waktu: <span className="font-medium">{formatRentalDateTime(item.handover.serah_terima_at)}</span></p><p>Admin: <span className="font-mono text-xs">{item.handover.actor_admin_id}</span></p><p>{item.handover.catatan ?? "Tidak ada catatan."}</p></div> : <p className="text-sm text-muted-foreground">Belum ada serah-terima.</p>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Perpanjangan</CardTitle></CardHeader><CardContent>{item.extensions.length===0 ? <p className="text-sm text-muted-foreground">Belum ada permintaan perpanjangan.</p> : <div className="space-y-3">{item.extensions.map((extension)=><div key={extension.perpanjangan_sewa_id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium">{semanticRentalLabel(extension.status)}</p><Badge variant="outline">{extension.tambahan_amount == null ? "-" : formatRentalMoney(extension.tambahan_amount, extension.currency_code)}</Badge></div><p className="mt-1 text-sm">{formatRentalDateTime(extension.jadwal_kembali_sebelum)} → {formatRentalDateTime(extension.jadwal_kembali_sesudah)}</p><p className="mt-1 text-xs text-muted-foreground">{extension.alasan ?? "Tidak ada alasan."}</p></div>)}</div>}</CardContent></Card></div>
    <Alert><AlertTitle>Trusted transaction aktif</AlertTitle><AlertDescription>{capabilities.reason}</AlertDescription></Alert>
    <RentalPhase2Actions
      context={{ ...context.data, timezone: context.data.timezone }}
      rental={item}
      onChanged={async () => { await query.refetch(); }}
    />
  </div>;
}
