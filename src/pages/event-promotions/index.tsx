import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import {
  CalendarClock, Check, CircleDollarSign, Gift, History, Loader2, Megaphone,
  Package, Plus, Search, ShieldCheck, Tag,
} from "lucide-react";

import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  endCatalogPromotion,
  getCheckoutDiscountPolicy,
  getLoyaltyProgram,
  getMyBusinessPermissions,
  listCatalogPromotions,
  listPackagePromotions,
  listPackageTariffs,
  listPromotionAdminMembers,
  setCatalogPromotionStatus,
  setCheckoutDiscountPolicy,
  setLoyaltyProgram,
  setMembershipPermission,
  setPackagePromotionWindow,
} from "@/features/event-promotions";
import type {
  BusinessPermission,
  CatalogPromotion,
  PackagePromotion,
} from "@/features/event-promotions";
import { paths } from "@/routes/paths";

type TabKey = "catalog" | "packages" | "loyalty" | "checkout" | "history" | "access";
type LoyaltyForm = { enabled: boolean; minimum: string; percent: string; validFrom: string; validUntil: string };
type PolicyForm = {
  manualEnabled: boolean; allowAbove: boolean; maxPercent: string; maxAmount: string;
  requireReason: boolean; reasons: string[];
};
type PromoStatus = "Aktif" | "Terjadwal" | "Draft" | "Berakhir" | "Dibatalkan";

const permissionItems: Array<{ key: BusinessPermission; label: string; description: string }> = [
  { key: "event_promotion.manage", label: "Kelola promosi", description: "Membuat, mengubah, mengaktifkan, dan mengakhiri promosi." },
  { key: "checkout_discount.apply", label: "Terapkan diskon checkout", description: "Menggunakan rekomendasi loyalitas dan diskon manual." },
  { key: "checkout_discount.override", label: "Override loyalitas", description: "Memberikan diskon di atas rekomendasi loyalitas." },
  { key: "retail_bonus.apply", label: "Berikan barang bonus", description: "Mengizinkan bonus barang pada checkout campuran." },
  { key: "reservation.amend", label: "Ubah kesepakatan reservasi", description: "Mengubah item, kuantitas, dan snapshot harga reservasi." },
  { key: "access_control.manage", label: "Kelola hak akses", description: "Memberikan atau mencabut kapabilitas admin lain." },
];
const reasonOptions = [
  ["service_recovery", "Pemulihan layanan"],
  ["customer_retention", "Retensi pelanggan"],
  ["manager_adjustment", "Penyesuaian manajer"],
  ["other", "Lainnya"],
] as const;

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
function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}
function formatWhen(value: string | null | undefined) {
  if (!value) return "Tanpa batas akhir";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.replace(/^.*?: /, "") : fallback;
}
function promotionStatus(row: CatalogPromotion): PromoStatus {
  if (row.status === "draft") return "Draft";
  if (row.status === "cancelled") return "Dibatalkan";
  if (row.status === "ended" || row.ended_at) return "Berakhir";
  const now = Date.now();
  if (row.valid_until && new Date(row.valid_until).getTime() <= now) return "Berakhir";
  if (new Date(row.started_at).getTime() > now) return "Terjadwal";
  return "Aktif";
}
function packagePromotionStatus(row: PackagePromotion): PromoStatus {
  if (row.ended_at || row.status !== "active") return "Berakhir";
  const now = Date.now();
  if (row.valid_until && new Date(row.valid_until).getTime() <= now) return "Berakhir";
  if (new Date(row.started_at).getTime() > now) return "Terjadwal";
  return "Aktif";
}
function badgeVariant(status: PromoStatus) {
  if (status === "Aktif") return "default" as const;
  if (status === "Berakhir" || status === "Dibatalkan") return "secondary" as const;
  return "outline" as const;
}
function isLoyaltyActive(enabled: boolean, from?: string | null, until?: string | null) {
  const now = Date.now();
  return enabled && (!from || new Date(from).getTime() <= now) && (!until || new Date(until).getTime() > now);
}
function isEndingSoon(until?: string | null) {
  if (!until) return false;
  const remain = new Date(until).getTime() - Date.now();
  return remain > 0 && remain <= 7 * 24 * 60 * 60 * 1000;
}

export function EventPromotionsPage() {
  const { current, status: tenantStatus } = useCurrentUsaha();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const usahaId = current?.usahaId ?? "";
  const [tab, setTab] = useState<TabKey>("catalog");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogChannel, setCatalogChannel] = useState<"all" | "rental" | "sale">("all");
  const [catalogStatus, setCatalogStatus] = useState<"all" | "Aktif" | "Terjadwal" | "Draft" | "Berakhir">("all");
  const [packageSearch, setPackageSearch] = useState("");

  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [packageTariffId, setPackageTariffId] = useState("");
  const [packagePrice, setPackagePrice] = useState("");
  const [packageValidUntil, setPackageValidUntil] = useState("");
  const [loyaltyDialogOpen, setLoyaltyDialogOpen] = useState(false);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [loyaltyForm, setLoyaltyForm] = useState<LoyaltyForm>({
    enabled: false, minimum: "10", percent: "6", validFrom: localDateTimeValue(), validUntil: "",
  });
  const [policyForm, setPolicyForm] = useState<PolicyForm>({
    manualEnabled: false, allowAbove: false, maxPercent: "", maxAmount: "",
    requireReason: true, reasons: ["service_recovery", "customer_retention", "manager_adjustment", "other"],
  });

  const permissions = useQuery({
    queryKey: ["event-promotions", "my-permissions", usahaId],
    queryFn: () => getMyBusinessPermissions(usahaId),
    enabled: Boolean(usahaId),
    staleTime: 30_000,
  });
  const canManage = Boolean(permissions.data?.includes("event_promotion.manage"));
  const canManageAccess = Boolean(permissions.data?.includes("access_control.manage"));
  const promos = useQuery({
    queryKey: ["event-promotions", "catalog", usahaId],
    queryFn: () => listCatalogPromotions(usahaId),
    enabled: Boolean(usahaId && canManage),
    staleTime: 15_000,
  });
  const packagePromos = useQuery({
    queryKey: ["event-promotions", "package-promos", usahaId],
    queryFn: () => listPackagePromotions(usahaId),
    enabled: Boolean(usahaId && canManage),
    staleTime: 15_000,
  });
  const packageTariffs = useQuery({
    queryKey: ["event-promotions", "package-tariffs", usahaId],
    queryFn: () => listPackageTariffs(usahaId),
    enabled: Boolean(usahaId && canManage),
    staleTime: 30_000,
  });
  const loyalty = useQuery({
    queryKey: ["event-promotions", "loyalty", usahaId],
    queryFn: () => getLoyaltyProgram(usahaId),
    enabled: Boolean(usahaId && canManage),
    staleTime: 15_000,
  });
  const checkoutPolicy = useQuery({
    queryKey: ["event-promotions", "checkout-policy", usahaId],
    queryFn: () => getCheckoutDiscountPolicy(usahaId),
    enabled: Boolean(usahaId && canManage),
    staleTime: 15_000,
  });
  const members = useQuery({
    queryKey: ["event-promotions", "members", usahaId],
    queryFn: () => listPromotionAdminMembers(usahaId),
    enabled: Boolean(usahaId && canManageAccess),
    staleTime: 15_000,
  });

  useEffect(() => {
    const state = location.state as { feedback?: string } | null;
    if (state?.feedback) {
      setFeedback({ kind: "success", text: state.feedback });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!loyalty.data) return;
    setLoyaltyForm({
      enabled: loyalty.data.is_enabled,
      minimum: String(loyalty.data.minimum_completed_rentals),
      percent: String(loyalty.data.recommended_discount_percent),
      validFrom: localFromIso(loyalty.data.valid_from),
      validUntil: localFromIso(loyalty.data.valid_until),
    });
  }, [loyalty.data]);

  useEffect(() => {
    if (!checkoutPolicy.data) return;
    setPolicyForm({
      manualEnabled: checkoutPolicy.data.manual_discount_enabled,
      allowAbove: checkoutPolicy.data.allow_above_loyalty,
      maxPercent: checkoutPolicy.data.max_discount_percent == null ? "" : String(checkoutPolicy.data.max_discount_percent),
      maxAmount: checkoutPolicy.data.max_discount_amount == null ? "" : String(checkoutPolicy.data.max_discount_amount),
      requireReason: checkoutPolicy.data.require_reason,
      reasons: checkoutPolicy.data.allowed_reason_codes ?? ["other"],
    });
  }, [checkoutPolicy.data]);

  const selectedPackageTariff = (packageTariffs.data ?? []).find((tariff) => tariff.tarif_sewa_id === packageTariffId) ?? null;
  const activePackagePromo = (packagePromos.data ?? []).find((row) =>
    row.tarif_sewa_id === packageTariffId && row.status === "active" && !row.ended_at,
  ) ?? null;

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "catalog", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "targets", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "package-promos", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "package-tariffs", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "loyalty", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "checkout-policy", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "members", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["event-promotions", "my-permissions", usahaId] }),
      queryClient.invalidateQueries({ queryKey: ["katalog"] }),
      queryClient.invalidateQueries({ queryKey: ["penyewaan"] }),
      queryClient.invalidateQueries({ queryKey: ["penjualan"] }),
    ]);
  };

  const catalogStatusMutation = useMutation({
    mutationFn: (input: { row: CatalogPromotion; status: "active" | "cancelled" }) =>
      setCatalogPromotionStatus({
        usahaId, promotionId: input.row.promosi_katalog_id,
        status: input.status, expectedUpdatedAt: input.row.updated_at,
      }),
    onSuccess: async (_, input) => {
      setFeedback({ kind: "success", text: input.status === "active" ? "Promosi berhasil diaktifkan." : "Draft promosi dibatalkan." });
      await refreshAll();
    },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Status promosi gagal diperbarui.") }),
  });
  const endCatalogMutation = useMutation({
    mutationFn: (row: CatalogPromotion) => endCatalogPromotion({
      usahaId, promotionId: row.promosi_katalog_id, expectedUpdatedAt: row.updated_at,
    }),
    onSuccess: async () => { setFeedback({ kind: "success", text: "Promosi telah diakhiri." }); await refreshAll(); },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Promosi gagal diakhiri.") }),
  });
  const savePackageMutation = useMutation({
    mutationFn: (input: { enabled: boolean; tariffId: string; price: number | null; validUntil: string | null; expectedUpdatedAt: string | null }) => {
      const tariff = (packageTariffs.data ?? []).find((item) => item.tarif_sewa_id === input.tariffId);
      if (!tariff?.paket_sewa_id) throw new Error("Tarif paket tidak ditemukan.");
      if (input.enabled && (input.price == null || !Number.isFinite(input.price) || input.price <= 0 || input.price >= Number(tariff.nominal))) {
        throw new Error("Harga promo harus positif dan lebih rendah dari harga normal.");
      }
      return setPackagePromotionWindow({
        usahaId, packageId: tariff.paket_sewa_id, tariffId: tariff.tarif_sewa_id,
        enabled: input.enabled, promoPrice: input.price, validUntil: input.validUntil,
        expectedUpdatedAt: input.expectedUpdatedAt,
      });
    },
    onSuccess: async (_, input) => {
      setPackageDialogOpen(false);
      setFeedback({ kind: "success", text: input.enabled ? "Promosi paket berhasil disimpan." : "Promosi paket telah dinonaktifkan." });
      await refreshAll();
    },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Promosi paket gagal diperbarui.") }),
  });
  const saveLoyaltyMutation = useMutation({
    mutationFn: () => {
      const minimum = Number(loyaltyForm.minimum);
      const percent = Number(loyaltyForm.percent);
      const from = isoFromLocal(loyaltyForm.validFrom);
      const until = isoFromLocal(loyaltyForm.validUntil);
      if (!Number.isInteger(minimum) || minimum < 1) throw new Error("Minimal penyewaan selesai harus berupa bilangan positif.");
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error("Diskon rekomendasi harus di atas 0 dan maksimal 100%.");
      if (!from || (until && until <= from)) throw new Error("Periode program tidak valid.");
      return setLoyaltyProgram({
        usahaId, isEnabled: loyaltyForm.enabled, minimumCompletedRentals: minimum,
        recommendedDiscountPercent: percent, validFrom: from, validUntil: until,
        expectedVersion: loyalty.data?.version ?? 0,
      });
    },
    onSuccess: async () => { setLoyaltyDialogOpen(false); setFeedback({ kind: "success", text: "Program loyalitas berhasil disimpan." }); await refreshAll(); },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Program loyalitas gagal disimpan.") }),
  });
  const savePolicyMutation = useMutation({
    mutationFn: () => {
      const maxPercent = policyForm.maxPercent.trim() ? Number(policyForm.maxPercent) : null;
      const maxAmount = policyForm.maxAmount.trim() ? Number(policyForm.maxAmount) : null;
      if (policyForm.manualEnabled && maxPercent == null && maxAmount == null) throw new Error("Diskon manual membutuhkan batas maksimal persentase atau nominal.");
      if (maxPercent != null && (!Number.isFinite(maxPercent) || maxPercent <= 0 || maxPercent > 100)) throw new Error("Batas persentase harus di atas 0 dan maksimal 100.");
      if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount <= 0)) throw new Error("Batas nominal harus lebih besar dari nol.");
      if (policyForm.allowAbove && !policyForm.manualEnabled) throw new Error("Aktifkan diskon manual terlebih dahulu untuk mengizinkan override.");
      if (!policyForm.reasons.length) throw new Error("Pilih minimal satu kategori alasan diskon.");
      return setCheckoutDiscountPolicy({
        usahaId, manualDiscountEnabled: policyForm.manualEnabled, allowAboveLoyalty: policyForm.allowAbove,
        maxDiscountPercent: maxPercent, maxDiscountAmount: maxAmount,
        requireReason: policyForm.requireReason, allowedReasonCodes: policyForm.reasons,
      });
    },
    onSuccess: async () => { setCheckoutDialogOpen(false); setFeedback({ kind: "success", text: "Kebijakan diskon checkout berhasil disimpan." }); await refreshAll(); },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Kebijakan diskon gagal disimpan.") }),
  });
  const permissionMutation = useMutation({
    mutationFn: (input: { adminId: string; permission: BusinessPermission; granted: boolean }) =>
      setMembershipPermission({ usahaId, targetAdminId: input.adminId, permission: input.permission, granted: input.granted }),
    onSuccess: async () => { setFeedback({ kind: "success", text: "Hak akses admin diperbarui." }); await refreshAll(); },
    onError: (error) => setFeedback({ kind: "error", text: errorText(error, "Hak akses gagal diperbarui.") }),
  });

  const catalogRows = useMemo(() => (promos.data ?? []).filter((row) => {
    const status = promotionStatus(row);
    const label = [row.barang_nama, row.varian_nama, row.kategori_nama].filter(Boolean).join(" ").toLocaleLowerCase("id-ID");
    return (catalogChannel === "all" || row.channel === catalogChannel) &&
      (catalogStatus === "all" || status === catalogStatus) &&
      (!catalogSearch.trim() || label.includes(catalogSearch.trim().toLocaleLowerCase("id-ID")));
  }), [promos.data, catalogChannel, catalogStatus, catalogSearch]);

  const packageRows = useMemo(() => (packagePromos.data ?? []).filter((row) => {
    const label = [row.paket_nama, row.tarif_nama].filter(Boolean).join(" ").toLocaleLowerCase("id-ID");
    return !packageSearch.trim() || label.includes(packageSearch.trim().toLocaleLowerCase("id-ID"));
  }), [packagePromos.data, packageSearch]);

  const allPromoStatuses = [
    ...(promos.data ?? []).map(promotionStatus),
    ...(packagePromos.data ?? []).map(packagePromotionStatus),
  ];
  const activeCount = allPromoStatuses.filter((status) => status === "Aktif").length;
  const scheduledCount = allPromoStatuses.filter((status) => status === "Terjadwal").length;
  const endingSoonCount = [
    ...(promos.data ?? []).filter((row) => promotionStatus(row) === "Aktif" && isEndingSoon(row.valid_until)),
    ...(packagePromos.data ?? []).filter((row) => packagePromotionStatus(row) === "Aktif" && isEndingSoon(row.valid_until)),
  ].length;
  const loyaltyActive = isLoyaltyActive(loyalty.data?.is_enabled ?? false, loyalty.data?.valid_from, loyalty.data?.valid_until);
  const checkoutActive = checkoutPolicy.data?.manual_discount_enabled === true;

  const openPackageDialog = (tariffId = "", price = "", validUntil = "") => {
    setPackageTariffId(tariffId);
    setPackagePrice(price);
    setPackageValidUntil(validUntil);
    setPackageDialogOpen(true);
  };
  const submitPackage = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPackageTariff) return;
    savePackageMutation.mutate({
      enabled: true,
      tariffId: selectedPackageTariff.tarif_sewa_id,
      price: Number(packagePrice),
      validUntil: isoFromLocal(packageValidUntil),
      expectedUpdatedAt: activePackagePromo?.updated_at ?? null,
    });
  };
  const disablePackagePromo = (row: PackagePromotion) => {
    if (!window.confirm("Nonaktifkan promo " + (row.paket_nama ?? "paket") + " · " + (row.tarif_nama ?? "tarif") + "? Promo ini akan diakhiri dan tidak dapat diaktifkan kembali sebagai versi yang sama.")) return;
    savePackageMutation.mutate({
      enabled: false, tariffId: row.tarif_sewa_id, price: null, validUntil: null,
      expectedUpdatedAt: row.updated_at,
    });
  };
  const submitLoyalty = (event: FormEvent) => { event.preventDefault(); saveLoyaltyMutation.mutate(); };
  const submitPolicy = (event: FormEvent) => { event.preventDefault(); savePolicyMutation.mutate(); };

  if (tenantStatus === "loading" || permissions.isPending) return <div className="p-6 text-sm text-muted-foreground">Memuat Event & Promosi…</div>;
  if (tenantStatus !== "ready" || !usahaId) return <Alert className="m-4"><AlertDescription>Usaha aktif belum tersedia. Pilih usaha terlebih dahulu untuk mengelola event dan promosi.</AlertDescription></Alert>;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-3 pb-24 sm:p-5 sm:pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary"><Megaphone className="size-4" /><span className="text-[10px] font-bold uppercase tracking-[0.15em]">Marketing & Retensi</span></div>
          <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Event & Promosi</h1>
          <p className="mt-1 text-xs text-muted-foreground">Kelola harga promo, program loyalitas, dan batas diskon operasional.</p>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1">{current?.usahaNama}</Badge>
      </header>

      {permissions.isError ? <Alert variant="destructive"><AlertDescription>{errorText(permissions.error, "Hak akses tidak dapat dimuat.")}</AlertDescription></Alert> : null}
      {!canManage && !canManageAccess ? <Alert><AlertDescription>Anda tidak memiliki izin untuk mengelola event dan promosi.</AlertDescription></Alert> : null}
      {feedback ? <Alert variant={feedback.kind === "error" ? "destructive" : "default"} className="rounded-xl"><AlertDescription>{feedback.text}</AlertDescription></Alert> : null}

      <section aria-label="Ringkasan event dan promosi" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <button type="button" onClick={() => { setTab("catalog"); setCatalogStatus("Aktif"); }} className="text-left">
          <Card className="h-full rounded-xl transition hover:border-primary/50"><CardContent className="flex items-center justify-between gap-2 p-3">
            <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Promo aktif</p><p className="mt-1 text-xl font-black">{promos.isPending || packagePromos.isPending ? "—" : activeCount}</p></div>
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Tag className="size-4" /></span>
          </CardContent></Card>
        </button>
        <button type="button" onClick={() => { setTab("catalog"); setCatalogStatus("Terjadwal"); }} className="text-left">
          <Card className="h-full rounded-xl transition hover:border-primary/50"><CardContent className="flex items-center justify-between gap-2 p-3">
            <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Terjadwal</p><p className="mt-1 text-xl font-black">{promos.isPending || packagePromos.isPending ? "—" : scheduledCount}</p></div>
            <span className="grid size-9 place-items-center rounded-xl bg-amber-500/10 text-amber-700"><CalendarClock className="size-4" /></span>
          </CardContent></Card>
        </button>
        <button type="button" onClick={() => { setTab("catalog"); setCatalogStatus("Aktif"); }} className="text-left">
          <Card className="h-full rounded-xl transition hover:border-primary/50"><CardContent className="flex items-center justify-between gap-2 p-3">
            <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Segera berakhir</p><p className="mt-1 text-xl font-black">{promos.isPending || packagePromos.isPending ? "—" : endingSoonCount}</p></div>
            <span className="grid size-9 place-items-center rounded-xl bg-orange-500/10 text-orange-700"><History className="size-4" /></span>
          </CardContent></Card>
        </button>
        <button type="button" onClick={() => setTab("loyalty")} className="text-left">
          <Card className="h-full rounded-xl transition hover:border-primary/50"><CardContent className="flex items-center justify-between gap-2 p-3">
            <div><p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Program & kebijakan</p><p className="mt-1 text-xs font-bold">{loyaltyActive ? "Loyalitas aktif" : "Loyalitas nonaktif"}</p><p className="text-[9px] text-muted-foreground">{checkoutActive ? "Diskon manual aktif" : "Diskon manual nonaktif"}</p></div>
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Gift className="size-4" /></span>
          </CardContent></Card>
        </button>
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-muted/35 p-1" aria-label="Bagian Event & Promosi">
        {([
          ["catalog", "Promo Katalog", Tag],
          ["packages", "Promo Paket", Package],
          ["loyalty", "Loyalitas", Gift],
          ["checkout", "Diskon Checkout", CircleDollarSign],
          ["history", "Riwayat", History],
          ["access", "Hak Akses", ShieldCheck],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={"flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold transition " + (tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </nav>

      {!canManage && tab !== "access" ? null : tab === "catalog" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-sm font-bold">Promo barang & varian</h2><p className="text-[10px] text-muted-foreground">Hanya target yang sudah memiliki konfigurasi promosi ditampilkan di daftar ini.</p></div>
            <Button size="sm" className="h-9 rounded-xl" onClick={() => navigate(paths.eventPromotionCreate)} disabled={!canManage}><Plus className="mr-1.5 size-4" />Tambah Promo</Button>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-2.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5"><Search className="size-3.5 text-muted-foreground" /><Input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Cari barang, varian, atau kategori…" className="h-9 border-0 px-0 text-xs shadow-none focus-visible:ring-0" /></div>
            <div className="flex gap-1.5 overflow-x-auto">
              {(["all", "rental", "sale"] as const).map((value) => <Button key={value} size="sm" variant={catalogChannel === value ? "default" : "outline"} className="h-8 shrink-0 rounded-lg px-3 text-[10px]" onClick={() => setCatalogChannel(value)}>{value === "all" ? "Semua kanal" : value === "rental" ? "Rental" : "Penjualan"}</Button>)}
            </div>
            <div className="flex gap-1.5 overflow-x-auto">
              {(["all", "Aktif", "Terjadwal", "Draft", "Berakhir"] as const).map((value) => <Button key={value} size="sm" variant={catalogStatus === value ? "secondary" : "ghost"} className="h-8 shrink-0 rounded-lg px-2.5 text-[10px]" onClick={() => setCatalogStatus(value)}>{value === "all" ? "Semua status" : value}</Button>)}
            </div>
          </div>

          {promos.isError ? <Alert variant="destructive"><AlertDescription>{errorText(promos.error, "Daftar promosi katalog gagal dimuat.")}</AlertDescription></Alert> : null}
          {promos.isPending ? <div className="rounded-xl border p-8 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat promosi…</div> : catalogRows.length ? (
            <>
              <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[970px] text-left text-xs">
                    <thead className="bg-muted/45 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr><th className="px-3 py-2.5">Barang / Varian</th><th className="px-3 py-2.5">Kanal</th><th className="px-3 py-2.5">Harga normal</th><th className="px-3 py-2.5">Harga promo</th><th className="px-3 py-2.5">Periode</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Tindakan</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {catalogRows.map((row) => {
                        const status = promotionStatus(row);
                        const label = row.varian_nama ? (row.barang_nama ?? "Barang") + " · " + row.varian_nama : row.barang_nama ?? "Target tidak tersedia";
                        const effective = row.normal_price == null ? null : Number(row.normal_price) * (100 - Number(row.diskon_persen)) / 100;
                        return (
                          <tr key={row.promosi_katalog_id} className="hover:bg-muted/20">
                            <td className="px-3 py-2.5"><div className="flex items-center gap-2.5">
                              <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">{row.cover_url ? <img src={row.cover_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-4 text-muted-foreground" /></div>}</div>
                              <div className="min-w-0"><p className="max-w-[260px] truncate text-[11px] font-semibold">{label}</p><p className="truncate text-[9px] text-muted-foreground">{row.kategori_nama ?? "Kategori tidak tersedia"}</p></div>
                            </div></td>
                            <td className="px-3 py-2.5"><Badge variant="outline" className="rounded-full text-[9px]">{row.channel === "rental" ? "Rental" : "Penjualan"}</Badge></td>
                            <td className="px-3 py-2.5"><p className="text-[10px] font-medium">{row.normal_price == null ? "—" : money(row.normal_price)}</p><p className="text-[9px] text-muted-foreground">{row.price_caption ?? ""}</p></td>
                            <td className="px-3 py-2.5"><p className="text-[11px] font-bold text-primary">{effective == null ? "—" : money(effective)}</p><p className="text-[9px] text-muted-foreground">Diskon {Number(row.diskon_persen)}%</p></td>
                            <td className="px-3 py-2.5"><p className="text-[10px]">{formatWhen(row.started_at)}</p><p className="text-[9px] text-muted-foreground">s.d. {formatWhen(row.valid_until)}</p></td>
                            <td className="px-3 py-2.5"><Badge variant={badgeVariant(status)} className="rounded-full text-[9px]">{status}</Badge></td>
                            <td className="px-3 py-2.5"><div className="flex justify-end gap-1">
                              {row.status === "draft" ? <>
                                <Button size="sm" variant="outline" className="h-7 rounded-lg px-2 text-[9px]" onClick={() => navigate(paths.eventPromotionEdit + "/" + encodeURIComponent(row.promosi_katalog_id) + "/edit")}>Edit</Button>
                                <Button size="sm" className="h-7 rounded-lg px-2 text-[9px]" disabled={catalogStatusMutation.isPending} onClick={() => catalogStatusMutation.mutate({ row, status: "active" })}>Aktifkan</Button>
                                <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[9px]" disabled={catalogStatusMutation.isPending} onClick={() => { if (window.confirm("Batalkan draft promosi ini?")) catalogStatusMutation.mutate({ row, status: "cancelled" }); }}>Batalkan</Button>
                              </> : row.status === "active" && !row.ended_at ? <Button size="sm" variant="outline" className="h-7 rounded-lg px-2 text-[9px]" disabled={endCatalogMutation.isPending} onClick={() => { if (window.confirm("Akhiri promosi ini? Tindakan ini tidak dapat dibatalkan.")) endCatalogMutation.mutate(row); }}>Akhiri</Button> : <span className="pr-2 text-[9px] text-muted-foreground">—</span>}
                            </div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid gap-2 md:hidden">
                {catalogRows.map((row) => {
                  const status = promotionStatus(row);
                  const label = row.varian_nama ? (row.barang_nama ?? "Barang") + " · " + row.varian_nama : row.barang_nama ?? "Target tidak tersedia";
                  const effective = row.normal_price == null ? null : Number(row.normal_price) * (100 - Number(row.diskon_persen)) / 100;
                  return <Card key={row.promosi_katalog_id} className="rounded-xl"><CardContent className="flex gap-3 p-3">
                    <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">{row.cover_url ? <img src={row.cover_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-5 text-muted-foreground" /></div>}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5"><p className="min-w-0 flex-1 truncate text-xs font-bold">{label}</p><Badge variant={badgeVariant(status)} className="text-[9px]">{status}</Badge></div>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">{row.kategori_nama ?? "Kategori"} · {row.channel === "rental" ? "Rental" : "Penjualan"}</p>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] text-muted-foreground line-through">{row.normal_price == null ? "Harga —" : money(row.normal_price)}</span><strong className="text-xs text-primary">{effective == null ? "—" : money(effective)}</strong><span className="text-[9px] font-semibold">{Number(row.diskon_persen)}%</span></div>
                      <p className="mt-1 text-[9px] text-muted-foreground">{formatWhen(row.started_at)} · {formatWhen(row.valid_until)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.status === "draft" ? <>
                          <Button size="sm" variant="outline" className="h-7 rounded-lg px-2 text-[9px]" onClick={() => navigate(paths.eventPromotionEdit + "/" + encodeURIComponent(row.promosi_katalog_id) + "/edit")}>Edit</Button>
                          <Button size="sm" className="h-7 rounded-lg px-2 text-[9px]" disabled={catalogStatusMutation.isPending} onClick={() => catalogStatusMutation.mutate({ row, status: "active" })}>Aktifkan</Button>
                          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[9px]" disabled={catalogStatusMutation.isPending} onClick={() => { if (window.confirm("Batalkan draft promosi ini?")) catalogStatusMutation.mutate({ row, status: "cancelled" }); }}>Batalkan</Button>
                        </> : row.status === "active" && !row.ended_at ? <Button size="sm" variant="outline" className="h-7 rounded-lg px-2 text-[9px]" disabled={endCatalogMutation.isPending} onClick={() => { if (window.confirm("Akhiri promosi ini?")) endCatalogMutation.mutate(row); }}>Akhiri</Button> : null}
                      </div>
                    </div>
                  </CardContent></Card>;
                })}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed bg-card px-4 py-12 text-center">
              <Tag className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">{promos.data?.length ? "Tidak ada promosi yang sesuai filter" : "Belum ada promo barang atau varian"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Daftar hanya menampilkan barang dan varian yang memiliki konfigurasi promo.</p>
              {!promos.data?.length ? <Button size="sm" className="mt-3 rounded-xl" onClick={() => navigate(paths.eventPromotionCreate)}><Plus className="mr-1.5 size-4" />Buat promo pertama</Button> : null}
            </div>
          )}
        </section>
      ) : tab === "packages" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-sm font-bold">Promo paket rental</h2><p className="text-[10px] text-muted-foreground">Harga promo ditetapkan per tarif paket dan tidak ditumpuk dengan promo komponen.</p></div>
            <Button size="sm" className="h-9 rounded-xl" onClick={() => openPackageDialog()}><Plus className="mr-1.5 size-4" />Tambah Promo Paket</Button>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-3"><Search className="size-3.5 text-muted-foreground" /><Input value={packageSearch} onChange={(event) => setPackageSearch(event.target.value)} placeholder="Cari nama paket atau tarif…" className="h-9 border-0 px-0 text-xs shadow-none focus-visible:ring-0" /></div>
          {packagePromos.isError || packageTariffs.isError ? <Alert variant="destructive"><AlertDescription>{errorText(packagePromos.error ?? packageTariffs.error, "Promo paket gagal dimuat.")}</AlertDescription></Alert> : null}
          {packagePromos.isPending || packageTariffs.isPending ? <div className="rounded-xl border p-8 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto mb-2 size-4 animate-spin" />Memuat promo paket…</div> : packageRows.length ? (
            <>
              <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/45 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2.5">Paket / Tarif</th><th className="px-3 py-2.5">Harga normal</th><th className="px-3 py-2.5">Harga promo</th><th className="px-3 py-2.5">Hemat</th><th className="px-3 py-2.5">Periode</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Kontrol</th></tr></thead>
                  <tbody className="divide-y">
                    {packageRows.map((row) => {
                      const tariff = packageTariffs.data?.find((item) => item.tarif_sewa_id === row.tarif_sewa_id);
                      const state = packagePromotionStatus(row);
                      const saving = Number(row.harga_normal) - Number(row.harga_promo);
                      return <tr key={row.promosi_paket_id} className="hover:bg-muted/20">
                        <td className="px-3 py-2.5"><div className="flex items-center gap-2.5"><div className="size-10 overflow-hidden rounded-lg bg-muted">{tariff?.cover_url ? <img src={tariff.cover_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-4 text-muted-foreground" /></div>}</div><div className="min-w-0"><p className="max-w-[260px] truncate text-[11px] font-semibold">{row.paket_nama ?? "Paket"}</p><p className="text-[9px] text-muted-foreground">{row.tarif_nama ?? tariff?.nama ?? "Tarif"}</p></div></div></td>
                        <td className="px-3 py-2.5 text-[10px]">{money(row.harga_normal)}</td><td className="px-3 py-2.5 text-[11px] font-bold text-primary">{money(row.harga_promo)}</td><td className="px-3 py-2.5"><p className="text-[10px] font-semibold">{money(saving)}</p><p className="text-[9px] text-muted-foreground">{Number(row.harga_normal) > 0 ? (saving / Number(row.harga_normal) * 100).toFixed(1) + "%" : "—"}</p></td>
                        <td className="px-3 py-2.5 text-[10px]"><p>{formatWhen(row.started_at)}</p><p className="text-[9px] text-muted-foreground">s.d. {formatWhen(row.valid_until)}</p></td>
                        <td className="px-3 py-2.5"><Badge variant={badgeVariant(state)} className="rounded-full text-[9px]">{state}</Badge></td>
                        <td className="px-3 py-2.5"><div className="flex items-center justify-end gap-2">{state === "Aktif" ? <><Switch checked disabled={savePackageMutation.isPending} onCheckedChange={() => disablePackagePromo(row)} aria-label={"Nonaktifkan promo " + (row.paket_nama ?? "paket")} /><span className="text-[9px] text-muted-foreground">Aktif</span></> : <Button size="sm" variant="outline" className="h-7 rounded-lg text-[9px]" onClick={() => openPackageDialog(row.tarif_sewa_id, "", "")}>Buat ulang</Button>}</div></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 md:hidden">
                {packageRows.map((row) => {
                  const tariff = packageTariffs.data?.find((item) => item.tarif_sewa_id === row.tarif_sewa_id);
                  const state = packagePromotionStatus(row);
                  const saving = Number(row.harga_normal) - Number(row.harga_promo);
                  return <Card key={row.promosi_paket_id} className="rounded-xl"><CardContent className="flex gap-3 p-3">
                    <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">{tariff?.cover_url ? <img src={tariff.cover_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-5 text-muted-foreground" /></div>}</div>
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="min-w-0 flex-1 truncate text-xs font-bold">{row.paket_nama ?? "Paket"}</p><Badge variant={badgeVariant(state)} className="text-[9px]">{state}</Badge></div>
                      <p className="text-[9px] text-muted-foreground">{row.tarif_nama ?? tariff?.nama ?? "Tarif"}</p>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] text-muted-foreground line-through">{money(row.harga_normal)}</span><strong className="text-xs text-primary">{money(row.harga_promo)}</strong></div>
                      <p className="text-[9px] text-muted-foreground">Hemat {money(saving)} · {formatWhen(row.valid_until)}</p>
                      <div className="mt-2 flex items-center gap-2">{state === "Aktif" ? <><Switch checked disabled={savePackageMutation.isPending} onCheckedChange={() => disablePackagePromo(row)} aria-label="Nonaktifkan promo paket" /><span className="text-[9px] text-muted-foreground">Nonaktifkan promo</span></> : <Button size="sm" variant="outline" className="h-7 rounded-lg text-[9px]" onClick={() => openPackageDialog(row.tarif_sewa_id, "", "")}>Buat ulang</Button>}</div>
                    </div>
                  </CardContent></Card>;
                })}
              </div>
            </>
          ) : <div className="rounded-2xl border border-dashed bg-card p-10 text-center"><Package className="mx-auto size-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{packagePromos.data?.length ? "Tidak ada promo yang sesuai pencarian" : "Belum ada konfigurasi promo paket"}</p><p className="mt-1 text-xs text-muted-foreground">Paket yang belum memiliki promo tidak ditampilkan pada daftar ini.</p></div>}
        </section>
      ) : tab === "loyalty" ? (
        <Card className="max-w-3xl rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gift className="size-4 text-primary" />Program Loyalitas · Model A</CardTitle><p className="text-xs text-muted-foreground">Kelayakan berkelanjutan setelah ambang penyewaan selesai tercapai.</p></CardHeader>
          <CardContent>
            {loyalty.isError ? <Alert variant="destructive"><AlertDescription>{errorText(loyalty.error, "Konfigurasi loyalitas gagal dimuat.")}</AlertDescription></Alert> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
              <div><div className="flex items-center gap-2"><Badge variant={loyaltyActive ? "default" : "secondary"}>{loyaltyActive ? "Aktif" : "Nonaktif"}</Badge><span className="text-[10px] text-muted-foreground">{loyalty.data ? "Versi " + loyalty.data.version : "Belum dikonfigurasi"}</span></div>
                {loyalty.data ? <p className="mt-2 text-xs font-semibold">Minimal {loyalty.data.minimum_completed_rentals} penyewaan selesai · Rekomendasi {Number(loyalty.data.recommended_discount_percent)}%</p> : <p className="mt-2 text-xs text-muted-foreground">Belum ada aturan loyalitas untuk usaha ini.</p>}
                {loyalty.data ? <p className="mt-1 text-[10px] text-muted-foreground">{formatWhen(loyalty.data.valid_from)} – {formatWhen(loyalty.data.valid_until)}</p> : null}
              </div>
              <Button size="sm" className="h-9 rounded-xl" onClick={() => setLoyaltyDialogOpen(true)}><Tag className="mr-1.5 size-3.5" />Ubah Pengaturan</Button>
            </div>
            <div className="mt-3 rounded-xl bg-primary/5 p-3 text-xs leading-5"><strong>Aturan pelanggan:</strong> pelanggan yang telah menyelesaikan minimal {loyalty.data?.minimum_completed_rentals ?? "—"} penyewaan memperoleh rekomendasi diskon {Number(loyalty.data?.recommended_discount_percent ?? 0)}% pada transaksi rental berikutnya dan seterusnya selama program berlaku. Penjualan dan jumlah unit tidak menambah hitungan.</div>
          </CardContent>
        </Card>
      ) : tab === "checkout" ? (
        <Card className="max-w-3xl rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CircleDollarSign className="size-4 text-primary" />Kebijakan Diskon Checkout</CardTitle><p className="text-xs text-muted-foreground">Diskon hanya mengurangi kewajiban rental; bukan pembayaran dan tidak memengaruhi subtotal penjualan.</p></CardHeader>
          <CardContent>
            {checkoutPolicy.isError ? <Alert variant="destructive"><AlertDescription>{errorText(checkoutPolicy.error, "Kebijakan checkout gagal dimuat.")}</AlertDescription></Alert> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
              <div><Badge variant={checkoutActive ? "default" : "secondary"}>{checkoutActive ? "Diskon manual diizinkan" : "Diskon manual nonaktif"}</Badge>
                <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-[10px]"><span className="text-muted-foreground">Batas persentase</span><strong>{checkoutPolicy.data?.max_discount_percent == null ? "Tidak diatur" : Number(checkoutPolicy.data.max_discount_percent) + "%"}</strong><span className="text-muted-foreground">Batas nominal</span><strong>{checkoutPolicy.data?.max_discount_amount == null ? "Tidak diatur" : money(checkoutPolicy.data.max_discount_amount)}</strong><span className="text-muted-foreground">Alasan wajib</span><strong>{checkoutPolicy.data?.require_reason ? "Ya" : "Tidak"}</strong><span className="text-muted-foreground">Override loyalitas</span><strong>{checkoutPolicy.data?.allow_above_loyalty ? "Diizinkan" : "Tidak diizinkan"}</strong></div>
              </div>
              <Button size="sm" className="h-9 rounded-xl" onClick={() => setCheckoutDialogOpen(true)}><Tag className="mr-1.5 size-3.5" />Ubah Kebijakan</Button>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Pengaturan ini divalidasi ulang oleh backend saat checkout. Perubahan kebijakan tidak mengubah transaksi yang telah dibuat.</p>
          </CardContent>
        </Card>
      ) : tab === "history" ? (
        <section className="space-y-3">
          <div><h2 className="text-sm font-bold">Riwayat konfigurasi promosi</h2><p className="text-[10px] text-muted-foreground">Menampilkan versi promo katalog dan paket yang tersimpan, termasuk draft, pembatalan, dan pengakhiran.</p></div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-muted/45 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2.5">Target</th><th className="px-3 py-2.5">Jenis</th><th className="px-3 py-2.5">Aturan harga</th><th className="px-3 py-2.5">Waktu</th><th className="px-3 py-2.5">Status</th></tr></thead>
                <tbody className="divide-y">
                  {[...(promos.data ?? []).map((row) => ({ id: row.promosi_katalog_id, label: (row.barang_nama ?? "Barang") + (row.varian_nama ? " · " + row.varian_nama : ""), kind: row.channel === "rental" ? "Promo rental" : "Promo penjualan", rule: Number(row.diskon_persen) + "%", when: row.created_at, status: promotionStatus(row) })), ...(packagePromos.data ?? []).map((row) => ({ id: row.promosi_paket_id, label: (row.paket_nama ?? "Paket") + " · " + (row.tarif_nama ?? "Tarif"), kind: "Promo paket", rule: money(row.harga_normal) + " → " + money(row.harga_promo), when: row.started_at, status: packagePromotionStatus(row) }))].sort((a, b) => String(b.when).localeCompare(String(a.when))).map((row) => <tr key={row.id}><td className="px-3 py-2.5 font-medium">{row.label}</td><td className="px-3 py-2.5">{row.kind}</td><td className="px-3 py-2.5">{row.rule}</td><td className="px-3 py-2.5">{formatWhen(row.when)}</td><td className="px-3 py-2.5"><Badge variant={badgeVariant(row.status)}>{row.status}</Badge></td></tr>)}
                </tbody>
              </table>
            </div>
            {!promos.data?.length && !packagePromos.data?.length ? <p className="p-8 text-center text-xs text-muted-foreground">Belum ada histori konfigurasi promosi.</p> : null}
          </div>
          <p className="text-[10px] text-muted-foreground">Riwayat ini menampilkan versi konfigurasi. Histori penerapan pada transaksi tetap bersumber dari snapshot transaksi, bukan konfigurasi terbaru.</p>
        </section>
      ) : (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Hak Akses Admin Usaha</CardTitle><p className="text-xs text-muted-foreground">Permission tersimpan per keanggotaan usaha dan diperiksa ulang oleh backend.</p></CardHeader>
          <CardContent>
            {!canManageAccess ? <Alert><AlertDescription>Anda tidak memiliki hak untuk mengelola permission admin.</AlertDescription></Alert> : members.isPending ? <p className="py-6 text-center text-xs text-muted-foreground">Memuat daftar admin…</p> : members.isError ? <Alert variant="destructive"><AlertDescription>{errorText(members.error, "Hak akses tidak dapat dimuat.")}</AlertDescription></Alert> : <div className="space-y-3">
              {(members.data ?? []).map((member) => <div key={member.akun_admin_id} className="rounded-xl border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold">{member.nama_tampilan}</p><p className="text-[10px] text-muted-foreground">{member.role === "super_admin" ? "Super admin" : "Admin"} · {member.status}</p></div><Badge variant="outline">{permissionItems.filter((item) => member.permissions[item.key]).length} izin</Badge></div>
                <div className="grid gap-2 sm:grid-cols-2">{permissionItems.map((item) => <label key={item.key} className="flex items-start justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2"><span className="min-w-0"><strong className="block text-[10px]">{item.label}</strong><span className="block text-[9px] leading-4 text-muted-foreground">{item.description}</span></span><input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={Boolean(member.permissions[item.key])} disabled={permissionMutation.isPending} onChange={(event) => permissionMutation.mutate({ adminId: member.akun_admin_id, permission: item.key, granted: event.target.checked })} /></label>)}</div>
              </div>)}
              {!members.data?.length ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada keanggotaan admin aktif.</p> : null}
            </div>}
          </CardContent>
        </Card>
      )}

      <Dialog open={packageDialogOpen} onOpenChange={setPackageDialogOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
            <DialogTitle className="text-sm">Buat Promo Paket</DialogTitle>
            <DialogDescription className="text-[10px]">Pilih paket dan tarif, lalu tetapkan harga promo nominal.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPackage} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from(new Map((packageTariffs.data ?? []).map((row) => [row.paket_sewa_id, row])).values()).map((pkg) => {
                  const chosen = (packageTariffs.data ?? []).find((row) => row.tarif_sewa_id === packageTariffId);
                  const active = chosen?.paket_sewa_id === pkg.paket_sewa_id;
                  return <button key={pkg.paket_sewa_id} type="button" onClick={() => { const first = packageTariffs.data?.find((row) => row.paket_sewa_id === pkg.paket_sewa_id); setPackageTariffId(first?.tarif_sewa_id ?? ""); setPackagePrice(""); setPackageValidUntil(""); }} className={"overflow-hidden rounded-xl border text-left transition " + (active ? "border-primary ring-2 ring-primary/15" : "hover:border-primary/40")}>
                    <div className="aspect-[16/9] overflow-hidden bg-muted">{pkg.cover_url ? <img src={pkg.cover_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-7 text-muted-foreground" /></div>}</div>
                    <div className="p-2"><p className="truncate text-[10px] font-bold">{pkg.paket_nama}</p><p className="text-[9px] text-muted-foreground">{active ? "Dipilih" : "Pilih paket"}</p></div>
                  </button>;
                })}
              </div>
              <div className="space-y-1.5"><p className="text-[10px] font-semibold">Pilih tarif</p><div className="flex flex-wrap gap-1.5">
                {(packageTariffs.data ?? []).filter((row) => row.paket_sewa_id === selectedPackageTariff?.paket_sewa_id).map((tariff) => <button key={tariff.tarif_sewa_id} type="button" onClick={() => { setPackageTariffId(tariff.tarif_sewa_id); const current = packagePromos.data?.find((row) => row.tarif_sewa_id === tariff.tarif_sewa_id && row.status === "active" && !row.ended_at); setPackagePrice(current ? String(current.harga_promo) : ""); setPackageValidUntil(localFromIso(current?.valid_until)); }} className={"rounded-full border px-3 py-1.5 text-[10px] " + (tariff.tarif_sewa_id === packageTariffId ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{tariff.nama} · {money(tariff.nominal)}</button>)}
                {!packageTariffs.data?.length ? <p className="text-[10px] text-muted-foreground">Belum ada paket dengan tarif aktif.</p> : null}
              </div></div>
              {selectedPackageTariff ? <div className="grid gap-2 rounded-xl bg-muted/35 p-3 sm:grid-cols-2"><div><p className="text-[9px] text-muted-foreground">Harga normal</p><p className="text-sm font-bold">{money(selectedPackageTariff.nominal)}</p></div><div><p className="text-[9px] text-muted-foreground">Harga promo</p><p className="text-sm font-bold text-primary">{packagePrice ? money(Number(packagePrice)) : "Belum ditentukan"}</p></div></div> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-[10px] font-semibold">Harga promo (Rp)<Input type="number" min="1" step="1" value={packagePrice} onChange={(event) => setPackagePrice(event.target.value)} required className="h-9 rounded-lg text-xs" /></label>
                <label className="grid gap-1 text-[10px] font-semibold">Berakhir (opsional)<Input type="datetime-local" value={packageValidUntil} onChange={(event) => setPackageValidUntil(event.target.value)} className="h-9 rounded-lg text-xs" /></label>
              </div>
              {selectedPackageTariff && Number(packagePrice) > 0 && Number(packagePrice) < Number(selectedPackageTariff.nominal) ? <p className="rounded-lg bg-primary/5 px-3 py-2 text-[10px] text-primary">Pelanggan menghemat {money(Number(selectedPackageTariff.nominal) - Number(packagePrice))} ({(100 - Number(packagePrice) / Number(selectedPackageTariff.nominal) * 100).toFixed(1)}%).</p> : null}
            </div>
            <DialogFooter className="shrink-0 border-t p-3 sm:p-3">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setPackageDialogOpen(false)}>Batal</Button>
              <Button type="submit" className="rounded-xl" disabled={!selectedPackageTariff || !packagePrice || savePackageMutation.isPending}>{savePackageMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}Simpan Promo Paket</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={loyaltyDialogOpen} onOpenChange={setLoyaltyDialogOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-2xl p-0">
          <DialogHeader className="border-b px-4 py-3 text-left"><DialogTitle className="text-sm">Pengaturan Loyalitas</DialogTitle><DialogDescription className="text-[10px]">Model A: pelanggan tetap memenuhi syarat setelah ambang penyewaan selesai tercapai.</DialogDescription></DialogHeader>
          <form onSubmit={submitLoyalty} className="space-y-3 p-4">
            <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-xs font-bold">Aktifkan program</p><p className="text-[10px] text-muted-foreground">Tidak menggunakan poin atau saldo.</p></div><Switch checked={loyaltyForm.enabled} onCheckedChange={(enabled) => setLoyaltyForm((v) => ({ ...v, enabled }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[10px] font-semibold">Minimal penyewaan selesai<Input type="number" min="1" step="1" value={loyaltyForm.minimum} onChange={(event) => setLoyaltyForm((v) => ({ ...v, minimum: event.target.value }))} className="h-9 rounded-lg text-xs" /></label>
              <label className="grid gap-1 text-[10px] font-semibold">Diskon rekomendasi (%)<Input type="number" min="0.01" max="100" step="0.01" value={loyaltyForm.percent} onChange={(event) => setLoyaltyForm((v) => ({ ...v, percent: event.target.value }))} className="h-9 rounded-lg text-xs" /></label>
              <label className="grid gap-1 text-[10px] font-semibold">Mulai program<Input type="datetime-local" value={loyaltyForm.validFrom} onChange={(event) => setLoyaltyForm((v) => ({ ...v, validFrom: event.target.value }))} className="h-9 rounded-lg text-[10px]" /></label>
              <label className="grid gap-1 text-[10px] font-semibold">Berakhir (opsional)<Input type="datetime-local" value={loyaltyForm.validUntil} onChange={(event) => setLoyaltyForm((v) => ({ ...v, validUntil: event.target.value }))} className="h-9 rounded-lg text-[10px]" /></label>
            </div>
            <div className="rounded-xl bg-primary/5 p-3 text-[10px] leading-5">Setelah menyelesaikan minimal <strong>{loyaltyForm.minimum || "—"} penyewaan</strong>, pelanggan memenuhi syarat rekomendasi diskon <strong>{loyaltyForm.percent || "—"}%</strong> pada transaksi rental berikutnya dan seterusnya selama program berlaku.</div>
            <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => setLoyaltyDialogOpen(false)}>Batal</Button><Button type="submit" className="rounded-xl" disabled={saveLoyaltyMutation.isPending}>{saveLoyaltyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}Simpan</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-2xl p-0">
          <DialogHeader className="border-b px-4 py-3 text-left"><DialogTitle className="text-sm">Kebijakan Diskon Checkout</DialogTitle><DialogDescription className="text-[10px]">Tetapkan batas yang dapat digunakan admin operasional saat Walk-in.</DialogDescription></DialogHeader>
          <form onSubmit={submitPolicy} className="space-y-3 p-4">
            <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-xs font-bold">Izinkan diskon manual</p><p className="text-[10px] text-muted-foreground">Default nonaktif sampai batas diskon ditentukan.</p></div><Switch checked={policyForm.manualEnabled} onCheckedChange={(manualEnabled) => setPolicyForm((v) => ({ ...v, manualEnabled }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[10px] font-semibold">Batas maksimal diskon (%)<Input type="number" min="0.01" max="100" step="0.01" value={policyForm.maxPercent} onChange={(event) => setPolicyForm((v) => ({ ...v, maxPercent: event.target.value }))} placeholder="Opsional" className="h-9 rounded-lg text-xs" /></label>
              <label className="grid gap-1 text-[10px] font-semibold">Batas maksimal nominal (Rp)<Input type="number" min="1" step="1" value={policyForm.maxAmount} onChange={(event) => setPolicyForm((v) => ({ ...v, maxAmount: event.target.value }))} placeholder="Opsional" className="h-9 rounded-lg text-xs" /></label>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-xs font-bold">Izinkan diskon di atas rekomendasi loyalitas</p><p className="text-[10px] text-muted-foreground">Tetap memerlukan hak override admin.</p></div><Switch checked={policyForm.allowAbove} disabled={!policyForm.manualEnabled} onCheckedChange={(allowAbove) => setPolicyForm((v) => ({ ...v, allowAbove }))} /></div>
            <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-xs font-bold">Wajibkan alasan diskon</p><p className="text-[10px] text-muted-foreground">Alasan disimpan pada snapshot transaksi.</p></div><Switch checked={policyForm.requireReason} onCheckedChange={(requireReason) => setPolicyForm((v) => ({ ...v, requireReason }))} /></div>
            <div className="space-y-2"><p className="text-[10px] font-semibold">Alasan yang diizinkan</p><div className="grid gap-2 sm:grid-cols-2">{reasonOptions.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px]"><input type="checkbox" checked={policyForm.reasons.includes(value)} onChange={(event) => setPolicyForm((v) => ({ ...v, reasons: event.target.checked ? [...v.reasons, value] : v.reasons.filter((item) => item !== value) }))} />{label}</label>)}</div></div>
            <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={() => setCheckoutDialogOpen(false)}>Batal</Button><Button type="submit" className="rounded-xl" disabled={savePolicyMutation.isPending}>{savePolicyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}Simpan Kebijakan</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
