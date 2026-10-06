import { createClientId } from "@/lib/client-id";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, ImagePlus, Loader2, Minus, MoreVertical, PackageOpen, Plus, Search, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  addCatalogPackageComponent,
  createCatalogPackage,
  createCatalogTariff,
  getCatalogContext,
  getCatalogPackageDetails,
  listCatalogCategories,
  listCatalogProducts,
  listCatalogVariants,
  removeCatalogPackageComponent,
  removeCatalogPackageMedia,
  setCatalogPackageState,
  updateCatalogPackage,
  updateCatalogTariff,
  uploadCatalogPackageMediaFile,
} from "@/features/katalog";
import type { CatalogPackageComponentDetail, CatalogPackageMedia, CatalogProduct, CatalogVariantOption } from "@/features/katalog/types";
import { catalogErrorMessage, formatCatalogMoney, isActiveCatalogTariff } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

type ComponentDraft = {
  id: string;
  targetType: "barang" | "varian";
  targetId: string;
  qty: string;
  note: string;
};

type PendingMedia = {
  id: string;
  file: File;
  previewUrl: string;
};

type PickerCartItem = {
  id: string;
  sourceComponentId?: string;
  targetType: "barang" | "varian";
  targetId: string;
  product: CatalogProduct;
  variant: CatalogVariantOption | null;
  qty: number;
  note: string;
};

const errorMessage = (error: unknown) => catalogErrorMessage(error, "Paket gagal diproses.");
const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "paket-rental";

const mediaUrl = (media: CatalogPackageMedia) =>
  import.meta.env.VITE_SUPABASE_URL + "/storage/v1/object/public/" + media.storage_bucket + "/" + media.storage_path;

const componentLabel = (component: CatalogPackageComponentDetail) =>
  component.varian?.nama ?? component.barang?.nama ?? "Komponen tidak tersedia";

function productImage(product: CatalogProduct | null | undefined) {
  return product?.cover_url ?? null;
}

export function CatalogPackagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editMode = Boolean(id);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingMediaRef = useRef<PendingMedia[]>([]);

  const context = useQuery({
    queryKey: ["katalog", "context"],
    queryFn: getCatalogContext,
    staleTime: 60_000,
  });
  const categories = useQuery({
    queryKey: ["katalog", "package-categories", context.data?.usahaId],
    queryFn: () => listCatalogCategories(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["katalog", "package-products", context.data?.usahaId],
    queryFn: () =>
      listCatalogProducts(context.data!.usahaId, {
        search: "",
        categoryId: "all",
        status: "active",
        visibility: "all",
        sort: "name_asc",
        page: 1,
        pageSize: 300,
      }),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });
  const variants = useQuery({
    queryKey: ["katalog", "package-variants", context.data?.usahaId],
    queryFn: () => listCatalogVariants(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });
  const details = useQuery({
    queryKey: ["katalog", "package-detail", context.data?.usahaId, id],
    queryFn: () => getCatalogPackageDetails(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 10_000,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [showPublic, setShowPublic] = useState(false);
  const [promo, setPromo] = useState(false);
  const [newComponents, setNewComponents] = useState<ComponentDraft[]>([]);
  const [removedComponentIds, setRemovedComponentIds] = useState<string[]>([]);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [pendingCoverId, setPendingCoverId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [partialState, setPartialState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tariffForm, setTariffForm] = useState({ name: "Harian", durationValue: "1", durationUnit: "hari" });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerCategory, setPickerCategory] = useState("all");
  const [pickerType, setPickerType] = useState<"all" | "product" | "variant">("all");
  const [pickerCart, setPickerCart] = useState<PickerCartItem[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [itemMenuId, setItemMenuId] = useState<string | null>(null);

  const pkg = details.data?.package;
  const activeTariffs = useMemo(
    () => (details.data?.tariffs ?? []).filter((item) => isActiveCatalogTariff(item)),
    [details.data?.tariffs],
  );
  const visibleComponents = useMemo(
    () => (details.data?.components ?? []).filter((item) => !removedComponentIds.includes(item.komponen_paket_id)),
    [details.data?.components, removedComponentIds],
  );
  const visibleMedia = useMemo(
    () => (details.data?.media ?? []).filter((item) => !removedMediaIds.includes(item.paket_media_id)),
    [details.data?.media, removedMediaIds],
  );

  const productOptions = useMemo(() => products.data?.products ?? [], [products.data?.products]);
  const variantOptions = useMemo(() => variants.data ?? [], [variants.data]);
  const categoryOptions = categories.data ?? [];

  const pickerVariantsByProduct = useMemo(() => {
    const map = new Map<string, CatalogVariantOption[]>();
    variantOptions.forEach((variant) => {
      const current = map.get(variant.barang_id) ?? [];
      current.push(variant);
      map.set(variant.barang_id, current);
    });
    return map;
  }, [variantOptions]);

  const pickerProducts = useMemo(() => {
    const search = pickerSearch.trim().toLowerCase();
    return productOptions.filter((product) => {
      const categoryMatches = pickerCategory === "all" || product.kategori_barang_id === pickerCategory;
      if (!categoryMatches) return false;
      if (!search) return true;
      const variants = pickerVariantsByProduct.get(product.barang_id) ?? [];
      return [
        product.nama,
        product.kategori?.nama ?? "",
        product.slug,
        ...variants.map((variant) => variant.nama),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [pickerCategory, pickerSearch, pickerVariantsByProduct, productOptions]);

  const pickerVariantRows = useMemo(() => {
    const search = pickerSearch.trim().toLowerCase();
    const productById = new Map(productOptions.map((product) => [product.barang_id, product]));
    return variantOptions.filter((variant) => {
      const product = productById.get(variant.barang_id);
      if (!product) return false;
      if (pickerCategory !== "all" && product.kategori_barang_id !== pickerCategory) return false;
      if (!search) return true;
      return [variant.nama, product.nama, product.kategori?.nama ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [pickerCategory, pickerSearch, productOptions, variantOptions]);

  const pickerCartUnits = useMemo(
    () => pickerCart.reduce((sum, item) => sum + item.qty, 0),
    [pickerCart],
  );

  const pickerCartKey = (targetType: "barang" | "varian", targetId: string) =>
    targetType + ":" + targetId;

  const pickerCartItem = (targetType: "barang" | "varian", targetId: string) =>
    pickerCart.find((item) => pickerCartKey(item.targetType, item.targetId) === pickerCartKey(targetType, targetId));

  useEffect(() => {
    if (!pkg) return;
    const metadata = pkg.metadata ?? {};
    setName(pkg.nama);
    setDescription(pkg.deskripsi ?? "");
    setBasePrice(pkg.harga_dasar == null ? "" : String(pkg.harga_dasar));
    setShowPublic(pkg.status === "active" && pkg.is_public);
    setPromo(metadata.promo_label_enabled === true);
    if (activeTariffs[0]) {
      setTariffForm({
        name: activeTariffs[0].nama,
        durationValue: String(activeTariffs[0].durasi_nilai),
        durationUnit: activeTariffs[0].durasi_unit,
      });
      if (pkg.harga_dasar == null) {
        setBasePrice(String(activeTariffs[0].nominal));
      }
    }
  }, [activeTariffs, pkg]);

  pendingMediaRef.current = pendingMedia;

  useEffect(() => {
    return () => {
      pendingMediaRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  function addMedia(files: FileList | null) {
    if (!files) return;
    const added: PendingMedia[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error(file.name + ": hanya gambar.");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error(file.name + ": maksimum 8 MB.");
        continue;
      }
      added.push({
        id: createClientId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (!added.length) return;
    setPendingMedia((current) => [...current, ...added]);
    if (!pendingCoverId && !visibleMedia.some((item) => item.is_cover)) {
      setPendingCoverId(added[0].id);
    }
  }

  function openPicker() {
    setPickerSearch("");
    setPickerCategory("all");
    setPickerType("all");

    const seeded: PickerCartItem[] = [];

    visibleComponents.forEach((component) => {
      const variant = component.varian_barang_id
        ? variantOptions.find((value) => value.varian_barang_id === component.varian_barang_id) ?? null
        : null;
      const product = productOptions.find(
        (value) => value.barang_id === (variant?.barang_id ?? component.barang_id),
      );
      const targetId = component.varian_barang_id ?? component.barang_id;
      if (!product || !targetId) return;
      seeded.push({
        id: "existing-" + component.komponen_paket_id,
        sourceComponentId: component.komponen_paket_id,
        targetType: component.varian_barang_id ? "varian" : "barang",
        targetId,
        product,
        variant,
        qty: component.jumlah,
        note: component.catatan ?? "",
      });
    });

    newComponents.forEach((component) => {
      const { product, variant } = itemDetailsFromDraft(component);
      if (!product) return;
      seeded.push({
        id: component.id,
        targetType: component.targetType,
        targetId: component.targetId,
        product,
        variant,
        qty: Number(component.qty) || 1,
        note: component.note,
      });
    });

    setPickerCart(seeded);
    setPickerOpen(true);
  }

  function updatePickerQuantity(
    targetType: "barang" | "varian",
    targetId: string,
    product: CatalogProduct,
    variant: CatalogVariantOption | null,
    delta: number,
  ) {
    setPickerCart((current) => {
      const key = pickerCartKey(targetType, targetId);
      const existing = current.find((item) => pickerCartKey(item.targetType, item.targetId) === key);
      const nextQty = (existing?.qty ?? 0) + delta;

      if (nextQty <= 0) {
        return current.filter((item) => pickerCartKey(item.targetType, item.targetId) !== key);
      }

      if (!existing) {
        return [
          ...current,
          {
            id: createClientId(),
            targetType,
            targetId,
            product,
            variant,
            qty: nextQty,
            note: "",
          },
        ];
      }

      return current.map((item) =>
        pickerCartKey(item.targetType, item.targetId) === key ? { ...item, qty: nextQty } : item,
      );
    });
  }

  function updatePickerNote(targetType: "barang" | "varian", targetId: string, note: string) {
    setPickerCart((current) =>
      current.map((item) =>
        pickerCartKey(item.targetType, item.targetId) === pickerCartKey(targetType, targetId)
          ? { ...item, note }
          : item,
      ),
    );
  }

  function pickerQuantityControl(
    targetType: "barang" | "varian",
    targetId: string,
    product: CatalogProduct,
    variant: CatalogVariantOption | null,
  ) {
    const item = pickerCartItem(targetType, targetId);
    const qty = item?.qty ?? 0;
    return (
      <div className="shrink-0">
        <div className="flex items-center rounded-xl border bg-background">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-l-xl text-muted-foreground hover:bg-muted disabled:opacity-40"
            aria-label="Kurangi jumlah"
            disabled={qty === 0}
            onClick={() => updatePickerQuantity(targetType, targetId, product, variant, -1)}
          >
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-8 text-center text-sm font-bold">{qty}</span>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-r-xl text-primary hover:bg-primary/5"
            aria-label="Tambah jumlah"
            onClick={() => updatePickerQuantity(targetType, targetId, product, variant, 1)}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {item && item.qty > 0 ? (
          <Input
            value={item.note}
            onChange={(event) => updatePickerNote(targetType, targetId, event.target.value)}
            placeholder="Catatan"
            className="mt-1.5 h-8 w-28 rounded-lg px-2 text-[10px]"
            maxLength={200}
            aria-label="Catatan item"
          />
        ) : null}
      </div>
    );
  }

  function finishPicker() {
    const nextNewComponents: ComponentDraft[] = [];
    const nextRemovedIds = new Set(removedComponentIds);

    visibleComponents.forEach((component) => {
      const cartItem = pickerCart.find((item) => item.sourceComponentId === component.komponen_paket_id);
      if (!cartItem) {
        nextRemovedIds.add(component.komponen_paket_id);
        return;
      }

      const sameTarget =
        (component.varian_barang_id ? "varian" : "barang") === cartItem.targetType &&
        (component.varian_barang_id ?? component.barang_id) === cartItem.targetId;
      const sameQty = component.jumlah === cartItem.qty;
      const sameNote = (component.catatan ?? "") === cartItem.note;

      if (!sameTarget || !sameQty || !sameNote) {
        nextRemovedIds.add(component.komponen_paket_id);
        nextNewComponents.push({
          id: cartItem.id,
          targetType: cartItem.targetType,
          targetId: cartItem.targetId,
          qty: String(cartItem.qty),
          note: cartItem.note.trim(),
        });
      }
    });

    pickerCart
      .filter((item) => !item.sourceComponentId)
      .forEach((item) => {
        nextNewComponents.push({
          id: item.id,
          targetType: item.targetType,
          targetId: item.targetId,
          qty: String(item.qty),
          note: item.note.trim(),
        });
      });

    setRemovedComponentIds([...nextRemovedIds]);
    setNewComponents(nextNewComponents);
    setPickerOpen(false);
  }

  function editExistingComponent(component: CatalogPackageComponentDetail) {
    openPicker();
    setPickerSearch(componentLabel(component));
    setItemMenuId(null);
  }

  function removeExistingComponent(component: CatalogPackageComponentDetail) {
    setRemovedComponentIds((current) =>
      current.includes(component.komponen_paket_id)
        ? current.filter((item) => item !== component.komponen_paket_id)
        : [...current, component.komponen_paket_id],
    );
    setItemMenuId(null);
  }

  function removeNewComponent(componentId: string) {
    setNewComponents((current) => current.filter((item) => item.id !== componentId));
    setItemMenuId(null);
  }


  function itemDetailsFromDraft(item: ComponentDraft) {
    const variant = item.targetType === "varian"
      ? variantOptions.find((value) => value.varian_barang_id === item.targetId) ?? null
      : null;
    const product = productOptions.find((value) => value.barang_id === (variant?.barang_id ?? item.targetId)) ?? null;
    return { product, variant };
  }

  async function savePackage() {
    if (!context.data) return;
    if (!name.trim()) {
      setSaveError("Nama paket wajib diisi.");
      return;
    }
    if (
      basePrice !== "" &&
      (!Number.isFinite(Number(basePrice)) || Number(basePrice) < 0)
    ) {
      setSaveError("Harga paket harus berupa angka nol atau lebih.");
      return;
    }

    const tariffAmount = basePrice.trim() === "" ? null : Number(basePrice);
    const tariffDuration = Number(tariffForm.durationValue);
    if (
      tariffAmount !== null &&
      (!Number.isFinite(tariffAmount) || tariffAmount < 0 ||
        !tariffForm.durationUnit.trim() ||
        !Number.isFinite(tariffDuration) ||
        tariffDuration <= 0)
    ) {
      setSaveError("Tarif paket belum valid.");
      return;
    }
    if (activeTariffs[0] && tariffAmount === null) {
      setSaveError("Tarif aktif paket harus memiliki nominal.");
      return;
    }
    if (
      newComponents.some(
        (item) => !item.targetId || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0,
      )
    ) {
      setSaveError("Semua item harus memiliki barang/varian dan jumlah lebih dari 0.");
      return;
    }

    const counts = new Map<string, number>();
    visibleComponents.forEach((item) => {
      const key = (item.varian_barang_id ? "varian:" : "barang:") + (item.varian_barang_id ?? item.barang_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    newComponents.forEach((item) => {
      const key = item.targetType + ":" + item.targetId;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    if ([...counts.values()].some((count) => count > 1)) {
      setSaveError("Satu barang atau varian hanya boleh muncul satu kali dalam paket.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setPartialState(false);

    const packageStatus: "active" | "inactive" | "draft" = pkg
      ? pkg.status === "inactive"
        ? "inactive"
        : pkg.status === "draft"
          ? "draft"
          : "active"
      : showPublic
        ? "active"
        : "draft";
    const metadata = {
      ...(pkg?.metadata ?? {}),
      promo_label_enabled: promo,
    };
    let packageId = id ?? "";

    try {
      const payload = {
        nama: name.trim(),
        slug: pkg?.slug ?? slugify(name),
        deskripsi: description.trim() || null,
        hargaDasar: basePrice === "" ? null : Number(basePrice),
        currencyCode: pkg?.currency_code ?? "IDR",
        status: packageStatus,
        isPublic: packageStatus === "active" && showPublic,
        metadata,
      };

      if (!packageId) {
        const created = await createCatalogPackage(context.data.usahaId, payload, {
          idempotencyKey: "create-package-" + createClientId(),
        });
        packageId = String(created.paket_sewa_id ?? "");
        if (!packageId) throw new Error("Paket dibuat tetapi ID paket tidak dikembalikan server.");
      } else {
        const updated = await updateCatalogPackage(
          context.data.usahaId,
          packageId,
          {
            ...payload,
            expectedUpdatedAt: pkg?.updated_at,
          },
          { idempotencyKey: "update-package-" + createClientId() },
        );
        const updatedAt = typeof updated.updated_at === "string" ? updated.updated_at : pkg?.updated_at;
        if (packageStatus !== "active" || showPublic !== pkg?.is_public) {
          await setCatalogPackageState(
            context.data.usahaId,
            packageId,
            packageStatus,
            packageStatus === "active" && showPublic,
            updatedAt,
            { idempotencyKey: "set-package-state-" + createClientId() },
          );
        }
      }

      if (tariffAmount !== null) {
        const currentTariff = activeTariffs[0];
        if (currentTariff) {
          await updateCatalogTariff(
            context.data.usahaId,
            {
              tarifSewaId: currentTariff.tarif_sewa_id,
              nama: tariffForm.name.trim() || currentTariff.nama,
              durasiNilai: tariffDuration,
              durasiUnit: tariffForm.durationUnit.trim(),
              nominal: tariffAmount,
              berlakuMulai: currentTariff.berlaku_mulai,
              berlakuSampai: currentTariff.berlaku_sampai,
              expectedUpdatedAt: currentTariff.updated_at,
            },
            { idempotencyKey: "update-package-tariff-" + currentTariff.tarif_sewa_id + "-" + createClientId() },
          );
        } else {
          await createCatalogTariff(
            context.data.usahaId,
            {
              paketSewaId: packageId,
              nama: tariffForm.name.trim() || "Harian",
              durasiNilai: tariffDuration,
              durasiUnit: tariffForm.durationUnit.trim(),
              nominal: tariffAmount,
              currencyCode: pkg?.currency_code ?? "IDR",
              status: "active",
            },
            { idempotencyKey: "create-package-tariff-" + packageId + "-" + createClientId() },
          );
        }
      }

      for (const componentId of removedComponentIds) {
        await removeCatalogPackageComponent(context.data.usahaId, componentId, {
          idempotencyKey: "remove-package-component-" + componentId + "-" + createClientId(),
        });
      }

      for (const component of newComponents) {
        await addCatalogPackageComponent(
          context.data.usahaId,
          {
            paketSewaId: packageId,
            barangId: component.targetType === "barang" ? component.targetId : null,
            varianBarangId: component.targetType === "varian" ? component.targetId : null,
            jumlah: Number(component.qty),
            catatan: component.note.trim() || null,
          },
          { idempotencyKey: "add-package-component-" + component.id },
        );
      }

      let order = visibleMedia.length;
      for (const media of pendingMedia) {
        order += 1;
        await uploadCatalogPackageMediaFile(
          context.data.usahaId,
          packageId,
          media.file,
          {
            isCover:
              media.id === pendingCoverId ||
              (order === 1 && !visibleMedia.some((item) => item.is_cover)),
            urutan: order,
            idempotencyKey: "upload-package-media-" + media.id,
          },
        );
      }

      for (const mediaId of removedMediaIds) {
        await removeCatalogPackageMedia(context.data.usahaId, mediaId, {
          idempotencyKey: "remove-package-media-" + mediaId + "-" + createClientId(),
        });
      }

      pendingMedia.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingMedia([]);
      setPendingCoverId(null);
      setNewComponents([]);
      setRemovedComponentIds([]);
      setRemovedMediaIds([]);
      setPartialState(false);

      navigate(paths.katalog + "?view=packages", { replace: true });
      toast.success(editMode ? "Paket berhasil disimpan." : "Paket berhasil dibuat.");
    } catch (error) {
      setSaveError(errorMessage(error));
      setPartialState(true);
    } finally {
      setSaving(false);
    }
  }

  if (context.isPending || (editMode && details.isPending)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
        <div className="h-10 animate-pulse rounded-xl bg-muted" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-56 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Konteks Usaha tidak tersedia</AlertTitle>
        <AlertDescription>{errorMessage(context.error)}</AlertDescription>
      </Alert>
    );
  }

  if (editMode && (details.error || !pkg)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Paket tidak dapat dimuat</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{errorMessage(details.error)}</p>
          <Button variant="outline" onClick={() => void details.refetch()}>
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const tariffSummary = activeTariffs[0] ?? null;
  const effectivePrice = basePrice !== "" ? Number(basePrice) : tariffSummary?.nominal ?? null;
  const visibleNewComponents = newComponents.filter((item) => item.targetId);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-9 rounded-xl">
              <Link to={paths.katalog} aria-label="Kembali ke Katalog">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <h1 className="truncate text-[17px] font-bold tracking-tight">{editMode ? "Ubah Paket" : "Paket Baru"}</h1>
          </div>
          <Button
            onClick={() => void savePackage()}
            disabled={saving || context.isPending || (editMode && details.isPending)}
            className="h-9 rounded-xl px-4 text-sm font-semibold shadow-sm"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Simpan
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-0">
        <section className="border-b px-4 py-4">
          <label className="block text-sm font-semibold">
            Nama Paket <span className="text-destructive">*</span>
            <Input
              className="mt-2 h-11 rounded-xl border-border/80 bg-background text-[15px] font-medium shadow-none"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Paket Camping 4 Orang"
            />
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Nama yang mudah dicari operator.</span>
          </label>
        </section>

        <section className="border-b px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ImagePlus className="size-4 text-primary" />
              Foto Paket
            </div>
            <span className="text-[11px] text-muted-foreground">{visibleMedia.length + pendingMedia.length} foto</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              addMedia(event.target.files);
              event.currentTarget.value = "";
            }}
          />

          <div className="grid grid-cols-4 gap-2">
            {visibleMedia.map((media) => (
              <div key={media.paket_media_id} className="group relative overflow-hidden rounded-xl border bg-muted/30">
                <div className="aspect-square">
                  <img src={mediaUrl(media)} alt="Foto paket" className="size-full object-cover" />
                </div>
                {media.is_cover ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold text-white">Cover</span>
                ) : null}
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/92 text-foreground shadow-sm"
                  aria-label="Hapus foto"
                  onClick={() => setRemovedMediaIds((current) => current.includes(media.paket_media_id) ? current.filter((value) => value !== media.paket_media_id) : [...current, media.paket_media_id])}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}

            {pendingMedia.map((media) => (
              <div key={media.id} className="relative overflow-hidden rounded-xl border border-primary/30 bg-muted/30">
                <div className="aspect-square">
                  <img src={media.previewUrl} alt={media.file.name} className="size-full object-cover" />
                </div>
                {pendingCoverId === media.id ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-primary-foreground">Cover</span>
                ) : null}
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/92 text-foreground shadow-sm"
                  aria-label="Hapus foto baru"
                  onClick={() => {
                    URL.revokeObjectURL(media.previewUrl);
                    setPendingMedia((current) => current.filter((value) => value.id !== media.id));
                    if (pendingCoverId === media.id) setPendingCoverId(null);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/15 text-muted-foreground transition hover:bg-muted/30"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-5" />
              <span className="mt-1 text-[11px] font-medium">Tambah Foto</span>
              <span className="mt-0.5 text-[9px]">JPG/PNG · 8 MB</span>
            </button>
          </div>
        </section>

        <section className="border-b px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <PackageOpen className="size-4 text-primary" />
              Isi Paket
            </div>
            <span className="text-xs text-muted-foreground">{visibleComponents.length + visibleNewComponents.length} barang</span>
          </div>

          <div className="space-y-2">
            {visibleComponents.map((component) => {
              const variant = component.varian_barang_id ? variantOptions.find((value) => value.varian_barang_id === component.varian_barang_id) : null;
              const product = productOptions.find((value) => value.barang_id === (variant?.barang_id ?? component.barang_id));
              const image = productImage(product);
              const quantity = component.jumlah;

              return (
                <div key={component.komponen_paket_id} className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-background px-2.5 py-2.5">
                  <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {image ? <img src={image} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted-foreground"><PackageOpen className="size-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{component.varian?.nama ?? product?.nama ?? componentLabel(component)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{component.varian ? product?.nama ?? "Varian" : product?.kategori?.nama ?? "Barang"}{component.catatan ? " · " + component.catatan : ""}</p>
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-lg border bg-muted/30 px-1">
                      <span className="px-2 py-1 text-xs font-semibold">× {quantity}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                    aria-label="Menu item"
                    onClick={() => setItemMenuId((current) => current === component.komponen_paket_id ? null : component.komponen_paket_id)}
                  >
                    <MoreVertical className="size-4" />
                  </button>
                  {itemMenuId === component.komponen_paket_id ? (
                    <div className="absolute right-3 z-10 mt-28 w-40 overflow-hidden rounded-xl border bg-background p-1 shadow-lg">
                      <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => editExistingComponent(component)}>
                        Ubah
                      </button>
                      <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/5" onClick={() => removeExistingComponent(component)}>
                        Hapus
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {newComponents.map((component) => {
              const { product, variant } = itemDetailsFromDraft(component);
              if (!product) return null;
              return (
                <div key={component.id} className="relative flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.02] px-2.5 py-2.5">
                  <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {productImage(product) ? <img src={productImage(product)!} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted-foreground"><PackageOpen className="size-5" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{variant?.nama ?? product.nama}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{product.nama}{component.note ? " · " + component.note : ""}</p>
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-lg border bg-muted/30 px-1">
                      <span className="px-2 py-1 text-xs font-semibold">× {component.qty}</span>
                    </div>
                  </div>
                  <button type="button" className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Hapus item" onClick={() => removeNewComponent(component.id)}>
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/35 bg-primary/[0.02] px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/[0.05]"
              onClick={() => openPicker()}
            >
              <Plus className="size-4" />
              Tambah Barang
            </button>
          </div>
        </section>

        <section className="border-b px-4 py-4">
          <div className="mb-3">
            <p className="text-sm font-semibold">Harga Paket</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Tentukan nominal dan periode tarif paket dengan jelas.</p>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs font-semibold">
              Harga sewa
              <div className="flex items-center rounded-xl border bg-background focus-within:ring-2 focus-within:ring-primary/20">
                <span className="px-3 text-sm font-semibold text-muted-foreground">Rp</span>
                <Input
                  className="h-12 min-w-0 flex-1 border-0 px-0 text-lg font-bold shadow-none focus-visible:ring-0"
                  inputMode="decimal"
                  value={basePrice}
                  onChange={(event) => setBasePrice(event.target.value)}
                  placeholder="500000"
                  aria-label="Harga Paket"
                />
              </div>
            </label>

            <div className="grid gap-1.5">
              <span className="text-xs font-semibold">Periode tarif</span>
              <div className="flex items-center gap-2">
                <div className="flex h-11 w-24 shrink-0 items-center rounded-xl border bg-background">
                  <Input
                    className="h-full w-full border-0 text-center text-base font-bold shadow-none focus-visible:ring-0"
                    inputMode="numeric"
                    value={tariffForm.durationValue}
                    onChange={(event) => setTariffForm((current) => ({ ...current, durationValue: event.target.value }))}
                    aria-label="Durasi tarif"
                  />
                </div>
                <select
                  value={tariffForm.durationUnit}
                  onChange={(event) => setTariffForm((current) => ({ ...current, durationUnit: event.target.value }))}
                  aria-label="Satuan tarif"
                  className="h-11 min-w-28 flex-1 rounded-xl border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="hari">Hari</option>
                  <option value="jam">Jam</option>
                  <option value="minggu">Minggu</option>
                  <option value="bulan">Bulan</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-muted/35 px-3.5 py-2.5">
              <span className="text-xs text-muted-foreground">Tarif paket</span>
              <span className="text-sm font-bold">
                {effectivePrice != null
                  ? formatCatalogMoney(effectivePrice, pkg?.currency_code ?? "IDR") +
                    " / " +
                    (tariffForm.durationValue || "1") +
                    " " +
                    (tariffForm.durationUnit || "hari")
                  : "Belum diisi"}
              </span>
            </div>
          </div>
        </section>

        <section className="px-4 py-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-1 text-left"
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <div>
              <p className="text-sm font-semibold">Informasi Tambahan</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Deskripsi, label, dan pengaturan lanjutan</p>
            </div>
            <ChevronDown className={advancedOpen ? "size-4 rotate-180 text-muted-foreground transition-transform" : "size-4 text-muted-foreground transition-transform"} />
          </button>

          {advancedOpen ? (
            <div className="mt-4 space-y-4 border-t pt-4">
              <label className="grid gap-2 text-sm font-medium">
                Deskripsi
                <Textarea
                  className="min-h-28 rounded-xl"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Paket lengkap untuk 4 orang..."
                  maxLength={500}
                />
                <span className="text-right text-[10px] text-muted-foreground">{description.length}/500</span>
              </label>

              <div className="border-y py-3">
                <div className="flex flex-wrap gap-2">
                  {[promo ? "Camping" : "Tambah label"].map((label) => (
                    <Badge key={label} variant={promo ? "secondary" : "outline"} className="rounded-full px-3 py-1">
                      {promo ? "Promo" : label}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Tandai sebagai promo</p>
                    <p className="text-[11px] text-muted-foreground">Label presentasi saja.</p>
                  </div>
                  <Switch checked={promo} onCheckedChange={setPromo} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-b pb-3">
                <div>
                  <p className="text-sm font-medium">Tampilkan di pilihan paket</p>
                  <p className="text-[11px] text-muted-foreground">Paket aktif dapat ditampilkan pada katalog publik.</p>
                </div>
                <Switch checked={showPublic} onCheckedChange={setShowPublic} disabled={pkg?.status === "inactive"} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Slug</p>
                  <p className="truncate text-[11px] text-muted-foreground">{pkg?.slug ?? slugify(name)}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {saveError ? (
          <div className="px-4 pb-4">
            <Alert variant="destructive" className="rounded-xl">
              <AlertTitle>Belum tersimpan</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {partialState ? (
          <div className="px-4 pb-4">
            <Alert className="rounded-xl">
              <AlertTitle>Perubahan tersimpan sebagian</AlertTitle>
              <AlertDescription>Periksa data terbaru sebelum mengulangi tindakan.</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-3 py-2.5 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{visibleComponents.length + visibleNewComponents.length} barang</p>
            <p className="truncate text-sm font-bold">
              {effectivePrice != null ? formatCatalogMoney(effectivePrice, pkg?.currency_code ?? "IDR") : "Harga belum diisi"}
              {basePrice !== "" ? " / " + (tariffForm.durationValue || "1") + " " + (tariffForm.durationUnit || "hari") : ""}
            </p>
          </div>
          <Button
            onClick={() => void savePackage()}
            disabled={saving || context.isPending || (editMode && details.isPending)}
            className="h-11 rounded-xl px-5 font-semibold"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            {editMode ? "Simpan Perubahan" : "Simpan Paket"}
          </Button>
        </div>
      </div>

      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setItemMenuId(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[92vh] rounded-t-[28px] border-0 p-0 shadow-[0_-20px_60px_rgba(0,0,0,0.2)]"
        >
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
            <SheetHeader className="border-b px-4 pb-3 pt-2.5 text-left">
              <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/25" />
              <div className="flex items-center justify-between">
                <SheetTitle className="text-base font-bold">Tambah Barang ke Paket</SheetTitle>
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  onClick={() => setPickerOpen(false)}
                  aria-label="Tutup"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                  placeholder="Cari barang, kategori, atau varian..."
                  className="h-10 rounded-xl border-0 bg-muted/55 pl-9 shadow-none"
                />
              </div>
            </SheetHeader>

            <div className="space-y-2 border-b px-4 py-3">
              <div className="flex gap-2 overflow-x-auto">
                {([
                  ["all", "Semua"],
                  ["product", "Produk"],
                  ["variant", "Varian"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={[
                      "shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition",
                      pickerType === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                    onClick={() => setPickerType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 overflow-x-auto pt-1">
                <button
                  type="button"
                  className={[
                    "shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold",
                    pickerCategory === "all"
                      ? "border-primary bg-primary/[0.05] text-primary"
                      : "border-border bg-background text-muted-foreground",
                  ].join(" ")}
                  onClick={() => setPickerCategory("all")}
                >
                  Semua kategori
                </button>
                {categoryOptions.map((category) => (
                  <button
                    type="button"
                    key={category.kategori_barang_id}
                    className={[
                      "shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold",
                      pickerCategory === category.kategori_barang_id
                        ? "border-primary bg-primary/[0.05] text-primary"
                        : "border-border bg-background text-muted-foreground",
                    ].join(" ")}
                    onClick={() => setPickerCategory(category.kategori_barang_id)}
                  >
                    {category.nama}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
              {pickerType === "variant" ? (
                <div className="space-y-2">
                  {pickerVariantRows.length === 0 ? (
                    <div className="py-16 text-center text-sm text-muted-foreground">Tidak ada varian yang cocok.</div>
                  ) : (
                    pickerVariantRows.map((variant) => {
                      const product = productOptions.find((item) => item.barang_id === variant.barang_id);
                      if (!product) return null;
                      const qty = pickerCartItem("varian", variant.varian_barang_id)?.qty ?? 0;
                      return (
                        <div
                          key={variant.varian_barang_id}
                          className={[
                            "flex items-center gap-3 rounded-2xl border bg-background px-2.5 py-2.5",
                            qty > 0 ? "border-primary/30 bg-primary/[0.025]" : "",
                          ].join(" ")}
                        >
                          <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                            {productImage(product) ? (
                              <img src={productImage(product)!} alt="" className="size-full object-cover" />
                            ) : (
                              <div className="grid size-full place-items-center text-muted-foreground">
                                <PackageOpen className="size-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-bold">{product.nama}</p>
                            <p className="truncate text-xs text-muted-foreground">{variant.nama}</p>
                          </div>
                          {pickerQuantityControl("varian", variant.varian_barang_id, product, variant)}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {pickerProducts.length === 0 ? (
                    <div className="py-16 text-center text-sm text-muted-foreground">Tidak ada barang yang cocok.</div>
                  ) : (
                    pickerProducts.map((product) => {
                      const variantsForProduct = pickerVariantsByProduct.get(product.barang_id) ?? [];
                      if (!variantsForProduct.length) {
                        const qty = pickerCartItem("barang", product.barang_id)?.qty ?? 0;
                        return (
                          <div
                            key={product.barang_id}
                            className={[
                              "flex items-center gap-3 rounded-2xl border bg-background px-2.5 py-2.5",
                              qty > 0 ? "border-primary/30 bg-primary/[0.025]" : "",
                            ].join(" ")}
                          >
                            <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                              {productImage(product) ? (
                                <img src={productImage(product)!} alt="" className="size-full object-cover" />
                              ) : (
                                <div className="grid size-full place-items-center text-muted-foreground">
                                  <PackageOpen className="size-5" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-bold">{product.nama}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{product.kategori?.nama ?? "Barang"}</p>
                            </div>
                            {pickerQuantityControl("barang", product.barang_id, product, null)}
                          </div>
                        );
                      }

                      return (
                        <div key={product.barang_id} className="overflow-hidden rounded-2xl border bg-background">
                          <div className="flex items-center gap-3 border-b bg-muted/[0.18] px-3 py-2.5">
                            <div className="size-11 shrink-0 overflow-hidden rounded-xl bg-muted">
                              {productImage(product) ? (
                                <img src={productImage(product)!} alt="" className="size-full object-cover" />
                              ) : (
                                <div className="grid size-full place-items-center text-muted-foreground">
                                  <PackageOpen className="size-5" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-bold">{product.nama}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{product.kategori?.nama ?? "Barang"} · {variantsForProduct.length} varian</p>
                            </div>
                          </div>

                          <div className="divide-y">
                            {variantsForProduct.map((variant) => (
                              <div
                                key={variant.varian_barang_id}
                                className={[
                                  "flex items-center gap-3 px-3 py-2.5",
                                  (pickerCartItem("varian", variant.varian_barang_id)?.qty ?? 0) > 0 ? "bg-primary/[0.02]" : "",
                                ].join(" ")}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[12px] font-semibold">{variant.nama}</p>
                                </div>
                                {pickerQuantityControl("varian", variant.varian_barang_id, product, variant)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="absolute inset-x-0 bottom-3 px-3">
              <div className="rounded-2xl border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ShoppingBag className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Keranjang sementara</p>
                    <p className="truncate text-sm font-bold">{pickerCart.length} item · {pickerCartUnits} unit</p>
                  </div>
                  <Button
                    type="button"
                    className="h-10 rounded-xl px-4 text-xs font-semibold"
                    onClick={finishPicker}
                  >
                    Selesai
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
