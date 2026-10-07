import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Edit3, Info, MoreVertical, Phone, Mail, MapPin, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  getPemasokContext,
  getProcurementCapabilities,
  getSupplier,
  listSupplierPurchases,
  setSupplierStatus,
} from "@/features/pemasok";
import {
  formatProcurementDate,
  formatPurchaseMoney,
  purchaseStatusLabel,
  purchaseStatusVariant,
  supplierStatusLabel,
  supplierStatusVariant,
} from "@/features/pemasok";
import { paths } from "@/routes/paths";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "PS";
}

export function SupplierShow() {
  const { id } = useParams<{ id: string }>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const context = useQuery({ queryKey: ["pemasok", "context"], queryFn: getPemasokContext, staleTime: 60_000 });
  const supplier = useQuery({
    queryKey: ["pemasok", "detail", context.data?.usahaId, id],
    queryFn: () => getSupplier(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    retry: false,
  });
  const purchases = useQuery({
    queryKey: ["pemasok", "purchase-history", context.data?.usahaId, id],
    queryFn: () => listSupplierPurchases(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });
  const statusMutation = useMutation({
    mutationFn: async (nextStatus: "active" | "inactive") => {
      if (!context.data || !supplier.data || !id) throw new Error("Konteks pemasok belum siap.");
      return setSupplierStatus(
        context.data.usahaId,
        id,
        nextStatus,
        supplier.data.updated_at,
        { idempotencyKey: createClientId(), requestId: createClientId() },
      );
    },
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["pemasok"] });
    },
  });

  if (context.isPending || supplier.isPending || purchases.isPending) {
    return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-56 animate-pulse rounded-2xl bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div>;
  }

  if (context.error || supplier.error || purchases.error || !supplier.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="icon" className="rounded-xl"><Link to={paths.pemasok} aria-label="Kembali ke pemasok"><ArrowLeft /></Link></Button>
        <Alert variant="destructive"><AlertTitle>Detail pemasok tidak tersedia</AlertTitle><AlertDescription>{context.error?.message ?? supplier.error?.message ?? purchases.error?.message ?? "Pemasok tidak ditemukan atau Anda tidak memiliki akses."}</AlertDescription></Alert>
      </div>
    );
  }

  const supplierData = supplier.data;
  const capabilities = getProcurementCapabilities();
  const isActive = supplierData.status === "active";

  return (
    <div className="space-y-4 pb-24 lg:space-y-5 lg:pb-10">
      <header className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke pemasok"><Link to={paths.pemasok}><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Pemasok</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight">{supplierData.nama}</h1>
            <Badge variant={supplierStatusVariant(supplierData.status)} className="rounded-full">{supplierStatusLabel(supplierData.status)}</Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Menu pemasok"><MoreVertical /></Button>
      </header>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid size-14 place-items-center rounded-full bg-muted text-base font-bold text-muted-foreground">{initials(supplierData.nama)}</div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{supplierData.nama}</p>
            <p className="mt-1 text-xs text-muted-foreground">{isActive ? "Dapat dipilih untuk pembelian baru." : "Tidak tersedia untuk pembelian baru."}</p>
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-xl"><Link to={paths.pemasok + "/" + supplierData.pemasok_id + "/edit"}><Edit3 />Ubah</Link></Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="info" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 rounded-xl">
          <TabsTrigger value="info">Informasi</TabsTrigger>
          <TabsTrigger value="history">Riwayat Pembelian</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-3">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Informasi Pemasok</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <InfoRow icon={<Phone className="size-4" />} label="Telepon" value={supplierData.nomor_telepon ?? "-"} />
              <InfoRow icon={<Mail className="size-4" />} label="Email" value={supplierData.email ?? "-"} />
              <InfoRow icon={<MapPin className="size-4" />} label="Alamat" value={supplierData.alamat ?? "-"} />
              <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Catatan</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{supplierData.catatan ?? "Tidak ada catatan."}</p></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-primary/15 bg-primary/[0.025]">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3"><Info className="mt-0.5 size-4 text-primary" /><div><p className="font-semibold">Status pemasok</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{isActive ? "Pemasok aktif dan dapat digunakan pada pembelian baru." : "Pemasok tidak aktif dan tetap tersimpan pada riwayat."}</p></div></div>
              <Button
                className="h-11 w-full rounded-xl"
                variant={isActive ? "outline" : "default"}
                disabled={!capabilities.mutation || statusMutation.isPending}
                onClick={() => isActive ? setConfirmOpen(true) : statusMutation.mutate("active")}
              >
                {statusMutation.isPending ? "Menyimpan..." : isActive ? "Nonaktifkan Pemasok" : "Aktifkan Pemasok"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Riwayat Pembelian</CardTitle><p className="text-sm text-muted-foreground">Riwayat tetap tersedia meskipun pemasok menjadi tidak aktif.</p></CardHeader>
            <CardContent className="space-y-2">
              {(purchases.data ?? []).length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><ShoppingBag className="size-8 text-muted-foreground" /><p className="font-semibold">Belum ada pembelian</p><p className="text-sm text-muted-foreground">Belum ada draft/pembelian tercatat untuk pemasok ini.</p></div>
              ) : (purchases.data ?? []).map((purchase) => (
                <Link key={purchase.pembelian_id} to={paths.pembelian + "/" + purchase.pembelian_id} className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/30">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><ShoppingBag className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{purchase.nomor_pembelian}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatProcurementDate(purchase.tanggal_pembelian)} · {purchase.line_count} item</p>
                    <p className="mt-1 text-sm font-semibold">{formatPurchaseMoney(purchase.total_amount, purchase.currency_code)}</p>
                  </div>
                  <div className="flex items-center gap-2"><Badge variant={purchaseStatusVariant()} className="rounded-full">{purchaseStatusLabel(purchase.status)}</Badge><ChevronRight className="size-4 text-muted-foreground" /></div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {statusMutation.error ? <Alert variant="destructive"><AlertTitle>Status pemasok belum berubah</AlertTitle><AlertDescription>{statusMutation.error instanceof Error ? statusMutation.error.message : "Perubahan status pemasok gagal."}</AlertDescription></Alert> : null}
      <Alert><Info /><AlertTitle>Kontrak Pemasok</AlertTitle><AlertDescription>Pemasok adalah data pihak penyedia. Pemasok bukan sumber pembayaran, penerimaan barang, unit fisik, penyewaan, atau ketersediaan.</AlertDescription></Alert>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Nonaktifkan Pemasok?</DialogTitle>
            <DialogDescription>Pemasok ini tidak akan tersedia untuk pembelian baru. Riwayat pembelian tetap dipertahankan.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full rounded-xl sm:w-auto" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button variant="destructive" className="w-full rounded-xl sm:w-auto" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("inactive")}>{statusMutation.isPending ? "Menyimpan..." : "Nonaktifkan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3 border-b pb-3 last:border-0 last:pb-0"><div className="mt-0.5 text-muted-foreground">{icon}</div><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div></div>;
}
