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
import { getCatalogContext, listCatalogCategories, uploadCatalogMediaFile, uploadCatalogVariantMediaFile } from "@/features/katalog";
import {
  listQuickItemLocations,
  onboardQuickItem,
  onboardQuickSaleItem,
  quickItemLocationSelection,
  type QuickItemOnboardingInput,
  type QuickItemOnboardingResult,
  type QuickSaleItemOnboardingResult,
} from "@/features/katalog/quick-item";
import { paths } from "@/routes/paths";

type QuickItemPageState = "form" | "processing" | "success" | "error" | "unknown";
type VariantDraft = {
  attributes: Record<string, string>;
  quantity: string;
  nominal: string;
  cost: string;
  note: string;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  photoError: string;
};

const DIMENSIONS = [
  { key: "warna", label: "Warna" },
  { key: "kapasitas", label: "Kapasitas/Ukuran" },
  { key: "seri", label: "Seri" },
] as const;

const createVariantDraft = (dimensions: string[], nominal = "", cost = ""): VariantDraft => ({
  attributes: Object.fromEntries(dimensions.map((dimension) => [dimension, ""])),
  quantity: "1",
  nominal,
  cost,
  note: "",
  photoFile: null,
  photoPreviewUrl: null,
  photoError: "",
});

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Barang belum dapat ditambahkan.";

function VariantPhotoField({
  row,
  index,
  onChange,
}: {
  row: VariantDraft;
  index: number;
  onChange: (index: number, file: File | null) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {row.photoPreviewUrl ? (
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border bg-muted">
          <img src={row.photoPreviewUrl} alt={"Pratinjau foto pilihan " + (index + 1)} className="h-full w-full object-cover" />
          <button
            type="button"
            aria-label={"Hapus foto pilihan " + (index + 1)}
            onClick={() => onChange(index, null)}
            className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/65 text-white"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-semibold hover:bg-muted/50">
          <ImagePlus className="size-3.5 text-primary" />
          {row.photoFile ? "Ganti foto" : "Pilih foto"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              onChange(index, event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
        </label>
        <p className="mt-1 truncate text-[10px] leading-4 text-muted-foreground">
          {row.photoFile?.name ?? "JPG, PNG, WEBP · maks. 8 MB"}
        </p>
        {row.photoError ? <p className="mt-0.5 text-[10px] leading-4 text-destructive">{row.photoError}</p> : null}
      </div>
    </div>
  );
}

export function CatalogQuickItem() {
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);
  const variantPreviewUrlsRef = useRef<Set<string>>(new Set());
  const [pageState, setPageState] = useState<QuickItemPageState>("form");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<QuickItemOnboardingResult | QuickSaleItemOnboardingResult | null>(null);
  const [resultChannel, setResultChannel] = useState<"rental" | "sale">("rental");

  const [channelMode, setChannelMode] = useState<"rental" | "sale">("rental");
  const [saleInventoryMode, setSaleInventoryMode] = useState<"serialized" | "untracked">("serialized");
  const [salePrice, setSalePrice] = useState("");
  const [saleCost, setSaleCost] = useState("");

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
  const [includeNote, setIncludeNote] = useState(false);
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

  useEffect(() => () => {
    for (const url of variantPreviewUrlsRef.current) URL.revokeObjectURL(url);
    variantPreviewUrlsRef.current.clear();
  }, []);

  const variantUnitTotal = useMemo(
    () => variants.reduce((total, row) => total + (Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0), 0),
    [variants],
  );

  const physicalUnitCount = channelMode === "rental" || saleInventoryMode === "serialized"
    ? variantMode
      ? variantUnitTotal
      : (Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 0)
    : 0;

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
    const defaultVariantPrice = channelMode === "sale" ? salePrice : price;
    setVariants((current) =>
      current.length
        ? current.map((row) => ({
            ...row,
            attributes: Object.fromEntries(
              dimensions.map((dimension) => [dimension, row.attributes[dimension] ?? ""]),
            ),
          }))
        : [createVariantDraft(dimensions, defaultVariantPrice)],
    );
  }, [channelMode, dimensions, price, salePrice, variantMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!commandRef.current) commandRef.current = "quick-item-" + createClientId();

      const currentCommandKey = commandRef.current;
      let nextResult: QuickItemOnboardingResult | QuickSaleItemOnboardingResult;

      if (channelMode === "rental") {
        const parsedPrice = Number(price);
        const parsedDuration = Number(durationValue);
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
                attributes: {
                  ...row.attributes,
                  ...(includeNote && row.note.trim() ? { catatan: row.note.trim() } : {}),
                },
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
        nextResult = await onboardQuickItem(context.data.usahaId, payload, {
          idempotencyKey: currentCommandKey,
        });
      } else {
        nextResult = await onboardQuickSaleItem(context.data.usahaId, {
          kategoriBarangId: categoryMode === "existing" ? categoryId : null,
          kategoriNama: categoryMode === "new" ? categoryName.trim() : null,
          namaBarang: productName.trim(),
          deskripsi: description.trim() || null,
          inventoryMode: saleInventoryMode,
          hargaJual: variantMode ? null : Number(salePrice),
          hargaBeli: saleInventoryMode === "untracked" && !variantMode ? Number(saleCost) : null,
          jumlah: saleInventoryMode === "untracked" ? 0 : (variantMode ? 0 : Number(quantity)),
          lokasiId: saleInventoryMode === "serialized" ? locationId : null,
          varianMode: variantMode,
          variants: variantMode
            ? variants.map((row) => ({
                attributes: {
                  ...row.attributes,
                  ...(includeNote && row.note.trim() ? { catatan: row.note.trim() } : {}),
                },
                quantity: saleInventoryMode === "untracked" ? 0 : Number(row.quantity),
                hargaJual: Number(row.nominal),
                hargaBeli: saleInventoryMode === "untracked" ? Number(row.cost) : null,
              }))
            : [],
        }, { idempotencyKey: currentCommandKey });
      }

      const mediaWarnings: string[] = [];
      if (photoFile && currentCommandKey) {
        try {
          await uploadCatalogMediaFile(context.data.usahaId, nextResult.barang_id, photoFile, {
            isCover: true,
            urutan: 1,
            idempotencyKey: "quick-item-media-" + currentCommandKey,
          });
        } catch (error) {
          mediaWarnings.push("Foto produk: " + errorMessage(error));
        }
      }

      if (variantMode && currentCommandKey) {
        const uploadedVariantIds = new Set<string>();
        for (const [index, draft] of variants.entries()) {
          if (!draft.photoFile) continue;

          const createdVariant = channelMode === "sale"
            ? (nextResult as QuickSaleItemOnboardingResult).variants[index]
            : (nextResult as QuickItemOnboardingResult).variants.find((candidate) =>
                !uploadedVariantIds.has(candidate.varian_barang_id) &&
                dimensions.every((dimension) =>
                  String(candidate.atribut_pembeda?.[dimension] ?? "").trim() ===
                  String(draft.attributes[dimension] ?? "").trim(),
                ),
              );

          if (!createdVariant?.varian_barang_id) {
            mediaWarnings.push("Foto pilihan " + (index + 1) + ": data varian hasil simpan tidak dapat dicocokkan.");
            continue;
          }

          uploadedVariantIds.add(createdVariant.varian_barang_id);
          try {
            await uploadCatalogVariantMediaFile(
              context.data.usahaId,
              createdVariant.varian_barang_id,
              draft.photoFile,
              {
                isCover: true,
                urutan: 1,
                idempotencyKey: "quick-item-variant-media-" + currentCommandKey + "-" + createdVariant.varian_barang_id,
              },
            );
          } catch (error) {
            mediaWarnings.push("Foto pilihan " + (index + 1) + ": " + errorMessage(error));
          }
        }
      }

      return { result: nextResult, mediaWarning: mediaWarnings.join("\n") };
    },
    onMutate: () => {
      setPageState("processing");
      setFeedback("");
    },
    onSuccess: async ({ result: nextResult, mediaWarning }) => {
      setResult(nextResult);
      setResultChannel(channelMode);
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

    if (channelMode === "sale") {
      if (saleInventoryMode === "serialized" && locations.data && locations.data.length > 1 && !locationId) {
        return "Pilih lokasi penyimpanan barang.";
      }
      if (!variantMode) {
        if (!Number.isFinite(Number(salePrice)) || Number(salePrice) <= 0) return "Harga jual harus lebih dari nol.";
        if (saleInventoryMode === "untracked" && (!saleCost.trim() || !Number.isFinite(Number(saleCost)) || Number(saleCost) < 0)) return "HPP per unit wajib diisi nol atau lebih untuk barang tanpa stok.";
        if (saleInventoryMode === "serialized" && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
          return "Jumlah unit awal harus berupa angka bulat nol atau lebih.";
        }
        return null;
      }
      if (dimensions.length < 1 || dimensions.length > 3) return "Pilih minimal satu atribut pembeda.";
      if (!variants.length) return "Tambahkan minimal satu pilihan.";
      if (variants.some((row) =>
        dimensions.some((dimension) => !row.attributes[dimension]?.trim()) ||
        !Number.isFinite(Number(row.nominal)) || Number(row.nominal) <= 0 ||
        (saleInventoryMode === "untracked" && (!row.cost.trim() || !Number.isFinite(Number(row.cost)) || Number(row.cost) < 0)) ||
        (saleInventoryMode === "serialized" && (!Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 0))
      )) return "Lengkapi atribut, harga jual, dan jumlah unit untuk setiap pilihan.";
      return null;
    }

    const parsedPrice = Number(price);
    const parsedDuration = Number(durationValue);
    if (!variantMode && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) return "Harga sewa harus valid.";
    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) return "Durasi sewa harus lebih dari 0.";
    if (locations.data && locations.data.length > 1 && !locationId) return "Pilih lokasi barang.";
    if (!variantMode) {
      const parsedQuantity = Number(quantity);
      if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) return "Jumlah unit harus lebih dari 0.";
      return null;
    }
    if (dimensions.length < 1 || dimensions.length > 3) return "Pilih minimal satu atribut pembeda: warna, kapasitas/ukuran, atau seri.";
    if (!variants.length) return "Tambahkan minimal satu pilihan.";
    if (variants.some((row) =>
      dimensions.some((dimension) => !row.attributes[dimension]?.trim()) ||
      !Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0 ||
      !Number.isFinite(Number(row.nominal)) || Number(row.nominal) < 0
    )) return "Lengkapi nilai, jumlah unit, dan harga setiap pilihan.";
    return null;
  }, [
    categoryId, categoryMode, categoryName, channelMode, dimensions, durationValue,
    locationId, locations.data, price, productName, quantity, saleInventoryMode,
    saleCost, salePrice, variantMode, variants,
  ]);

  const submitDisabled =
    Boolean(validationError) ||
    Boolean(photoInputError) ||
    (variantMode && variants.some((row) => Boolean(row.photoError))) ||
    mutation.isPending ||
    pageState === "processing";

  const handleVariantPhotoChange = (index: number, file: File | null) => {
    const current = variants[index];
    if (!current) return;

    if (current.photoPreviewUrl) {
      URL.revokeObjectURL(current.photoPreviewUrl);
      variantPreviewUrlsRef.current.delete(current.photoPreviewUrl);
    }

    let nextFile = file;
    let photoError = "";
    if (file && !file.type.startsWith("image/")) {
      nextFile = null;
      photoError = "Foto varian harus berupa gambar.";
    } else if (file && file.size > 8 * 1024 * 1024) {
      nextFile = null;
      photoError = "Ukuran foto maksimal 8 MB.";
    }

    const photoPreviewUrl = nextFile ? URL.createObjectURL(nextFile) : null;
    if (photoPreviewUrl) variantPreviewUrlsRef.current.add(photoPreviewUrl);

    setVariants((rows) => rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, photoFile: nextFile, photoPreviewUrl, photoError } : row,
    ));
  };

  const removeVariantDraft = (index: number) => {
    const target = variants[index];
    if (target?.photoPreviewUrl) {
      URL.revokeObjectURL(target.photoPreviewUrl);
      variantPreviewUrlsRef.current.delete(target.photoPreviewUrl);
    }
    setVariants((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const clearVariantDraftPhotos = () => {
    for (const url of variantPreviewUrlsRef.current) URL.revokeObjectURL(url);
    variantPreviewUrlsRef.current.clear();
  };

  const toggleDimension = (key: string) => {
    setDimensions((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }
      if (current.length >= 3) return current;
      return [...current, key];
    });
  };

  const resetForm = () => {
    setPageState("form");
    setFeedback("");
    setResult(null);
    setResultChannel("rental");
    setChannelMode("rental");
    setSaleInventoryMode("serialized");
    setSalePrice("");
    setCategoryMode("existing");
    setCategoryId("");
    setCategoryName("");
    setProductName("");
    setDescription("");
    setPhotoFile(null);
    setPhotoInputError("");
    setPhotoUploadWarning("");
    clearVariantDraftPhotos();
    setPrice("65000");
    setDurationUnit("hari");
    setDurationValue("1");
    setQuantity("1");
    setLocationId(locationSelection.selectedLocationId);
    setVariantMode(false);
    setDimensions(["warna"]);
    setIncludeNote(false);
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
                  <Badge variant="secondary">
                    {resultChannel === "rental"
                      ? (result as QuickItemOnboardingResult).unit_count + " unit"
                      : (result as QuickSaleItemOnboardingResult).inventory_mode === "untracked"
                        ? "Tanpa stok"
                        : (result as QuickSaleItemOnboardingResult).unit_count + " unit"}
                  </Badge>
                  {result.variant_count > 0 ? <Badge variant="secondary">{result.variant_count} pilihan</Badge> : null}
                  <Badge variant="secondary">
                    {formatMoney(result.min_price, result.currency_code)}
                    {result.min_price !== result.max_price ? " – " + formatMoney(result.max_price, result.currency_code) : ""}
                    {resultChannel === "rental" ? " / " + (result as QuickItemOnboardingResult).durasi_unit : ""}
                  </Badge>
                  <Badge>{resultChannel === "rental" ? "Siap Disewakan" : "Siap Dijual"}</Badge>
                </div>
              </div>
            </div>
            {photoUploadWarning ? (
              <Alert>
                <AlertTitle>Barang tersimpan, foto belum dapat dipastikan</AlertTitle>
                <AlertDescription className="whitespace-pre-line">{photoUploadWarning} Barang tetap tersimpan; periksa kembali media sebelum mengaktifkan katalog publik.</AlertDescription>
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
        <h1 className="text-base font-bold tracking-tight">Tambah Katalog</h1>
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
          <p className="text-sm font-medium text-primary">Katalog</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Tambah Barang</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pilih penggunaan barang, lalu lengkapi informasi yang diperlukan.
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

      <Card className="overflow-hidden rounded-2xl border-primary/20 shadow-none">
        <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-3"><CardTitle className="text-base sm:text-lg">Jenis Barang</CardTitle><p className="mt-1 text-xs text-muted-foreground">Pilih satu penggunaan utama untuk barang ini.</p></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 p-4 pt-1 sm:p-5 sm:pt-2">
          <button type="button" onClick={() => { setChannelMode("rental"); setAdvancedMode(false); }} aria-pressed={channelMode === "rental"} className={`rounded-xl border p-3 text-left transition ${channelMode === "rental" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-background hover:bg-muted/40"}`}>
            <span className="block text-sm font-semibold">Sewa</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Unit fisik untuk operasional rental.</span>
          </button>
          <button type="button" onClick={() => { setChannelMode("sale"); setAdvancedMode(false); }} aria-pressed={channelMode === "sale"} className={`rounded-xl border p-3 text-left transition ${channelMode === "sale" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-background hover:bg-muted/40"}`}>
            <span className="block text-sm font-semibold">Jual</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Barang tersedia untuk transaksi POS.</span>
          </button>
        </CardContent>
      </Card>

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



      {channelMode === "rental" ? (
      <>
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
      </> ) : (
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
          <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-3"><CardTitle className="text-base sm:text-lg">Pengaturan Penjualan</CardTitle><p className="mt-1 text-xs text-muted-foreground">Tentukan harga jual dan pencatatan unit fisik.</p></CardHeader>
          <CardContent className="space-y-3 p-4 pt-1 sm:p-6 sm:pt-2">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSaleInventoryMode("serialized")} aria-pressed={saleInventoryMode === "serialized"} className={`rounded-xl border p-3 text-left transition ${saleInventoryMode === "serialized" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-background hover:bg-muted/40"}`}><span className="block text-sm font-semibold">Dengan stok</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Unit fisik terlacak dan berkurang saat terjual.</span></button>
              <button type="button" onClick={() => setSaleInventoryMode("untracked")} aria-pressed={saleInventoryMode === "untracked"} className={`rounded-xl border p-3 text-left transition ${saleInventoryMode === "untracked" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-background hover:bg-muted/40"}`}><span className="block text-sm font-semibold">Tanpa stok</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Tidak mengubah jumlah unit; cocok untuk isi ulang.</span></button>
            </div>
            {!variantMode ? <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">Harga Jual (IDR)<Input type="number" min="1" step="1000" inputMode="numeric" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} className="h-10 rounded-xl sm:h-11" placeholder="Contoh: 150000" /></label> : <div className="rounded-xl border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">Harga jual diatur pada setiap pilihan barang.</div>}
            {saleInventoryMode === "untracked" && !variantMode ? <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">HPP per Unit (IDR)<Input type="number" min="0" step="500" inputMode="numeric" value={saleCost} onChange={(event) => setSaleCost(event.target.value)} className="h-10 rounded-xl sm:h-11" placeholder="Contoh: 20000" /><span className="text-[11px] font-normal text-muted-foreground">Biaya isi ulang/pengadaan per unit untuk menghitung laba penjualan.</span></label> : null}
            {saleInventoryMode === "serialized" ? <>
              {!variantMode ? <label className="grid gap-1.5 text-xs font-semibold sm:text-sm">Jumlah Unit Awal<Input type="number" min="0" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-10 rounded-xl sm:h-11" /><span className="text-[11px] font-normal text-muted-foreground">Isi 0 bila stok akan ditambahkan melalui Pembelian.</span></label> : null}
              <div className="grid gap-1.5"><label className="text-xs font-semibold sm:text-sm">Lokasi Penyimpanan</label>{locationSelection.selectionRequired ? <Select value={locationId ?? ""} onValueChange={setLocationId}><SelectTrigger className="h-10 rounded-xl sm:h-11"><SelectValue placeholder="Pilih lokasi" /></SelectTrigger><SelectContent>{(locations.data ?? []).map((location) => <SelectItem key={location.lokasi_id} value={location.lokasi_id}>{location.nama}</SelectItem>)}</SelectContent></Select> : locations.data?.length === 1 ? <div className="flex h-10 items-center justify-between rounded-xl border bg-muted/30 px-3.5 text-sm sm:h-11"><span>{locations.data[0].nama}</span><Badge variant="secondary" className="rounded-full">Otomatis</Badge></div> : <p className="rounded-xl border border-dashed px-3.5 py-3 text-xs leading-5 text-muted-foreground">Lokasi dapat ditentukan kemudian.</p>}</div>
            </> : <div className="rounded-xl border border-dashed bg-muted/15 px-3 py-2.5 text-xs leading-5 text-muted-foreground">Tidak ada unit fisik yang dibuat atau dikurangi saat transaksi. Contoh: isi ulang LPG, tabung tetap kembali kepada pelanggan.</div>}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2 sm:p-6 sm:pb-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Variasi Barang</CardTitle>
            <p className="mt-1 text-xs leading-5 font-normal text-muted-foreground sm:text-sm">Pilih pembeda dan informasi yang diperlukan untuk setiap pilihan barang.</p>
          </div>
            <div className="flex rounded-xl border bg-muted/30 p-1">
              <Button type="button" size="sm" variant={!variantMode ? "secondary" : "ghost"} className="rounded-lg" onClick={() => setVariantMode(false)}>Tidak</Button>
              <Button type="button" size="sm" variant={variantMode ? "secondary" : "ghost"} className="rounded-lg" onClick={() => setVariantMode(true)}>Ya</Button>
            </div>
        </CardHeader>

        {variantMode ? (
          <CardContent className="space-y-3 p-4 pt-1 sm:space-y-5 sm:p-6 sm:pt-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Atribut pilihan</p>
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
                <Button
                  type="button"
                  size="sm"
                  variant={includeNote ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => setIncludeNote((current) => !current)}
                >
                  Catatan
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Pilih minimal satu pembeda: warna, kapasitas/ukuran, atau seri. Catatan bersifat opsional.
              </p>
            </div>


            <div className="grid gap-2 sm:hidden">
              {variants.map((row, index) => (
                <div key={index} className="rounded-2xl border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Pilihan {index + 1}</p>
                      <p className="text-[11px] text-muted-foreground">{channelMode === "rental" ? "Unit fisik dibuat sesuai jumlah." : saleInventoryMode === "untracked" ? "Pilihan tanpa pencatatan stok." : "Unit fisik tercatat sesuai jumlah awal."}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg"
                      aria-label={"Hapus pilihan " + (index + 1)}
                      disabled={variants.length === 1}
                      onClick={() => removeVariantDraft(index)}
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

                    {channelMode === "rental" || saleInventoryMode === "serialized" ? <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">{channelMode === "rental" ? "Jumlah unit" : "Stok awal"}</span>
                      <Input
                        type="number"
                        min={channelMode === "rental" ? "1" : "0"}
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
                    </label> : null}

                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">{channelMode === "rental" ? "Harga Sewa" : "Harga Jual"}</span>
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
                    {channelMode === "sale" && saleInventoryMode === "untracked" ? <label className="grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">HPP per unit (IDR)</span>
                      <Input type="number" min="0" step="500" inputMode="numeric" value={row.cost}
                        onChange={(event) => {
                          const value = event.target.value;
                          setVariants((current) => current.map((item, rowIndex) =>
                            rowIndex === index ? { ...item, cost: value } : item,
                          ));
                        }} className="h-9 rounded-lg text-sm" />
                    </label> : null}
                  </div>
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-2 text-[10px] font-semibold text-muted-foreground">Foto varian · opsional</p>
                    <VariantPhotoField row={row} index={index} onChange={handleVariantPhotoChange} />
                  </div>
                  {includeNote ? (
                    <label className="mt-3 grid gap-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">Catatan</span>
                      <Textarea
                        rows={2}
                        value={row.note}
                        onChange={(event) => {
                          const value = event.target.value;
                          setVariants((current) => current.map((item, rowIndex) =>
                            rowIndex === index ? { ...item, note: value } : item,
                          ));
                        }}
                        placeholder="Catatan tambahan untuk pilihan ini (opsional)"
                        className="min-h-16 rounded-lg text-sm"
                      />
                    </label>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border sm:block">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="border-b bg-muted/30 text-left">
                  <tr>
                    {dimensions.map((dimension) => (
                      <th key={dimension} className="px-3 py-3 font-medium">
                        {DIMENSIONS.find((item) => item.key === dimension)?.label ?? dimension}
                      </th>
                    ))}
                    {channelMode === "rental" || saleInventoryMode === "serialized" ? <th className="px-3 py-3 font-medium">{channelMode === "rental" ? "Jumlah unit" : "Stok awal"}</th> : null}
                    <th className="px-3 py-3 font-medium">{channelMode === "rental" ? "Harga Sewa" : "Harga Jual"}</th>
                    {channelMode === "sale" && saleInventoryMode === "untracked" ? <th className="px-3 py-3 font-medium">HPP per unit</th> : null}
                    {includeNote ? <th className="min-w-52 px-3 py-3 font-medium">Catatan</th> : null}
                    <th className="min-w-52 px-3 py-3 font-medium">Foto varian</th>
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
                      {channelMode === "rental" || saleInventoryMode === "serialized" ? <td className="p-2">
                        <Input
                          type="number"
                          min={channelMode === "rental" ? "1" : "0"}
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
                      </td> : null}
                      <td className="p-2">
                        <Input
                          type="number"
                          min={channelMode === "rental" ? "0" : "1"}
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
                      {channelMode === "sale" && saleInventoryMode === "untracked" ? <td className="p-2">
                        <Input type="number" min="0" step="500" inputMode="numeric" value={row.cost}
                          onChange={(event) => {
                            const value = event.target.value;
                            setVariants((current) => current.map((item, rowIndex) =>
                              rowIndex === index ? { ...item, cost: value } : item,
                            ));
                          }} className="h-10 rounded-lg" />
                      </td> : null}
                      {includeNote ? (
                        <td className="p-2">
                          <Textarea
                            rows={2}
                            value={row.note}
                            onChange={(event) => {
                              const value = event.target.value;
                              setVariants((current) => current.map((item, rowIndex) =>
                                rowIndex === index ? { ...item, note: value } : item,
                              ));
                            }}
                            placeholder="Opsional"
                            className="min-h-16 min-w-48 rounded-lg"
                          />
                        </td>
                      ) : null}
                      <td className="p-2">
                        <VariantPhotoField row={row} index={index} onChange={handleVariantPhotoChange} />
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Hapus pilihan"
                          disabled={variants.length === 1}
                          onClick={() => removeVariantDraft(index)}
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
              onClick={() => setVariants((current) => [...current, createVariantDraft(dimensions, channelMode === "sale" ? salePrice : price, channelMode === "sale" && saleInventoryMode === "untracked" ? saleCost : "")])}
            >
              <Plus />Tambah pilihan
            </Button>

            <div className="flex flex-col gap-1 rounded-2xl bg-muted/30 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-muted-foreground">{channelMode === "sale" && saleInventoryMode === "untracked" ? "Pilihan barang" : "Total unit fisik"}</span>
              <strong>{channelMode === "sale" && saleInventoryMode === "untracked" ? variants.length + " pilihan" : variantUnitTotal + " unit"}</strong>
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

      {channelMode === "rental" ? <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
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
      </Card> : null}

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
