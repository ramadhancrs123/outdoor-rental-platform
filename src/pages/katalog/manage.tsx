import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, RefreshCw, Save } from "lucide-react";
import { useSearchParams, Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  addCatalogPackageComponent,
  createCatalogCategory,
  createCatalogPackage,
  createCatalogProduct,
  createCatalogTariff,
  createCatalogVariant,
  getCatalogContext,
  listCatalogCategories,
  listCatalogPackageComponents,
  listCatalogPackages,
  listCatalogProducts,
  listCatalogVariants,
  reconcileCatalogMutation,
  setCatalogPackageState,
  updateCatalogPackage,
} from "@/features/katalog";
import type { CreateCatalogProductInput, CreateCatalogVariantInput } from "@/features/katalog/service";
import { catalogErrorMessage, catalogStatusLabel, catalogVariantCapacity, catalogVariantColor, formatCatalogMoney } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

type UnknownCommand = { commandName: string; idempotencyKey: string; message: string };
const commandKey = (prefix: string) => prefix + "-" + crypto.randomUUID();
const messageOf = (error: unknown) => catalogErrorMessage(error);
const isUnknown = (error: unknown) => messageOf(error).startsWith("UNKNOWN_OUTCOME:");

function buildVariantAttributes(color: string, capacity: string) {
  const attributes: Record<string, unknown> = {};
  if (color.trim()) attributes.warna = color.trim();
  if (capacity.trim()) {
    const value = capacity.trim();
    const literMatch = /^([0-9]+(?:[.,][0-9]+)?)\s*(?:l|liter)$/i.exec(value);
    if (literMatch) {
      const numericCapacity = Number(literMatch[1].replace(",", "."));
      if (!Number.isFinite(numericCapacity) || numericCapacity < 0) throw new Error("Kapasitas harus berupa angka 0 atau lebih.");
      attributes.kapasitas_liter = numericCapacity;
    } else {
      attributes.kapasitas = value;
    }
  }
  return Object.keys(attributes).length ? attributes : null;
}

export function CatalogManage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const commandRef = useRef<UnknownCommand | null>(null);
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState(initialTab === "variant" || initialTab === "package" || initialTab === "tariff" ? initialTab : "product");
  const [editingPackageId, setEditingPackageId] = useState(searchParams.get("editPackage") ?? "");
  const [unknownCommand, setUnknownCommand] = useState<UnknownCommand | null>(null);

  const [category, setCategory] = useState({ name: "", description: "" });
  const [product, setProduct] = useState({ categoryId: "", name: "", slug: "", description: "", publicSummary: "" });
  const [variant, setVariant] = useState({ productId: "", name: "", code: "", description: "", color: "", capacityLiters: "" });
  const [pkg, setPkg] = useState({ name: "", slug: "", description: "", price: "" });
  const [packageEdit, setPackageEdit] = useState({ name: "", slug: "", description: "", price: "" });
  const [component, setComponent] = useState({ packageId: "", targetType: "barang", targetId: "", qty: "1", note: "" });
  const [tariff, setTariff] = useState({ targetType: "barang", targetId: "", name: "Harian", durationUnit: "hari", durationValue: "1", amount: "" });

  const context = useQuery({ queryKey: ["katalog", "context"], queryFn: getCatalogContext, staleTime: 60_000 });
  const categories = useQuery({ queryKey: ["katalog", "categories", context.data?.usahaId], queryFn: () => listCatalogCategories(context.data!.usahaId), enabled: Boolean(context.data?.usahaId), staleTime: 60_000 });
  const products = useQuery({ queryKey: ["katalog", "manage-products", context.data?.usahaId], queryFn: () => listCatalogProducts(context.data!.usahaId, { search: "", categoryId: "all", status: "all", visibility: "all", sort: "name_asc", page: 1, pageSize: 200 }), enabled: Boolean(context.data?.usahaId), staleTime: 10_000 });
  const packages = useQuery({ queryKey: ["katalog", "packages", context.data?.usahaId], queryFn: () => listCatalogPackages(context.data!.usahaId), enabled: Boolean(context.data?.usahaId), staleTime: 10_000 });
  const variants = useQuery({ queryKey: ["katalog", "variants", context.data?.usahaId], queryFn: () => listCatalogVariants(context.data!.usahaId), enabled: Boolean(context.data?.usahaId), staleTime: 10_000 });
  useEffect(() => {
    const nextTab = searchParams.get("tab");
    setTab(nextTab === "variant" || nextTab === "package" || nextTab === "tariff" ? nextTab : "product");
    setEditingPackageId(searchParams.get("editPackage") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!editingPackageId || !packages.data) return;
    const target = packages.data.find((item) => item.paket_sewa_id === editingPackageId);
    if (!target) return;
    setPackageEdit({
      name: target.nama,
      slug: target.slug,
      description: target.deskripsi ?? "",
      price: target.harga_dasar == null ? "" : String(target.harga_dasar),
    });
  }, [editingPackageId, packages.data]);

  const components = useQuery({ queryKey: ["katalog", "package-components", context.data?.usahaId, component.packageId], queryFn: () => listCatalogPackageComponents(context.data!.usahaId, component.packageId), enabled: Boolean(context.data?.usahaId && component.packageId), staleTime: 10_000 });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["katalog", "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "manage-products"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "products"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "packages"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "variants"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "package-components"] }),
    ]);
  };

  const runCommand = async <T,>(operation: string, fn: (key: string) => Promise<T>) => {
    const commandNames: Record<string, string> = {
      "create-kategori": "create_kategori_barang",
      "create-barang": "create_barang",
      "create-varian": "create_varian_barang",
      "create-paket": "create_paket_sewa",
      "update-paket": "update_paket_sewa",
      "add-komponen": "add_komponen_paket",
      "create-tarif": "create_tarif_sewa",
    };
    const key = commandKey(operation);
    commandRef.current = { commandName: commandNames[operation] ?? operation, idempotencyKey: key, message: "" };
    setUnknownCommand(null);
    try {
      return await fn(key);
    } catch (error) {
      if (isUnknown(error)) {
        setUnknownCommand({ commandName: commandRef.current?.commandName ?? operation, idempotencyKey: key, message: messageOf(error) });
      }
      throw error;
    }
  };

  const createCategory = useMutation({
    mutationFn: () => runCommand("create-kategori", (key) => createCatalogCategory(context.data!.usahaId, { nama: category.name, deskripsi: category.description || null }, { idempotencyKey: key })),
    onSuccess: async () => { setCategory({ name: "", description: "" }); toast.success("Kategori berhasil ditambahkan."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const createProduct = useMutation({
    mutationFn: () => runCommand("create-barang", (key) => {
      const input: CreateCatalogProductInput = { kategoriBarangId: product.categoryId, nama: product.name, slug: product.slug, deskripsi: product.description || null, ringkasanPublik: product.publicSummary || null, status: "active", isPublic: false };
      return createCatalogProduct(context.data!.usahaId, input, { idempotencyKey: key });
    }),
    onSuccess: async () => { setProduct({ categoryId: "", name: "", slug: "", description: "", publicSummary: "" }); toast.success("Barang berhasil ditambahkan."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const createVariant = useMutation({
    mutationFn: () => runCommand("create-varian", (key) => {
      const input: CreateCatalogVariantInput = { barangId: variant.productId, nama: variant.name, kodeInternal: variant.code || null, deskripsi: variant.description || null, atributPembeda: buildVariantAttributes(variant.color, variant.capacityLiters), status: "active" };
      return createCatalogVariant(context.data!.usahaId, input, { idempotencyKey: key });
    }),
    onSuccess: async () => { setVariant({ productId: "", name: "", code: "", description: "", color: "", capacityLiters: "" }); toast.success("Varian berhasil ditambahkan."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const createPackage = useMutation({
    mutationFn: () => runCommand("create-paket", (key) => createCatalogPackage(context.data!.usahaId, { nama: pkg.name, slug: pkg.slug, deskripsi: pkg.description || null, hargaDasar: pkg.price === "" ? null : Number(pkg.price), status: "draft", isPublic: false }, { idempotencyKey: key })),
    onSuccess: async () => { setPkg({ name: "", slug: "", description: "", price: "" }); toast.success("Paket dibuat sebagai draft internal."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const packageState = useMutation({
    mutationFn: ({ item, status }: { item: typeof packageOptions[number]; status: "active" | "inactive" }) =>
      runCommand("set-paket-state", (key) =>
        setCatalogPackageState(
          context.data!.usahaId,
          item.paket_sewa_id,
          status,
          status === "active" ? item.is_public : false,
          item.updated_at,
          { idempotencyKey: key },
        ),
      ),
    onSuccess: async (_, variables) => {
      toast.success(variables.status === "active" ? "Paket diaktifkan." : "Paket dinonaktifkan.");
      await invalidate();
    },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const updatePackage = useMutation({
    mutationFn: () => {
      if (!editingPackageId || !context.data) throw new Error("Pilih paket yang akan diperbarui.");
      const target = packageOptions.find((item) => item.paket_sewa_id === editingPackageId);
      if (!target) throw new Error("Paket yang akan diperbarui tidak ditemukan.");
      return runCommand("update-paket", (key) => updateCatalogPackage(context.data!.usahaId, editingPackageId, {
        nama: packageEdit.name,
        slug: packageEdit.slug,
        deskripsi: packageEdit.description || null,
        hargaDasar: packageEdit.price === "" ? null : Number(packageEdit.price),
        currencyCode: target.currency_code,
        metadata: target.metadata,
        status: target.status === "active" || target.status === "inactive" ? target.status : "draft",
        isPublic: target.is_public,
        expectedUpdatedAt: target.updated_at,
      }, { idempotencyKey: key }));
    },
    onSuccess: async () => {
      toast.success("Paket berhasil diperbarui.");
      await invalidate();
    },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const addComponent = useMutation({
    mutationFn: () => runCommand("add-komponen", (key) => addCatalogPackageComponent(context.data!.usahaId, { paketSewaId: component.packageId, barangId: component.targetType === "barang" ? component.targetId : null, varianBarangId: component.targetType === "varian" ? component.targetId : null, jumlah: Number(component.qty), catatan: component.note || null }, { idempotencyKey: key })),
    onSuccess: async () => { setComponent((value) => ({ ...value, targetId: "", qty: "1", note: "" })); toast.success("Komponen paket ditambahkan."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const createTariff = useMutation({
    mutationFn: () => runCommand("create-tarif", (key) => createCatalogTariff(context.data!.usahaId, { barangId: tariff.targetType === "barang" ? tariff.targetId : null, varianBarangId: tariff.targetType === "varian" ? tariff.targetId : null, paketSewaId: tariff.targetType === "paket" ? tariff.targetId : null, nama: tariff.name, durasiUnit: tariff.durationUnit, durasiNilai: Number(tariff.durationValue), nominal: Number(tariff.amount), status: "active" }, { idempotencyKey: key })),
    onSuccess: async () => { setTariff({ targetType: "barang", targetId: "", name: "Harian", durationUnit: "hari", durationValue: "1", amount: "" }); toast.success("Tarif berhasil ditambahkan."); await invalidate(); },
    onError: (error) => { if (!isUnknown(error)) toast.error(messageOf(error)); },
  });

  const busy = createCategory.isPending || createProduct.isPending || createVariant.isPending || createPackage.isPending || packageState.isPending || updatePackage.isPending || addComponent.isPending || createTariff.isPending;

  const reconcile = async () => {
    if (!context.data || !unknownCommand) return;
    try {
      const result = await reconcileCatalogMutation(context.data.usahaId, unknownCommand.commandName, unknownCommand.idempotencyKey);
      if (result.state === "committed") {
        toast.success("Perubahan sudah disimpan. Data terbaru dimuat.");
        setUnknownCommand(null);
        await invalidate();
      } else if (result.state === "not_found") {
        toast.info("Perubahan belum ditemukan. Data dimuat ulang sebelum mencoba tindakan baru.");
        setUnknownCommand(null);
        await invalidate();
      } else {
        toast.error("Hasil perubahan belum dapat dipastikan. Jangan mengulang perubahan sebelum status diperiksa.");
      }
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  if (context.isPending) return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-[520px] rounded-2xl" /></div>;
  if (context.error || !context.data) return <Alert variant="destructive"><AlertTitle>Konteks Usaha tidak tersedia</AlertTitle><AlertDescription>{messageOf(context.error)}</AlertDescription></Alert>;

  const categoryOptions = categories.data ?? [];
  const productOptions = products.data?.products ?? [];
  const packageOptions = packages.data ?? [];
  const variantOptions = variants.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-24 lg:pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-sm font-medium text-muted-foreground">Katalog</p><h1 className="text-2xl font-bold tracking-tight">Kelola Katalog</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Kelola katalog barang. Status dan tampilan publik tetap dipisahkan.</p></div>
        <Button asChild variant="outline" className="rounded-xl"><Link to={paths.katalog}><ArrowLeft />Kembali</Link></Button>
      </header>

      {unknownCommand ? <Alert variant="destructive"><AlertTitle>Permintaan belum dapat dipastikan</AlertTitle><AlertDescription className="space-y-3"><p>{unknownCommand.message}</p><Button variant="outline" size="sm" onClick={() => void reconcile()}><RefreshCw />Periksa Status Tindakan</Button></AlertDescription></Alert> : null}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="product">Produk</TabsTrigger>
          <TabsTrigger value="variant">Varian</TabsTrigger>
          <TabsTrigger value="package">Paket Sewa</TabsTrigger>
          <TabsTrigger value="tariff">Tarif</TabsTrigger>
        </TabsList>

        <TabsContent value="product" className="grid gap-4 lg:grid-cols-[.85fr_1.15fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Kategori</CardTitle><p className="text-sm text-muted-foreground">Satu kategori utama untuk setiap barang pada baseline.</p></CardHeader>
            <CardContent className="space-y-3">
              <Input className="h-11 rounded-xl" value={category.name} onChange={(e) => setCategory((v) => ({ ...v, name: e.target.value }))} placeholder="Nama kategori" aria-label="Nama kategori" />
              <Input className="h-11 rounded-xl" value={category.description} onChange={(e) => setCategory((v) => ({ ...v, description: e.target.value }))} placeholder="Deskripsi (opsional)" aria-label="Deskripsi kategori" />
              <Button className="h-11 rounded-xl" disabled={!category.name.trim() || busy} onClick={() => createCategory.mutate()}>{createCategory.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Kategori</Button>
              <div className="space-y-2 border-t pt-3">{categoryOptions.map((item) => <div key={item.kategori_barang_id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span className="font-medium">{item.nama}</span><Badge variant={item.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(item.status)}</Badge></div>)}</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Barang</CardTitle><p className="text-sm text-muted-foreground">Buat barang yang dapat disewakan dan nantinya dapat memiliki varian, tarif, media, dan relasi paket.</p></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Kategori<Select value={product.categoryId} onValueChange={(value) => setProduct((v) => ({ ...v, categoryId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih kategori" /></SelectTrigger><SelectContent>{categoryOptions.map((c) => <SelectItem key={c.kategori_barang_id} value={c.kategori_barang_id}>{c.nama}</SelectItem>)}</SelectContent></Select></label>
              <label className="grid gap-2 text-sm font-medium">Nama barang<Input className="h-11 rounded-xl" value={product.name} onChange={(e) => setProduct((v) => ({ ...v, name: e.target.value }))} placeholder="Tenda Dome 4P" /></label>
              <label className="grid gap-2 text-sm font-medium">Slug<Input className="h-11 rounded-xl" value={product.slug} onChange={(e) => setProduct((v) => ({ ...v, slug: e.target.value }))} placeholder="tenda-dome-4p" /></label>
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Deskripsi<Textarea className="rounded-xl" rows={4} value={product.description} onChange={(e) => setProduct((v) => ({ ...v, description: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Ringkasan publik<Textarea className="rounded-xl" rows={3} value={product.publicSummary} onChange={(e) => setProduct((v) => ({ ...v, publicSummary: e.target.value }))} /></label>
              <div className="sm:col-span-2 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">Barang baru dimulai Aktif + Internal. Tampilan publik ditentukan setelah informasi publik siap.</p><Button className="h-11 rounded-xl" disabled={!product.categoryId || !product.name.trim() || !product.slug.trim() || busy} onClick={() => createProduct.mutate()}>{createProduct.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Barang</Button></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variant" className="space-y-4">
          <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Tambah Varian</CardTitle><p className="text-sm text-muted-foreground">Varian berada di bawah satu Barang. Pilih relasi melalui nama, bukan ID.</p></CardHeader><CardContent className="grid gap-4 lg:grid-cols-4">
            <label className="grid gap-2 text-sm font-medium">Barang induk<Select value={variant.productId} onValueChange={(value) => setVariant((v) => ({ ...v, productId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih barang" /></SelectTrigger><SelectContent>{productOptions.map((p) => <SelectItem key={p.barang_id} value={p.barang_id}>{p.nama}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-2 text-sm font-medium">Nama varian<Input className="h-11 rounded-xl" value={variant.name} onChange={(e) => setVariant((v) => ({ ...v, name: e.target.value }))} /></label>
            <label className="grid gap-2 text-sm font-medium">Kode internal<Input className="h-11 rounded-xl" value={variant.code} onChange={(e) => setVariant((v) => ({ ...v, code: e.target.value }))} placeholder="Opsional" /></label>
            <label className="grid gap-2 text-sm font-medium">Warna<Input className="h-11 rounded-xl" value={variant.color} onChange={(e) => setVariant((v) => ({ ...v, color: e.target.value }))} placeholder="Contoh: hitam" /></label>
            <label className="grid gap-2 text-sm font-medium">Kapasitas<Input className="h-11 rounded-xl" value={variant.capacityLiters} onChange={(e) => setVariant((v) => ({ ...v, capacityLiters: e.target.value }))} placeholder="Contoh: 60 liter atau 4 orang" /></label>
            <Button className="self-end h-11 rounded-xl" disabled={!variant.productId || !variant.name.trim() || busy} onClick={() => createVariant.mutate()}>{createVariant.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Varian</Button>
            <label className="grid gap-2 text-sm font-medium lg:col-span-4">Deskripsi<Input className="h-11 rounded-xl" value={variant.description} onChange={(e) => setVariant((v) => ({ ...v, description: e.target.value }))} /></label>
          </CardContent></Card>
          <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Daftar Varian</CardTitle></CardHeader><CardContent className="space-y-2">{variantOptions.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada varian.</p> : variantOptions.map((item) => <div key={item.varian_barang_id} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="font-semibold">{item.barang_nama} · {item.nama}</p><p className="text-xs text-muted-foreground">{item.kode_internal ?? "Tanpa kode internal"}</p><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-xl bg-muted/40 px-3 py-2"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">Warna</span><span className="font-medium">{catalogVariantColor(item.atribut_pembeda) || "—"}</span></div><div className="rounded-xl bg-muted/40 px-3 py-2"><span className="block text-[11px] uppercase tracking-wide text-muted-foreground">Kapasitas</span><span className="font-medium">{catalogVariantCapacity(item.atribut_pembeda) || "—"}</span></div></div>{item.atribut_pembeda ? <div className="mt-1 flex flex-wrap gap-1.5">{Object.entries(item.atribut_pembeda).filter(([key]) => key !== "warna" && key !== "kapasitas" && key !== "kapasitas_liter").map(([key, value]) => <Badge key={key} variant="outline" className="rounded-full">{key}: {String(value)}</Badge>)}</div> : null}</div><Badge variant={item.status === "active" ? "default" : "secondary"} className="shrink-0 rounded-full">{catalogStatusLabel(item.status)}</Badge></div>)}</CardContent></Card>
          <Alert><AlertTitle>Boundary varian</AlertTitle><AlertDescription>Perubahan varian tidak memindahkan unit fisik dan tidak menentukan ketersediaan.</AlertDescription></Alert>
        </TabsContent>

        <TabsContent value="package" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {editingPackageId ? (
              <Card className="rounded-2xl border-primary/30 shadow-sm sm:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Ubah Paket Sewa</CardTitle>
                  <p className="text-sm text-muted-foreground">Perbarui identitas dan harga dasar paket yang dipilih. Tarif sewa tetap dikelola sebagai record tarif terpisah.</p>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium">Nama paket<Input className="h-11 rounded-xl" value={packageEdit.name} onChange={(e) => setPackageEdit((v) => ({ ...v, name: e.target.value }))} /></label>
                  <label className="grid gap-2 text-sm font-medium">Slug<Input className="h-11 rounded-xl" value={packageEdit.slug} onChange={(e) => setPackageEdit((v) => ({ ...v, slug: e.target.value }))} /></label>
                  <label className="grid gap-2 text-sm font-medium sm:col-span-2">Deskripsi<Textarea className="rounded-xl" rows={3} value={packageEdit.description} onChange={(e) => setPackageEdit((v) => ({ ...v, description: e.target.value }))} /></label>
                  <label className="grid gap-2 text-sm font-medium">Harga dasar<Input className="h-11 rounded-xl" type="number" min="0" inputMode="decimal" value={packageEdit.price} onChange={(e) => setPackageEdit((v) => ({ ...v, price: e.target.value }))} placeholder="Opsional" /></label>
                  <div className="flex items-end gap-2">
                    <Button className="h-11 rounded-xl" disabled={!packageEdit.name.trim() || !packageEdit.slug.trim() || (packageEdit.price !== "" && Number(packageEdit.price) < 0) || updatePackage.isPending} onClick={() => updatePackage.mutate()}>
                      {updatePackage.isPending ? <Loader2 className="animate-spin" /> : <Save />}Simpan Perubahan
                    </Button>
                    <Button asChild variant="outline" className="h-11 rounded-xl"><Link to={paths.katalogManage + "?tab=package"}>Batal</Link></Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Buat Paket Sewa</CardTitle><p className="text-sm text-muted-foreground">Paket baru dibuat sebagai draft internal agar admin dapat melengkapi komponen dan tarif sebelum dipublikasikan.</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Nama paket<Input className="h-11 rounded-xl" value={pkg.name} onChange={(e) => setPkg((v) => ({ ...v, name: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium">Slug<Input className="h-11 rounded-xl" value={pkg.slug} onChange={(e) => setPkg((v) => ({ ...v, slug: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Deskripsi<Textarea className="rounded-xl" rows={3} value={pkg.description} onChange={(e) => setPkg((v) => ({ ...v, description: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium">Harga dasar<Input className="h-11 rounded-xl" inputMode="decimal" value={pkg.price} onChange={(e) => setPkg((v) => ({ ...v, price: e.target.value }))} placeholder="Opsional" /></label>
              <div className="flex items-end"><Button className="h-11 w-full rounded-xl" disabled={!pkg.name.trim() || !pkg.slug.trim() || busy} onClick={() => createPackage.mutate()}>{createPackage.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Paket Draft</Button></div>
            </CardContent></Card>

            <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Tambah Komponen</CardTitle><p className="text-sm text-muted-foreground">Satu pilihan hanya berlaku untuk Barang atau Varian, bukan keduanya.</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Paket<Select value={component.packageId} onValueChange={(value) => setComponent((v) => ({ ...v, packageId: value, targetId: "" }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih paket" /></SelectTrigger><SelectContent>{packageOptions.map((p) => <SelectItem key={p.paket_sewa_id} value={p.paket_sewa_id}>{p.nama}</SelectItem>)}</SelectContent></Select></label>
              <label className="grid gap-2 text-sm font-medium">Target<Select value={component.targetType} onValueChange={(value) => setComponent((v) => ({ ...v, targetType: value, targetId: "" }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="barang">Barang</SelectItem><SelectItem value="varian">Varian</SelectItem></SelectContent></Select></label>
              <label className="grid gap-2 text-sm font-medium">Pilihan{component.targetType === "barang" ? <Select value={component.targetId} onValueChange={(value) => setComponent((v) => ({ ...v, targetId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih barang" /></SelectTrigger><SelectContent>{productOptions.map((p) => <SelectItem key={p.barang_id} value={p.barang_id}>{p.nama}</SelectItem>)}</SelectContent></Select> : <Select value={component.targetId} onValueChange={(value) => setComponent((v) => ({ ...v, targetId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih varian" /></SelectTrigger><SelectContent>{variantOptions.map((v) => <SelectItem key={v.varian_barang_id} value={v.varian_barang_id}>{v.barang_nama} · {v.nama}</SelectItem>)}</SelectContent></Select>}</label>
              <label className="grid gap-2 text-sm font-medium">Jumlah<Input className="h-11 rounded-xl" inputMode="numeric" value={component.qty} onChange={(e) => setComponent((v) => ({ ...v, qty: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Catatan<Input className="h-11 rounded-xl" value={component.note} onChange={(e) => setComponent((v) => ({ ...v, note: e.target.value }))} /></label>
              <div className="sm:col-span-2 flex items-center justify-between border-t pt-4"><span className="text-xs text-muted-foreground">{components.data ? String(components.data.length) + " komponen saat ini" : "Pilih paket untuk melihat komponen"}</span><Button className="h-11 rounded-xl" disabled={!component.packageId || !component.targetId || Number(component.qty) <= 0 || busy} onClick={() => addComponent.mutate()}>{addComponent.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Komponen</Button></div>
            </CardContent></Card>
          </div>
          <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Daftar Paket</CardTitle></CardHeader><CardContent className="space-y-2">{packageOptions.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada paket.</p> : packageOptions.map((item) => <div key={item.paket_sewa_id} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-semibold">{item.nama}</p><p className="text-sm text-muted-foreground">{item.harga_dasar == null ? "Tanpa harga dasar" : formatCatalogMoney(item.harga_dasar, item.currency_code)}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={item.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(item.status)}</Badge><Badge variant="outline" className="rounded-full">{item.is_public ? "Publik" : "Internal"}</Badge>{item.status !== "active" ? <Button size="sm" className="rounded-xl" disabled={packageState.isPending} onClick={() => packageState.mutate({ item, status: "active" })}>Aktifkan</Button> : <Button size="sm" variant="outline" className="rounded-xl" disabled={packageState.isPending} onClick={() => packageState.mutate({ item, status: "inactive" })}>Nonaktifkan</Button>}<Button asChild size="sm" variant="outline" className="rounded-xl"><Link to={paths.katalogManage + "?tab=package&editPackage=" + item.paket_sewa_id}>Ubah</Link></Button></div></div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="tariff" className="space-y-4">
          <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="text-base">Tambah Tarif</CardTitle><p className="text-sm text-muted-foreground">Target dipilih dengan label katalog; tidak ada ID database mentah.</p></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-2 text-sm font-medium">Tipe target<Select value={tariff.targetType} onValueChange={(value) => setTariff((v) => ({ ...v, targetType: value, targetId: "" }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="barang">Barang</SelectItem><SelectItem value="varian">Varian</SelectItem><SelectItem value="paket">Paket</SelectItem></SelectContent></Select></label>
            <label className="grid gap-2 text-sm font-medium lg:col-span-3">Target{tariff.targetType === "barang" ? <Select value={tariff.targetId} onValueChange={(value) => setTariff((v) => ({ ...v, targetId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih barang" /></SelectTrigger><SelectContent>{productOptions.map((p) => <SelectItem key={p.barang_id} value={p.barang_id}>{p.nama}</SelectItem>)}</SelectContent></Select> : tariff.targetType === "varian" ? <Select value={tariff.targetId} onValueChange={(value) => setTariff((v) => ({ ...v, targetId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih varian" /></SelectTrigger><SelectContent>{variantOptions.map((v) => <SelectItem key={v.varian_barang_id} value={v.varian_barang_id}>{v.barang_nama} · {v.nama}</SelectItem>)}</SelectContent></Select> : <Select value={tariff.targetId} onValueChange={(value) => setTariff((v) => ({ ...v, targetId: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih paket" /></SelectTrigger><SelectContent>{packageOptions.map((p) => <SelectItem key={p.paket_sewa_id} value={p.paket_sewa_id}>{p.nama}</SelectItem>)}</SelectContent></Select>}</label>
            <label className="grid gap-2 text-sm font-medium lg:col-span-2">Nama tarif<Input className="h-11 rounded-xl" value={tariff.name} onChange={(e) => setTariff((v) => ({ ...v, name: e.target.value }))} /></label>
            <label className="grid gap-2 text-sm font-medium">Durasi<input className="h-11 rounded-xl border bg-background px-3" inputMode="numeric" value={tariff.durationValue} onChange={(e) => setTariff((v) => ({ ...v, durationValue: e.target.value }))} /></label>
            <label className="grid gap-2 text-sm font-medium">Satuan<input className="h-11 rounded-xl border bg-background px-3" value={tariff.durationUnit} onChange={(e) => setTariff((v) => ({ ...v, durationUnit: e.target.value }))} /></label>
            <label className="grid gap-2 text-sm font-medium">Nominal IDR<Input className="h-11 rounded-xl" inputMode="decimal" value={tariff.amount} onChange={(e) => setTariff((v) => ({ ...v, amount: e.target.value }))} placeholder="50000" /></label>
            <div className="lg:col-span-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">Tarif penyewaan yang sudah tercatat akan tersimpan sebagai riwayat; perubahan katalog tidak mengubah riwayat tersebut.</p><Button className="h-11 rounded-xl" disabled={!tariff.targetId || !tariff.name.trim() || Number(tariff.durationValue) <= 0 || Number(tariff.amount) < 0 || busy} onClick={() => createTariff.mutate()}>{createTariff.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Tarif</Button></div>
          </CardContent></Card>
          <Alert><AlertTitle>Price policy boundary</AlertTitle><AlertDescription>Katalog menyimpan tarif yang ditawarkan. Jangan menambahkan diskon, late fee, damage fee, refund, atau formula harga baru dari UI.</AlertDescription></Alert>
        </TabsContent>
      </Tabs>
    </div>
  );
}
