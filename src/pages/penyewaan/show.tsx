import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, CreditCard, Filter, Handshake, History, MessageCircle, MoreHorizontal, Package, PackageCheck, Phone, Plus, QrCode, ReceiptText, RefreshCw, Search, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { ToleranceExtensionDialog } from "@/components/penyewaan/tolerance-extension-dialog";
import { RentalConsequenceList } from "@/components/keuangan/rental-consequence-list";
import { getPenyewaanContext, getRentalCapabilities, getRental, listRentalToleranceHistory } from "@/features/penyewaan";
import { listRentalConsequenceReviews } from "@/features/keuangan";
import { formatRentalDateTime, formatRentalMoney, semanticRentalLabel, rentalStatusVariant } from "@/features/penyewaan";
import { QrPreviewDialog, RentalReceiptDialog } from "@/components/qr-operasional/qr-operasional";
import { buildPenyewaanQrUrl, getQrPenyewaanRecord, getRentalReceiptSupport } from "@/features/qr-operasional";
import { paths } from "@/routes/paths";
import { RentalFinanceCard } from "@/components/penyewaan/rental-finance-card";
import { RentalOperationalWorkspace } from "@/components/penyewaan/rental-operational-workspace";
import { RentalPaymentDialog } from "@/components/penyewaan/rental-payment-dialog";
import { RentalPhase2Actions } from "./phase2-actions";

export function RentalShow() {
  const { id } = useParams<{ id: string }>();
  const context = useQuery({ queryKey: ["penyewaan", "context"], queryFn: getPenyewaanContext, staleTime: 60_000 });
  const query = useQuery({ queryKey: ["penyewaan", "detail", context.data?.usahaId, id], queryFn: () => getRental(context.data!.usahaId, id!), enabled: Boolean(context.data?.usahaId && id) });
  const toleranceHistory = useQuery({
    queryKey: ["penyewaan", "tolerance-history", context.data?.usahaId, id],
    queryFn: () => listRentalToleranceHistory(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });
  const consequenceReviews = useQuery({
    queryKey: ["keuangan", "rental-consequence", context.data?.usahaId, id],
    queryFn: () => listRentalConsequenceReviews(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
  });
  const [qrOpen, setQrOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [phase2Open, setPhase2Open] = useState(false);
  const rentalQr = useQuery({
    queryKey: ["qr-operasional", "penyewaan", context.data?.usahaId, id],
    queryFn: () => getQrPenyewaanRecord(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5 * 60_000,
  });
  const receiptSupport = useQuery({
    queryKey: ["qr-operasional", "rental-receipt-support", context.data?.usahaId, id, query.data?.penyewa_id],
    queryFn: () => getRentalReceiptSupport(context.data!.usahaId, id!, query.data!.penyewa_id),
    enabled: Boolean(context.data?.usahaId && id && query.data?.penyewa_id),
    staleTime: 15_000,
  });
  const receiptData = useMemo(() => {
    const rental = query.data;
    if (!rental || !rentalQr.data || !receiptSupport.data) return null;
    const recorded = receiptSupport.data.recorded;
    const total = Number(rental.total_amount);
    const status: "belum_dibayar" | "sebagian" | "lunas" = recorded <= 0 ? "belum_dibayar" : recorded >= total ? "lunas" : "sebagian";
    return {
      usaha_nama: receiptSupport.data.usaha_nama,
      usaha_alamat: receiptSupport.data.usaha_alamat,
      usaha_telepon: receiptSupport.data.usaha_telepon,
      usaha_email: receiptSupport.data.usaha_email,
      timezone: receiptSupport.data.timezone,
      nomor_penyewaan: rental.nomor_penyewaan,
      penyewa_nama: rental.penyewa_nama ?? "Penyewa tidak ditemukan",
      penyewa_telepon: receiptSupport.data.penyewa_telepon,
      jadwal_mulai: rental.jadwal_mulai,
      jadwal_kembali: rental.jadwal_kembali,
      tolerance_deadline: rental.tolerance_deadline,
      actual_pickup_at: rental.actual_pickup_at,
      total_amount: total,
      currency_code: rental.currency_code,
      token_qr: rentalQr.data.token_qr,
      url: buildPenyewaanQrUrl(window.location.origin, rentalQr.data.token_qr),
      generated_at: new Date().toISOString(),
      lines: rental.lines.map((line) => ({
        nama: line.paket_nama ?? line.barang_nama ?? "Barang",
        rincian: line.varian_nama,
        jumlah: Number(line.jumlah),
        subtotal: Number(line.subtotal),
        currency_code: line.currency_code,
      })),
      catatan: rental.catatan,
      pembayaran: {
        tercatat: recorded,
        sisa: Math.max(0, total - recorded),
        status,
      },
    };
  }, [query.data, receiptSupport.data, rentalQr.data]);
  if (context.isPending || query.isPending) return <Card><CardContent className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">Memuat detail penyewaan…</CardContent></Card>;
  if (context.error || query.error || !query.data) return <Alert variant="destructive"><AlertTitle>Detail penyewaan tidak tersedia</AlertTitle><AlertDescription className="gap-3"><p>{context.error?.message ?? query.error?.message ?? "Penyewaan tidak ditemukan atau Anda tidak memiliki akses."}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>;
  const item=query.data; const capabilities=getRentalCapabilities();
  const packageLines = item.lines.filter((line) => Boolean(line.paket_sewa_id));
  const rentalMode = packageLines.length
    ? packageLines.length === item.lines.length
      ? "Paket"
      : "Campuran"
    : "Barang Satuan";
  const renterName = item.penyewa_nama ?? "Penyewa tidak ditemukan";
  const renterPhone = item.penyewa_telepon?.trim() || null;
  const whatsappHref = renterPhone ? buildWhatsAppHref(renterPhone, renterName, item.nomor_penyewaan) : null;
  return (
    <div data-testid="rental-detail-root" className="mx-auto w-full max-w-3xl space-y-2.5 pb-28 sm:space-y-3.5 lg:pb-10">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_32px_rgba(23,68,55,.10)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/login-bg.webp')" }}
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#0b5c4b]/72 via-[#0d4f43]/42 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/28 to-transparent" />

        <div className="relative px-4 pb-4 pt-3.5 text-white sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-xl bg-white/12 text-white hover:bg-white/20 hover:text-white" aria-label="Kembali ke penyewaan">
                <Link to={paths.penyewaan}><ArrowLeft className="size-4" /></Link>
              </Button>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78">Detail Penyewaan</p>
                <h1 className="mt-1 truncate text-[21px] font-bold leading-6 tracking-[-0.03em]">{item.nomor_penyewaan}</h1>
                <p className="mt-0.5 truncate text-[11px] text-white/82">{item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p>
              </div>
            </div>

            <Badge variant={rentalStatusVariant()} className="shrink-0 rounded-full border border-white/40 bg-white/12 px-2.5 py-1 text-[10px] text-white backdrop-blur">
              {semanticRentalLabel(item.status)}
            </Badge>
          </div>

          <div className="mt-5 max-w-[30rem]">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-white/86 text-[#0d5e4b] shadow-sm backdrop-blur">
                <WalletCards className="size-4.5" />
              </span>
              <div>
                <p className="text-[20px] font-bold leading-5 tracking-[-0.03em]">Keuangan</p>
                <p className="mt-0.5 text-[10px] text-white/82">Pantau pembayaran dan status operasional penyewaan.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Detail penyewaan" className="grid grid-cols-4 gap-1.5 rounded-2xl border border-border/60 bg-card p-1.5 shadow-[0_4px_16px_rgba(30,68,57,.05)]">
        <button type="button" onClick={() => document.getElementById("rental-finance")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0a6b55] px-2 text-[10px] font-semibold text-white shadow-sm">
          <WalletCards className="size-3.5" />Keuangan
        </button>
        <button type="button" onClick={() => setQrOpen(true)} disabled={!rentalQr.data} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground transition-colors hover:bg-muted">
          <QrCode className="size-3.5" />QR
        </button>
        <button type="button" onClick={() => setReceiptOpen(true)} disabled={!receiptData} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground transition-colors hover:bg-muted">
          <ReceiptText className="size-3.5" />Struk
        </button>
        <button type="button" onClick={() => document.getElementById("rental-history")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-2 text-[10px] font-semibold text-foreground transition-colors hover:bg-muted">
          <History className="size-3.5" />Riwayat
        </button>
      </nav>

      <section className="rounded-[18px] border border-border/65 bg-card px-3.5 py-3 shadow-[0_3px_14px_rgba(28,67,56,.04)] sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground">Penyewa</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold">{renterName}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{renterPhone ?? "Nomor telepon belum dicatat."}</p>
          </div>
          {renterPhone ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button asChild type="button" variant="outline" size="sm" className="h-9 rounded-xl px-2.5 text-[10px] font-semibold">
                <a href={"tel:" + renterPhone} aria-label={"Telepon " + renterName}>
                  <Phone className="size-3.5" />Telepon
                </a>
              </Button>
              {whatsappHref ? (
                <Button asChild type="button" size="sm" className="h-9 rounded-xl bg-[#0a6b55] px-2.5 text-[10px] font-semibold hover:bg-[#075944]">
                  <a href={whatsappHref} target="_blank" rel="noreferrer" aria-label={"Hubungi WhatsApp " + renterName}>
                    <MessageCircle className="size-3.5" />WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <RentalFinanceCard
        context={{ ...context.data, timezone: context.data.timezone }}
        rental={item}
        onRecordPayment={() => setPaymentOpen(true)}
      />

      <RentalOperationalWorkspace
        usahaId={context.data.usahaId}
        penyewaanId={item.penyewaan_id}
        rentalStatus={item.status}
        enabled={item.status === "active" || item.status === "return_in_progress" || item.status === "completed"}
        onChanged={async () => { await query.refetch(); }}
      />

      <details className="group overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.055)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden sm:px-4">
          <span className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><Package className="size-4.5" /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold tracking-tight">Daftar Penyewaan</span>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[9px]">{rentalMode}</Badge>
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">{item.lines.length} detail · {item.assignments.length} unit · buka untuk rincian.</span>
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-border/60 px-3.5 pb-3.5 pt-2.5 sm:px-4 sm:pb-4">
          <div className="mb-2 flex justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground" aria-label="Cari">
              <Search className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground" aria-label="Filter">
              <Filter className="size-3.5" />
            </Button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border/65 bg-background">
            <div className="flex items-start justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"><PackageCheck className="size-4.5" /></span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-bold">{renterName}</p>
                    <Badge variant="secondary" className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">Sedang Sewa</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{item.lines.length} detail · {item.assignments.length} unit ditetapkan</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[8px] text-muted-foreground">Total</p>
                <p className="mt-0.5 text-[12px] font-bold">{formatRentalMoney(item.total_amount, item.currency_code)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x border-t border-border/60 bg-muted/10">
              <div className="min-w-0 px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Mulai</p><p className="mt-0.5 truncate text-[10px] font-semibold">{formatRentalDateTime(item.jadwal_mulai)}</p></div>
              <div className="min-w-0 px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Kembali</p><p className="mt-0.5 truncate text-[10px] font-semibold">{formatRentalDateTime(item.jadwal_kembali)}</p></div>
              <div className="min-w-0 px-2.5 py-2.5"><p className="text-[8px] text-muted-foreground">Unit</p><p className="mt-0.5 truncate text-[10px] font-semibold">{item.assignments.length}</p></div>
            </div>
          </div>
        </div>
      </details>

      <details className="group overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden sm:px-4">
          <span className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><Clock3 className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[15px] font-bold">Status Pengembalian</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Jadwal kembali · {formatRentalDateTime(item.jadwal_kembali)}</span></span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-border/60 px-3.5 pb-3.5 pt-3.5 sm:px-4 sm:pb-4">
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[10px] font-semibold text-primary" onClick={() => document.getElementById("rental-history")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Lihat detail<ArrowRight className="size-3.5" />
            </Button>
          </div>

        <RentalTimingSummary
          scheduleAt={item.jadwal_kembali}
          toleranceDeadline={item.tolerance_deadline}
          actualReturnAt={item.actual_return_completed_at}
          lateFeeEnabled={context.data.lateFeeEnabled}
          lateFeePerHour={context.data.lateFeePerHour}
          compact
          className="mt-3"
        />

        {item.status !== "completed" && item.status !== "cancelled" ? (
          <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300"><Clock3 className="size-3.5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold">Batas toleransi</p>
                <p className="truncate text-[9px] text-muted-foreground">{formatRentalDateTime(item.tolerance_deadline)}</p>
              </div>
            </div>
            <ToleranceExtensionDialog
              usahaId={context.data.usahaId}
              penyewaanId={item.penyewaan_id}
              currentDeadline={item.tolerance_deadline}
              history={toleranceHistory.data ?? []}
              buttonLabel={item.status === "draft" || item.status === "ready_for_pickup" ? "Atur Toleransi" : "Tambah Toleransi"}
              onSaved={async () => { await Promise.all([query.refetch(), toleranceHistory.refetch()]); }}
            />
          </div>
        ) : null}
        </div>
      </details>

      <section className="rounded-[22px] border border-border/65 bg-card p-3.5 shadow-[0_4px_18px_rgba(28,67,56,.04)] sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm"><Plus className="size-4.5" /></span>
            <div>
              <h2 className="text-[15px] font-bold">Tindakan Cepat</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Akses fitur penyewaan yang sering digunakan.</p>
            </div>
          </div>
          <button type="button" onClick={() => setPhase2Open((value) => !value)} className="grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-muted/40" aria-expanded={phase2Open} aria-label={phase2Open ? "Ringkas tindakan" : "Buka tindakan"}>
            <ChevronDown className={"size-4 transition-transform " + (phase2Open ? "rotate-180" : "")} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => setPaymentOpen(true)} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl bg-emerald-600 px-1.5 py-2 text-center text-white shadow-[0_7px_16px_rgba(10,107,85,.18)]">
            <CreditCard className="size-4.5" />
            <span className="text-[9px] font-semibold leading-3.5">Catat<br />Pembayaran</span>
          </button>
          <button type="button" onClick={() => document.getElementById("rental-tolerance")?.scrollIntoView({ behavior: "smooth", block: "center" })} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/10 px-1.5 py-2 text-center text-foreground">
            <Clock3 className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Atur<br />Toleransi</span>
          </button>
          <button type="button" onClick={() => setPhase2Open(true)} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/10 px-1.5 py-2 text-center text-foreground">
            <PackageCheck className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Pilih &<br />Serahkan Barang</span>
          </button>
          <button type="button" onClick={() => setReceiptOpen(true)} disabled={!receiptData} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/10 px-1.5 py-2 text-center text-foreground disabled:opacity-50">
            <ReceiptText className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Buat<br />Struk</span>
          </button>
          <button type="button" onClick={() => document.getElementById("rental-extension")?.scrollIntoView({ behavior: "smooth", block: "center" })} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/10 px-1.5 py-2 text-center text-foreground">
            <History className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Perpanjangan</span>
          </button>
          <button type="button" onClick={() => document.getElementById("rental-history")?.scrollIntoView({ behavior: "smooth", block: "center" })} className="flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-muted/10 px-1.5 py-2 text-center text-foreground">
            <MoreHorizontal className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Lainnya</span>
          </button>
        </div>

        <div className="mt-2.5" hidden={!phase2Open}>
          <div id="rental-phase2">
            <RentalPhase2Actions
              context={{ ...context.data, timezone: context.data.timezone }}
              rental={item}
              onChanged={async () => { await query.refetch(); }}
            />
          </div>
        </div>
      </section>

      <details className="group overflow-hidden rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden sm:px-4">
          <span className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><ReceiptText className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[15px] font-bold">Detail Penyewaan</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item.lines.length} detail · {item.assignments.length} unit ditetapkan · buka untuk rincian.</span></span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-border/60 px-3.5 pb-3.5 pt-3.5 sm:px-4 sm:pb-4">
          <div className="mb-2.5 flex justify-end">
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[10px] font-semibold text-primary">
              <Link to={paths.penyewaan}>Kembali ke daftar<ArrowRight className="size-3.5" /></Link>
            </Button>
          </div>
          <div className="space-y-1.5">
            {item.lines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-center text-[10px] text-muted-foreground">Belum ada detail penyewaan.</div>
            ) : (
              item.lines.map((line) => (
                <div key={line.detail_penyewaan_id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><Package className="size-4" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold">{line.barang_nama ?? line.varian_nama ?? line.paket_nama ?? "Target tidak ditemukan"}</p>
                      <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{line.jumlah} unit · {formatRentalMoney(line.unit_price, line.currency_code)} / unit</p>
                    </div>
                  </div>
                  <p className="shrink-0 text-[10px] font-bold">{formatRentalMoney(line.subtotal, line.currency_code)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </details>

      {packageLines.length ? (
        <details className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><PackageCheck className="size-4.5" /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">Komposisi Paket</span>
                <span className="mt-0.5 block text-[9px] text-muted-foreground">Unit fisik ditetapkan per komponen.</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border/60 px-3.5 py-3.5">
            {packageLines.map((line) => {
              const components = item.components.filter((component) => component.detail_penyewaan_id === line.detail_penyewaan_id);
              return (
                <div key={line.detail_penyewaan_id} className="rounded-2xl border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-[11px] font-semibold">{line.paket_nama ?? "Paket"}</p><p className="mt-0.5 text-[9px] text-muted-foreground">Quantity paket: {line.jumlah}</p></div>
                    <Badge variant="secondary" className="rounded-full text-[9px]">{components.reduce((sum, component) => sum + Number(component.jumlah), 0)} unit</Badge>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {components.map((component) => {
                      const assignments = item.assignments.filter((assignment) => assignment.komponen_penyewaan_id === component.komponen_penyewaan_id);
                      return (
                        <div key={component.komponen_penyewaan_id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/15 px-2.5 py-2">
                          <div className="min-w-0"><p className="truncate text-[10px] font-medium">{component.varian_nama ?? component.barang_nama ?? "Komponen"}</p><p className="mt-0.5 text-[9px] text-muted-foreground">Butuh {component.jumlah} · Ditetapkan {assignments.length}</p></div>
                          <Badge variant={assignments.length >= Number(component.jumlah) ? "outline" : "destructive"} className="rounded-full text-[9px]">{assignments.length}/{component.jumlah}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      <details open className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><PackageCheck className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Penetapan Unit</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Kesiapan fisik tetap dikelola Inventaris.</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-1.5 border-t border-border/60 px-3.5 py-3.5">
          {item.assignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-center text-[10px] text-muted-foreground">Belum ada unit yang ditetapkan.</div>
          ) : (
            item.assignments.map((assignment) => (
              <div key={assignment.penetapan_unit_id} className="flex items-start justify-between gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
                <div className="min-w-0"><p className="text-[10px] font-semibold">{assignment.kode_unit ?? "Unit tidak ditemukan"}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{semanticRentalLabel(assignment.status)} · {formatRentalDateTime(assignment.ditetapkan_at)}</p>{assignment.alasan_substitusi ? <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Substitusi: {assignment.alasan_substitusi}</p> : null}</div>
                {assignment.dibatalkan_at ? <Badge variant="outline" className="rounded-full text-[9px]">Dibatalkan</Badge> : null}
              </div>
            ))
          )}
        </div>
      </details>

      <details className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><Handshake className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Serah-terima</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{item.handover ? "Serah-terima sudah tercatat." : "Belum ada serah-terima."}</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 px-3.5 py-3.5">
          {item.handover ? (
            <div className="rounded-2xl bg-muted/15 px-3 py-3">
              <div className="flex items-center justify-between gap-3"><span className="text-[9px] text-muted-foreground">Status</span><Badge variant="secondary" className="rounded-full text-[9px]">{semanticRentalLabel(item.handover.status)}</Badge></div>
              <p className="mt-2 text-[10px] font-semibold">{formatRentalDateTime(item.handover.serah_terima_at)}</p>
              {item.handover.catatan ? <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{item.handover.catatan}</p> : null}
            </div>
          ) : <p className="text-[10px] text-muted-foreground">Belum ada serah-terima.</p>}
        </div>
      </details>

      <details id="rental-extension" className="group rounded-[22px] border border-border/65 bg-card shadow-[0_4px_18px_rgba(28,67,56,.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><History className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold">Perpanjangan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{item.extensions.length ? item.extensions.length + " riwayat" : "Belum ada permintaan perpanjangan."}</span></span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-1.5 border-t border-border/60 px-3.5 py-3.5">
          {item.extensions.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Belum ada permintaan perpanjangan.</p>
          ) : item.extensions.slice(0, 3).map((extension) => (
            <div key={extension.perpanjangan_sewa_id} className="rounded-2xl border border-border/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold">{semanticRentalLabel(extension.status)}</p><Badge variant="outline" className="rounded-full text-[9px]">{extension.tambahan_amount == null ? "-" : formatRentalMoney(extension.tambahan_amount, extension.currency_code)}</Badge></div>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{formatRentalDateTime(extension.jadwal_kembali_sebelum)} → {formatRentalDateTime(extension.jadwal_kembali_sesudah)}</p>
            </div>
          ))}
        </div>
      </details>

      <div id="rental-history" className="space-y-2.5">
        {consequenceReviews.data?.length ? (
          <RentalConsequenceList items={consequenceReviews.data} />
        ) : null}
        <details className="group rounded-[22px] border border-border/65 bg-card shadow-none">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 marker:hidden">
            <span className="flex items-center gap-2.5"><ShieldCheck className="size-4 text-primary" /><span className="text-[11px] font-semibold">Catatan operasional</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border/60 px-3.5 py-3.5">
            <div className="rounded-xl bg-blue-50/55 px-3 py-2.5 text-[9px] leading-4 text-slate-600 dark:bg-blue-950/15 dark:text-slate-300">Pembayaran tetap dikelola oleh Keuangan. Nilai pada penyewaan adalah snapshot transaksi.</div>
            <div className="rounded-xl bg-emerald-50/55 px-3 py-2.5 text-[9px] leading-4 text-slate-600 dark:bg-emerald-950/15 dark:text-slate-300">{capabilities.reason}</div>
          </div>
        </details>
      </div>

      <QrPreviewDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        title="QR Penyewaan"
        description="QR ini membuka detail penyewaan yang sama dan dapat digunakan sebagai locator operasional."
        code={item.nomor_penyewaan}
        kind="penyewaan"
        url={rentalQr.data ? buildPenyewaanQrUrl(window.location.origin, rentalQr.data.token_qr) : ""}
      />

      {receiptData ? <RentalReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receiptData} /> : null}

      <RentalPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        context={{ ...context.data, timezone: context.data.timezone }}
        rental={item}
        onRecorded={async () => { await query.refetch(); }}
      />

      {item.status === "active" || item.status === "return_in_progress" ? (
        <div className="fixed inset-x-3 bottom-16 z-40 lg:hidden">
          <div className="rounded-2xl border border-white/60 bg-background/92 p-2 shadow-[0_18px_50px_rgba(20,40,30,.16)] backdrop-blur">
            <Button asChild className="h-11 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold hover:bg-[#075944]">
              <a href="#rental-operational">Selesaikan Sewa<ArrowRight className="size-4" /></a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

}
function buildWhatsAppHref(phone: string, renterName: string, rentalNumber: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("62") ? digits : digits.replace(/^0+/, "62");
  const message = encodeURIComponent("Halo " + renterName + ", terkait rental " + rentalNumber + ".");
  return "https://wa.me/" + normalized + "?text=" + message;
}
