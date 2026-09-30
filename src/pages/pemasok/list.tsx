import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Mail, Phone, Plus, RefreshCw, Search } from "lucide-react";
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
  listSuppliers,
  type SupplierListItem,
  supplierStatusLabel,
  supplierStatusVariant,
  formatProcurementDate,
} from "@/features/pemasok";
import { paths } from "@/routes/paths";

const PAGE_SIZE = DEFAULT_PURCHASE_LIST_FILTERS.pageSize;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data pemasok gagal dimuat.";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "PS";
}

export function SupplierList() {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const context = useQuery({
    queryKey: ["pemasok", "context"],
    queryFn: getPemasokContext,
    staleTime: 60_000,
  });

  const suppliers = useQuery({
    queryKey: ["pemasok", "suppliers", context.data?.usahaId, submittedSearch, page],
    queryFn: () => listSuppliers(context.data!.usahaId, submittedSearch, page, PAGE_SIZE),
    enabled: Boolean(context.data?.usahaId),
  });

  const visibleSuppliers = useMemo(
    () => (suppliers.data?.suppliers ?? []).filter((supplier) => statusFilter === "all" || supplier.status === statusFilter),
    [statusFilter, suppliers.data?.suppliers],
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((suppliers.data?.total ?? 0) / PAGE_SIZE)),
    [suppliers.data?.total],
  );

  if (context.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pemasok belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4 pb-24 lg:space-y-5 lg:pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Pemasok</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight">Pemasok</h1>
          <p className="mt-1 text-sm text-muted-foreground">Kelola data pemasok usaha Anda.</p>
        </div>
        <Button asChild className="h-10 shrink-0 rounded-xl px-3 sm:px-4">
          <Link to={paths.pemasok + "/create"}><Plus /> <span>Tambah Pemasok</span></Link>
        </Button>
      </header>

      <div className="flex flex-col gap-2">
        <label className="relative block" htmlFor="supplier-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="supplier-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setSubmittedSearch(search); } }}
            placeholder="Cari nama, telepon, atau email..."
            className="h-11 rounded-xl pl-9"
            autoComplete="off"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter status pemasok">
          {[
            ["all", "Semua"],
            ["active", "Aktif"],
            ["inactive", "Tidak Aktif"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={statusFilter === value}
              onClick={() => setStatusFilter(value as typeof statusFilter)}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                statusFilter === value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {suppliers.isPending ? (
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : suppliers.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data pemasok belum dapat ditampilkan</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage(suppliers.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void suppliers.refetch()}><RefreshCw />Coba lagi</Button>
          </AlertDescription>
        </Alert>
      ) : visibleSuppliers.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="size-7" /></div>
            <div>
              <h2 className="font-semibold">{statusFilter === "all" ? "Belum ada pemasok" : "Tidak ada pemasok pada filter ini"}</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Mulai dari satu data pemasok, lalu gunakan detail untuk melihat riwayat pembelian.</p>
            </div>
            <Button asChild className="rounded-xl"><Link to={paths.pemasok + "/create"}><Plus />Tambah Pemasok</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {visibleSuppliers.map((supplier: SupplierListItem) => (
              <Link key={supplier.pemasok_id} to={paths.pemasok + "/" + supplier.pemasok_id} className="block">
                <Card className="rounded-2xl shadow-sm transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">{initials(supplier.nama)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="truncate font-semibold">{supplier.nama}</h2>
                          <Badge variant={supplierStatusVariant(supplier.status)} className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">{supplierStatusLabel(supplier.status)}</Badge>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          <p className="flex items-center gap-2"><Phone className="size-3.5" />{supplier.nomor_telepon ?? "Nomor telepon tidak dicatat"}</p>
                          <p className="flex items-center gap-2"><Mail className="size-3.5" />{supplier.email ?? "Email tidak dicatat"}</p>
                        </div>
                      </div>
                    </div>
                    <div className="border-t pt-3 text-xs text-muted-foreground">
                      <span>{supplier.purchase_count} pembelian</span>
                      <span className="mx-2">•</span>
                      <span>Terakhir {formatProcurementDate(supplier.last_purchase_at)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/35 text-left">
                <tr><th className="px-5 py-3 font-medium">Pemasok</th><th className="px-5 py-3 font-medium">Kontak</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Pembelian</th><th className="px-5 py-3 font-medium">Terakhir</th><th className="px-5 py-3 text-right font-medium">Aksi</th></tr>
              </thead>
              <tbody>
                {visibleSuppliers.map((supplier) => (
                  <tr key={supplier.pemasok_id} className="border-b last:border-0">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-muted text-xs font-bold">{initials(supplier.nama)}</div><div><p className="font-semibold">{supplier.nama}</p><p className="text-xs text-muted-foreground">{supplier.email ?? "-"}</p></div></div></td>
                    <td className="px-5 py-4">{supplier.nomor_telepon ?? "-"}</td>
                    <td className="px-5 py-4"><Badge variant={supplierStatusVariant(supplier.status)} className="rounded-full">{supplierStatusLabel(supplier.status)}</Badge></td>
                    <td className="px-5 py-4">{supplier.purchase_count}</td>
                    <td className="px-5 py-4">{formatProcurementDate(supplier.last_purchase_at)}</td>
                    <td className="px-5 py-4 text-right"><Button asChild size="sm" variant="outline" className="rounded-xl"><Link to={paths.pemasok + "/" + supplier.pemasok_id}><ChevronRight />Buka</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hidden flex-col gap-2 border-t pt-3 text-sm sm:flex md:flex-row md:items-center md:justify-between">
            <span className="text-muted-foreground">{suppliers.data?.total ?? visibleSuppliers.length} pemasok · Halaman {page} dari {totalPages}</span>
            <div className="flex gap-2"><Button variant="outline" className="rounded-xl" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Sebelumnya</Button><Button variant="outline" className="rounded-xl" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Berikutnya</Button></div>
          </div>
        </>
      )}
    </div>
  );
}
