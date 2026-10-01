import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, RefreshCw, Warehouse, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createInventoryLocation,
  getInventarisContext,
  listInventoryLocations,
  updateInventoryLocation,
} from "@/features/inventaris";
import type { CreateInventoryLocationInput, InventoryLocation } from "@/features/inventaris/types";
import { paths } from "@/routes/paths";

const emptyForm: CreateInventoryLocationInput = {
  nama: "",
  tipe: "gudang",
  alamat: "",
  keterangan: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Lokasi gagal diproses.";
}

function typeLabel(value: string) {
  const labels: Record<string, string> = {
    gudang: "Gudang",
    pickup_point: "Pickup Point",
    kantor: "Kantor",
    maintenance: "Maintenance",
    lainnya: "Lainnya",
  };
  return labels[value] ?? value;
}

export function InventoryLocations() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateInventoryLocationInput>(emptyForm);
  const [status, setStatus] = useState<"active" | "inactive">("active");

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: getInventarisContext,
    staleTime: 60_000,
  });

  const locations = useQuery({
    queryKey: ["inventaris", "locations", context.data?.usahaId],
    queryFn: () => listInventoryLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!form.nama.trim()) throw new Error("Nama lokasi wajib diisi.");
      if (editingId) {
        const editingLocation = locations.data?.find((item) => item.lokasi_id === editingId);
        if (!editingLocation) throw new Error("Lokasi yang akan diperbarui tidak ditemukan pada data terbaru.");
        return updateInventoryLocation(
          context.data.usahaId,
          editingId,
          { ...form, status },
          { expectedUpdatedAt: editingLocation.updated_at },
        );
      }
      return createInventoryLocation(context.data.usahaId, form);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventaris", "locations"] });
      resetForm();
    },
  });

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setStatus("active");
  }

  function startEdit(location: InventoryLocation) {
    setEditingId(location.lokasi_id);
    setForm({
      nama: location.nama,
      tipe: location.tipe,
      alamat: location.alamat ?? "",
      keterangan: location.keterangan ?? "",
    });
    setStatus(location.status === "inactive" ? "inactive" : "active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (context.isPending) {
    return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-72 animate-pulse rounded-2xl bg-muted" /></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Master Lokasi belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  const rows = locations.data ?? [];
  const activeCount = rows.filter((item) => item.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-24 lg:space-y-5 lg:pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Inventaris · Master</p>
          <h1 className="text-2xl font-bold tracking-tight">Lokasi</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Tetapkan tempat fisik seperti gudang, pickup point, dan area maintenance. Lokasi adalah fakta tempat, bukan status unit.
          </p>
        </div>
        <Button asChild variant="outline" className="h-11 rounded-xl">
          <Link to={paths.inventaris}><MapPin />Kembali ke Inventaris</Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total lokasi</p><p className="mt-1 text-2xl font-bold">{rows.length}</p><p className="text-xs text-muted-foreground">dalam usaha aktif</p></CardContent></Card>
        <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Aktif</p><p className="mt-1 text-2xl font-bold">{activeCount}</p><p className="text-xs text-muted-foreground">dapat dipilih di Inventaris</p></CardContent></Card>
        <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Usaha</p><p className="mt-1 truncate text-base font-bold">{context.data.usahaNama}</p><p className="text-xs text-muted-foreground">tenant aktif</p></CardContent></Card>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Warehouse className="size-5" />{editingId ? "Ubah Lokasi" : "Tambah Lokasi"}</CardTitle>
          <p className="text-sm text-muted-foreground">{editingId ? "Perbarui metadata lokasi tanpa mengubah histori unit." : "Buat lokasi yang nantinya langsung tersedia pada pemilihan Lokasi awal di Inventaris."}</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">Nama Lokasi <span className="text-destructive">*</span>
            <Input value={form.nama} onChange={(event) => setForm((value) => ({ ...value, nama: event.target.value }))} placeholder="Gudang Utama" className="h-11 rounded-xl" autoComplete="off" />
          </label>
          <label className="grid gap-2 text-sm font-medium">Tipe
            <Select value={form.tipe} onValueChange={(value) => setForm((current) => ({ ...current, tipe: value }))}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gudang">Gudang</SelectItem>
                <SelectItem value="pickup_point">Pickup Point</SelectItem>
                <SelectItem value="kantor">Kantor</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="lainnya">Lainnya</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">Alamat / Area
            <Input value={form.alamat ?? ""} onChange={(event) => setForm((value) => ({ ...value, alamat: event.target.value }))} placeholder="Alamat atau penanda area (opsional)" className="h-11 rounded-xl" />
          </label>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">Keterangan
            <Textarea value={form.keterangan ?? ""} onChange={(event) => setForm((value) => ({ ...value, keterangan: event.target.value }))} placeholder="Keterangan operasional (opsional)" rows={3} className="rounded-xl" />
          </label>
          {editingId ? (
            <label className="grid gap-2 text-sm font-medium">Status
              <Select value={status} onValueChange={(value) => setStatus(value as "active" | "inactive")}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Aktif</SelectItem><SelectItem value="inactive">Tidak aktif</SelectItem></SelectContent>
              </Select>
            </label>
          ) : null}
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
            {editingId ? <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={resetForm}><X />Batal</Button> : null}
            <Button type="button" className="h-11 rounded-xl" disabled={!form.nama.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Tambah Lokasi"}
              {!mutation.isPending && (editingId ? <Pencil /> : <Plus />)}
            </Button>
          </div>
          {mutation.error ? <Alert variant="destructive" className="sm:col-span-2"><AlertTitle>Lokasi belum tersimpan</AlertTitle><AlertDescription>{errorMessage(mutation.error)}</AlertDescription></Alert> : null}
        </CardContent>
      </Card>

      {locations.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : locations.error ? (
        <Alert variant="destructive"><AlertTitle>Master lokasi gagal dimuat</AlertTitle><AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{errorMessage(locations.error)}</span><Button variant="outline" size="sm" onClick={() => void locations.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl shadow-sm"><CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"><div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><MapPin className="size-7" /></div><div><p className="font-semibold">Belum ada lokasi</p><p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">Tambahkan lokasi pertama. Setelah tersimpan, lokasi aktif akan langsung muncul pada form Daftarkan Unit.</p></div></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {rows.map((location) => (
              <Card key={location.lokasi_id} className="rounded-2xl shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-full bg-muted"><MapPin className="size-5 text-muted-foreground" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2"><p className="truncate font-semibold">{location.nama}</p><Badge variant={location.status === "active" ? "default" : "secondary"} className="shrink-0 rounded-full">{location.status === "active" ? "Aktif" : "Tidak aktif"}</Badge></div>
                      <p className="mt-1 text-xs text-muted-foreground">{typeLabel(location.tipe)}</p>
                    </div>
                  </div>
                  <div className="space-y-1 border-t pt-3 text-sm"><p>{location.alamat || "Alamat belum diisi"}</p>{location.keterangan ? <p className="text-xs leading-5 text-muted-foreground">{location.keterangan}</p> : null}</div>
                  <Button variant="outline" className="h-10 w-full rounded-xl" onClick={() => startEdit(location)}><Pencil />Ubah</Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/35 text-left"><tr><th className="px-5 py-3 font-medium">Lokasi</th><th className="px-5 py-3 font-medium">Tipe</th><th className="px-5 py-3 font-medium">Alamat</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Aksi</th></tr></thead>
              <tbody>
                {rows.map((location) => (
                  <tr key={location.lokasi_id} className="border-b last:border-0">
                    <td className="px-5 py-4"><p className="font-semibold">{location.nama}</p><p className="text-xs text-muted-foreground">{location.keterangan || "Tanpa keterangan"}</p></td>
                    <td className="px-5 py-4">{typeLabel(location.tipe)}</td>
                    <td className="px-5 py-4">{location.alamat || "—"}</td>
                    <td className="px-5 py-4"><Badge variant={location.status === "active" ? "default" : "secondary"} className="rounded-full">{location.status === "active" ? "Aktif" : "Tidak aktif"}</Badge></td>
                    <td className="px-5 py-4 text-right"><Button size="sm" variant="outline" className="rounded-xl" onClick={() => startEdit(location)}><Pencil />Ubah</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
