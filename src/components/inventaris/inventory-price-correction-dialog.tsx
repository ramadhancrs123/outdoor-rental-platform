import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CalendarClock, Loader2, Package, Save, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getCatalogProduct,
  reconcileCatalogMutation,
  setCatalogProductPurchaseCost,
  setCatalogProductSalesConfig,
  setCatalogVariantPurchaseCost,
  setCatalogVariantSalesConfig,
  updateCatalogTariff,
} from "@/features/katalog";
import type { CatalogProductDetail, CatalogTariff, CatalogVariant } from "@/features/katalog/types";
import { catalogErrorMessage, formatCatalogMoney, formatTariffDuration, isActiveCatalogTariff } from "@/features/katalog/utils";
import { createClientId } from "@/lib/client-id";

type UncertainCommand = {
  commandName: string;
  idempotencyKey: string;
  message: string;
};

type Props = {
  usahaId: string;
  productId: string;
  productName: string;
};

function isUnknownOutcome(error: unknown) {
  return error instanceof Error && error.message.startsWith("UNKNOWN_OUTCOME:");
}

function amountValue(value: string, allowZero: boolean) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed >= (allowZero ? 0 : 1);
}

function PriceSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: typeof Calculator;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border p-3.5 sm:p-4">
      <div className="flex items-start gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function variantCanSell(variant: CatalogVariant, product: CatalogProductDetail) {
  return variant.is_sellable ?? product.is_sellable;
}

function variantCanRent(variant: CatalogVariant, product: CatalogProductDetail) {
  return variant.is_rentable ?? product.is_rentable;
}

export function InventoryPriceCorrectionDialog({ usahaId, productId, productName }: Props) {
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [productHppDraft, setProductHppDraft] = useState<string | null>(null);
  const [productSalesDraft, setProductSalesDraft] = useState<string | null>(null);
  const [variantHppDrafts, setVariantHppDrafts] = useState<Record<string, string>>({});
  const [variantSalesDrafts, setVariantSalesDrafts] = useState<Record<string, string>>({});
  const [tariffDrafts, setTariffDrafts] = useState<Record<string, string>>({});
  const [uncertainCommand, setUncertainCommand] = useState<UncertainCommand | null>(null);
  const queryClient = useQueryClient();

  const catalog = useQuery({
    queryKey: ["katalog", "product", usahaId, productId],
    queryFn: () => getCatalogProduct(usahaId, productId),
    enabled: open && Boolean(usahaId && productId),
    staleTime: 0,
  });

  const product = catalog.data;
  const sellableVariants = useMemo(
    () => (product?.variants ?? []).filter((variant) => variantCanSell(variant, product!)),
    [product],
  );
  const rentableVariants = useMemo(
    () => (product?.variants ?? []).filter((variant) => variantCanRent(variant, product!)),
    [product],
  );
  const activeProductTariffs = useMemo(
    () => (product?.tariffs ?? []).filter(
      (tariff) => tariff.barang_id === productId && tariff.varian_barang_id === null && tariff.paket_sewa_id === null && isActiveCatalogTariff(tariff),
    ),
    [product?.tariffs, productId],
  );
  const activeTariffsByVariant = useMemo(() => {
    const map = new Map<string, CatalogTariff[]>();
    for (const tariff of product?.tariffs ?? []) {
      if (!tariff.varian_barang_id || tariff.paket_sewa_id !== null || !isActiveCatalogTariff(tariff)) continue;
      const rows = map.get(tariff.varian_barang_id) ?? [];
      rows.push(tariff);
      map.set(tariff.varian_barang_id, rows);
    }
    return map;
  }, [product?.tariffs]);

  const hasSellableChannel = Boolean(product && (product.is_sellable || sellableVariants.length));
  const hasRentableChannel = Boolean(product && (product.is_rentable || rentableVariants.length));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["katalog", "product", usahaId, productId] }),
      queryClient.invalidateQueries({ queryKey: ["inventaris", "product", usahaId, productId] }),
      queryClient.invalidateQueries({ queryKey: ["penjualan", "catalog"] }),
      queryClient.invalidateQueries({ queryKey: ["keuangan"] }),
    ]);
  };

  const runCommand = async (
    key: string,
    commandName: string,
    action: (idempotencyKey: string) => Promise<unknown>,
    successMessage: string,
    clearDraft?: () => void,
  ) => {
    if (busyKey || uncertainCommand) return;
    const idempotencyKey = "inventory-price-" + createClientId();
    setBusyKey(key);
    try {
      await action(idempotencyKey);
      clearDraft?.();
      toast.success(successMessage);
      try {
        await refresh();
      } catch {
        toast.info("Koreksi tersimpan. Muat ulang detail untuk melihat nilai terbaru.");
      }
    } catch (error) {
      if (isUnknownOutcome(error)) {
        setUncertainCommand({
          commandName,
          idempotencyKey,
          message: error instanceof Error ? error.message : "Hasil perubahan belum dapat dipastikan.",
        });
        toast.error("Hasil koreksi belum dapat dipastikan. Periksa status sebelum mencoba kembali.");
      } else {
        toast.error(catalogErrorMessage(error, "Koreksi harga gagal disimpan."));
      }
    } finally {
      setBusyKey("");
    }
  };

  const reconcile = async () => {
    if (!uncertainCommand) return;
    setBusyKey("reconcile");
    try {
      const result = await reconcileCatalogMutation(usahaId, uncertainCommand.commandName, uncertainCommand.idempotencyKey);
      if (result.state === "committed") {
        setUncertainCommand(null);
        toast.success("Koreksi harga sudah tersimpan.");
        try {
          await refresh();
        } catch {
          toast.info("Koreksi tersimpan. Muat ulang detail untuk melihat nilai terbaru.");
        }
      } else if (result.state === "not_found") {
        setUncertainCommand(null);
        toast.info("Command tidak ditemukan. Periksa nilai terbaru sebelum mengirim ulang.");
        try {
          await refresh();
        } catch {
          toast.info("Detail belum dapat dimuat ulang. Segarkan halaman sebelum mengirim perubahan.");
        }
      } else {
        toast.error("Hasil koreksi masih belum dapat dipastikan. Jangan kirim ulang dulu.");
      }
    } catch (error) {
      toast.error(catalogErrorMessage(error, "Pemeriksaan status koreksi gagal."));
    } finally {
      setBusyKey("");
    }
  };

  const closeDialog = (next: boolean) => {
    if (busyKey) return;
    setOpen(next);
    if (!next && !uncertainCommand) {
      setProductHppDraft(null);
      setProductSalesDraft(null);
      setVariantHppDrafts({});
      setVariantSalesDrafts({});
      setTariffDrafts({});
    }
  };

  const updateTariff = (tariff: CatalogTariff) => {
    if (!product) return;
    const draft = tariffDrafts[tariff.tarif_sewa_id] ?? String(tariff.nominal);
    if (!amountValue(draft, true)) {
      toast.error("Nominal tarif harus berupa angka nol atau lebih.");
      return;
    }
    const amount = Number(draft);
    if (amount === Number(tariff.nominal)) return;
    void runCommand(
      "tariff-" + tariff.tarif_sewa_id,
      "update_tarif_sewa",
      (idempotencyKey) => updateCatalogTariff(usahaId, {
        tarifSewaId: tariff.tarif_sewa_id,
        nama: tariff.nama,
        durasiUnit: tariff.durasi_unit,
        durasiNilai: tariff.durasi_nilai,
        nominal: amount,
        berlakuMulai: tariff.berlaku_mulai,
        berlakuSampai: tariff.berlaku_sampai,
        expectedUpdatedAt: tariff.updated_at,
      }, { idempotencyKey }),
      "Tarif sewa berhasil dikoreksi.",
      () => setTariffDrafts((current) => {
        const next = { ...current };
        delete next[tariff.tarif_sewa_id];
        return next;
      }),
    );
  };

  const updateProductHpp = () => {
    if (!product) return;
    const draft = productHppDraft ?? (product.harga_beli == null ? "" : String(product.harga_beli));
    if (!amountValue(draft, true)) {
      toast.error("HPP harus berupa angka nol atau lebih.");
      return;
    }
    const amount = Number(draft);
    if (product.harga_beli != null && amount === Number(product.harga_beli)) return;
    void runCommand(
      "product-hpp",
      "set_barang_hpp",
      (idempotencyKey) => setCatalogProductPurchaseCost(usahaId, product.barang_id, amount, product.updated_at, { idempotencyKey }),
      "HPP produk berhasil dikoreksi. Perubahan berlaku untuk transaksi penjualan berikutnya.",
      () => setProductHppDraft(null),
    );
  };

  const updateProductSalePrice = () => {
    if (!product) return;
    const draft = productSalesDraft ?? (product.harga_jual == null ? "" : String(product.harga_jual));
    if (!amountValue(draft, false)) {
      toast.error("Harga jual harus lebih besar dari nol.");
      return;
    }
    const amount = Number(draft);
    if (amount === Number(product.harga_jual)) return;
    void runCommand(
      "product-sales",
      "set_barang_sales_config",
      (idempotencyKey) => setCatalogProductSalesConfig(usahaId, product.barang_id, {
        isRentable: product.is_rentable,
        isSellable: product.is_sellable,
        hargaJual: amount,
        inventoryMode: product.inventory_mode,
        expectedUpdatedAt: product.updated_at,
      }, { idempotencyKey }),
      "Harga jual produk berhasil dikoreksi.",
      () => setProductSalesDraft(null),
    );
  };

  const updateVariantHpp = (variant: CatalogVariant) => {
    if (!product) return;
    const draft = variantHppDrafts[variant.varian_barang_id] ?? (variant.harga_beli == null ? "" : String(variant.harga_beli));
    if (!amountValue(draft, true)) {
      toast.error("HPP varian harus berupa angka nol atau lebih.");
      return;
    }
    const amount = Number(draft);
    if (variant.harga_beli != null && amount === Number(variant.harga_beli)) return;
    void runCommand(
      "variant-hpp-" + variant.varian_barang_id,
      "set_varian_hpp",
      (idempotencyKey) => setCatalogVariantPurchaseCost(usahaId, variant.varian_barang_id, amount, variant.updated_at, { idempotencyKey }),
      "HPP varian berhasil dikoreksi.",
      () => setVariantHppDrafts((current) => {
        const next = { ...current };
        delete next[variant.varian_barang_id];
        return next;
      }),
    );
  };

  const updateVariantSalePrice = (variant: CatalogVariant) => {
    if (!product) return;
    const draft = variantSalesDrafts[variant.varian_barang_id] ?? (variant.harga_jual == null ? "" : String(variant.harga_jual));
    if (!amountValue(draft, false)) {
      toast.error("Harga jual varian harus lebih besar dari nol.");
      return;
    }
    const amount = Number(draft);
    if (amount === Number(variant.harga_jual)) return;
    void runCommand(
      "variant-sales-" + variant.varian_barang_id,
      "set_varian_sales_config",
      (idempotencyKey) => setCatalogVariantSalesConfig(usahaId, variant.varian_barang_id, {
        isRentable: variant.is_rentable ?? null,
        isSellable: variant.is_sellable ?? null,
        hargaJual: amount,
        inventoryMode: variant.inventory_mode ?? null,
        expectedUpdatedAt: variant.updated_at,
      }, { idempotencyKey }),
      "Harga jual varian berhasil dikoreksi.",
      () => setVariantSalesDrafts((current) => {
        const next = { ...current };
        delete next[variant.varian_barang_id];
        return next;
      }),
    );
  };

  const renderTariffEditor = (tariff: CatalogTariff) => {
    const value = tariffDrafts[tariff.tarif_sewa_id] ?? String(tariff.nominal);
    const valid = amountValue(value, true);
    const changed = Number(value) !== Number(tariff.nominal);
    return (
      <div key={tariff.tarif_sewa_id} className="grid gap-2 rounded-xl bg-muted/25 p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{tariff.nama}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatTariffDuration(tariff)} · {tariff.currency_code}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Tarif sekarang: {formatCatalogMoney(tariff.nominal, tariff.currency_code)}</p>
        </div>
        <label className="grid gap-1 text-xs font-semibold">
          Nominal baru
          <Input
            className="h-10 rounded-lg"
            type="number"
            min="0"
            step="500"
            inputMode="numeric"
            value={value}
            onChange={(event) => setTariffDrafts((current) => ({ ...current, [tariff.tarif_sewa_id]: event.target.value }))}
          />
        </label>
        <Button
          size="sm"
          className="h-10 rounded-lg"
          disabled={Boolean(busyKey || uncertainCommand) || !valid || !changed}
          onClick={() => updateTariff(tariff)}
        >
          {busyKey === "tariff-" + tariff.tarif_sewa_id ? <Loader2 className="animate-spin" /> : <Save />}
          Simpan
        </Button>
      </div>
    );
  };

  const renderVariantSalesEditor = (variant: CatalogVariant) => {
    const hppValue = variantHppDrafts[variant.varian_barang_id] ?? (variant.harga_beli == null ? "" : String(variant.harga_beli));
    const saleValue = variantSalesDrafts[variant.varian_barang_id] ?? (variant.harga_jual == null ? "" : String(variant.harga_jual));
    const hppValid = amountValue(hppValue, true);
    const saleValid = amountValue(saleValue, false);
    const inheritedHpp = variant.harga_beli == null;
    const inheritedSale = variant.harga_jual == null;
    const hppChanged = hppValid && (variant.harga_beli == null || Number(hppValue) !== Number(variant.harga_beli));
    const saleChanged = saleValid && Number(saleValue) !== Number(variant.harga_jual);

    return (
      <div key={variant.varian_barang_id} className="space-y-3 rounded-xl border p-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-semibold">{variant.nama}</p>
          <Badge variant="outline" className="rounded-full text-[10px]">Varian</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="grid gap-1 text-xs font-semibold">
              HPP varian (IDR)
              <Input
                className="h-10 rounded-lg"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={hppValue}
                placeholder={product?.harga_beli == null ? "Masukkan HPP" : "Ikuti " + formatCatalogMoney(product.harga_beli, "IDR")}
                onChange={(event) => setVariantHppDrafts((current) => ({ ...current, [variant.varian_barang_id]: event.target.value }))}
              />
            </label>
            <p className="text-[10px] text-muted-foreground">{inheritedHpp ? "Belum ada HPP khusus; mengikuti HPP barang induk." : "Menggunakan HPP khusus varian."}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full rounded-lg"
              disabled={Boolean(busyKey || uncertainCommand) || !hppValid || !hppChanged}
              onClick={() => updateVariantHpp(variant)}
            >
              {busyKey === "variant-hpp-" + variant.varian_barang_id ? <Loader2 className="animate-spin" /> : <Save />}
              Simpan HPP
            </Button>
          </div>
          <div className="space-y-1.5">
            <label className="grid gap-1 text-xs font-semibold">
              Harga jual varian (IDR)
              <Input
                className="h-10 rounded-lg"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={saleValue}
                placeholder={product?.harga_jual == null ? "Masukkan harga jual" : "Ikuti " + formatCatalogMoney(product.harga_jual, "IDR")}
                onChange={(event) => setVariantSalesDrafts((current) => ({ ...current, [variant.varian_barang_id]: event.target.value }))}
              />
            </label>
            <p className="text-[10px] text-muted-foreground">{inheritedSale ? "Belum ada harga khusus; mengikuti harga jual barang induk." : "Menggunakan harga jual khusus varian."}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full rounded-lg"
              disabled={Boolean(busyKey || uncertainCommand) || !saleValid || !saleChanged}
              onClick={() => updateVariantSalePrice(variant)}
            >
              {busyKey === "variant-sales-" + variant.varian_barang_id ? <Loader2 className="animate-spin" /> : <Save />}
              Simpan Harga Jual
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-xl px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <Calculator className="size-4" />
        Koreksi Harga
      </Button>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-2xl sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>Koreksi Harga Inventaris</DialogTitle>
            <DialogDescription>
              {productName}. Koreksi ini berlaku untuk transaksi berikutnya; snapshot harga dan HPP transaksi lama tetap dipertahankan.
            </DialogDescription>
          </DialogHeader>

          {catalog.isPending ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />Memuat konfigurasi harga…
            </div>
          ) : catalog.error || !product ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {catalogErrorMessage(catalog.error, "Konfigurasi harga tidak dapat dimuat.")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {hasRentableChannel ? <Badge className="rounded-full"><CalendarClock className="size-3" /> Channel Sewa</Badge> : null}
                {hasSellableChannel ? <Badge variant="secondary" className="rounded-full"><ShoppingBag className="size-3" /> Channel Jual</Badge> : null}
                {!hasRentableChannel && !hasSellableChannel ? <Badge variant="outline" className="rounded-full">Belum ada channel aktif</Badge> : null}
              </div>

              {hasSellableChannel ? (
                <PriceSection
                  title="HPP dan harga jual"
                  description="HPP master menjadi nilai default/fallback. Stok kuantitas tetap memakai HPP rata-rata persediaan dari pembelian; unit fisik dengan harga perolehan tercatat tetap memakai HPP per unit. Transaksi lama tidak berubah."
                  icon={ShoppingBag}
                >
                  <div className="space-y-3 rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Harga dasar barang</p>
                      <Badge variant="outline" className="rounded-full text-[10px]">Produk induk</Badge>
                    </div>
                    <div className={"grid gap-3 " + (product.is_sellable ? "sm:grid-cols-2" : "")}>
                      <div className="space-y-1.5">
                        <label className="grid gap-1 text-xs font-semibold">
                          HPP barang (IDR)
                          <Input className="h-10 rounded-lg" type="number" min="0" step="1" inputMode="numeric" value={productHppDraft ?? (product.harga_beli == null ? "" : String(product.harga_beli))} onChange={(event) => setProductHppDraft(event.target.value)} />
                        </label>
                        <Button size="sm" variant="outline" className="h-9 w-full rounded-lg" disabled={Boolean(busyKey || uncertainCommand) || !amountValue(productHppDraft ?? (product.harga_beli == null ? "" : String(product.harga_beli)), true) || (product.harga_beli != null && Number(productHppDraft ?? product.harga_beli) === Number(product.harga_beli))} onClick={updateProductHpp}>
                          {busyKey === "product-hpp" ? <Loader2 className="animate-spin" /> : <Save />}Simpan HPP
                        </Button>
                      </div>
                      {product.is_sellable ? (
                        <div className="space-y-1.5">
                          <label className="grid gap-1 text-xs font-semibold">
                            Harga jual (IDR)
                            <Input className="h-10 rounded-lg" type="number" min="1" step="1" inputMode="numeric" value={productSalesDraft ?? (product.harga_jual == null ? "" : String(product.harga_jual))} onChange={(event) => setProductSalesDraft(event.target.value)} />
                          </label>
                          <Button size="sm" variant="outline" className="h-9 w-full rounded-lg" disabled={Boolean(busyKey || uncertainCommand) || !amountValue(productSalesDraft ?? (product.harga_jual == null ? "" : String(product.harga_jual)), false) || Number(productSalesDraft ?? product.harga_jual) === Number(product.harga_jual)} onClick={updateProductSalePrice}>
                            {busyKey === "product-sales" ? <Loader2 className="animate-spin" /> : <Save />}Simpan Harga Jual
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {sellableVariants.length ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Harga khusus varian yang dapat dijual</p>
                      {sellableVariants.map(renderVariantSalesEditor)}
                    </div>
                  ) : null}
                </PriceSection>
              ) : null}

              {hasRentableChannel ? (
                <PriceSection
                  title="Tarif sewa"
                  description="Hanya tarif aktif yang berlaku saat ini ditampilkan. Perubahan mempertahankan durasi, masa berlaku, dan mata uang."
                  icon={CalendarClock}
                >
                  {product.is_rentable ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Tarif produk induk</p>
                      {activeProductTariffs.length ? activeProductTariffs.map(renderTariffEditor) : (
                        <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Belum ada tarif sewa aktif pada produk induk.</p>
                      )}
                    </div>
                  ) : null}
                  {rentableVariants.map((variant) => {
                    const tariffs = activeTariffsByVariant.get(variant.varian_barang_id) ?? [];
                    const inheritsProductTariff = activeProductTariffs.length > 0;
                    return (
                      <div key={variant.varian_barang_id} className="space-y-2 rounded-xl border p-3">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <p className="min-w-0 text-sm font-semibold">{variant.nama}</p>
                          <Badge variant="outline" className="rounded-full text-[10px]">Varian sewa</Badge>
                        </div>
                        {tariffs.length ? tariffs.map(renderTariffEditor) : (
                          <p className="rounded-lg bg-muted/25 p-3 text-xs text-muted-foreground">
                            {inheritsProductTariff ? "Mengikuti tarif aktif produk induk." : "Belum ada tarif sewa aktif khusus untuk varian ini."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </PriceSection>
              ) : null}

              {!hasRentableChannel && !hasSellableChannel ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Barang ini belum diaktifkan pada channel sewa maupun jual. Aktifkan channel melalui Katalog agar harga dapat dikoreksi dari sini.
                </div>
              ) : null}

              {uncertainCommand ? (
                <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                  <p className="font-semibold">Status koreksi perlu diperiksa</p>
                  <p>{uncertainCommand.message}</p>
                  <Button size="sm" variant="outline" className="h-9 rounded-lg" disabled={busyKey === "reconcile"} onClick={() => void reconcile()}>
                    {busyKey === "reconcile" ? <Loader2 className="animate-spin" /> : <Package />}
                    Periksa status koreksi
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
            <Button type="button" variant="outline" className="w-full rounded-xl sm:w-auto" disabled={Boolean(busyKey)} onClick={() => closeDialog(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
