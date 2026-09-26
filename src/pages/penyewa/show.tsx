import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRenter, maskPhone, resolveTenantContext, type RenterDetail, type TenantContext } from "@/features/penyewa/service";
import { paths } from "@/routes/paths";

export function RenterShow() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [renter, setRenter] = useState<RenterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError("Identitas penyewa pada tautan tidak valid."); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const context = tenant ?? (await resolveTenantContext());
      setTenant(context); setRenter(await getRenter(context, id));
    } catch (cause) {
      setRenter(null); setError(cause instanceof Error ? cause.message : "Data gagal dimuat.");
    } finally { setLoading(false); }
  }, [id, tenant]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">Memuat detail penyewa…</CardContent></Card>;
  if (error || !renter) return <div className="space-y-4">
    <Button asChild variant="ghost" className="-ml-3"><Link to={paths.penyewa}><ArrowLeft />Kembali ke penyewa</Link></Button>
    <Alert variant="destructive"><AlertTitle>Detail tidak tersedia</AlertTitle><AlertDescription className="gap-3">
      <p>{error ?? "Penyewa tidak ditemukan atau Anda tidak memiliki akses."}</p>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Coba lagi</Button>
    </AlertDescription></Alert>
  </div>;

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div>
      <Button asChild variant="ghost" className="-ml-3 mb-1"><Link to={paths.penyewa}><ArrowLeft />Kembali</Link></Button>
      <p className="text-sm text-muted-foreground">Usaha: {tenant?.usahaNama}</p>
      <h1 className="text-2xl font-bold tracking-tight">{renter.nama_lengkap}</h1>
    </div><Badge variant="secondary">{renter.status}</Badge></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Kontak</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-xs text-muted-foreground">Nomor telepon</p><p className="mt-1 font-medium">{maskPhone(renter.nomor_telepon)}</p></div>
        <div><p className="text-xs text-muted-foreground">Alamat</p><p className="mt-1 font-medium">{renter.alamat || "-"}</p></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Media & identitas</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Media privat belum tersedia.</p><p>Upload dan signed URL belum menjadi capability yang terverifikasi.</p>
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Catatan akses</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
      Detail ini dibatasi oleh konteks usaha yang terotorisasi. Nomor identitas dan payload dokumen privat tidak dipresentasikan pada read-side.
    </CardContent></Card>
  </div>;
}
