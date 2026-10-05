import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Clock3, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getFinanceCapabilities, getRentalPaymentSummary, listFinanceAccounts, recordPayment, reconcilePaymentCommand, type RecordPaymentInput } from "@/features/keuangan";
import { formatDateTimeLocalInTimezone, formatFinanceTimezone } from "@/features/keuangan/utils";
import { formatRentalMoney } from "@/features/penyewaan";
import type { RentalDetail, RentalTenantContext } from "@/features/penyewaan";
import { createClientId } from "@/lib/client-id";

type PaymentMode = "form" | "processing" | "success" | "unknown";

const paymentKinds: Array<[RecordPaymentInput["jenis"], string]> = [
  ["dp", "DP"],
  ["pelunasan", "Pelunasan"],
  ["pembayaran_tambahan", "Pembayaran Tambahan"],
];

const methods: Array<[RecordPaymentInput["metode"], string]> = [
  ["cash", "Cash"],
  ["bank_transfer", "Bank Transfer"],
  ["qris_manual", "QRIS Manual"],
  ["other", "Lainnya"],
];

export function RentalPaymentDialog({
  open,
  onOpenChange,
  context,
  rental,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: RentalTenantContext;
  rental: RentalDetail;
  onRecorded?: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PaymentMode>("form");
  const [amount, setAmount] = useState("");
  const [jenis, setJenis] = useState<RecordPaymentInput["jenis"]>("dp");
  const [metode, setMetode] = useState<RecordPaymentInput["metode"]>("bank_transfer");
  const [akunKeuanganId, setAkunKeuanganId] = useState("");
  const [dibayarAt, setDibayarAt] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [catatan, setCatatan] = useState("");
  const [feedback, setFeedback] = useState("");
  const [resultNumber, setResultNumber] = useState("");
  const commandRef = useRef<string | null>(null);

  const summary = useQuery({
    queryKey: ["keuangan", "rental-payment-summary", context.usahaId, rental.penyewaan_id, rental.total_amount],
    queryFn: () => getRentalPaymentSummary(context.usahaId, rental.penyewaan_id, Number(rental.total_amount)),
    enabled: open,
    staleTime: 5_000,
  });

  const accounts = useQuery({
    queryKey: ["keuangan", "accounts", context.usahaId],
    queryFn: () => listFinanceAccounts(context.usahaId),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setMode("form");
    setFeedback("");
    setResultNumber("");
    setAmount("");
    setJenis("dp");
    setMetode("bank_transfer");
    setAkunKeuanganId("");
    setReferenceText("");
    setCatatan("");
    setDibayarAt(formatDateTimeLocalInTimezone(new Date(), context.timezone));
  }, [open, context.timezone]);

  useEffect(() => {
    const onlyAccount = accounts.data?.length === 1 ? accounts.data[0] : null;
    if (!open || !onlyAccount) return;
    setAkunKeuanganId((current) => current || onlyAccount.akun_keuangan_id);
  }, [accounts.data, open]);

  const recorded = summary.data?.recordedPaymentTotal ?? 0;
  const total = Number(rental.total_amount);
  const remaining = Math.max(0, total - recorded);
  const capabilities = getFinanceCapabilities();
  const validAmount = Number(amount) > 0;
  const canSubmit = validAmount && Boolean(akunKeuanganId) && Boolean(dibayarAt) && Boolean(capabilities.mutation);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!akunKeuanganId) throw new Error("Akun penerima pembayaran wajib dipilih.");
      if (!validAmount) throw new Error("Nominal pembayaran harus lebih dari 0.");
      if (!dibayarAt) throw new Error("Waktu pembayaran wajib diisi.");
      if (!commandRef.current) commandRef.current = createClientId();

      return recordPayment(
        context.usahaId,
        {
          penyewaanId: rental.penyewaan_id,
          reservasiId: null,
          akunKeuanganId,
          jenis,
          metode,
          amount: Number(amount),
          dibayarAt,
          referenceText,
          catatan,
        },
        {
          idempotencyKey: commandRef.current,
          requestId: createClientId(),
          businessTimezone: context.timezone,
        },
      );
    },
    onMutate: () => {
      setFeedback("");
      setMode("processing");
    },
    onSuccess: async (data) => {
      setResultNumber(data.nomor_pembayaran ?? "Pembayaran baru");
      commandRef.current = null;
      setMode("success");
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
      await onRecorded?.();
    },
    onError: async (error) => {
      if (!commandRef.current) {
        setFeedback("Hasil transaksi belum dapat dipastikan. Jangan mengulang sebelum status diperiksa.");
        setMode("unknown");
        return;
      }

      try {
        const reconciliation = await reconcilePaymentCommand(context.usahaId, commandRef.current);
        if (reconciliation.state === "committed" && reconciliation.response) {
          setResultNumber(reconciliation.response.nomor_pembayaran ?? "Pembayaran baru");
          commandRef.current = null;
          setMode("success");
          await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
          await onRecorded?.();
          return;
        }
      } catch {
        // Keep unknown outcome and never blind-retry a financial mutation.
      }

      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message || "Status transaksi belum dapat dipastikan.");
      setMode("unknown");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto rounded-[24px] p-0 sm:max-h-[90vh]">
        <DialogHeader className="border-b px-4 pb-3 pt-4 pr-12 text-left sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CreditCard className="size-4.5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[17px] tracking-tight">Catat Pembayaran</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Pembayaran untuk Penyewaan {rental.nomor_penyewaan}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {mode === "processing" ? (
          <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
            <Card className="rounded-2xl border-amber-200 bg-amber-50/55 dark:border-amber-900/50 dark:bg-amber-950/20">
              <CardContent className="flex items-center gap-3 p-4">
                <Loader2 className="size-5 animate-spin text-amber-700 dark:text-amber-300" />
                <div>
                  <p className="text-sm font-semibold">Mencatat pembayaran…</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Sistem sedang memvalidasi dan menyimpan fakta pembayaran.</p>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2 text-xs text-muted-foreground">
              {["Validasi data", "Menyimpan pembayaran", "Membuat transaksi keuangan", "Finalisasi"].map((label, index) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className={"grid size-6 place-items-center rounded-full " + (index < 2 ? "bg-emerald-50 text-emerald-700" : "border bg-muted/40")}>
                    {index < 2 ? <Check className="size-3.5" /> : <span className="size-2 rounded-full bg-muted-foreground/30" />}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : mode === "success" ? (
          <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
            <Alert className="border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <Check className="size-4" />
              <AlertTitle>Pembayaran berhasil dicatat</AlertTitle>
              <AlertDescription>{resultNumber} telah tercatat untuk Penyewaan {rental.nomor_penyewaan}.</AlertDescription>
            </Alert>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Total rental</p>
              <p className="mt-1 text-lg font-bold">{formatRentalMoney(total, rental.currency_code)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Ringkasan pembayaran pada halaman telah diperbarui.</p>
            </div>
            <Button className="h-11 w-full rounded-xl" onClick={() => onOpenChange(false)}>Tutup</Button>
          </div>
        ) : mode === "unknown" ? (
          <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
            <Alert variant="destructive" className="rounded-2xl">
              <CircleAlert className="size-4" />
              <AlertTitle>Status transaksi belum dapat dipastikan</AlertTitle>
              <AlertDescription>{feedback || "Periksa ringkasan pembayaran sebelum mencoba lagi."}</AlertDescription>
            </Alert>
            <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setMode("form")}>Kembali ke Form</Button>
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
            <div className="grid grid-cols-3 gap-2">
              <SummaryTile label="Total rental" value={formatRentalMoney(total, rental.currency_code)} />
              <SummaryTile label="Tercatat" value={formatRentalMoney(recorded, rental.currency_code)} />
              <SummaryTile label="Sisa" value={formatRentalMoney(remaining, rental.currency_code)} />
            </div>

            <div className="rounded-2xl border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              Sumber pembayaran: <span className="font-semibold text-foreground">Penyewaan {rental.nomor_penyewaan}</span>
              <span className="mx-1.5">·</span>
              <span>{rental.penyewa_nama ?? "Penyewa tidak ditemukan"}</span>
            </div>

            {summary.error ? (
              <Alert variant="destructive" className="rounded-2xl">
                <CircleAlert className="size-4" />
                <AlertTitle>Ringkasan pembayaran belum dapat dibaca</AlertTitle>
                <AlertDescription>{summary.error instanceof Error ? summary.error.message : "Silakan periksa kembali data Keuangan."}</AlertDescription>
              </Alert>
            ) : null}

            {accounts.isPending ? (
              <div className="h-11 animate-pulse rounded-xl bg-muted" />
            ) : accounts.data?.length ? (
              <FieldSelect
                label="Uang Masuk ke"
                value={akunKeuanganId}
                options={accounts.data.map((account) => [account.akun_keuangan_id, account.nama_akun + " · " + account.jenis_akun] as [string, string])}
                onChange={setAkunKeuanganId}
              />
            ) : (
              <Alert className="rounded-2xl">
                <CircleAlert className="size-4" />
                <AlertTitle>Belum ada akun uang aktif</AlertTitle>
                <AlertDescription>Pembayaran membutuhkan minimal satu akun Kas, Bank, atau E-Wallet aktif.</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldSelect label="Jenis Pembayaran" value={jenis} options={paymentKinds} onChange={(value) => setJenis(value as RecordPaymentInput["jenis"])} />
              <FieldSelect label="Metode Pembayaran" value={metode} options={methods} onChange={(value) => setMetode(value as RecordPaymentInput["metode"])} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold" htmlFor="rental-payment-amount">Nominal Pembayaran</label>
              <div className="flex items-center rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring/60">
                <span className="text-sm font-semibold text-muted-foreground">Rp</span>
                <Input id="rental-payment-amount" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-12 border-0 text-right text-lg font-bold shadow-none focus-visible:ring-0" placeholder="150000" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" htmlFor="rental-payment-date">Waktu Pembayaran</label>
                <Input id="rental-payment-date" type="datetime-local" value={dibayarAt} onChange={(event) => setDibayarAt(event.target.value)} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" htmlFor="rental-payment-ref">Reference <span className="font-normal text-muted-foreground">(opsional)</span></label>
                <Input id="rental-payment-ref" value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="TRF-982736" className="h-11 rounded-xl" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold" htmlFor="rental-payment-note">Catatan <span className="font-normal text-muted-foreground">(opsional)</span></label>
              <Input id="rental-payment-note" value={catatan} onChange={(event) => setCatatan(event.target.value)} placeholder="Catatan pembayaran." className="h-11 rounded-xl" />
            </div>

            <Alert className="border-primary/10 bg-primary/[0.03]">
              <ShieldCheck className="size-4" />
              <AlertTitle>Pembayaran → Transaksi Keuangan</AlertTitle>
              <AlertDescription>Pencatatan ini hanya membuat fakta pembayaran dan transaksi keuangan. Status Penyewaan tetap dikelola oleh workflow Penyewaan.</AlertDescription>
            </Alert>

            {feedback ? <p className="text-xs text-destructive">{feedback}</p> : null}

            <Separator />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Batal</Button>
              <Button className="h-11 rounded-xl bg-[#0a6b55] px-5 hover:bg-[#075944]" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? <><Loader2 className="animate-spin" />Mencatat…</> : <><CreditCard />Catat Pembayaran</>}
              </Button>
            </div>

            <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
              <Clock3 className="size-3.5" />
              Waktu mengikuti {formatFinanceTimezone(context.timezone)}.
            </div>

            {capabilities.mutation ? null : <p className="text-center text-[10px] text-muted-foreground">Pencatatan pembayaran sedang dinonaktifkan oleh capability Keuangan.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold">{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-medium">
        {options.map(([key, optionLabel]) => <option key={key} value={key}>{optionLabel}</option>)}
      </select>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/15 px-2.5 py-2.5">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[12px] font-bold sm:text-[13px]">{value}</p>
    </div>
  );
}
