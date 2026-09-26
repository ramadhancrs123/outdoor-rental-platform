import { RefreshCw, Search, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listRenters, maskPhone, resolveTenantContext, type RenterListItem, type TenantContext } from "@/features/penyewa/service";
import { paths } from "@/routes/paths";

export function RenterList() {
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [renters, setRenters] = useState<RenterListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const context = tenant ?? (await resolveTenantContext());
      setTenant(context);
      setRenters(await listRenters(context, search));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data gagal dimuat.");
    } finally { setLoading(false); }
  }, [search, tenant]);

  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-5">
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">Penyewa</p>
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Daftar Penyewa</h1>
          <p className="text-sm text-muted-foreground">Identitas penyewa dalam konteks usaha yang sedang terotorisasi.</p>
        </div>
        {tenant && <Badge variant="secondary" className="w-fit">Usaha: {tenant.usahaNama}</Badge>}
      </div>
    </header>
    <Card><CardHeader className="pb-4"><CardTitle className="text-base">Cari penyewa</CardTitle></CardHeader>
      <CardContent><div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="renter-search">Cari berdasarkan nama atau nomor telepon</label>
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="renter-search" value={search} onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void load(); }}
            placeholder="Nama atau nomor telepon" className="pl-9" autoComplete="off" />
        </div>
        <Button onClick={() => void load()} disabled={loading}><Search />Cari</Button>
      </div></CardContent>
    </Card>
    {error && <Alert variant="destructive"><AlertTitle>Data belum dapat ditampilkan</AlertTitle>
      <AlertDescription className="gap-3"><p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Coba lagi</Button>
      </AlertDescription>
    </Alert>}
    {loading && !error && <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">Memuat data penyewa…</CardContent></Card>}
    {!loading && !error && renters.length === 0 && <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-2 text-center">
      <Users className="size-8 text-muted-foreground" /><h2 className="font-semibold">Belum ada penyewa</h2>
      <p className="max-w-md text-sm text-muted-foreground">Tidak ada penyewa yang cocok dengan pencarian dalam usaha ini.</p>
    </CardContent></Card>}
    {!loading && !error && renters.length > 0 && <>
      <div className="grid gap-3 md:hidden">{renters.map((renter) =>
        <Link key={renter.penyewa_id} to={`${paths.penyewa}/${renter.penyewa_id}`}>
          <Card className="transition-colors hover:bg-accent/40"><CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{renter.nama_lengkap}</h2>
              <p className="text-sm text-muted-foreground">{maskPhone(renter.nomor_telepon)}</p></div>
              <Badge variant="secondary">{renter.status}</Badge></div>
          </CardContent></Card>
        </Link>
      )}</div>
      <Card className="hidden md:block"><CardContent className="p-0"><div className="overflow-x-auto">
        <table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left"><tr>
          <th className="px-6 py-3 font-medium">Nama</th><th className="px-6 py-3 font-medium">Kontak</th>
          <th className="px-6 py-3 font-medium">Status</th>
        </tr></thead><tbody>{renters.map((renter) => <tr key={renter.penyewa_id} className="border-b last:border-0">
          <td className="px-6 py-4 font-medium"><Link className="hover:underline" to={`${paths.penyewa}/${renter.penyewa_id}`}>{renter.nama_lengkap}</Link></td>
          <td className="px-6 py-4">{maskPhone(renter.nomor_telepon)}</td><td className="px-6 py-4"><Badge variant="secondary">{renter.status}</Badge></td>
        </tr>)}</tbody></table>
      </div></CardContent></Card>
    </>}
  </div>;
}
