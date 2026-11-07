import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, PackagePlus, Search, ShieldCheck } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  UnknownOutcomeNotice,
} from "@/components/inventaris/inventory-ui";
import {
  createCatalogTariff,
  createCatalogVariant,
  reconcileCatalogMutation,
} from "@/features/katalog";
import {
  EMPTY_INVENTORY_VARIANT_DRAFT,
  findInventoryVariantNameCollision,
  findMatchingInventoryVariant,
  inventoryVariantDraftAttributes,
  inventoryVariantDraftName,
  inventoryVariantHasIdentity,
  type InventoryVariantDraft,
} from "@/features/inventaris/variant-draft";
import {
  getInventarisContext,
  getInventoryStateCapabilities,
  listInventoryLocations,
  listInventoryProducts,
  listInventoryVariants,
  reconcileInventoryCommand,
  registerInventoryUnits,
  type InventoryCommandResult,
  type RegisterInventoryUnitInput,
} from "@/features/inventaris";
import { getPurchase, listPurchases } from "@/features/pemasok";
import { paths } from "@/routes/paths";

type CreateMode = "form" | "review" | "processing" | "success" | "error" | "unknown";
type CreateFormStep = 1 | 2;

const initialForm: RegisterInventoryUnitInput = {
  barangId: "",
  varianBarangId: null,
  kodeUnit: "",
  serialNumber: "",
  lokasiId: null,
  tanggalDiperoleh: getLocalDateInputValue(),
  sumberPembelianDetailId: null,
  catatanInternal: "",
};

function getLocalDateInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function stepState(mode: CreateMode, formStep: CreateFormStep) {
  if (mode === "form") return formStep;
  return 3;
}

function inventoryVariantAttributeEntries(attributes: Record<string, unknown> | null | undefined) {
  if (!attributes) return [] as Array<{ label: string; value: string }>;

  const readValue = (key: string) => {
    const value = attributes[key];
    return typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  };

  const entries: Array<{ label: string; value: string }> = [];
  const color = readValue("warna");
  const capacity = readValue("kapasitas") || readValue("ukuran");
  const liters = readValue("kapasitas_liter");
  const series = readValue("seri");

  if (color) entries.push({ label: "Warna", value: color });
  if (capacity) entries.push({ label: "Kapasitas/Ukuran", value: capacity });
  else if (liters) entries.push({ label: "Kapasitas/Ukuran", value: /liter$/i.test(liters) ? liters : liters + " liter" });
  if (series) entries.push({ label: "Seri", value: series });

  const knownKeys = new Set(["warna", "kapasitas", "ukuran", "kapasitas_liter", "seri", "catatan"]);
  for (const [key, rawValue] of Object.entries(attributes)) {
    if (knownKeys.has(key) || (typeof rawValue !== "string" && typeof rawValue !== "number")) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    const label = key
      .replace(/_/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    entries.push({ label, value });
  }

  return entries;
}

export function InventoryCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);
  const variantCreationKeyRef = useRef<string | null>(null);
  const tariffCreationKeyRef = useRef<string | null>(null);
  const tariffPendingVariantIdRef = useRef<string | null>(null);
  const tariffPendingVariantNameRef = useRef<string | null>(null);
  const [creatingVariant, setCreatingVariant] = useState(false);
  const [variantDraft, setVariantDraft] = useState<InventoryVariantDraft>(EMPTY_INVENTORY_VARIANT_DRAFT);
  const [variantTariffAmount, setVariantTariffAmount] = useState("");
  const [variantFeedback, setVariantFeedback] = useState("");
  const [form, setForm] = useState<RegisterInventoryUnitInput>(() => ({
    ...initialForm,
    barangId: searchParams.get("barangId") ?? "",
    varianBarangId: searchParams.get("varianBarangId") ?? null,
  }));
  const [mode, setMode] = useState<CreateMode>("form");
  const [formStep, setFormStep] = useState<CreateFormStep>(1);
  const [feedback, setFeedback] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdUnits, setCreatedUnits] = useState<InventoryCommandResult[]>([]);
  const [reconciling, setReconciling] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"manual" | "purchase">("manual");
  const [jumlahUnit, setJumlahUnit] = useState("1");

  const context = useQuery({
    queryKey: ["inventaris", "context"],
    queryFn: getInventarisContext,
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["inventaris", "products", context.data?.usahaId],
    queryFn: () => listInventoryProducts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const variants = useQuery({
    queryKey: ["inventaris", "variants", context.data?.usahaId],
    queryFn: () => listInventoryVariants(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const locations = useQuery({
    queryKey: ["inventaris", "locations", context.data?.usahaId],
    queryFn: () => listInventoryLocations(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 60_000,
  });
  const purchases = useQuery({
    queryKey: ["inventaris", "purchase-sources", context.data?.usahaId, purchaseSearch],
    queryFn: () => listPurchases(context.data!.usahaId, { search: purchaseSearch, status: "all", page: 1, pageSize: 20 }),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });
  const selectedPurchase = useQuery({
    queryKey: ["inventaris", "purchase-source", context.data?.usahaId, selectedPurchaseId],
    queryFn: () => getPurchase(context.data!.usahaId, selectedPurchaseId!),
    enabled: Boolean(context.data?.usahaId && selectedPurchaseId),
    staleTime: 30_000,
  });

  const capabilities = getInventoryStateCapabilities();
  const selectedProduct = (products.data ?? []).find((product) => product.barang_id === form.barangId);
  const selectedVariants = (variants.data ?? []).filter((variant) => variant.barang_id === form.barangId);
  const selectedVariant = selectedVariants.find((variant) => variant.varian_barang_id === form.varianBarangId);
  const newVariantAttributes = useMemo(
    () => inventoryVariantDraftAttributes(variantDraft),
    [variantDraft],
  );
  const newVariantName = useMemo(
    () => inventoryVariantDraftName(variantDraft),
    [variantDraft],
  );
  const matchingVariant = useMemo(
    () => findMatchingInventoryVariant(selectedVariants, variantDraft),
    [selectedVariants, variantDraft],
  );
  const variantNameCollision = useMemo(
    () => findInventoryVariantNameCollision(selectedVariants, variantDraft),
    [selectedVariants, variantDraft],
  );
  const selectedLocation = (locations.data ?? []).find((location) => location.lokasi_id === form.lokasiId);
  const selectedPurchaseLine = selectedPurchase.data?.lines.find(
    (line) => line.detail_pembelian_id === form.sumberPembelianDetailId,
  );
  const selectedPurchaseRegistered = Number(selectedPurchaseLine?.registered_unit_count ?? 0);
  const selectedPurchaseRemaining = Number(selectedPurchaseLine?.remaining_unit_count ?? 0);
  const jumlahUnitValue = Number(jumlahUnit);
  const validJumlahUnit = Number.isInteger(jumlahUnitValue) && jumlahUnitValue >= 1 && jumlahUnitValue <= 250;
  const quantityExceedsPurchaseReference = Boolean(
    sourceMode === "purchase" &&
    selectedPurchaseLine &&
    (selectedPurchaseLine.quantity_needs_review || jumlahUnitValue > selectedPurchaseRemaining),
  );
  const newVariantPurchaseConflict = Boolean(
    creatingVariant && sourceMode === "purchase" && selectedPurchaseLine?.varian_barang_id,
  );
  const requiresNewVariantTariff = Boolean(creatingVariant && selectedProduct?.is_rentable && !matchingVariant);
  const parsedVariantTariffAmount = Number(variantTariffAmount);
  const validVariantTariff = !requiresNewVariantTariff || (
    variantTariffAmount.trim() !== "" &&
    Number.isFinite(parsedVariantTariffAmount) &&
    parsedVariantTariffAmount >= 0
  );
  const validVariantSelection = creatingVariant
    ? Boolean(inventoryVariantHasIdentity(variantDraft) && newVariantName && !newVariantPurchaseConflict && !(
        variantNameCollision && !matchingVariant
      ))
    : selectedVariants.length === 0 || Boolean(form.varianBarangId);
  const readyToReview = Boolean(
    context.data?.usahaId &&
    form.barangId &&
    validVariantSelection &&
    validVariantTariff &&
    validJumlahUnit &&
    (sourceMode === "manual" || Boolean(form.sumberPembelianDetailId)) &&
    capabilities.mutation,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Konteks Usaha belum siap.");
      if (!commandRef.current) commandRef.current = createClientId();

      let varianBarangId = form.varianBarangId ?? null;
      if (creatingVariant) {
        if (newVariantPurchaseConflict) {
          throw new Error("Item pembelian ini terikat ke varian tertentu. Pilih varian yang tercantum pada pembelian atau gunakan input manual untuk membuat varian baru.");
        }

        const reusableVariant = findMatchingInventoryVariant(selectedVariants, variantDraft);
        if (reusableVariant) {
          varianBarangId = reusableVariant.varian_barang_id;
          setForm((current) => ({ ...current, varianBarangId }));
          setCreatingVariant(false);
          setVariantFeedback("Spesifikasi yang sama sudah terdaftar. Unit akan menggunakan varian yang sudah ada, tanpa membuat duplikat.");
        } else {
          if (variantNameCollision) {
            throw new Error("Nama varian tersebut sudah digunakan dengan spesifikasi berbeda. Periksa varian yang ada atau ubah atributnya.");
          }
          if (!inventoryVariantHasIdentity(variantDraft) || !newVariantName) {
            throw new Error("Isi minimal satu atribut varian: warna, kapasitas/ukuran, atau seri.");
          }

          if (!variantCreationKeyRef.current) {
            variantCreationKeyRef.current = "inventory-create-variant-" + createClientId();
          }

          try {
            const createdVariant = await createCatalogVariant(context.data.usahaId, {
              barangId: form.barangId,
              nama: newVariantName,
              kodeInternal: variantDraft.kodeInternal.trim() || null,
              deskripsi: variantDraft.deskripsi.trim() || null,
              atributPembeda: newVariantAttributes,
              status: "active",
            }, { idempotencyKey: variantCreationKeyRef.current });

            const createdVariantId = typeof createdVariant?.varian_barang_id === "string"
              ? createdVariant.varian_barang_id
              : null;
            if (!createdVariantId) {
              throw new Error("Varian telah diproses tetapi ID-nya belum diterima. Periksa status varian sebelum mencoba kembali.");
            }
            varianBarangId = createdVariantId;
            variantCreationKeyRef.current = null;
            if (selectedProduct?.is_rentable) {
              tariffPendingVariantIdRef.current = createdVariantId;
              tariffPendingVariantNameRef.current = newVariantName;
            }
            setForm((current) => ({ ...current, varianBarangId: createdVariantId }));
            setCreatingVariant(false);
            setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
            setVariantFeedback("Varian baru berhasil dibuat di bawah barang yang sama. Unit akan didaftarkan ke varian tersebut.");
            await queryClient.invalidateQueries({ queryKey: ["inventaris", "variants", context.data.usahaId] });
            await variants.refetch();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("BUSINESS_CONFLICT") && !message.includes("23505") && !message.toLowerCase().includes("duplicate")) {
              throw error;
            }

            const refreshed = await variants.refetch();
            const racedVariant = findMatchingInventoryVariant(
              (refreshed.data ?? variants.data ?? []).filter((variant) => variant.barang_id === form.barangId),
              variantDraft,
            );
            if (!racedVariant) throw error;

            varianBarangId = racedVariant.varian_barang_id;
            variantCreationKeyRef.current = null;
            setForm((current) => ({ ...current, varianBarangId: racedVariant.varian_barang_id }));
            setCreatingVariant(false);
            setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
            setVariantFeedback("Varian yang sama baru saja dibuat oleh proses lain. Unit akan menggunakan varian tersebut.");
          }
        }
      }

      if (tariffPendingVariantIdRef.current) {
        if (!selectedProduct?.is_rentable) {
          tariffPendingVariantIdRef.current = null;
          tariffCreationKeyRef.current = null;
        } else {
          if (!validVariantTariff) throw new Error("Isi tarif sewa per 1 hari untuk varian baru.");
          if (!tariffCreationKeyRef.current) {
            tariffCreationKeyRef.current = "inventory-create-tariff-" + createClientId();
          }
          const tariffTargetId = tariffPendingVariantIdRef.current;
          const tariffVariantName = tariffPendingVariantNameRef.current || selectedVariant?.nama || newVariantName;
          await createCatalogTariff(context.data.usahaId, {
            varianBarangId: tariffTargetId,
            nama: "Sewa " + selectedProduct.nama + (tariffVariantName ? " / " + tariffVariantName : ""),
            durasiUnit: "hari",
            durasiNilai: 1,
            nominal: parsedVariantTariffAmount,
            currencyCode: "IDR",
            status: "active",
          }, { idempotencyKey: tariffCreationKeyRef.current });
          tariffCreationKeyRef.current = null;
          tariffPendingVariantIdRef.current = null;
          tariffPendingVariantNameRef.current = null;
          setVariantFeedback("Tarif sewa per 1 hari berhasil ditambahkan untuk varian baru.");
        }
      }

      return registerInventoryUnits(context.data.usahaId, {
        barangId: form.barangId,
        varianBarangId,
        lokasiId: form.lokasiId,
        tanggalDiperoleh: form.tanggalDiperoleh,
        sumberPembelianDetailId: sourceMode === "purchase" ? form.sumberPembelianDetailId : null,
        catatanInternal: form.catatanInternal,
      }, jumlahUnitValue, {
        idempotencyKey: commandRef.current,
        requestId: createClientId(),
      });
    },
    onMutate: () => {
      setMode("processing");
      setFeedback("");
    },
    onSuccess: async (result) => {
      const units = result.units ?? [];
      setCreatedUnits(units);
      setCreatedId(units[0]?.unit_barang_id ?? null);
      setForm((current) => ({ ...current, kodeUnit: units[0]?.kode_unit ?? current.kodeUnit }));
      commandRef.current = null;
      setMode("success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
        queryClient.invalidateQueries({ queryKey: ["inventaris", "purchase-source"] }),
        queryClient.invalidateQueries({ queryKey: ["pembelian"] }),
      ]);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Pendaftaran unit gagal.";
      setFeedback(message);
      if (message.startsWith("UNKNOWN_OUTCOME:")) {
        setMode("unknown");
      } else {
        commandRef.current = null;
        setMode("error");
      }
    },
  });

  const update = <K extends keyof RegisterInventoryUnitInput>(
    key: K,
    value: RegisterInventoryUnitInput[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateVariantDraft = <K extends keyof InventoryVariantDraft>(
    key: K,
    value: InventoryVariantDraft[K],
  ) => {
    variantCreationKeyRef.current = null;
    setVariantDraft((current) => ({ ...current, [key]: value }));
    setVariantFeedback("");
  };

  const reconcile = async () => {
    if (!context.data?.usahaId) return;
    setReconciling(true);
    try {
      if (variantCreationKeyRef.current) {
        const variantResult = await reconcileCatalogMutation(
          context.data.usahaId,
          "create_varian_barang",
          variantCreationKeyRef.current,
        );
        if (variantResult.state === "committed" && variantResult.response) {
          const response = variantResult.response as unknown as { varian_barang_id?: string };
          if (!response.varian_barang_id) {
            setFeedback("Pembuatan varian tercatat, tetapi ID varian tidak tersedia. Jangan buat varian kedua; periksa Katalog.");
            return;
          }
          setForm((current) => ({ ...current, varianBarangId: response.varian_barang_id! }));
          if (selectedProduct?.is_rentable) {
            tariffPendingVariantIdRef.current = response.varian_barang_id!;
            tariffPendingVariantNameRef.current = newVariantName;
          }
          setCreatingVariant(false);
          setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
          setVariantFeedback("Varian baru terkonfirmasi. Tinjau kembali pendaftaran unit untuk melanjutkan.");
          variantCreationKeyRef.current = null;
          commandRef.current = null;
          await queryClient.invalidateQueries({ queryKey: ["inventaris", "variants", context.data.usahaId] });
          await variants.refetch();
          setFeedback("");
          setMode("review");
        } else if (variantResult.state === "not_found") {
          variantCreationKeyRef.current = null;
          commandRef.current = null;
          setFeedback("Pembuatan varian tidak tercatat. Periksa atributnya, lalu coba kembali.");
          setFormStep(1);
          setMode("form");
        } else {
          setFeedback("Hasil pembuatan varian masih belum dapat dipastikan. Jangan mengulang pembuatan varian.");
        }
        return;
      }

      if (tariffCreationKeyRef.current && tariffPendingVariantIdRef.current) {
        const tariffResult = await reconcileCatalogMutation(
          context.data.usahaId,
          "create_tarif_sewa",
          tariffCreationKeyRef.current,
        );
        if (tariffResult.state === "committed") {
          tariffCreationKeyRef.current = null;
          tariffPendingVariantIdRef.current = null;
          tariffPendingVariantNameRef.current = null;
          commandRef.current = null;
          setFeedback("Tarif sewa varian sudah tersimpan. Tinjau kembali lalu lanjutkan pendaftaran unit.");
          setMode("review");
        } else if (tariffResult.state === "not_found") {
          commandRef.current = null;
          setFeedback("Tarif belum tercatat. Kembali ke tinjauan dan kirim ulang untuk menyimpan tarif sebelum unit didaftarkan.");
          setMode("review");
        } else {
          setFeedback("Hasil pembuatan tarif belum dapat dipastikan. Jangan mengirim ulang sebelum status diperiksa.");
        }
        return;
      }

      if (!commandRef.current) return;
      const result = await reconcileInventoryCommand(
        context.data.usahaId,
        "register_inventory_units",
        commandRef.current,
      );
      if (result.state === "committed" && result.response && "units" in result.response) {
        const units = result.response.units ?? [];
        setCreatedUnits(units);
        setCreatedId(units[0]?.unit_barang_id ?? null);
        setForm((current) => ({ ...current, kodeUnit: units[0]?.kode_unit ?? current.kodeUnit }));
        commandRef.current = null;
        setFeedback("");
        setMode("success");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["inventaris"] }),
          queryClient.invalidateQueries({ queryKey: ["inventaris", "purchase-source"] }),
          queryClient.invalidateQueries({ queryKey: ["pembelian"] }),
        ]);
      } else if (result.state === "not_found") {
        commandRef.current = null;
        setFeedback("Hasil pendaftaran tidak ditemukan. Periksa data terbaru sebelum mencoba lagi.");
        setMode("form");
      } else {
        setFeedback("Hasil tindakan belum dapat dipastikan. Jangan kirim tindakan yang sama lagi.");
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Pemeriksaan status tindakan gagal.");
    } finally {
      setReconciling(false);
    }
  };

  if (context.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
        <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (context.error || !context.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Inventaris belum siap</AlertTitle>
        <AlertDescription>{context.error?.message ?? "Konteks Usaha belum tersedia."}</AlertDescription>
      </Alert>
    );
  }

  if (mode === "processing") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={paths.inventaris} className="hover:underline">Inventaris</Link>
          <span>/</span>
          <span>Daftarkan Unit</span>
        </div>
        <Card className="shadow-sm">
          <CardContent className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <PackagePlus className="size-7" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Mendaftarkan Unit</h1>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Tindakan dikirim sebagai transaksi sistem. Jangan kirim tindakan yang sama lagi selama hasil belum jelas.
              </p>
            </div>
            <div className="grid w-full gap-2 text-left text-sm">
              {[
                "Validasi tenant dan katalog",
                "Membuat unit physical truth",
                "Menyimpan riwayat + audit + outbox",
                "Finalisasi idempotency",
              ].map((step) => (
                <div key={step} className="flex items-center gap-3 rounded-xl border p-3">
                  <Check className="size-4 text-primary" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "success") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 pb-10">
        <Card className="overflow-hidden shadow-sm">
          <CardContent className="flex min-h-[28rem] flex-col items-center justify-center gap-5 p-8 text-center sm:p-10">
            <div className="grid size-20 place-items-center rounded-full bg-primary/10 ring-8 ring-primary/[0.04] text-primary">
              <Check className="size-10" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{createdUnits.length > 1 ? createdUnits.length + " unit berhasil didaftarkan" : "Unit berhasil didaftarkan"}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {createdUnits.length} unit fisik telah masuk inventaris. Kode unit dibuat otomatis dan unik oleh sistem.
              </p>
            </div>
            <div className="w-full max-w-md rounded-2xl border bg-muted/20 p-4 text-left">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Barang</p><p className="mt-1 font-semibold">{selectedProduct?.nama ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Jumlah unit</p><p className="mt-1 font-semibold">{createdUnits.length} unit</p></div>
                <div><p className="text-xs text-muted-foreground">Kode unit pertama</p><p className="mt-1 font-semibold">{(createdUnits[0]?.kode_unit ?? form.kodeUnit) || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Lokasi</p><p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Belum ditentukan"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="secondary" className="mt-1 rounded-full">Siap Disewakan</Badge></div>
              </div>
            </div>
            {createdUnits.length > 0 ? (
              <div className="w-full max-w-md rounded-xl border p-3 text-left">
                <p className="text-xs font-semibold text-muted-foreground">Kode unit otomatis</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {createdUnits.slice(0, 8).map((unit) => (
                    <Badge key={unit.unit_barang_id} variant="outline" className="rounded-md font-mono">{unit.kode_unit ?? unit.unit_barang_id.slice(0, 8)}</Badge>
                  ))}
                  {createdUnits.length > 8 ? <Badge variant="secondary" className="rounded-md">+{createdUnits.length - 8} lainnya</Badge> : null}
                </div>
              </div>
            ) : null}
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              Serial number produsen tidak dibuat secara artifisial. Bila tersedia pada barang fisik, nomor tersebut dapat dicatat di detail unit. Pemeriksaan terstruktur tetap dilakukan setelah pengembalian.
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button className="h-11 min-w-44 rounded-xl" onClick={() => createdId && navigate(paths.inventaris + "/" + createdId)}>Lihat Detail Unit</Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => navigate(paths.inventaris)}>Kembali ke Inventaris</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "unknown") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <UnknownOutcomeNotice
          message={feedback}
          onReconcile={() => void reconcile()}
          busy={reconciling}
        />
        <Button variant="ghost" className="rounded-xl" onClick={() => navigate(paths.inventaris)}>
          Keluar tanpa retry
        </Button>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Pendaftaran unit belum berhasil</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button className="rounded-xl" onClick={() => setMode("review")}>
            Kembali ke Tinjauan
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => navigate(paths.inventaris)}>
            Kembali
          </Button>
        </div>
      </div>
    );
  }

  const currentStep = stepState(mode, formStep);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-24 sm:space-y-5">
      <header className="space-y-2">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.inventaris}><ArrowLeft />Kembali ke Inventaris</Link>
        </Button>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{context.data.usahaNama}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Daftarkan Unit</h1>
            <Badge variant="secondary" className="rounded-full">Aman digunakan</Badge>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Daftarkan satu atau beberapa unit fisik sekaligus. Kode unit dibuat otomatis untuk setiap unit; pembelian hanya menjadi referensi opsional.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2" aria-label="Tahap pendaftaran unit">
        {["Identitas", "Lokasi", "Tinjauan"].map((label, index) => {
          const step = index + 1;
          const active = step === currentStep;
          const complete = step < currentStep;
          return (
            <div key={label} className="space-y-1">
              <div className={`h-1.5 rounded-full ${complete || active ? "bg-primary" : "bg-muted"}`} />
              <p className={`text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {step}. {label}
              </p>
            </div>
          );
        })}
      </div>

      {products.error || variants.error || locations.error ? (
        <Alert variant="destructive">
          <AlertTitle>Referensi Inventaris belum lengkap</AlertTitle>
          <AlertDescription>
            Produk, varian, atau lokasi tidak dapat dimuat. Periksa koneksi dan segarkan sebelum melanjutkan.
          </AlertDescription>
        </Alert>
      ) : null}

      {mode === "form" ? (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{formStep === 1 ? "Identitas fisik" : "Lokasi & perolehan"}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formStep === 1
                  ? "Tentukan barang dan identitas unit yang akan diregistrasikan."
                  : "Lengkapi konteks penyimpanan dan asal unit sebelum review."}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className={formStep === 1 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-product" className="text-xs font-semibold">Barang</label>
                <Select
                  value={form.barangId}
                  onValueChange={(value) => {
                    setSourceMode("manual");
                    setSelectedPurchaseId(null);
                    setJumlahUnit("1");
                    setCreatingVariant(false);
                    setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
                    setVariantTariffAmount("");
                    setVariantFeedback("");
                    variantCreationKeyRef.current = null;
                    tariffCreationKeyRef.current = null;
                    tariffPendingVariantIdRef.current = null;
                    tariffPendingVariantNameRef.current = null;
                    const productVariants = (variants.data ?? []).filter((variant) => variant.barang_id === value);
                    setForm((current) => ({
                      ...current,
                      barangId: value,
                      varianBarangId: productVariants.length === 1 ? productVariants[0].varian_barang_id : null,
                      sumberPembelianDetailId: null,
                    }));
                  }}
                >
                  <SelectTrigger id="inventory-product" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="Pilih barang" />
                  </SelectTrigger>
                  <SelectContent>
                    {(products.data ?? []).map((product) => (
                      <SelectItem key={product.barang_id} value={product.barang_id}>{product.nama}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={formStep === 1 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="inventory-variant" className="text-xs font-semibold">
                    Varian <span className="font-normal text-muted-foreground">{selectedVariants.length > 0 ? "(wajib dipilih)" : "(opsional)"}</span>
                  </label>
                  {form.barangId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={creatingVariant ? "ghost" : "outline"}
                      className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                      onClick={() => {
                        if (creatingVariant) {
                          setCreatingVariant(false);
                          setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
                          setVariantTariffAmount("");
                          variantCreationKeyRef.current = null;
                          tariffCreationKeyRef.current = null;
                          tariffPendingVariantIdRef.current = null;
                          tariffPendingVariantNameRef.current = null;
                          setVariantFeedback("");
                        } else {
                          setCreatingVariant(true);
                          update("varianBarangId", null);
                          setVariantFeedback("");
                        }
                      }}
                    >
                      {creatingVariant ? "Batal" : "+ Tambah varian"}
                    </Button>
                  ) : null}
                </div>
                <Select
                  value={form.varianBarangId ?? (selectedVariants.length > 0 ? "" : "none")}
                  onValueChange={(value) => {
                    setSourceMode("manual");
                    setSelectedPurchaseId(null);
                    setJumlahUnit("1");
                    setForm((current) => ({ ...current, varianBarangId: value === "none" ? null : value, sumberPembelianDetailId: null }));
                  }}
                  disabled={!form.barangId || selectedVariants.length === 0 || creatingVariant}
                >
                  <SelectTrigger id="inventory-variant" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder={
                      !form.barangId
                        ? "Pilih barang dulu"
                        : selectedVariants.length > 0
                          ? "Pilih seri / varian yang sesuai"
                          : "Barang ini tidak memiliki varian"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedVariants.length === 0 ? <SelectItem value="none">Tanpa varian</SelectItem> : null}
                    {selectedVariants.map((variant) => (
                      <SelectItem key={variant.varian_barang_id} value={variant.varian_barang_id}>
                        <span className="flex min-w-0 flex-col">
                          <span>{variant.nama}{variant.kode_internal ? " · " + variant.kode_internal : ""}</span>
                          {inventoryVariantAttributeEntries(variant.atribut_pembeda).length > 0 ? (
                            <span className="max-w-[70vw] truncate text-[11px] text-muted-foreground">
                              {inventoryVariantAttributeEntries(variant.atribut_pembeda)
                                .map((attribute) => attribute.label + ": " + attribute.value)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!creatingVariant && selectedVariants.length > 0 && !form.varianBarangId ? (
                  <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                    Pilih varian sesuai barang fisik agar unit tidak tercatat pada seri atau kualitas yang keliru.
                  </p>
                ) : null}
                {!creatingVariant && selectedVariant ? (
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <p className="text-xs font-semibold">Spesifikasi varian terpilih</p>
                    {selectedVariant.media?.length ? (
                      <div className="mt-2 flex items-center gap-3 rounded-xl bg-background p-2">
                        <img
                          src={(selectedVariant.media.find((item) => item.is_cover) ?? selectedVariant.media[0]).url}
                          alt={"Foto varian " + selectedVariant.nama}
                          className="size-16 shrink-0 rounded-lg object-cover"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">Foto representatif varian</p>
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            Foto ini digunakan bersama seluruh unit pada varian yang sama. Foto fisik asli dapat ditambahkan dari detail unit.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        Varian ini belum memiliki foto representatif. Unit tetap dapat didaftarkan; foto dapat ditambahkan dari Katalog.
                      </p>
                    )}
                    {inventoryVariantAttributeEntries(selectedVariant.atribut_pembeda).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inventoryVariantAttributeEntries(selectedVariant.atribut_pembeda).map((attribute) => (
                          <Badge key={attribute.label} variant="outline" className="rounded-full">
                            {attribute.label}: {attribute.value}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {typeof selectedVariant.atribut_pembeda?.catatan === "string" && selectedVariant.atribut_pembeda.catatan.trim() ? (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Catatan varian: {selectedVariant.atribut_pembeda.catatan}
                      </p>
                    ) : null}
                    {selectedVariant.deskripsi?.trim() ? (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedVariant.deskripsi}</p>
                    ) : null}
                  </div>
                ) : null}
                {creatingVariant ? (
                  <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.025] p-3.5">
                    <div>
                      <p className="text-sm font-semibold">Tambah varian untuk {selectedProduct?.nama}</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        Varian baru akan menjadi bagian dari barang induk ini. Tidak ada barang katalog baru yang dibuat.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="grid gap-1.5 text-xs font-medium">
                        Warna
                        <Input value={variantDraft.warna} onChange={(event) => updateVariantDraft("warna", event.target.value)} placeholder="Contoh: Hitam" className="h-10 rounded-lg" />
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium">
                        Kapasitas / Ukuran
                        <Input value={variantDraft.kapasitas} onChange={(event) => updateVariantDraft("kapasitas", event.target.value)} placeholder="Contoh: 4 orang" className="h-10 rounded-lg" />
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium">
                        Seri
                        <Input value={variantDraft.seri} onChange={(event) => updateVariantDraft("seri", event.target.value)} placeholder="Contoh: V2" className="h-10 rounded-lg" />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-xs font-medium">
                        Kode internal <span className="font-normal text-muted-foreground">(opsional)</span>
                        <Input value={variantDraft.kodeInternal} onChange={(event) => updateVariantDraft("kodeInternal", event.target.value)} placeholder="Contoh: TND-4P-BLK" className="h-10 rounded-lg" />
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium">
                        Catatan varian <span className="font-normal text-muted-foreground">(opsional)</span>
                        <Input value={variantDraft.catatan} onChange={(event) => updateVariantDraft("catatan", event.target.value)} placeholder="Catatan pembeda" className="h-10 rounded-lg" />
                      </label>
                    </div>
                    <label className="grid gap-1.5 text-xs font-medium">
                      Deskripsi <span className="font-normal text-muted-foreground">(opsional)</span>
                      <Textarea value={variantDraft.deskripsi} onChange={(event) => updateVariantDraft("deskripsi", event.target.value)} placeholder="Informasi tambahan tentang varian" className="min-h-16 rounded-lg" rows={2} />
                    </label>
                    {selectedProduct?.is_rentable && !matchingVariant ? (
                      <label className="grid gap-1.5 text-xs font-semibold">
                        Tarif sewa per 1 hari (IDR)
                        <Input
                          type="number"
                          min="0"
                          step="500"
                          required={requiresNewVariantTariff}
                          inputMode="numeric"
                          value={variantTariffAmount}
                          onChange={(event) => setVariantTariffAmount(event.target.value)}
                          placeholder="Contoh: 25000"
                          className="h-10 rounded-lg"
                          aria-label="Tarif sewa per 1 hari"
                        />
                        <span className="text-[11px] font-normal leading-5 text-muted-foreground">
                          Tarif aktif ini langsung ditautkan ke varian baru. Durasi lain dapat ditambahkan dari Katalog → Tarif.
                        </span>
                        {!validVariantTariff ? <span className="text-[11px] font-medium text-destructive">Masukkan nominal tarif yang valid, termasuk 0 bila gratis.</span> : null}
                      </label>
                    ) : null}
                    <div className="rounded-lg bg-background px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nama varian otomatis</p>
                      <p className="mt-1 text-sm font-semibold">{newVariantName || "Isi minimal satu atribut pembeda"}</p>
                    </div>
                    {!inventoryVariantHasIdentity(variantDraft) ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">Isi minimal satu atribut: warna, kapasitas/ukuran, atau seri.</p>
                    ) : null}
                    {matchingVariant ? (
                      <Alert className="border-primary/20 bg-primary/[0.035] py-2.5">
                        <AlertTitle className="text-xs">Varian sudah tersedia</AlertTitle>
                        <AlertDescription className="text-xs leading-5">
                          {matchingVariant.nama} memiliki atribut yang sama. Gunakan data yang sudah ada agar tidak membuat duplikat.
                        </AlertDescription>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 h-8 rounded-lg"
                          onClick={() => {
                            setForm((current) => ({ ...current, varianBarangId: matchingVariant.varian_barang_id }));
                            setCreatingVariant(false);
                            setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
                            setVariantFeedback("Varian yang sama sudah tersedia dan akan digunakan untuk unit ini.");
                          }}
                        >
                          Gunakan varian yang ada
                        </Button>
                      </Alert>
                    ) : variantNameCollision ? (
                      <Alert variant="destructive" className="py-2.5">
                        <AlertTitle className="text-xs">Nama varian sudah digunakan</AlertTitle>
                        <AlertDescription className="text-xs leading-5">
                          Nama ini sudah dipakai spesifikasi lain pada barang yang sama. Ubah atribut atau pilih varian yang tersedia.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {newVariantPurchaseConflict ? (
                      <Alert variant="destructive" className="py-2.5">
                        <AlertTitle className="text-xs">Terikat ke varian pembelian</AlertTitle>
                        <AlertDescription className="text-xs leading-5">
                          Rincian pembelian ini sudah menentukan varian tertentu. Gunakan varian yang tercantum pada pembelian atau ganti asal unit menjadi input manual.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : variantFeedback ? (
                  <Alert className="border-primary/20 bg-primary/[0.035] py-2.5">
                    <AlertDescription className="text-xs leading-5">{variantFeedback}</AlertDescription>
                  </Alert>
                ) : null}
              </div>

              <div className={formStep === 1 ? "space-y-3 sm:col-span-2" : "hidden"}>
                <div className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <PackagePlus className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Identitas unit dibuat otomatis</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Kode unit akan dibuat sistem berdasarkan kategori + barang dan nomor urut Usaha saat pendaftaran disimpan.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl bg-background/80 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Kode unit</p>
                    <p className="mt-0.5 text-sm font-semibold text-primary">Otomatis saat disimpan</p>
                  </div>
                </div>

                <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                  <p className="text-xs font-semibold">Serial number produsen</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Tidak dibuat secara artifisial oleh sistem. Bila unit memiliki serial number fisik, data dapat dilengkapi kemudian pada detail unit.
                  </p>
                </div>
              </div>

              <div className={formStep === 2 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-location" className="text-xs font-semibold">
                  Lokasi awal <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Select
                  value={form.lokasiId ?? "none"}
                  onValueChange={(value) => update("lokasiId", value === "none" ? null : value)}
                >
                  <SelectTrigger id="inventory-location" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="Belum ditentukan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Belum ditentukan</SelectItem>
                    {(locations.data ?? [])
                      .filter((location) => location.status === "active")
                      .map((location) => (
                        <SelectItem key={location.lokasi_id} value={location.lokasi_id}>
                          {location.nama}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={formStep === 2 ? "space-y-1.5" : "hidden"}>
                <label htmlFor="inventory-acquired" className="text-xs font-semibold">
                  Tanggal diperoleh <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  id="inventory-acquired"
                  type="date"
                  value={form.tanggalDiperoleh ?? ""}
                  onChange={(event) => update("tanggalDiperoleh", event.target.value || null)}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-source-mode" className="text-xs font-semibold">Asal unit</label>
                <Select
                  value={sourceMode}
                  onValueChange={(value) => {
                    setSourceMode(value === "purchase" ? "purchase" : "manual");
                    setSelectedPurchaseId(null);
                    setPurchaseSearch("");
                    setJumlahUnit("1");
                    update("sumberPembelianDetailId", null);
                  }}
                >
                  <SelectTrigger id="inventory-source-mode" className="h-11 rounded-xl">
                    <SelectValue placeholder="Pilih asal unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Bukan dari pembelian / input manual</SelectItem>
                    <SelectItem value="purchase">Berasal dari pembelian</SelectItem>
                  </SelectContent>
                </Select>
                {sourceMode === "purchase" ? (
                  <div className="space-y-3 rounded-xl border p-3">
                    <div>
                      <p className="text-xs font-semibold">Pilih pembelian</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Jumlah akan terisi otomatis dari jumlah yang belum terhubung ke inventaris. Jumlah tetap dapat disesuaikan bila kondisi fisik berbeda.</p>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Cari nomor pembelian atau pemasok…" className="h-11 rounded-xl pl-9" />
                    </div>
                    <div className="grid gap-2">
                      {(purchases.data?.purchases ?? []).map((purchase) => (
                        <button key={purchase.pembelian_id} type="button" onClick={() => { setSelectedPurchaseId(purchase.pembelian_id); setJumlahUnit("1"); update("sumberPembelianDetailId", null); }} className={selectedPurchaseId === purchase.pembelian_id ? "rounded-xl border border-primary bg-primary/[0.035] p-3 text-left ring-1 ring-primary/20" : "rounded-xl border p-3 text-left hover:bg-muted/40"}>
                          <p className="text-sm font-semibold">{purchase.nomor_pembelian}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{purchase.pemasok_nama ?? "Pemasok tidak tercatat"} · {purchase.tanggal_pembelian}</p>
                        </button>
                      ))}
                      {!purchases.isPending && (purchases.data?.purchases ?? []).length === 0 ? <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Pembelian tidak ditemukan.</p> : null}
                    </div>
                    {selectedPurchase.data ? (
                      <div className="rounded-xl border bg-muted/20 p-3">
                        <p className="text-xs font-semibold">Pilih rincian barang</p>
                        <div className="mt-2 grid gap-2">
                          {selectedPurchase.data.lines.map((line) => (
                            <button
                              key={line.detail_pembelian_id}
                              type="button"
                              onClick={() => {
                                const remaining = Math.max(0, Math.floor(Number(line.jumlah) || 0) - Number(line.registered_unit_count ?? 0));
                                setJumlahUnit(String(remaining));
                                if (line.barang_id !== form.barangId || line.varian_barang_id) {
                                  setCreatingVariant(false);
                                  setVariantDraft(EMPTY_INVENTORY_VARIANT_DRAFT);
                                  setVariantFeedback("");
                                  variantCreationKeyRef.current = null;
                                }
                                setForm((current) => ({
                                  ...current,
                                  barangId: line.barang_id ?? "",
                                  varianBarangId: line.varian_barang_id,
                                  sumberPembelianDetailId: line.detail_pembelian_id,
                                  tanggalDiperoleh: selectedPurchase.data?.tanggal_pembelian ?? current.tanggalDiperoleh,
                                }));
                              }}
                              className={form.sumberPembelianDetailId === line.detail_pembelian_id ? "rounded-lg border border-primary bg-background p-3 text-left ring-1 ring-primary/20" : "rounded-lg border bg-background p-3 text-left hover:bg-muted"}
                            >
                              <p className="text-sm font-medium">{line.barang_nama ?? line.deskripsi ?? "Barang pembelian"}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {line.varian_nama ?? "Tanpa varian"} · catatan {line.jumlah} unit · {line.registered_unit_count ?? 0} terhubung
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {selectedPurchaseLine ? (
                      <Alert className={quantityExceedsPurchaseReference ? "border-amber-300 bg-amber-50/70 text-amber-950" : ""}>
                        <CircleAlert className="size-4" />
                        <AlertTitle>{quantityExceedsPurchaseReference ? "Periksa kesesuaian jumlah" : "Referensi pembelian"}</AlertTitle>
                        <AlertDescription>
                          Catatan pembelian: {selectedPurchaseLine.jumlah} unit; sudah terhubung: {selectedPurchaseRegistered}; sisa acuan: {selectedPurchaseRemaining}.
                          {selectedPurchaseLine.quantity_needs_review
                            ? " Jumlah pada catatan pembelian perlu diperiksa. Pastikan jumlah fisik benar; peringatan ini tidak mengunci pendaftaran."
                            : quantityExceedsPurchaseReference
                              ? " Jumlah di atas sisa catatan. Pastikan barang fisik memang tersedia; peringatan ini tidak mengunci pendaftaran."
                              : " Jumlah awal diisi otomatis berdasarkan sisa catatan pembelian."}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-xl border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                    Untuk barang dari stok awal, hibah, atau sumber lain, pilih mode ini. Tidak perlu membuat pembelian terlebih dahulu.
                  </p>
                )}
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-quantity" className="text-xs font-semibold">Jumlah unit yang didaftarkan</label>
                <Input
                  id="inventory-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={250}
                  step={1}
                  value={jumlahUnit}
                  onChange={(event) => setJumlahUnit(event.target.value)}
                  className="h-11 rounded-xl"
                />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Setiap unit memperoleh ID dan kode unit unik secara otomatis. Maksimal 250 unit per pendaftaran. Serial number produsen tidak dibuat secara palsu; isi di detail unit bila tersedia secara fisik.
                </p>
                {!validJumlahUnit ? <p className="text-xs text-destructive">Masukkan bilangan bulat antara 1 dan 250.</p> : null}
              </div>

              <div className={formStep === 2 ? "space-y-1.5 sm:col-span-2" : "hidden"}>
                <label htmlFor="inventory-note" className="text-xs font-semibold">
                  Catatan internal <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Textarea
                  id="inventory-note"
                  value={form.catatanInternal ?? ""}
                  onChange={(event) => update("catatanInternal", event.target.value)}
                  placeholder="Catatan operasional unit"
                  className="min-h-24 rounded-xl"
                />
              </div>
            </CardContent>
          </Card>

          <Alert className="border-primary/15 bg-primary/[0.03]">
            <ShieldCheck className="size-4" />
            <AlertTitle>Registrasi adalah konfirmasi kelayakan awal</AlertTitle>
            <AlertDescription>
              Sebelum menekan Daftarkan Unit, admin memastikan benda fisik sudah layak digunakan. Sistem tidak membuat acquisition inspection terpisah; Pemeriksaan terstruktur digunakan setelah return.
            </AlertDescription>
          </Alert>
        </>
      ) : (
        <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Tinjauan Pendaftaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Barang</p>
                  <p className="mt-1 font-semibold">{selectedProduct?.nama ?? "—"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Varian</p>
                  <p className="mt-1 font-semibold">{creatingVariant ? (newVariantName || "Varian baru belum lengkap") : (selectedVariant?.nama ?? "Tanpa varian")}</p>
                  {creatingVariant ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {inventoryVariantAttributeEntries(newVariantAttributes).map((attribute) => (
                        <Badge key={attribute.label} variant="outline" className="rounded-full">
                          {attribute.label}: {attribute.value}
                        </Badge>
                      ))}
                    </div>
                  ) : selectedVariant ? (
                    <>
                      {inventoryVariantAttributeEntries(selectedVariant.atribut_pembeda).length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {inventoryVariantAttributeEntries(selectedVariant.atribut_pembeda).map((attribute) => (
                            <Badge key={attribute.label} variant="outline" className="rounded-full">
                              {attribute.label}: {attribute.value}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {typeof selectedVariant.atribut_pembeda?.catatan === "string" && selectedVariant.atribut_pembeda.catatan.trim() ? (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          Catatan varian: {selectedVariant.atribut_pembeda.catatan}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className="rounded-2xl border bg-primary/[0.03] p-4">
                  <p className="text-xs text-muted-foreground">Jumlah unit</p>
                  <p className="mt-1 font-semibold text-primary">{jumlahUnit} unit · kode tiap unit otomatis</p>
                </div>
                {selectedProduct?.is_rentable && Boolean(tariffPendingVariantIdRef.current || (creatingVariant && !matchingVariant)) ? (
                  <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
                    <p className="text-xs text-muted-foreground">Tarif sewa aktif · 1 hari</p>
                    <p className="mt-1 font-semibold text-primary">Rp {parsedVariantTariffAmount.toLocaleString("id-ID")}</p>
                  </div>
                ) : null}
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Asal unit</p>
                  <p className="mt-1 font-semibold">{sourceMode === "purchase" ? (selectedPurchaseLine ? "Pembelian terkait" : "Pembelian belum dipilih") : "Input manual / non-pembelian"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Serial number</p>
                  <p className="mt-1 font-semibold">Dicatat kemudian bila tersedia</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Lokasi awal</p>
                  <p className="mt-1 font-semibold">{selectedLocation?.nama ?? "Belum ditentukan"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground">Tanggal diperoleh</p>
                  <p className="mt-1 font-semibold">{form.tanggalDiperoleh || "Belum dicatat"}</p>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-semibold text-muted-foreground">Status setelah berhasil</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-full">Siap Disewakan</Badge>
                  <span className="text-sm text-muted-foreground">Unit siap digunakan berdasarkan konfirmasi admin saat registrasi.</span>
                </div>
              </div>

              {form.catatanInternal ? (
                <div className="rounded-2xl border p-4">
                  <p className="text-xs text-muted-foreground">Catatan internal</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{form.catatanInternal}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      <div className="sticky bottom-3 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur-md">
        {mode === "form" ? (
          formStep === 1 ? (
            <Button
              className="h-12 w-full rounded-xl"
              disabled={!readyToReview || products.isPending || variants.isPending || locations.isPending}
              onClick={() => setFormStep(2)}
            >
              Lanjutkan
              <ArrowRight />
            </Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-12 rounded-xl" onClick={() => setFormStep(1)}>
                Kembali
              </Button>
              <Button className="h-12 rounded-xl" disabled={!readyToReview} onClick={() => setMode("review")}>
                Tinjauan Pendaftaran
                <ArrowRight />
              </Button>
            </div>
          )
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="h-12 rounded-xl"
              onClick={() => {
                setFormStep(2);
                setMode("form");
              }}
            >
              Kembali Edit
            </Button>
            <Button
              className="h-12 rounded-xl"
              disabled={mutation.isPending || !capabilities.mutation || !readyToReview}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Mendaftarkan Unit…" : "Daftarkan " + jumlahUnit + " Unit"}
              <PackagePlus />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
