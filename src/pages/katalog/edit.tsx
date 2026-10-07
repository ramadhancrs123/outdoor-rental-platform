import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Loader2, MoreVertical, Plus, RefreshCw, Save, ShieldAlert, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  createCatalogVariant,
  getCatalogContext,
  getCatalogMediaUrl,
  getCatalogProduct,
  listCatalogCategories,
  reconcileCatalogMutation,
  setCatalogProductStatus,
  setCatalogProductVisibility,
  setCatalogVariantStatus,
  setCatalogTariffStatus,
  updateCatalogProduct,
  updateCatalogTariff,
  updateCatalogVariant,
  uploadCatalogMediaFile,
  removeCatalogMedia,
  reorderCatalogMedia,
  setCatalogMediaCover,
} from "@/features/katalog";
import { CATALOG_PRODUCT_MEDIA_BUCKET } from "@/features/katalog/types";
import type { CatalogMedia, CatalogTariff, CatalogVariant } from "@/features/katalog/types";
import { catalogErrorMessage, catalogStatusLabel, catalogVariantCapacity, catalogVariantColor, formatCatalogMoney, formatTariffDuration } from "@/features/katalog/utils";
import { paths } from "@/routes/paths";

type UncertainCommand = {
  commandName: string;
  idempotencyKey: string;
  message: string;
};

type TransitionRequest = {
  kind: "status" | "visibility";
  value: string;
};

type VariantDraft = {
  name: string;
  code: string;
  description: string;
  color: string;
  capacityLiters: string;
};

function variantDraftFrom(source: CatalogVariant): VariantDraft {
  const attrs = source.atribut_pembeda ?? {};
  return {
    name: source.nama,
    code: source.kode_internal ?? "",
    description: source.deskripsi ?? "",
    color: catalogVariantColor(attrs),
    capacityLiters: catalogVariantCapacity(attrs),
  };
}

function buildVariantAttributes(base: Record<string, unknown> | null, draft: Pick<VariantDraft, "color" | "capacityLiters">) {
  const next = { ...(base ?? {}) };
  const color = draft.color.trim();
  const capacity = draft.capacityLiters.trim();

  if (color) next.warna = color;
  else delete next.warna;

  if (capacity) {
    const literMatch = /^([0-9]+(?:[.,][0-9]+)?)\s*(?:l|liter)$/i.exec(capacity);
    if (literMatch) {
      const numericCapacity = Number(literMatch[1].replace(",", "."));
      if (!Number.isFinite(numericCapacity) || numericCapacity < 0) throw new Error("Kapasitas harus berupa angka 0 atau lebih.");
      next.kapasitas_liter = numericCapacity;
      delete next.kapasitas;
    } else {
      next.kapasitas = capacity;
      delete next.kapasitas_liter;
    }
  } else {
    delete next.kapasitas;
    delete next.kapasitas_liter;
  }

  return Object.keys(next).length ? next : null;
}

function messageOf(error: unknown, fallback = "Perubahan Katalog gagal.") {
  return catalogErrorMessage(error, fallback);
}

function commandKey(prefix: string) {
  return prefix + "-" + createClientId();
}

function isUnknownOutcome(error: unknown) {
  return messageOf(error).startsWith("UNKNOWN_OUTCOME:");
}

function rememberCommand(commandRef: MutableRefObject<UncertainCommand | null>, commandName: string, idempotencyKey: string) {
  commandRef.current = { commandName, idempotencyKey, message: "" };
}

function titleForVisibility(isPublic: boolean) {
  return isPublic ? "Publikasikan produk?" : "Sembunyikan produk?";
}

export function CatalogEdit() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const commandRef = useRef<UncertainCommand | null>(null);
  const [uncertainCommand, setUncertainCommand] = useState<UncertainCommand | null>(null);
  const [transition, setTransition] = useState<TransitionRequest | null>(null);
  const [productDraft, setProductDraft] = useState({ categoryId: "", name: "", slug: "", description: "", publicSummary: "" });
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({});
  const [tariffDrafts, setTariffDrafts] = useState<Record<string, { name: string; durationValue: string; durationUnit: string; nominal: string }>>({});
  const [newVariant, setNewVariant] = useState({ name: "", code: "", description: "", color: "", capacityLiters: "" });
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState("");
  const [mediaCover, setMediaCover] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const product = useQuery({
    queryKey: ["katalog", "product", context.data?.usahaId, id],
    queryFn: () => getCatalogProduct(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
    retry: false,
  });

  useEffect(() => {
    if (!product.data) return;
    setProductDraft({
      categoryId: product.data.kategori_barang_id,
      name: product.data.nama,
      slug: product.data.slug,
      description: product.data.deskripsi ?? "",
      publicSummary: product.data.ringkasan_publik ?? "",
    });
    setVariantDrafts(
      Object.fromEntries(product.data.variants.map((variant) => [variant.varian_barang_id, variantDraftFrom(variant)])),
    );
    setTariffDrafts(
      Object.fromEntries(
        product.data.tariffs.map((tariff) => [
          tariff.tarif_sewa_id,
          {
            name: tariff.nama,
            durationValue: String(tariff.durasi_nilai),
            durationUnit: tariff.durasi_unit,
            nominal: String(tariff.nominal),
          },
        ]),
      ),
    );
  }, [product.data]);

  useEffect(() => {
    if (!mediaFile) {
      setMediaPreview("");
      return;
    }
    const url = URL.createObjectURL(mediaFile);
    setMediaPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  const current = product.data;
  const availableMedia = product.data?.media.filter((media) => media.status === "valid" && media.storage_bucket === CATALOG_PRODUCT_MEDIA_BUCKET) ?? [];
  const unavailableMedia = product.data?.media.filter((media) => media.status === "valid" && media.storage_bucket !== CATALOG_PRODUCT_MEDIA_BUCKET) ?? [];

  const refreshAll = async () => {
    await product.refetch();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["katalog", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "product"] }),
      queryClient.invalidateQueries({ queryKey: ["katalog", "variants"] }),
    ]);
  };

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!context.data || !current) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("update-katalog-product");
      rememberCommand(commandRef, "update_barang", key);
      setBusyKey("product-save");
      setUncertainCommand(null);
      return {
        key,
        response: await updateCatalogProduct(
          context.data.usahaId,
          current.barang_id,
          {
            kategoriBarangId: productDraft.categoryId,
            nama: productDraft.name,
            slug: productDraft.slug,
            deskripsi: productDraft.description,
            ringkasanPublik: productDraft.publicSummary,
            status: current.status === "active" ? "active" : "inactive",
            isPublic: current.is_public,
            expectedUpdatedAt: current.updated_at,
          },
          { idempotencyKey: key },
        ),
      };
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Produk berhasil disimpan.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "update_barang", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: "active" | "inactive") => {
      if (!context.data || !current) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("set-katalog-product-status");
      rememberCommand(commandRef, "set_barang_status", key);
      setBusyKey("product-status");
      return { key, response: await setCatalogProductStatus(context.data.usahaId, current.barang_id, nextStatus, current.updated_at, { idempotencyKey: key }) };
    },
    onSuccess: async () => {
      setBusyKey("");
      setTransition(null);
      toast.success("Status produk diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        setUncertainCommand({ commandName: "set_barang_status", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: async (isPublic: boolean) => {
      if (!context.data || !current) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("set-katalog-product-visibility");
      rememberCommand(commandRef, "set_barang_visibility", key);
      setBusyKey("product-visibility");
      return { key, response: await setCatalogProductVisibility(context.data.usahaId, current.barang_id, isPublic, current.updated_at, { idempotencyKey: key }) };
    },
    onSuccess: async () => {
      setBusyKey("");
      setTransition(null);
      toast.success("Visibilitas publik diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        setUncertainCommand({ commandName: "set_barang_visibility", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const variantSaveMutation = useMutation({
    mutationFn: async (variant: CatalogVariant) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const draft = variantDrafts[variant.varian_barang_id];
      if (!draft?.name.trim()) throw new Error("Nama varian wajib diisi.");
      const key = commandKey("update-katalog-variant");
      rememberCommand(commandRef, "update_varian_barang", key);
      setBusyKey("variant-" + variant.varian_barang_id);
      return {
        key,
        response: await updateCatalogVariant(
          context.data.usahaId,
          variant.varian_barang_id,
          {
            nama: draft.name,
            kodeInternal: draft.code || null,
            deskripsi: draft.description || null,
            atributPembeda: buildVariantAttributes(variant.atribut_pembeda, draft),
            status: variant.status === "active" ? "active" : "inactive",
            expectedUpdatedAt: variant.updated_at,
          },
          { idempotencyKey: key },
        ),
      };
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Varian berhasil disimpan.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "update_varian_barang", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const variantStatusMutation = useMutation({
    mutationFn: async ({ variant, status }: { variant: CatalogVariant; status: "active" | "inactive" }) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("set-katalog-variant-status");
      rememberCommand(commandRef, "set_varian_barang_status", key);
      setBusyKey("variant-status-" + variant.varian_barang_id);
      return setCatalogVariantStatus(context.data.usahaId, variant.varian_barang_id, status, variant.updated_at, { idempotencyKey: key });
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Status varian diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "set_varian_barang_status", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const tariffSaveMutation = useMutation({
    mutationFn: async (tariff: CatalogTariff) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const draft = tariffDrafts[tariff.tarif_sewa_id];
      const amount = Number(draft?.nominal);
      const durationValue = Number(draft?.durationValue);
      if (!draft?.name.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(durationValue) || durationValue <= 0) {
        throw new Error("Nama, durasi, dan nominal tarif wajib valid.");
      }
      const key = commandKey("update-katalog-tariff");
      rememberCommand(commandRef, "update_tarif_sewa", key);
      setBusyKey("tariff-" + tariff.tarif_sewa_id);
      return updateCatalogTariff(
        context.data.usahaId,
        {
          tarifSewaId: tariff.tarif_sewa_id,
          nama: draft.name,
          durasiUnit: draft.durationUnit,
          durasiNilai: durationValue,
          nominal: amount,
          berlakuMulai: tariff.berlaku_mulai,
          berlakuSampai: tariff.berlaku_sampai,
          expectedUpdatedAt: tariff.updated_at,
        },
        { idempotencyKey: key },
      );
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Tarif berhasil disimpan.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "update_tarif_sewa", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const tariffStatusMutation = useMutation({
    mutationFn: async ({ tariff, status }: { tariff: CatalogTariff; status: "active" | "inactive" }) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("set-katalog-tariff-status");
      rememberCommand(commandRef, "set_tarif_sewa_status", key);
      setBusyKey("tariff-status-" + tariff.tarif_sewa_id);
      return setCatalogTariffStatus(context.data.usahaId, tariff.tarif_sewa_id, status, tariff.updated_at, { idempotencyKey: key });
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Status tarif diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "set_tarif_sewa_status", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const createVariantMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !current) throw new Error("Konteks Katalog belum siap.");
      if (!newVariant.name.trim()) throw new Error("Nama varian wajib diisi.");
      const key = commandKey("create-katalog-variant");
      rememberCommand(commandRef, "create_varian_barang", key);
      setBusyKey("variant-create");
      return createCatalogVariant(
        context.data.usahaId,
        {
          barangId: current.barang_id,
          nama: newVariant.name,
          kodeInternal: newVariant.code || null,
          deskripsi: newVariant.description || null,
          atributPembeda: buildVariantAttributes(null, newVariant),
          status: "active",
        },
        { idempotencyKey: key },
      );
    },
    onSuccess: async () => {
      setBusyKey("");
      setNewVariant({ name: "", code: "", description: "", color: "", capacityLiters: "" });
      toast.success("Varian berhasil ditambahkan.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "create_varian_barang", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const mediaUploadMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !current || !mediaFile) throw new Error("Pilih gambar terlebih dahulu.");
      const key = commandKey("add-katalog-media");
      rememberCommand(commandRef, "add_barang_media", key);
      setBusyKey("media-upload");
      setMediaError("");
      return uploadCatalogMediaFile(context.data.usahaId, current.barang_id, mediaFile, {
        isCover: mediaCover,
        urutan: current.media.length + 1,
        idempotencyKey: key,
      });
    },
    onSuccess: async () => {
      setBusyKey("");
      setMediaFile(null);
      setMediaCover(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Media berhasil ditambahkan.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      const message = messageOf(error);
      setMediaError(message);
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message } : { commandName: "add_barang_media", idempotencyKey: "", message });
      } else toast.error(message);
    },
  });

  const mediaCoverMutation = useMutation({
    mutationFn: async (media: CatalogMedia) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("set-katalog-media-cover");
      rememberCommand(commandRef, "set_barang_media_cover", key);
      setBusyKey("media-cover-" + media.barang_media_id);
      return setCatalogMediaCover(context.data.usahaId, media.barang_media_id, !media.is_cover, { idempotencyKey: key });
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Cover media diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "set_barang_media_cover", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const mediaRemoveMutation = useMutation({
    mutationFn: async (media: CatalogMedia) => {
      if (!context.data) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("remove-katalog-media");
      rememberCommand(commandRef, "remove_barang_media", key);
      setBusyKey("media-remove-" + media.barang_media_id);
      return removeCatalogMedia(context.data.usahaId, media.barang_media_id, { idempotencyKey: key });
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Media dihapus dari katalog.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "remove_barang_media", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  const mediaReorderMutation = useMutation({
    mutationFn: async (orders: Array<{ barang_media_id: string; urutan: number }>) => {
      if (!context.data || !current) throw new Error("Konteks Katalog belum siap.");
      const key = commandKey("reorder-katalog-media");
      rememberCommand(commandRef, "reorder_barang_media", key);
      setBusyKey("media-reorder");
      return reorderCatalogMedia(context.data.usahaId, current.barang_id, orders, { idempotencyKey: key });
    },
    onSuccess: async () => {
      setBusyKey("");
      toast.success("Urutan media diperbarui.");
      await refreshAll();
    },
    onError: (error) => {
      setBusyKey("");
      if (isUnknownOutcome(error)) {
        const ref = commandRef.current;
        setUncertainCommand(ref ? { ...ref, message: messageOf(error) } : { commandName: "reorder_barang_media", idempotencyKey: "", message: messageOf(error) });
      } else toast.error(messageOf(error));
    },
  });

  if (context.isPending || product.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    );
  }

  if (context.error || product.error || !current || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Produk tidak dapat diedit</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{messageOf(context.error ?? product.error, "Data produk tidak tersedia.")}</span>
          <Button variant="outline" size="sm" onClick={() => void product.refetch()}><RefreshCw />Muat ulang</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const updateVariantDraft = (variantId: string, patch: Partial<VariantDraft>) => {
    setVariantDrafts((drafts) => ({ ...drafts, [variantId]: { ...drafts[variantId], ...patch } }));
  };

  const moveMedia = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.media.length) return;
    const copy = [...current.media];
    [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
    mediaReorderMutation.mutate(copy.map((media, position) => ({ barang_media_id: media.barang_media_id, urutan: position + 1 })));
  };

  const reconcile = async () => {
    if (!context.data || !uncertainCommand?.idempotencyKey) {
      setUncertainCommand(null);
      await product.refetch();
      return;
    }
    try {
      const result = await reconcileCatalogMutation(context.data.usahaId, uncertainCommand.commandName, uncertainCommand.idempotencyKey);
      if (result.state === "committed") {
        toast.success("Perubahan sudah disimpan. Data terbaru dimuat.");
        setUncertainCommand(null);
        await refreshAll();
      } else if (result.state === "not_found") {
        toast.info("Command tidak ditemukan. Muat ulang state sebelum mencoba kembali.");
        setUncertainCommand(null);
        await refreshAll();
      } else {
        toast.error("Hasil perubahan belum dapat dipastikan. Jangan mengulang perubahan sebelum status diperiksa.");
      }
    } catch (error) {
      toast.error(messageOf(error, "Rekonsiliasi gagal."));
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-24 lg:pb-10">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke detail katalog"><Link to={paths.katalog + "/show/" + current.barang_id}><ArrowLeft /></Link></Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Katalog · Ubah Barang</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{current.nama}</h1>
              <Badge variant={current.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(current.status)}</Badge>
              <Badge variant="outline" className="rounded-full">{current.is_public ? "Publik" : "Internal"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Informasi barang. Data unit fisik dan ketersediaan aktual dikelola pada proses terkait.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Menu produk"><MoreVertical /></Button>
      </header>

      {uncertainCommand ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Permintaan belum dapat dipastikan</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{uncertainCommand.message}</p>
            <Button variant="outline" size="sm" onClick={() => void reconcile()}><RefreshCw />Periksa Status Tindakan</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="general">Informasi Produk</TabsTrigger>
          <TabsTrigger value="variants">Varian ({current.variants.length})</TabsTrigger>
          <TabsTrigger value="tariffs">Tarif ({current.tariffs.length})</TabsTrigger>
          <TabsTrigger value="media">Media ({current.media.length})</TabsTrigger>
          <TabsTrigger value="packages">Paket ({current.package_references.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Identitas Produk</CardTitle></CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Kategori
                <Select value={productDraft.categoryId} onValueChange={(value) => setProductDraft((d) => ({ ...d, categoryId: value }))}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                  <SelectContent>{(categories.data ?? []).map((category) => <SelectItem key={category.kategori_barang_id} value={category.kategori_barang_id}>{category.nama}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium">Nama barang<Input className="h-11 rounded-xl" value={productDraft.name} onChange={(e) => setProductDraft((d) => ({ ...d, name: e.target.value }))} /></label>
              <label className="grid gap-2 text-sm font-medium">Slug<input className="h-11 rounded-xl" value={productDraft.slug} onChange={(e) => setProductDraft((d) => ({ ...d, slug: e.target.value }))} /></label>
              <div className="rounded-2xl border bg-muted/20 p-4 text-sm">
                <p className="font-semibold">Tampilan Publik</p>
                <p className="mt-1 text-muted-foreground">{current.is_public ? "Barang saat ini ditampilkan pada katalog publik." : "Barang tetap aktif secara internal tetapi belum ditawarkan di katalog publik."}</p>
              </div>
              <label className="lg:col-span-2 grid gap-2 text-sm font-medium">Deskripsi
                <Textarea rows={6} className="rounded-xl" value={productDraft.description} onChange={(e) => setProductDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Jelaskan produk dengan bahasa yang dipahami admin dan calon penyewa." />
              </label>
              <label className="lg:col-span-2 grid gap-2 text-sm font-medium">Ringkasan publik
                <Textarea rows={4} className="rounded-xl" value={productDraft.publicSummary} onChange={(e) => setProductDraft((d) => ({ ...d, publicSummary: e.target.value }))} placeholder="Ringkasan singkat yang aman ditampilkan ke publik." />
              </label>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Status & Tampilan Publik</CardTitle></CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <p className="font-semibold">Status produk</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Status internal dan visibilitas publik adalah dua keputusan yang berbeda.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant={current.status === "active" ? "default" : "outline"} disabled={busyKey === "product-status"} onClick={() => current.status !== "active" && setTransition({ kind: "status", value: "active" })}>Aktif</Button>
                  <Button variant={current.status === "inactive" ? "default" : "outline"} disabled={busyKey === "product-status"} onClick={() => current.status !== "inactive" && setTransition({ kind: "status", value: "inactive" })}>Nonaktif</Button>
                </div>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="font-semibold">Tampilan di Website Publik</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{current.is_public ? "Penyewa dapat menemukan barang ini di katalog publik." : "Barang tidak ditawarkan di katalog publik."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant={current.is_public ? "default" : "outline"} disabled={busyKey === "product-visibility"} onClick={() => current.is_public || setTransition({ kind: "visibility", value: "true" })}>Publik</Button>
                  <Button variant={!current.is_public ? "default" : "outline"} disabled={busyKey === "product-visibility"} onClick={() => current.is_public && setTransition({ kind: "visibility", value: "false" })}>Internal</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-2 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            <Button className="h-12 w-full rounded-xl sm:w-auto sm:min-w-52" disabled={busyKey === "product-save" || !productDraft.name.trim() || !productDraft.categoryId || !productDraft.slug.trim()} onClick={() => saveProduct.mutate()}>
              {busyKey === "product-save" ? <Loader2 className="animate-spin" /> : <Save />}Simpan Perubahan
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="variants" className="space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Tambah Varian</CardTitle><p className="text-sm text-muted-foreground">Varian tetap berada di bawah produk ini; bukan unit fisik.</p></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-2 text-sm font-medium">Nama varian<Input className="h-11 rounded-xl" value={newVariant.name} onChange={(e) => setNewVariant((d) => ({ ...d, name: e.target.value }))} placeholder="Contoh: Hitam" /></label>
              <label className="grid gap-2 text-sm font-medium">Kode internal<Input className="h-11 rounded-xl" value={newVariant.code} onChange={(e) => setNewVariant((d) => ({ ...d, code: e.target.value }))} placeholder="Opsional" /></label>
              <label className="grid gap-2 text-sm font-medium">Warna<Input className="h-11 rounded-xl" value={newVariant.color} onChange={(e) => setNewVariant((d) => ({ ...d, color: e.target.value }))} placeholder="Contoh: hitam" /></label>
              <label className="grid gap-2 text-sm font-medium">Kapasitas<Input className="h-11 rounded-xl" value={newVariant.capacityLiters} onChange={(e) => setNewVariant((d) => ({ ...d, capacityLiters: e.target.value }))} placeholder="Contoh: 60 liter atau 4 orang" /></label>
              <label className="grid gap-2 text-sm font-medium sm:col-span-2">Deskripsi<Input className="h-11 rounded-xl" value={newVariant.description} onChange={(e) => setNewVariant((d) => ({ ...d, description: e.target.value }))} placeholder="Pembeda yang bermakna bagi produk" /></label>
              <Button className="self-end h-11 rounded-xl" disabled={!newVariant.name.trim() || busyKey === "variant-create"} onClick={() => createVariantMutation.mutate()}>{busyKey === "variant-create" ? <Loader2 className="animate-spin" /> : <Plus />}Tambah Varian</Button>
            </CardContent>
          </Card>

          {current.variants.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="flex min-h-48 items-center justify-center p-6 text-center"><div><p className="font-semibold">Belum ada varian</p><p className="mt-1 text-sm text-muted-foreground">Varian hanya perlu dibuat bila ada perbedaan bermakna pada identitas, spesifikasi, atau harga.</p></div></CardContent></Card>
          ) : current.variants.map((variant) => {
            const draft = variantDrafts[variant.varian_barang_id] ?? variantDraftFrom(variant);
            return (
              <Card key={variant.varian_barang_id} className="rounded-2xl shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">{variant.nama}</CardTitle><p className="text-sm text-muted-foreground">Bagian dari {current.nama}</p></div><Badge variant={variant.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(variant.status)}</Badge></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-2 text-sm font-medium">Nama<Input className="h-11 rounded-xl" value={draft.name} onChange={(e) => updateVariantDraft(variant.varian_barang_id, { name: e.target.value })} /></label>
                  <label className="grid gap-2 text-sm font-medium">Kode internal<Input className="h-11 rounded-xl" value={draft.code} onChange={(e) => updateVariantDraft(variant.varian_barang_id, { code: e.target.value })} /></label>
                  <label className="grid gap-2 text-sm font-medium">Deskripsi<Input className="h-11 rounded-xl" value={draft.description} onChange={(e) => updateVariantDraft(variant.varian_barang_id, { description: e.target.value })} /></label>
                  <label className="grid gap-2 text-sm font-medium">Warna<Input className="h-11 rounded-xl" value={draft.color} onChange={(e) => updateVariantDraft(variant.varian_barang_id, { color: e.target.value })} placeholder="Contoh: hitam" /></label>
                  <label className="grid gap-2 text-sm font-medium">Kapasitas<Input className="h-11 rounded-xl" value={draft.capacityLiters} onChange={(e) => updateVariantDraft(variant.varian_barang_id, { capacityLiters: e.target.value })} placeholder="Contoh: 60 liter atau 4 orang" /></label>
                  <div className="lg:col-span-3 flex flex-wrap gap-2 border-t pt-4">
                    <Button size="sm" className="rounded-xl" disabled={busyKey === "variant-" + variant.varian_barang_id} onClick={() => variantSaveMutation.mutate(variant)}>{busyKey === "variant-" + variant.varian_barang_id ? <Loader2 className="animate-spin" /> : <Save />}Simpan Varian</Button>
                    <Button size="sm" variant="outline" className="rounded-xl" disabled={busyKey === "variant-status-" + variant.varian_barang_id} onClick={() => variantStatusMutation.mutate({ variant, status: variant.status === "active" ? "inactive" : "active" })}>{variant.status === "active" ? "Nonaktifkan" : "Aktifkan"}</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Alert>
            <AlertTitle>Catatan authority</AlertTitle>
            <AlertDescription>Perubahan varian di sini tidak memindahkan unit fisik atau menentukan ketersediaan.</AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="tariffs" className="space-y-4">
          {current.tariffs.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="flex min-h-48 items-center justify-center p-6 text-center"><div><p className="font-semibold">Belum ada tarif</p><p className="mt-1 text-sm text-muted-foreground">Tambahkan tarif dari Katalog · Operasional setelah target dan periode tarif dipastikan.</p></div></CardContent></Card>
          ) : current.tariffs.map((tariff) => {
            const draft = tariffDrafts[tariff.tarif_sewa_id] ?? { name: tariff.nama, durationValue: String(tariff.durasi_nilai), durationUnit: tariff.durasi_unit, nominal: String(tariff.nominal) };
            return (
              <Card key={tariff.tarif_sewa_id} className="rounded-2xl shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">{tariff.nama}</CardTitle><p className="text-sm text-muted-foreground">{formatCatalogMoney(tariff.nominal, tariff.currency_code)} · {formatTariffDuration(tariff)}</p></div><Badge variant={tariff.status === "active" ? "default" : "secondary"} className="rounded-full">{catalogStatusLabel(tariff.status)}</Badge></CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-4">
                  <label className="grid gap-2 text-sm font-medium">Nama<Input className="h-11 rounded-xl" value={draft.name} onChange={(e) => setTariffDrafts((d) => ({ ...d, [tariff.tarif_sewa_id]: { ...draft, name: e.target.value } }))} /></label>
                  <label className="grid gap-2 text-sm font-medium">Durasi<input className="h-11 rounded-xl border bg-background px-3" inputMode="numeric" value={draft.durationValue} onChange={(e) => setTariffDrafts((d) => ({ ...d, [tariff.tarif_sewa_id]: { ...draft, durationValue: e.target.value } }))} /></label>
                  <label className="grid gap-2 text-sm font-medium">Satuan<input className="h-11 rounded-xl border bg-background px-3" value={draft.durationUnit} onChange={(e) => setTariffDrafts((d) => ({ ...d, [tariff.tarif_sewa_id]: { ...draft, durationUnit: e.target.value } }))} /></label>
                  <label className="grid gap-2 text-sm font-medium">Nominal IDR<input className="h-11 rounded-xl border bg-background px-3" inputMode="decimal" value={draft.nominal} onChange={(e) => setTariffDrafts((d) => ({ ...d, [tariff.tarif_sewa_id]: { ...draft, nominal: e.target.value } }))} /></label>
                  <div className="lg:col-span-4 flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button size="sm" className="rounded-xl" disabled={busyKey === "tariff-" + tariff.tarif_sewa_id} onClick={() => tariffSaveMutation.mutate(tariff)}>{busyKey === "tariff-" + tariff.tarif_sewa_id ? <Loader2 className="animate-spin" /> : <Save />}Simpan Tarif</Button>
                    <Button size="sm" variant="outline" className="rounded-xl" disabled={busyKey === "tariff-status-" + tariff.tarif_sewa_id} onClick={() => tariffStatusMutation.mutate({ tariff, status: tariff.status === "active" ? "inactive" : "active" })}>{tariff.status === "active" ? "Nonaktifkan" : "Aktifkan"}</Button>
                    <span className="ml-auto text-xs text-muted-foreground">Berlaku mulai {new Date(tariff.berlaku_mulai).toLocaleDateString("id-ID")}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Tambah Media Produk</CardTitle><p className="text-sm text-muted-foreground">Hanya media katalog publik. Jangan unggah identitas penyewa atau bukti kondisi.</p></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
                <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center focus-within:ring-2 focus-within:ring-ring">
                  <ImagePlus className="size-8 text-muted-foreground" />
                  <span className="mt-3 font-semibold">Pilih gambar</span>
                  <span className="mt-1 text-sm text-muted-foreground">JPG, PNG, WebP · maksimal 8 MB</span>
                  <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)} />
                </label>
                <div className="rounded-2xl border p-4">
                  {mediaPreview ? <img src={mediaPreview} alt="Preview media baru" className="aspect-[4/3] w-full rounded-xl object-cover" /> : <div className="grid aspect-[4/3] place-items-center rounded-xl bg-muted text-sm text-muted-foreground">Preview muncul di sini</div>}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{mediaFile?.name ?? "Belum memilih file"}</p><p className="text-xs text-muted-foreground">{mediaFile ? Math.round(mediaFile.size / 1024) + " KB" : "Belum ada upload"}</p></div>
                    <Button size="icon" variant="ghost" className="rounded-xl" disabled={!mediaFile} onClick={() => { setMediaFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label="Hapus file terpilih"><X /></Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mediaCover} onChange={(e) => setMediaCover(e.target.checked)} /> Jadikan cover</label>
                <Button className="h-11 rounded-xl" disabled={!mediaFile || busyKey === "media-upload"} onClick={() => mediaUploadMutation.mutate()}>{busyKey === "media-upload" ? <Loader2 className="animate-spin" /> : <Upload />}Upload Media</Button>
              </div>
              {mediaError ? <Alert variant="destructive"><AlertTitle>Upload belum selesai</AlertTitle><AlertDescription>{mediaError}</AlertDescription></Alert> : null}
            </CardContent>
          </Card>

          {unavailableMedia.length > 0 ? (
            <Alert>
              <AlertTitle>Referensi media lama tidak tersedia</AlertTitle>
              <AlertDescription>
                {unavailableMedia.length} media reference tidak dapat dipreview karena bucket lama tidak tersedia. Jangan mengunggah ulang file yang sama tanpa memastikan state storage lebih dahulu.
              </AlertDescription>
            </Alert>
          ) : null}

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Galeri Produk</CardTitle></CardHeader>
            <CardContent>
              {current.media.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada media katalog.</div> : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {availableMedia.map((media, index) => {
                    const url = getCatalogMediaUrl(media.storage_bucket, media.storage_path);
                    return (
                      <div key={media.barang_media_id} className="overflow-hidden rounded-2xl border bg-card">
                        <div className="relative aspect-[4/3] bg-muted">
                          <img src={url} alt={media.is_cover ? "Cover produk" : "Media produk " + (index + 1)} className="size-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                          <div className="absolute inset-x-2 top-2 flex justify-between gap-2">
                            {media.is_cover ? <Badge className="rounded-full">Cover</Badge> : <span />}
                            <Badge variant="outline" className="rounded-full bg-background/90">{index + 1}</Badge>
                          </div>
                        </div>
                        <div className="space-y-2 p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" className="rounded-xl" disabled={busyKey.startsWith("media-cover-")} onClick={() => mediaCoverMutation.mutate(media)}>{media.is_cover ? "Lepas Cover" : "Jadikan Cover"}</Button>
                            <Button size="icon" variant="outline" className="rounded-xl" disabled={index === 0 || busyKey === "media-reorder"} onClick={() => moveMedia(index, -1)} aria-label="Naikkan media"><ArrowUp /></Button>
                            <Button size="icon" variant="outline" className="rounded-xl" disabled={index === current.media.length - 1 || busyKey === "media-reorder"} onClick={() => moveMedia(index, 1)} aria-label="Turunkan media"><ArrowDown /></Button>
                            <Button size="icon" variant="outline" className="rounded-xl text-destructive" disabled={busyKey === "media-remove-" + media.barang_media_id} onClick={() => { if (window.confirm("Hapus media ini dari katalog?")) mediaRemoveMutation.mutate(media); }} aria-label="Hapus media"><Trash2 /></Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert>
            <AlertTitle>Media merupakan bagian dari informasi barang</AlertTitle>
            <AlertDescription>Lokasi penyimpanan hanya detail teknis. Admin melihat pratinjau; katalog publik hanya menerima media yang memang ditampilkan.</AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="packages" className="space-y-4">
          {current.package_references.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="flex min-h-48 items-center justify-center p-6 text-center"><div><p className="font-semibold">Belum menjadi komponen paket</p><p className="mt-1 text-sm text-muted-foreground">Komposisi paket dikelola dari Katalog · Operasional.</p></div></CardContent></Card>
          ) : current.package_references.map((reference) => (
            <Card key={reference.komponen_paket_id} className="rounded-2xl shadow-sm">
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">{reference.paket?.nama ?? "Paket tidak ditemukan"}</p><p className="text-sm text-muted-foreground">Jumlah {reference.jumlah} · {reference.paket?.is_public ? "Publik" : "Internal"} · {reference.paket?.status === "active" ? "Aktif" : reference.paket?.status === "inactive" ? "Tidak Aktif" : "Draf"}</p></div>
                <Badge variant="outline" className="rounded-full">Referensi produk</Badge>
              </CardContent>
            </Card>
          ))}
          <Alert><AlertTitle>Boundary paket</AlertTitle><AlertDescription>Paket berisi barang/varian, bukan unit fisik. Penetapan Unit dilakukan pada alur operasional terkait.</AlertDescription></Alert>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(transition)} onOpenChange={(open) => !open && setTransition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{transition ? (transition.kind === "visibility" ? titleForVisibility(transition.value === "true") : transition.value === "active" ? "Aktifkan barang?" : "Nonaktifkan barang?") : "Konfirmasi perubahan"}</DialogTitle>
            <DialogDescription>
              {transition?.kind === "visibility"
                ? transition.value === "true"
                  ? "Barang akan ditampilkan sebagai informasi publik setelah perubahan berhasil disimpan."
                  : "Barang akan tetap tersimpan secara internal dan tidak lagi ditawarkan di katalog publik."
                : transition?.value === "inactive"
                  ? "Nonaktif tidak menghapus histori produk. Data tetap dapat dilihat dan ditelusuri."
                  : "Barang menjadi aktif secara internal; tampilan di katalog publik tetap merupakan keputusan terpisah."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransition(null)}>Batal</Button>
            <Button onClick={() => {
              if (!transition) return;
              if (transition.kind === "visibility") visibilityMutation.mutate(transition.value === "true");
              else statusMutation.mutate(transition.value as "active" | "inactive");
            }}>Konfirmasi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
