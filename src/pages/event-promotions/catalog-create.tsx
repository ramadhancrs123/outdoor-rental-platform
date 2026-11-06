import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, ImageOff, Loader2, Package, Search } from "lucide-react";

import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createCatalogPromotion,
  listCatalogPromotionTargets,
  listCatalogPromotions,
  updateCatalogPromotionDraft,
} from "@/features/event-promotions";
import type { CatalogPromotionTarget } from "@/features/event-promotions";
import { paths } from "@/routes/paths";
import { cn } from "@/lib/utils";

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function isoFromLocal(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function localFromIso(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDateTimeValue(date);
}
function money(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}
function targetKey(target: Pick<CatalogPromotionTarget, "barang_id" | "varian_barang_id">) {
  return target.barang_id + "::" + (target.varian_barang_id ?? "");
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*?: /, "") : "Promosi katalog gagal disimpan.";
}

type ProductGroup = {
  barangId: string;
  name: string;
  categoryId: string | null;
  categoryName: string;
  cover: string | null;
  productTarget: CatalogPromotionTarget | null;
  variantTargets: CatalogPromotionTarget[];
};

export function EventPromotionCatalogPage() {
  const { current, status: tenantStatus } = useCurrentUsaha();
  const usahaId = current?.usahaId ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams();
  const isEditing = Boolean(editId);

  const [channel, setChannel] = useState<"rental" | "sale">("rental");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [activeProductId, setActiveProductId] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [percent, setPercent] = useState("10");
  const [startedAt, setStartedAt] = useState(localDateTimeValue());
  const [validUntil, setValidUntil] = useState("");
  const [initialStatus, setInitialStatus] = useState<"draft" | "active">("draft");
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const targets = useQuery({
    queryKey: ["event-promotions", "targets", usahaId],
    queryFn: () => listCatalogPromotionTargets(usahaId),
    enabled: Boolean(usahaId),
    staleTime: 30_000,
  });
  const promotions = useQuery({
    queryKey: ["event-promotions", "catalog", usahaId],
    queryFn: () => listCatalogPromotions(usahaId),
    enabled: Boolean(usahaId && editId),
    staleTime: 10_000,
  });

  const editRow = promotions.data?.find((row) => row.promosi_katalog_id === editId) ?? null;
  const editReady = !editId || promotions.isSuccess;

  const allGroups = useMemo(() => {
    const channelTargets = (targets.data ?? []).filter((target) => target.channel === channel);
    const groups = new Map<string, ProductGroup>();
    for (const target of channelTargets) {
      let group = groups.get(target.barang_id);
      if (!group) {
        group = {
          barangId: target.barang_id,
          name: target.product_name ?? target.label.split(" · ")[0],
          categoryId: target.category_id ?? null,
          categoryName: target.category_name ?? "Tanpa kategori",
          cover: target.cover_url ?? null,
          productTarget: null,
          variantTargets: [],
        };
        groups.set(target.barang_id, group);
      }
      if (target.varian_barang_id) {
        group.variantTargets.push(target);
        if (!group.cover && target.cover_url) group.cover = target.cover_url;
      } else {
        group.productTarget = target;
        if (!group.cover && target.cover_url) group.cover = target.cover_url;
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [targets.data, channel]);

  const groupedProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("id-ID");
    return allGroups
      .filter((group) => category === "all" || group.categoryId === category)
      .filter((group) => !needle ||
        group.name.toLocaleLowerCase("id-ID").includes(needle) ||
        group.categoryName.toLocaleLowerCase("id-ID").includes(needle) ||
        group.variantTargets.some((target) => target.label.toLocaleLowerCase("id-ID").includes(needle)));
  }, [allGroups, search, category]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of targets.data ?? []) {
      if (target.channel === channel && target.category_id) map.set(target.category_id, target.category_name ?? "Tanpa kategori");
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [targets.data, channel]);

  const activeGroup = allGroups.find((group) => group.barangId === activeProductId) ?? null;
  const selectedTarget = useMemo(() => {
    return (targets.data ?? []).find((target) =>
      target.channel === channel && targetKey(target) === selectedKey,
    ) ?? null;
  }, [targets.data, channel, selectedKey]);
  const selectedPrice = selectedTarget?.normal_price ?? null;
  const effectivePrice = selectedPrice != null
    ? Math.round(selectedPrice * (100 - Number(percent || 0))) / 100
    : null;

  useEffect(() => {
    if (!editRow || !targets.isSuccess) return;
    const editTarget = (targets.data ?? []).find((target) => {
      if (target.channel !== editRow.channel) return false;
      return editRow.varian_barang_id
        ? target.varian_barang_id === editRow.varian_barang_id
        : !target.varian_barang_id && target.barang_id === editRow.barang_id;
    });
    setChannel(editRow.channel);
    setActiveProductId(editTarget?.barang_id ?? "");
    setSelectedKey(editTarget ? targetKey(editTarget) : "");
    setPercent(String(editRow.diskon_persen));
    setStartedAt(localFromIso(editRow.started_at));
    setValidUntil(localFromIso(editRow.valid_until));
    setInitialStatus("draft");
    setConfigOpen(true);
  }, [editRow, targets.data, targets.isSuccess]);

  const savePromotion = useMutation({
    mutationFn: async () => {
      if (!selectedTarget) throw new Error("Pilih barang atau unit/varian promosi terlebih dahulu.");
      const start = isoFromLocal(startedAt);
      const end = isoFromLocal(validUntil);
      const discount = Number(percent);
      if (!start) throw new Error("Waktu mulai promosi tidak valid.");
      if (end && end <= start) throw new Error("Waktu berakhir harus setelah waktu mulai.");
      if (!Number.isFinite(discount) || discount <= 0 || discount > 100) throw new Error("Diskon harus lebih dari 0 dan maksimal 100%.");
      if (channel === "sale" && discount >= 100) throw new Error("Diskon penjualan tidak boleh membuat harga menjadi nol. Gunakan fitur barang bonus.");
      if (isEditing && editRow) {
        if (editRow.status !== "draft") throw new Error("Hanya promo draft yang dapat diedit.");
        return updateCatalogPromotionDraft({
          usahaId,
          promotionId: editRow.promosi_katalog_id,
          barangId: selectedTarget.barang_id,
          variantId: selectedTarget.varian_barang_id,
          channel,
          percent: discount,
          startedAt: start,
          validUntil: end,
          isPublic: false,
          expectedUpdatedAt: editRow.updated_at,
        });
      }
      return createCatalogPromotion({
        usahaId,
        barangId: selectedTarget.barang_id,
        variantId: selectedTarget.varian_barang_id,
        channel,
        percent: discount,
        startedAt: start,
        validUntil: end,
        isPublic: false,
        status: initialStatus,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["event-promotions", "catalog", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["event-promotions", "targets", usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["katalog"] }),
        queryClient.invalidateQueries({ queryKey: ["penyewaan"] }),
        queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
      ]);
      setConfigOpen(false);
      navigate(paths.eventPromotions, { replace: true, state: { feedback: isEditing ? "Draft promosi berhasil diperbarui." : "Promosi katalog berhasil dibuat." } });
    },
    onError: (error) => setFeedback({ kind: "error", text: messageOf(error) }),
  });

  if (tenantStatus === "loading" || targets.isPending || (editId && promotions.isPending)) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat katalog promosi…</div>;
  }
  if (tenantStatus !== "ready" || !usahaId) {
    return <Alert className="m-4"><AlertDescription>Usaha aktif belum tersedia.</AlertDescription></Alert>;
  }
  if (targets.isError) {
    return <Alert variant="destructive" className="m-4"><AlertDescription>{messageOf(targets.error)}</AlertDescription></Alert>;
  }
  if (!editReady || (editId && !editRow)) {
    return <Alert variant="destructive" className="m-4"><AlertDescription>{promotions.error ? messageOf(promotions.error) : "Draft promosi tidak ditemukan."}</AlertDescription></Alert>;
  }
  if (editId && editRow?.status !== "draft") {
    return (
      <div className="p-4">
        <Alert><AlertDescription>Hanya promosi berstatus Draft yang dapat diubah. Promosi yang sudah aktif harus diakhiri terlebih dahulu.</AlertDescription></Alert>
        <Button variant="outline" className="mt-3" onClick={() => navigate(paths.eventPromotions)}>Kembali ke Event & Promosi</Button>
      </div>
    );
  }

  const selectProduct = (group: ProductGroup) => {
    const defaultTarget = group.productTarget ?? group.variantTargets[0] ?? null;
    setActiveProductId(group.barangId);
    setSelectedKey(defaultTarget ? targetKey(defaultTarget) : "");
    setFeedback(null);
  };

  const openProductConfig = (group: ProductGroup) => {
    selectProduct(group);
    setConfigOpen(true);
  };

  const changeChannel = (next: "rental" | "sale") => {
    setChannel(next);
    setActiveProductId("");
    setSelectedKey("");
    setCategory("all");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    savePromotion.mutate();
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 p-3 pb-24 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl" onClick={() => navigate(paths.eventPromotions)} aria-label="Kembali">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Event & Promosi · Promo Katalog</p>
            <h1 className="truncate text-lg font-bold tracking-tight">{isEditing ? "Ubah draft promosi" : "Buat promo barang / varian"}</h1>
          </div>
        </div>
        <Badge variant="secondary" className="rounded-full">{allGroups.length} produk tersedia</Badge>
      </header>

      {feedback ? <Alert variant="destructive" className="rounded-xl"><AlertDescription>{feedback.text}</AlertDescription></Alert> : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Pilih barang promosi</h2>
              <p className="text-[10px] text-muted-foreground">Pilih satu produk untuk membuka konfigurasi. Unit/varian dipilih di dalam dialog.</p>
            </div>
            <Badge variant="outline" className="rounded-full">{groupedProducts.length} produk ditampilkan</Badge>
          </div>
          <div className="flex gap-1.5" role="tablist" aria-label="Kanal promosi">
            <Button type="button" role="tab" aria-selected={channel === "rental"} size="sm" variant={channel === "rental" ? "default" : "outline"} className="h-8 rounded-full px-4 text-[11px]" onClick={() => changeChannel("rental")}>Barang sewa</Button>
            <Button type="button" role="tab" aria-selected={channel === "sale"} size="sm" variant={channel === "sale" ? "default" : "outline"} className="h-8 rounded-full px-4 text-[11px]" onClick={() => changeChannel("sale")}>Barang jual</Button>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-background px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama barang, unit/varian, atau kategori…" className="h-10 border-0 px-0 text-xs shadow-none focus-visible:ring-0" aria-label="Cari barang promosi" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Filter kategori">
            <Button type="button" size="sm" variant={category === "all" ? "default" : "outline"} className="h-7 shrink-0 rounded-full px-3 text-[10px]" onClick={() => setCategory("all")}>Semua</Button>
            {categories.map((item) => (
              <Button key={item.id} type="button" size="sm" variant={category === item.id ? "default" : "outline"} className="h-7 shrink-0 rounded-full px-3 text-[10px]" onClick={() => setCategory(item.id)}>{item.name}</Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {groupedProducts.map((group) => {
            const selected = activeProductId === group.barangId && configOpen;
            const targetCount = Number(Boolean(group.productTarget)) + group.variantTargets.length;
            const displayedPrice = group.productTarget?.price_caption
              ?? group.variantTargets[0]?.price_caption
              ?? "Harga belum tersedia";
            return (
              <Card key={group.barangId} className={cn("overflow-hidden rounded-2xl border-border/70 transition hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md", selected && "border-primary ring-2 ring-primary/15")}>
                <button type="button" onClick={() => openProductConfig(group)} className="block w-full text-left" aria-label={"Konfigurasi promo " + group.name}>
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted/60">
                    {group.cover
                      ? <img src={group.cover} alt="" loading="lazy" className="size-full object-cover" />
                      : <div className="grid size-full place-items-center text-muted-foreground"><Package className="size-8" /></div>}
                    <Badge className="absolute left-2 top-2 rounded-full bg-background/90 text-[8px] text-foreground hover:bg-background/90">
                      {targetCount > 1 ? targetCount + " pilihan" : "1 pilihan"}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    <p className="truncate text-[11px] font-bold">{group.name}</p>
                    <p className="truncate text-[9px] text-muted-foreground">{group.categoryName}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[9px] font-semibold text-primary">{displayedPrice}</span>
                      <span className="shrink-0 text-[9px] font-semibold text-muted-foreground">Atur →</span>
                    </div>
                  </div>
                </button>
              </Card>
            );
          })}
          {!groupedProducts.length ? (
            <div className="col-span-full rounded-2xl border border-dashed p-8 text-center">
              <ImageOff className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-2 text-xs font-semibold">Barang tidak ditemukan</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{channel === "rental" ? "Tidak ada barang dengan tarif rental aktif pada kanal ini." : "Tidak ada barang aktif yang memiliki harga jual."}</p>
            </div>
          ) : null}
        </div>
      </section>

      <Dialog open={configOpen} onOpenChange={(open) => {
        setConfigOpen(open);
        if (!open) setFeedback(null);
      }}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-[calc(100%-2rem)]"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left sm:px-5">
            <div className="flex items-start justify-between gap-3 pr-1">
              <div className="min-w-0">
                <DialogTitle className="text-sm font-bold">Konfigurasi promosi</DialogTitle>
                <DialogDescription className="mt-1 text-[10px]">
                  Harga normal ditarik dari tarif rental atau harga jual yang aktif. Pilih produk dan unit yang menjadi target promo.
                </DialogDescription>
              </div>
              <Badge variant="secondary" className="shrink-0 rounded-full">{channel === "rental" ? "Rental" : "Penjualan"}</Badge>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
            {feedback ? <Alert variant="destructive" className="mb-3"><AlertDescription>{feedback.text}</AlertDescription></Alert> : null}

            <form id="promotion-config-form" onSubmit={submit} className="space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[11px] font-bold">1. Pilih barang</h3>
                    <p className="text-[9px] text-muted-foreground">Anda dapat mengganti produk tanpa menutup dialog.</p>
                  </div>
                </div>
                <Select
                  value={activeProductId}
                  onValueChange={(value) => {
                    const next = allGroups.find((group) => group.barangId === value);
                    if (next) selectProduct(next);
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl text-xs">
                    <SelectValue placeholder="Pilih produk katalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {allGroups.map((group) => (
                      <SelectItem key={group.barangId} value={group.barangId}>
                        {group.name} · {group.categoryName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeGroup ? (
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-2.5">
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {activeGroup.cover
                        ? <img src={activeGroup.cover} alt="" className="size-full object-cover" />
                        : <div className="grid size-full place-items-center"><Package className="size-5 text-muted-foreground" /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold">{activeGroup.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{activeGroup.categoryName}</p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">{activeGroup.variantTargets.length} unit/varian tersedia untuk kanal ini</p>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="space-y-2">
                <div>
                  <h3 className="text-[11px] font-bold">2. Pilih cakupan promo</h3>
                  <p className="text-[9px] text-muted-foreground">Pilih seluruh barang atau satu unit/varian tertentu.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {activeGroup?.productTarget ? (
                    <button
                      type="button"
                      onClick={() => setSelectedKey(targetKey(activeGroup.productTarget!))}
                      aria-pressed={selectedTarget?.varian_barang_id == null && selectedTarget?.barang_id === activeGroup.barangId}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-left transition",
                        selectedTarget?.varian_barang_id == null && selectedTarget?.barang_id === activeGroup.barangId
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "hover:border-primary/50",
                      )}
                    >
                      <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {activeGroup.productTarget.cover_url
                          ? <img src={activeGroup.productTarget.cover_url} alt="" className="size-full object-cover" />
                          : <div className="grid size-full place-items-center"><Package className="size-4 text-muted-foreground" /></div>}
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-bold">Seluruh barang</span>
                        <span className="block truncate text-[9px] text-muted-foreground">Berlaku untuk produk ini</span>
                        <span className="block truncate text-[9px] font-semibold text-primary">{activeGroup.productTarget.price_caption ?? money(activeGroup.productTarget.normal_price)}</span>
                      </span>
                      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border text-[9px]", selectedTarget?.varian_barang_id == null && selectedTarget?.barang_id === activeGroup.barangId ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                        {selectedTarget?.varian_barang_id == null && selectedTarget?.barang_id === activeGroup.barangId ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  ) : null}

                  {activeGroup?.variantTargets.map((target) => {
                    const selected = selectedKey === targetKey(target);
                    return (
                      <button
                        key={target.varian_barang_id}
                        type="button"
                        onClick={() => setSelectedKey(targetKey(target))}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-left transition",
                          selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/50",
                        )}
                      >
                        <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {target.cover_url
                            ? <img src={target.cover_url} alt="" loading="lazy" className="size-full object-cover" />
                            : <div className="grid size-full place-items-center"><Package className="size-4 text-muted-foreground" /></div>}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-bold">{target.variant_name ?? "Unit"}</span>
                          <span className="block truncate text-[9px] text-muted-foreground">Unit / varian</span>
                          <span className="block truncate text-[9px] font-semibold text-primary">{target.price_caption ?? money(target.normal_price)}</span>
                        </span>
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border text-[9px]", selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                          {selected ? <Check className="size-3" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeGroup && !activeGroup.productTarget && !activeGroup.variantTargets.length ? (
                  <Alert><AlertDescription className="text-[10px]">Produk ini tidak memiliki target harga aktif pada kanal tersebut.</AlertDescription></Alert>
                ) : null}
              </section>

              <section className="space-y-3 border-t pt-3">
                <div>
                  <h3 className="text-[11px] font-bold">3. Atur harga promosi</h3>
                  <p className="text-[9px] text-muted-foreground">Harga referensi diperoleh dari katalog. Nilai transaksi tetap diverifikasi oleh backend.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-[10px] font-semibold">Diskon (%)
                    <Input type="number" min="0.01" max={channel === "sale" ? "99.99" : "100"} step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)} className="h-10 rounded-xl text-xs" required />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-[9px] font-semibold">Mulai berlaku
                      <Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} className="h-10 min-w-0 rounded-xl px-2 text-[9px]" required />
                    </label>
                    <label className="grid gap-1 text-[9px] font-semibold">Berakhir (opsional)
                      <Input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="h-10 min-w-0 rounded-xl px-2 text-[9px]" />
                    </label>
                  </div>
                </div>

                {!isEditing ? (
                  <label className="grid gap-1 text-[10px] font-semibold">Status awal
                    <Select value={initialStatus} onValueChange={(value) => setInitialStatus(value as "draft" | "active")}>
                      <SelectTrigger className="h-10 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Simpan sebagai draft</SelectItem>
                        <SelectItem value="active">Aktif / terjadwal</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                ) : (
                  <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-[10px] text-amber-800">
                    Hanya Draft yang dapat diubah. Versi aktif tidak ditimpa agar histori transaksi tetap konsisten.
                  </div>
                )}

                {selectedTarget && selectedPrice != null ? (
                  <div className="rounded-xl bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">Harga normal</span>
                      <strong>{selectedTarget.price_caption ?? money(selectedPrice)}</strong>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">Diskon</span>
                      <strong>{Number(percent || 0)}%</strong>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-primary/10 pt-2">
                      <span className="text-[10px] font-semibold">Estimasi harga promo</span>
                      <strong className="text-sm text-primary">{money(effectivePrice)}</strong>
                    </div>
                  </div>
                ) : (
                  <Alert><AlertDescription className="text-[10px]">Pilih produk dan cakupan target yang memiliki harga aktif untuk melihat estimasi promo.</AlertDescription></Alert>
                )}

                {channel === "sale" && Number(percent) >= 100 ? (
                  <Alert variant="destructive"><AlertDescription className="text-[10px]">Diskon penjualan tidak boleh menghasilkan harga nol.</AlertDescription></Alert>
                ) : null}
              </section>
            </form>
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t bg-background px-3 py-3 sm:px-5">
            <Button type="button" variant="outline" className="min-w-24 flex-1 rounded-xl sm:flex-none" onClick={() => setConfigOpen(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              form="promotion-config-form"
              className="min-w-36 flex-1 rounded-xl sm:flex-none"
              disabled={!selectedTarget || savePromotion.isPending || !percent || (channel === "sale" && Number(percent) >= 100)}
            >
              {savePromotion.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
              {isEditing ? "Simpan perubahan" : "Simpan promosi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
