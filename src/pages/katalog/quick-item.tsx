import { useEffect, useMemo, useRef, useState } from "react";
import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronLeft, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ListView } from "@/components/refine-ui/views/list-view";
import { getCatalogContext, listCatalogCategories, uploadCatalogMediaFile } from "@/features/katalog";
import {
  listQuickItemLocations,
  onboardQuickItem,
  quickItemLocationSelection,
  type QuickItemOnboardingInput,
  type QuickItemOnboardingResult,
} from "@/features/katalog/quick-item";
import { paths } from "@/routes/paths";

type QuickItemPageState = "form" | "processing" | "success" | "error" | "unknown";
type VariantDraft = { attributes: Record<string, string>; quantity: string; nominal: string };

const DIMENSIONS = [
  { key: "warna", label: "Warna" },
  { key: "kapasitas", label: "Kapasitas" },
  { key: "ukuran", label: "Ukuran" },
] as const;

const createVariantDraft = (dimensions: string[], nominal = ""): VariantDraft => ({
  attributes: Object.fromEntries(dimensions.map((dimension) => [dimension, ""])),
  quantity: "1",
  nominal,
});

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Barang belum dapat ditambahkan.";

export function CatalogQuickItem() {
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);
  const [pageState, setPageState] = useState<QuickItemPageState>("form");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<QuickItemOnboardingResult | null>(null);

  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoInputError, setPhotoInputError] = useState("");
  const [photoUploadWarning, setPhotoUploadWarning] = useState("");
  const [price, setPrice] = useState("65000");
  const [durationUnit, setDurationUnit] = useState("hari");
  const [durationValue, setDurationValue] = useState("1");
  const [quantity, setQuantity] = useState("1");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [variantMode, setVariantMode] = useState(false);
  const [dimensions, setDimensions] = useState<string[]>(["warna"]);
  const [variants, setVariants] = useState<VariantDraft[]>([createVariantDraft(["warna"], "65000")]);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [unitDetails, setUnitDetails] = useState<Array<{ serialNumber: string; tanggalDiperoleh: string; catatanInternal: string }>>([]);

  const context = useQuery({
    queryKey: ["katalog", "context"],
    queryFn: getCatalogContext,
    staleTime: 60_000,
  });

  const categories = useQuery({
    queryKey: ["katalog", "categories", context.data?.usahaId],
    queryFn: () => listCatalogCategories(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });

  const locations = useQuery({
    queryKey: ["katalog", "quick-item", "locations", context.data?.usahaId],
    queryFn: () => listQuickItemLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });

  const locationSelection = useMemo(
    () => quickItemLocationSelection(locations.data ?? []),
    [locations.data],
  );

  const variantUnitTotal = useMemo(
    () => variants.reduce((total, row) => total + (Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0), 0),
    [variants],
  );

  const physicalUnitCount = variantMode
    ? variantUnitTotal
    : (Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 0);

  const physicalUnitLabels = useMemo(() => {
    if (!variantMode) return Array.from({ length: physicalUnitCount }, () => null as string | null);

    return variants.flatMap((row) =>
      Array.from({ length: Math.max(0, Number(row.quantity) || 0) }, () =>
        dimensions
          .map((dimension) => row.attributes[dimension]?.trim())
          .filter(Boolean)
          .join(" / ") || "Pilihan",
      ),
    );
  }, [dimensions, physicalUnitCount, variantMode, variants]);

  const photoPreviewUrl = useMemo(() => (
    photoFile ? URL.createObjectURL(photoFile) : null
  ), [photoFile]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    setUnitDetails((current) =>
      Array.from({ length: physicalUnitCount }, (_, index) => current[index] ?? ({
        serialNumber: "",
        tanggalDiperoleh: "",
        catatanInternal: "",
      })),
    );
  }, [physicalUnitCount]);

  useEffect(() => {
    if (locationSelection.selectedLocationId && !locationId) {
      setLocationId(locationSelection.selectedLocationId);
    }
  }, [locationId, locationSelection.selectedLocationId]);

  useEffect(() => {
    if (!variantMode) return;
    setVariants((current) =>
      current.length
        ? current.map((row) => ({
            ...row,
            attributes: Object.fromEntries(
              dimensions.map((dimension) => [dimension, row.attributes[dimension] ?? ""]),
            ),
          }))
        : [createVariantDraft(dimensions, price)],
    );
  }, [dimensions, price, variantMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!commandRef.current) commandRef.current = "quick-item-" + createClientId();

      const parsedPrice = Number(price);
      const parsedDuration = Number(durationValue);

      const currentCommandKey = commandRef.current;
      const payload: QuickItemOnboardingInput = {
        kategoriBarangId: categoryMode === "existing" ? categoryId : null,
        kategoriNama: categoryMode === "new" ? categoryName.trim() : null,
        namaBarang: productName.trim(),
        deskripsi: description.trim() || null,
        hargaSewa: {
          nominal: variantMode ? null : parsedPrice,
          durasiUnit: durationUnit,
          durasiNilai: parsedDuration,
          currencyCode: "IDR",
        },
        jumlah: variantMode ? null : Number(quantity),
        lokasiId: locationId,
        varianMode: variantMode,
        variantDimensions: variantMode ? dimensions : [],
        variants: variantMode
          ? variants.map((row) => ({
              attributes: row.attributes,
              quantity: Number(row.quantity),
              nominal: Number(row.nominal),
            }))
          : [],
        advancedMode,
        unitDetails: advancedMode
          ? unitDetails.map((detail) => ({
              serialNumber: detail.serialNumber.trim() || null,
              tanggalDiperoleh: detail.tanggalDiperoleh || null,
              catatanInternal: detail.catatanInternal.trim() || null,
            }))
          : [],
      };

      const nextResult = await onboardQuickItem(context.data.usahaId, payload, {
        idempotencyKey: currentCommandKey ?? undefined,
      });

      let mediaWarning = "";
      if (photoFile && currentCommandKey) {
        try {
          await uploadCatalogMediaFile(context.data.usahaId, nextResult.barang_id, photoFile, {
            isCover: true,
            urutan: 1,
            idempotencyKey: "quick-item-media-" + currentCommandKey,
          });
        } catch (error) {
          mediaWarning = errorMessage(error);
        }
      }

      return { result: nextResult, mediaWarning };
    },
    onMutate: () => {
      setPageState("processing");
      setFeedback("");
    },
    onSuccess: async ({ result: nextResult, mediaWarning }) => {
      setResult(nextResult);
      setPhotoUploadWarning(mediaWarning);
      commandRef.current = null;
      setPageState("success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["katalog"] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
      ]);
    },
    onError: (error) => {
      const message = errorMessage(error);
      setFeedback(message);
      setPageState(message.startsWith("UNKNOWN_OUTCOME:") ? "unknown" : "error");
      if (!message.startsWith("UNKNOWN_OUTCOME:")) commandRef.current = null;
    },
  });

  const validationError = useMemo(() => {
    if (categoryMode === "existing" && !categoryId) return "Pilih kategori barang.";
    if (categoryMode === "new" && !categoryName.trim()) return "Isi nama kategori baru.";
    if (!productName.trim()) return "Nama barang wajib diisi.";

    const parsedPrice = Number(price);
    const parsedDuration = Number(durationValue);
    if (!variantMode && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) return "Harga sewa harus valid.";
    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) return "Durasi sewa harus lebih dari 0.";

    if (locations.data && locations.data.length > 1 && !locationId) {
      return "Pilih lokasi barang.";
    }

    if (!variantMode) {
      const parsedQuantity = Number(quantity);
      if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) return "Jumlah unit harus lebih dari 0.";
      return null;
    }

    if (dimensions.length < 1 || dimensions.length > 2) return "Pilih satu atau dua dimensi pilihan.";
    if (!variants.length) return "Tambahkan minimal satu pilihan.";
    if (
      variants.some(
        (row) =>
          dimensions.some((dimension) => !row.attributes[dimension]?.trim()) ||
          !Number.isInteger(Number(row.quantity)) ||
          Number(row.quantity) <= 0 ||
          !Number.isFinite(Number(row.nominal)) ||
          Number(row.nominal) < 0,
      )
    ) {
      return "Lengkapi nilai, jumlah unit, dan harga setiap pilihan.";
    }

    return null;
  }, [
    categoryId,
    categoryMode,
    categoryName,
    dimensions,
    durationValue,
    locationId,
    locations.data,
    price,
    productName,
    quantity,
    variantMode,
    variants,
  ]);

  const submitDisabled =
    Boolean(validationError) ||
    Boolean(photoInputError) ||
    mutation.isPending ||
    pageState === "processing";

  const toggleDimension = (key: string) => {
    setDimensions((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== key);
      }
      if (current.length >= 2) return current;
      return [...current, key];
    });
  };

  const resetForm = () => {
    setPageState("form");
    setFeedback("");
    setResult(null);
    setCategoryMode("existing");
    setCategoryId("");
    setCategoryName("");
    setProductName("");
    setDescription("");
    setPhotoFile(null);
    setPhotoInputError("");
    setPhotoUploadWarning("");
    setPrice("65000");
    setDurationUnit("hari");
    setDurationValue("1");
    setQuantity("1");
    setLocationId(locationSelection.selectedLocationId);
    setVariantMode(false);
    setDimensions(["warna"]);
    setVariants([createVariantDraft(["warna"], "65000")]);
    setAdvancedMode(false);
    setUnitDetails([]);
    commandRef.current = null;
  };

  if (context.isPending) {
    return (
      <ListView className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-[620px] rounded-2xl" />
      </ListView>
    );
  }

  if (context.error || !context.data) {
    return (
      <ListView className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertTitle>Katalog belum siap</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </ListView>
    );
  }

  if (pageState === "success" && result) {
    return (
      <ListView className="mx-auto max-w-2xl space-y-4 pb-24 lg:pb-8">
        <Card className="rounded-3xl border-primary/20">
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <CheckCircle2 className="size-7" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Barang berhasil ditambahkan</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight">{result.barang_nama}</h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{result.unit_count} unit</Badge>
                  {result.variant_count > 0 ? <Badge variant="secondary">{result.variant_count} pilihan</Badge> : null}
                  <Badge variant="secondary">
                    {formatMoney(result.min_price, result.currency_code)}
                    {result.min_price !== result.max_price ? " – " + formatMoney(result.max_price, result.currency_code) : ""}
                    {" / " + result.durasi_unit}
                  </Badge>
                  <Badge>Siap Disewakan</Badge>
                </div>
              </div>
            </div>
            {photoUploadWarning ? (
              <Alert>
                <AlertTitle>Barang tersimpan, foto belum dapat dipastikan</AlertTitle>
                <AlertDescription>{photoUploadWarning} Foto dapat ditambahkan lagi dari detail Barang.</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild className="h-11 rounded-xl">
                <Link to={paths.katalog + "/show/" + result.barang_id}>Lihat Barang</Link>
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={resetForm}>
                Tambah Barang Lagi
              </Button>
            </div>
          </CardContent>
        </Card>
      </ListView>
    );
  }

  return (
    <ListView className="mx-auto max-w-3xl space-y-2.5 pb-20 sm:space-y-4 lg:pb-8">
      <div className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b bg-background/95 px-0 backdrop-blur sm:hidden">
        <Button asChild variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Kembali ke Katalog">
          <Link to={paths.katalog}><ChevronLeft /></Link>
        </Button>
        <h1 className="text-base font-bold tracking-tight">Tambah Barang</h1>
        <Button
          type="button"
          size="sm"
          className="h-9 rounded-xl px-4"
          disabled={submitDisabled}
          onClick={() => mutation.mutate()}
        >
          {pageState === "processing" ? "Simpan…" : "Simpan"}
        </Button>
      </div>

      <header className="hidden space-y-3 sm:block">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-xl">
            <Link to={paths.katalog}><ChevronLeft className="size-4" />Katalog</Link>
          </Button>
        </div>
        <div>
          <p className="text-sm font-medium text-primary">Tambah barang</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tambahkan barang siap disewakan</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Isi fakta yang Anda pahami. Sistem akan membuat struktur katalog dan unit fisiknya.
          </p>
        </div>
      </header>

      {(pageState === "error" || pageState === "unknown") && (
        <Alert variant={pageState === "unknown" ? "default" : "destructive"}>
          <AlertTitle>
            {pageState === "unknown" ? "Hasil penambahan belum dapat dipastikan" : "Barang belum ditambahkan"}
          </AlertTitle>
          <AlertDescription>
            {feedback}
            {pageState === "unknown" ? " Jangan kirim ulang sebelum memeriksa Katalog." : ""}
          </AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ImagePlus className="size-4 shrink-0 text-primary" />
              <CardTitle className="text-base sm:text-lg">Foto Produk</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground sm:hidden">Opsional</span>
            <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
            Tambah foto untuk memudahkan identifikasi.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-1 sm:p-6 sm:pt-2">
          {photoPreviewUrl ? (
            <div className="relative overflow-hidden rounded-2xl border bg-muted">
              <img src={photoPreviewUrl} alt="Pratinjau foto produk" className="h-44 w-full object-cover sm:h-64" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-2.5 top-2.5 size-8 rounded-full shadow-sm"
                onClick={() => setPhotoFile(null)}
                aria-label="Hapus foto produk"
              >
                <X className="size-4" />
              </Button>
              <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-xs text-white">
                {photoFile?.name}
              </div>
            </div>
          ) : (
            <label className="flex min-h-28 cursor-pointer items-center gap-3 rounded-2xl border border-dashed bg-muted/15 px-4 py-4 hover:bg-muted/35 sm:min-h-36 sm:flex-col sm:justify-center sm:text-center">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-muted-foreground sm:size-11">
                <ImagePlus className="size-5" />
              </div>
              <div className="min-w-0">
                <span className="block text-sm font-semibold">Tambah Foto</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">JPG, PNG, WEBP · maks. 8 MB</span>
              </div>
              <Input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    setPhotoFile(null);
                    setPhotoInputError("Foto produk harus berupa gambar.");
                    return;
                  }
                  if (file.size > 8 * 1024 * 1024) {
                    setPhotoFile(null);
                    setPhotoInputError("Ukuran foto maksimal 8 MB.");
                    return;
                  }
                  setPhotoInputError("");
                  setPhotoFile(file);
                  event.target.value = "";
                }}
              />
            </label>
          )}
          {photoInputError ? <p className="mt-2 text-xs text-destructive">{photoInputError}</p> : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 sm:p-6 sm:pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Informasi Dasar</CardTitle>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-1 sm:space-y-5 sm:p-6 sm:pt-2">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold sm:text-sm">Nama Barang</label>
            <Input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Contoh: Tenda Dome 4P" className="h-10 rounded-xl sm:h-11" />
          </div>

          <div className="grid gap-1.5">
            <label className="text-xs font-semibold sm:text-sm">Kategori</label>
            {categoryMode === "existing" ? (
              <div className="flex gap-2">
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="h-10 flex-1 rounded-xl sm:h-11"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                  <SelectContent>
                    {(categories.data ?? []).filter((category) => category.status === "active").map((category) => (
                      <SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>{category.nama}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="h-10 shrink-0 rounded-xl px-3 sm:h-11"
                  onClick={() => { setCategoryMode("new"); setCategoryId(""); }}
                >
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">Buat kategori</span>
                  <span className="sm:hidden">Kategori</span>
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Contoh: Tenda" className="h-10 rounded-xl sm:h-11" />
                <Button variant="outline" className="h-10 shrink-0 rounded-xl px-3 sm:h-11" onClick={() => { setCategoryMode("existing"); setCategoryName(""); }}>
                  Pilih
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <label className="text-xs font-semibold sm:text-sm">Deskripsi</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Jelaskan barang, spesifikasi penting, atau informasi yang perlu dipahami admin dan penyewa."
              className="min-h-20 rounded-xl sm:min-h-24"
              rows={3}
            />
            <div className="flex justify-end">
              <span className="text-[11px] text-muted-foreground">{description.length}/500</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 sm:p-6 sm:pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Pengaturan Sewa</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">Tarif dasar dan durasi sewa barang.</p>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-4 pt-1 sm:p-6 sm:pt-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            {!variantMode ? (
              <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">
                Harga Sewa
                <Input type="number" min="0" step="1000" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} className="h-10 rounded-xl sm:h-11" />
              </label>
            ) : (
              <div className="rounded-xl border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                Harga sewa diatur pada setiap pilihan barang di bawah.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">
                Durasi
                <Input type="number" min="1" step="1" inputMode="numeric" value={durationValue} onChange={(event) => setDurationValue(event.target.value)} className="h-10 rounded-xl sm:h-11" />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">
                Satuan
                <Select value={durationUnit} onValueChange={setDurationUnit}>
                  <SelectTrigger className="h-10 rounded-xl sm:h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hari">Hari</SelectItem>
                    <SelectItem value="jam">Jam</SelectItem>
                    <SelectItem value="minggu">Minggu</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 sm:p-6 sm:pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Lokasi &amp; Lainnya</CardTitle>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-1 sm:space-y-5 sm:p-6 sm:pt-2">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold sm:text-sm">Lokasi Awal</label>
            {locationSelection.selectionRequired ? (
              <Select value={locationId ?? ""} onValueChange={setLocationId}>
                <SelectTrigger className="h-10 rounded-xl sm:h-11"><SelectValue placeholder="Pilih lokasi" /></SelectTrigger>
                <SelectContent>
                  {(locations.data ?? []).map((location) => (
                    <SelectItem key={location.lokasi_id} value={location.lokasi_id}>{location.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : locations.data?.length === 1 ? (
              <div className="flex h-10 items-center justify-between rounded-xl border bg-muted/30 px-3.5 text-sm sm:h-11">
                <span>{locations.data[0].nama}</span>
                <Badge variant="secondary" className="rounded-full">Otomatis</Badge>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                Belum ada lokasi aktif. Barang dapat ditempatkan kemudian.
              </p>
            )}
          </div>

          {!variantMode ? (
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold sm:text-sm">Jumlah Unit Fisik</label>
              <Input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-10 rounded-xl sm:h-11" />
              <span className="text-[11px] text-muted-foreground">Setiap unit tetap dapat dilacak satu per satu di Inventaris.</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2 sm:p-6 sm:pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Variasi Barang</CardTitle>
            <p className="mt-1 text-xs leading-5 font-normal text-muted-foreground sm:text-sm">Kelola variasi yang bisa disewa (warna, ukuran, kapasitas).</p>
          </div>
            <div className="flex rounded-xl border bg-muted/30 p-1">
              <Button type="button" size="sm" variant={!variantMode ? "secondary" : "ghost"} className="rounded-lg" onClick={() => setVariantMode(false)}>Tidak</Button>
              <Button type="button" size="sm" variant={variantMode ? "secondary" : "ghost"} className="rounded-lg" onClick={() => setVariantMode(true)}>Ya</Button>
            </div>
        </CardHeader>

        {variantMode ? (
          <CardContent className="space-y-3 p-4 pt-1 sm:space-y-5 sm:p-6 sm:pt-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Dimensi pilihan</p>
              <div className="flex flex-wrap gap-2">
                {DIMENSIONS.map((dimension) => (
                  <Button
                    type="button"
                    key={dimension.key}
                    size="sm"
                    variant={dimensions.includes(dimension.key) ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => toggleDimension(dimension.key)}
                  >
                    {dimension.label}
                  </Button>
                ))}
              </div>
            </div>


            <div className="grid gap-2 sm:hidden">
              {variants.map((row, index) => (
                <div key={index} className="rounded-2xl border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Pilihan {index + 1}</p>
                      <p className="text-[11px] text-muted-foreground">Unit fisik dibuat sesuai jumlah.</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg"
                      aria-label={"Hapus pilihan " + (index + 1)}
                      disabled={variants.length === 1}
                      onClick={() => setVariants((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {dimensions.map((dimension) => (
                      <label key={dimension} className="grid gap-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {DIMENSIONS.find((item) => item.key === dimension)?.label ?? dimension}
                        </span>
                        <Input
                          value={row.attributes[dimension] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setVariants((current) => current.map((item, rowIndex) =>
                              rowIndex === index
                                ? { ...item, attributes: { ...item.attributes, [dimension]: value } }
                                : item,
                            ));
                          }}
                          placeholder="Isi nilai"
                          className="h-9 rounded-lg text-sm"
                        />
                      </label>
                    ))}

                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">Jumlah</span>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(event) => {
                          const value = event.target.value;
                          setVariants((current) => current.map((item, rowIndex) =>
                            rowIndex === index ? { ...item, quantity: value } : item,
                          ));
                        }}
                        className="h-9 rounded-lg text-sm"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">Harga Sewa</span>
                      <Input
                        type="number"
                        min="0"
                        step="1000"
                        inputMode="numeric"
                        value={row.nominal}
                        onChange={(event) => {
                          const value = event.target.value;
                          setVariants((current) => current.map((item, rowIndex) =>
                            rowIndex === index ? { ...item, nominal: value } : item,
                          ));
                        }}
                        className="h-9 rounded-lg text-sm"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border sm:block">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b bg-muted/30 text-left">
                  <tr>
                    {dimensions.map((dimension) => (
                      <th key={dimension} className="px-3 py-3 font-medium">
                        {DIMENSIONS.find((item) => item.key === dimension)?.label ?? dimension}
                      </th>
                    ))}
                    <th className="px-3 py-3 font-medium">Jumlah</th>
                    <th className="px-3 py-3 font-medium">Harga Sewa</th>
                    <th className="w-12 px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {variants.map((row, index) => (
                    <tr key={index} className="border-b last:border-b-0">
                      {dimensions.map((dimension) => (
                        <td key={dimension} className="p-2">
                          <Input
                            value={row.attributes[dimension] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setVariants((current) => current.map((item, rowIndex) =>
                                rowIndex === index
                                  ? { ...item, attributes: { ...item.attributes, [dimension]: value } }
                                  : item,
                              ));
                            }}
                            placeholder="Isi nilai"
                            className="h-10 rounded-lg"
                          />
                        </td>
                      ))}
                      <td className="p-2">
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={row.quantity}
                          onChange={(event) => {
                            const value = event.target.value;
                            setVariants((current) => current.map((item, rowIndex) =>
                              rowIndex === index ? { ...item, quantity: value } : item,
                            ));
                          }}
                          className="h-10 rounded-lg"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          inputMode="numeric"
                          value={row.nominal}
                          onChange={(event) => {
                            const value = event.target.value;
                            setVariants((current) => current.map((item, rowIndex) =>
                              rowIndex === index ? { ...item, nominal: value } : item,
                            ));
                          }}
                          className="h-10 rounded-lg"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Hapus pilihan"
                          disabled={variants.length === 1}
                          onClick={() => setVariants((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => setVariants((current) => [...current, createVariantDraft(dimensions, price)])}
            >
              <Plus />Tambah pilihan
            </Button>

            <div className="flex flex-col gap-1 rounded-2xl bg-muted/30 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-muted-foreground">Total unit fisik</span>
              <strong>{variantUnitTotal} unit</strong>
            </div>
          </CardContent>
        ) : (
          <CardContent className="pt-0">
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              Tanpa pilihan. Semua unit memakai harga dan data barang yang sama.
            </div>
          </CardContent>
        )}
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="text-base sm:text-lg">Kontrol Lanjutan</CardTitle>
              <p className="mt-1 text-xs leading-5 font-normal text-muted-foreground sm:text-sm">
                Lengkapi data fisik per unit sekarang bila diperlukan.
              </p>
            </div>
            <Switch
              checked={advancedMode}
              onCheckedChange={setAdvancedMode}
              aria-label="Aktifkan kontrol unit lanjutan"
            />
          </div>
        </CardHeader>
        {advancedMode ? (
          <CardContent className="space-y-3 p-4 pt-1 sm:space-y-4 sm:p-6 sm:pt-2">
            <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Unit yang perlu dilengkapi</span>
                <strong>{physicalUnitCount} unit</strong>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Nomor seri bersifat opsional. Sistem tetap membuat kode unit operasional sendiri.
              </p>
            </div>

            <div className="space-y-3">
              {unitDetails.map((detail, index) => (
                <div key={index} className="rounded-2xl border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Unit {index + 1}</p>
                      {physicalUnitLabels[index] ? (
                        <p className="text-xs text-muted-foreground">{physicalUnitLabels[index]}</p>
                      ) : variantMode ? (
                        <p className="text-xs text-muted-foreground">Pilihan belum dilengkapi.</p>
                      ) : null}
                    </div>
                    <Badge variant="outline">Fisik</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium">
                      Nomor Seri
                      <Input
                        value={detail.serialNumber}
                        onChange={(event) => setUnitDetails((current) => current.map((item, rowIndex) =>
                          rowIndex === index ? { ...item, serialNumber: event.target.value } : item,
                        ))}
                        placeholder="Contoh: SN123456"
                        className="h-11 rounded-xl"
                      />
                    </label>

                    <label className="grid gap-2 text-sm font-medium">
                      Tanggal Diperoleh
                      <Input
                        type="date"
                        value={detail.tanggalDiperoleh}
                        onChange={(event) => setUnitDetails((current) => current.map((item, rowIndex) =>
                          rowIndex === index ? { ...item, tanggalDiperoleh: event.target.value } : item,
                        ))}
                        className="h-11 rounded-xl"
                      />
                    </label>
                  </div>

                  <label className="mt-3 grid gap-2 text-sm font-medium">
                    Catatan Internal
                    <Textarea
                      value={detail.catatanInternal}
                      onChange={(event) => setUnitDetails((current) => current.map((item, rowIndex) =>
                        rowIndex === index ? { ...item, catatanInternal: event.target.value } : item,
                      ))}
                      placeholder="Catatan khusus untuk unit ini"
                      className="min-h-20 rounded-xl"
                      rows={3}
                    />
                  </label>
                </div>
              ))}
            </div>
          </CardContent>
        ) : null}
      </Card>

      {validationError ? (
        <Alert>
          <AlertTitle>Lengkapi data</AlertTitle>
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="hidden rounded-3xl border-primary/20 bg-primary/[0.03] sm:block">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">Siap ditambahkan?</p>
            <p className="text-muted-foreground">
              Produk, tarif, unit fisik, QR, histori, dan audit dibuat dalam satu transaksi.
            </p>
          </div>
          <Button className="h-11 rounded-xl sm:min-w-44" disabled={submitDisabled} onClick={() => mutation.mutate()}>
            {pageState === "processing" ? "Menambahkan..." : "Tambahkan Barang"}
          </Button>
        </CardContent>
      </Card>
    </ListView>
  );
}
