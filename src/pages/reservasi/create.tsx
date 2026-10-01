import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  LockKeyhole,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ReservationItemVisual } from "@/components/reservasi/reservation-item-visual";
import {
  createReservationFromRequest,
  formatReservationDate,
  formatReservationMoney,
  getRequest,
  getReservationCapabilities,
  getReservasiContext,
} from "@/features/reservasi";
import { paths } from "@/routes/paths";

type Step = 1 | 2 | 3;
type FlowMode = "wizard" | "processing" | "success" | "conflict" | "unknown";

type LocationState = {
  prices?: Record<string, string>;
};

const stepMeta = [
  { step: 1 as const, title: "Detail" },
  { step: 2 as const, title: "Item" },
  { step: 3 as const, title: "Tinjau" },
];

function artworkFor(index: number) {
  const tones = [
    "from-emerald-100 via-stone-50 to-white text-emerald-700",
    "from-amber-100 via-stone-50 to-white text-amber-700",
    "from-slate-100 via-stone-50 to-white text-slate-600",
    "from-rose-100 via-stone-50 to-white text-rose-700",
  ];
  return tones[index % tones.length];
}

export function ReservationCreate() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("requestId");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const locationState = (location.state ?? {}) as LocationState;

  const [step, setStep] = useState<Step>(1);
  const [flowMode, setFlowMode] = useState<FlowMode>("wizard");
  const [prices] = useState<Record<string, string>>(locationState.prices ?? {});
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [createdReservation, setCreatedReservation] = useState<{ reservasi_id: string; nomor_reservasi: string } | null>(null);
  const createCommandContext = useRef<{ idempotencyKey: string; requestId: string } | null>(null);

  const context = useQuery({
    queryKey: ["reservasi", "context"],
    queryFn: getReservasiContext,
    staleTime: 60_000,
  });

  const request = useQuery({
    queryKey: ["reservasi", "create", context.data?.usahaId, requestId],
    queryFn: () => getRequest(context.data!.usahaId, requestId!),
    enabled: Boolean(context.data?.usahaId && requestId),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!context.data || !request.data || !requestId) {
        throw new Error("Konteks permintaan belum siap.");
      }

      const lines = request.data.lines.map((line) => {
        const quantity = Number(line.jumlah);
        const unitPrice = Number(prices[line.detail_permintaan_id]);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Jumlah detail permintaan tidak valid.");
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error("Semua harga snapshot harus berupa angka nol atau lebih.");
        }

        return {
          detail_permintaan_id: line.detail_permintaan_id,
          unit_price: unitPrice,
          subtotal: Number((quantity * unitPrice).toFixed(2)),
          currency_code: "IDR" as const,
        };
      });

      if (!createCommandContext.current) {
        createCommandContext.current = {
          idempotencyKey: `create-reservation-${requestId}-${crypto.randomUUID()}`,
          requestId: crypto.randomUUID(),
        };
      }

      return createReservationFromRequest(context.data.usahaId, requestId, lines, createCommandContext.current);
    },
    onMutate: () => {
      setReconciliationError(null);
      setFlowMode("processing");
    },
    onSuccess: async (result) => {
      createCommandContext.current = null;
      setCreatedReservation({ reservasi_id: result.reservasi_id, nomor_reservasi: result.nomor_reservasi });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["permintaan", "detail", context.data?.usahaId, requestId] }),
        queryClient.invalidateQueries({ queryKey: ["permintaan", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] }),
      ]);
      await queryClient.invalidateQueries({
        queryKey: ["reservasi", "detail", context.data?.usahaId, result.reservasi_id],
      });
      setFlowMode("success");
    },
    onError: async (error) => {
      const reconciliation = await request.refetch();
      const recoveredReservationId = reconciliation.data?.reservasi_id;

      if (recoveredReservationId) {
        createCommandContext.current = null;
        await queryClient.invalidateQueries({ queryKey: ["reservasi", "list"] });
        await queryClient.invalidateQueries({ queryKey: ["permintaan", "list"] });
        setFlowMode("success");
        return;
      }

      createCommandContext.current = null;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

      if (message.includes("capacity") || message.includes("availability") || message.includes("conflict") || message.includes("stock")) {
        setFlowMode("conflict");
        return;
      }

      setReconciliationError(
        "Permintaan sudah dikirim, namun hasil transaksi belum dapat dipastikan. Data sumber sudah diperiksa ulang dan tidak menunjukkan reservasi baru.",
      );
      setFlowMode("unknown");
    },
  });

  const capabilities = getReservationCapabilities();

  if (!requestId) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center">
        <Alert variant="destructive">
          <AlertTitle>Permintaan belum dipilih</AlertTitle>
          <AlertDescription>
            Flow Buat Reservasi membutuhkan Permintaan sebagai sumber.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (context.isPending || request.isPending) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 pb-24">
        <div className="h-8 w-44 animate-pulse rounded-full bg-muted" />
        <Card className="animate-pulse"><CardContent className="h-72" /></Card>
      </div>
    );
  }

  if (context.error || request.error || !request.data) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 pb-24">
        <Button asChild variant="ghost" className="-ml-3"><ButtonLink to={paths.permintaan}><ArrowLeft /> Kembali</ButtonLink></Button>
        <Alert variant="destructive">
          <AlertTitle>Permintaan belum dapat dibuka</AlertTitle>
          <AlertDescription>{context.error?.message ?? request.error?.message ?? "Permintaan tidak ditemukan."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = request.data;
  const allPricesFilled = data.lines.every(
    (line) => prices[line.detail_permintaan_id] !== undefined && prices[line.detail_permintaan_id] !== "",
  );
  const total = data.lines.reduce((sum, line) => {
    const price = Number(prices[line.detail_permintaan_id]);
    const qty = Number(line.jumlah);
    return Number.isFinite(price) && Number.isFinite(qty) ? sum + price * qty : sum;
  }, 0);

  if (flowMode === "processing") {
    return (
      <div className="mx-auto flex min-h-[72vh] w-full max-w-xl items-center justify-center px-2 pb-24">
        <Card className="w-full overflow-hidden border-primary/10 shadow-lg shadow-primary/5">
          <CardContent className="flex min-h-[560px] flex-col items-center justify-center px-6 py-10 text-center sm:min-h-[620px]">
            <div className="relative grid size-28 place-items-center rounded-full border-8 border-primary/10">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary" />
              <Clock3 className="size-9 text-primary" />
            </div>
            <h1 className="mt-8 text-2xl font-bold tracking-tight">Memproses Reservasi</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Mohon jangan menutup halaman ini. Sistem sedang membuat reservasi dan memeriksa kesesuaian transaksi.
            </p>
            <div className="mt-7 w-full max-w-sm space-y-3 text-left">
              {["Validasi data", "Memeriksa Permintaan", "Membuat reservasi", "Finalisasi"].map((label, index) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className={cn(
                    "grid size-7 place-items-center rounded-full border",
                    index < 2 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : index === 2 ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                  )}>
                    {index < 2 ? <Check className="size-3.5" /> : index === 2 ? <span className="size-2 animate-pulse rounded-full bg-current" /> : <span className="size-2 rounded-full bg-current/30" />}
                  </span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (flowMode === "success") {
    return (
      <div className="mx-auto flex min-h-[72vh] w-full max-w-xl items-center justify-center px-2 pb-24">
        <Card className="w-full overflow-hidden border-emerald-200 shadow-lg shadow-emerald-500/5 dark:border-emerald-900">
          <CardContent className="flex min-h-[560px] flex-col items-center justify-center px-6 py-10 text-center sm:min-h-[620px]">
            <div className="relative grid size-28 place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <div className="absolute inset-0 animate-ping rounded-full border border-emerald-300/40" />
              <div className="grid size-16 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
                <Check className="size-8" />
              </div>
            </div>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Reservasi berhasil dicatat</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Reservasi Berhasil Dibuat</h1>
            <p className="mt-2 text-sm text-muted-foreground">Nomor Reservasi</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-primary">{createdReservation?.nomor_reservasi ?? "Reservasi baru"}</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Reservasi telah dicatat dan menunggu konfirmasi. Buka detail untuk melihat status commitment dan kapasitas.
            </p>
            <div className="mt-8 grid w-full gap-3 sm:max-w-sm">
              <Button
                className="h-12 rounded-xl"
                onClick={() => createdReservation ? navigate(paths.reservasi + "/" + createdReservation.reservasi_id) : navigate(paths.reservasi)}
              >
                Lihat Detail Reservasi <ArrowRight className="size-4" />
              </Button>
              <Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate(paths.permintaan + "/" + requestId)}>
                Kembali ke Permintaan
              </Button>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">Status hasil akhir mengikuti data transaksi yang tersimpan pada sistem.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (flowMode === "conflict") {
    return (
      <div className="mx-auto flex min-h-[72vh] w-full max-w-xl items-center justify-center px-2 pb-24">
        <Card className="w-full border-amber-200 shadow-lg shadow-amber-500/5 dark:border-amber-900">
          <CardContent className="flex min-h-[560px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="grid size-20 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/35 dark:text-rose-300">
              <AlertTriangle className="size-9" />
            </div>
            <h1 className="mt-7 text-2xl font-bold tracking-tight">Kapasitas Tidak Cukup</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Kapasitas tidak cukup untuk periode tersebut. Silakan ubah periode atau jumlah item, lalu coba lagi.
            </p>
            <div className="mt-7 grid w-full max-w-sm grid-cols-2 gap-3">
              <Metric label="Diminta" value={`${data.detail_count} rincian`} />
              <Metric label="Tersedia" value="0" danger />
            </div>
            <div className="mt-7 grid w-full max-w-sm gap-3">
              <Button className="h-11 rounded-xl" onClick={() => { setFlowMode("wizard"); setStep(2); }}>Ubah Periode</Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setFlowMode("wizard"); setStep(2); }}>Ubah Jumlah</Button>
              <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setFlowMode("wizard")}>Cek Kembali</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (flowMode === "unknown") {
    return (
      <div className="mx-auto flex min-h-[72vh] w-full max-w-xl items-center justify-center px-2 pb-24">
        <Card className="w-full border-amber-200 shadow-lg shadow-amber-500/5 dark:border-amber-900">
          <CardContent className="flex min-h-[560px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="grid size-20 place-items-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300">
              <CircleAlert className="size-9" />
            </div>
            <h1 className="mt-7 text-2xl font-bold tracking-tight">Status Transaksi Belum Dapat Dipastikan</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Permintaan telah dikirim, namun status transaksi belum dapat dipastikan. Sistem sudah memeriksa data terbaru.
            </p>
            {reconciliationError && (
              <div className="mt-6 w-full rounded-2xl border bg-muted/40 p-4 text-left text-sm text-muted-foreground">
                {reconciliationError}
              </div>
            )}
            <div className="mt-7 grid w-full max-w-sm gap-3">
              <Button className="h-11 rounded-xl" onClick={() => void request.refetch()}>
                <Search className="size-4" /> Cek Status
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setFlowMode("wizard"); setStep(3); }}>
                Kembali ke Tinjauan
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-28">
      <header className="sticky top-0 z-30 -mx-3 mb-3 border-b bg-background/95 px-3 py-3 backdrop-blur-md sm:-mx-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="icon" aria-label="Kembali" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Buat Reservasi</p>
            <p className="truncate text-[10px] text-muted-foreground">Dari Permintaan {data.nomor_permintaan}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Cari">
            <Search className="size-5" />
          </Button>
        </div>
      </header>

      <div className="mb-5 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-3 items-start">
          {stepMeta.map((item, index) => {
            const active = step === item.step;
            const complete = step > item.step;
            return (
              <div key={item.step} className="relative text-center">
                {index < stepMeta.length - 1 && (
                  <span className={cn(
                    "absolute left-1/2 top-3 h-px w-full",
                    complete ? "bg-primary" : "bg-border",
                  )} />
                )}
                <span className={cn(
                  "relative z-10 mx-auto grid size-7 place-items-center rounded-full border text-xs font-semibold",
                  active && "border-primary bg-primary text-primary-foreground shadow-sm",
                  complete && "border-primary bg-primary text-primary-foreground",
                  !active && !complete && "bg-muted text-muted-foreground",
                )}>
                  {complete ? <Check className="size-3.5" /> : item.step}
                </span>
                <p className={cn("mt-2 text-[11px] font-medium", (active || complete) ? "text-foreground" : "text-muted-foreground")}>{item.title}</p>
              </div>
            );
          })}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle title="Informasi Penyewa" subtitle="Pastikan data penyewa dan periode sudah benar." />
          <Card className="overflow-hidden border shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="grid size-11 place-items-center rounded-full bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                <UserRound className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{data.penyewa_nama}</p>
                <p className="text-xs text-muted-foreground">{data.sumber === "admin" ? "Dari Admin" : "Dari Penyewa"}</p>
              </div>
              <Badge variant="outline">Ubah</Badge>
            </CardContent>
          </Card>

          <SectionTitle title="Periode Penyewaan" subtitle="Periode ini tetap mengikuti Permintaan." />
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">
                  <CalendarDays className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{formatReservationDate(data.mulai_rencana)} → {formatReservationDate(data.selesai_rencana)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Periode dari Permintaan {data.nomor_permintaan}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <SectionTitle title="Catatan" subtitle="Opsional" />
          <Card className="shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">
              {data.catatan ?? "Tambahkan catatan hanya bila diperlukan untuk konteks reservasi."}
            </CardContent>
          </Card>

          <StickyAction>
            <Button className="h-12 w-full rounded-xl" onClick={() => setStep(2)}>
              Lanjutkan <ArrowRight className="size-4" />
            </Button>
          </StickyAction>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle title="Pilih Item dan Jumlah" subtitle="Jumlah berasal dari kebutuhan pada Permintaan." />
          {data.lines.map((line, index) => (
            <Card key={line.detail_permintaan_id} className="overflow-hidden shadow-sm">
              <CardContent className="flex gap-3 p-3.5">
                <ReservationItemVisual
                  variant={index % 4 === 0 ? "tent" : index % 4 === 1 ? "carrier" : index % 4 === 2 ? "stove" : "gear"}
                  className={cn("size-20 shrink-0", artworkFor(index))}
                  compact
                />
                <div className="min-w-0 flex-1 py-1">
                  <p className="font-semibold">{line.barang_nama ?? line.varian_nama ?? line.paket_nama}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{line.varian_nama ?? "Barang"}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Jumlah permintaan</span>
                    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-1.5 py-1">
                      <Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Kurangi jumlah" disabled><Minus className="size-3.5" /></Button>
                      <span className="min-w-5 text-center text-sm font-semibold">{line.jumlah}</span>
                      <Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Tambah jumlah" disabled><Plus className="size-3.5" /></Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          <Alert className="border-primary/10 bg-primary/[0.03]">
            <LockKeyhole className="size-4" />
            <AlertTitle>Penguncian stok belum aktif</AlertTitle>
            <AlertDescription>
              Melanjutkan ke Tinjauan belum mengunci stok. Penguncian stok baru berlaku saat Reservasi dikonfirmasi.
            </AlertDescription>
          </Alert>

          <StickyAction>
            <Button className="h-12 w-full rounded-xl" onClick={() => setStep(3)}>
              Lanjutkan <ArrowRight className="size-4" />
            </Button>
          </StickyAction>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <SectionTitle title="Ringkasan Reservasi" subtitle="Tinjauan sebelum transaksi dikirim ke sistem." />
          <Card className="shadow-sm">
            <CardContent className="space-y-3 p-4">
              <Row label="Penyewa" value={data.penyewa_nama ?? "-"} />
              <Row label="Periode" value={`${formatReservationDate(data.mulai_rencana)} – ${formatReservationDate(data.selesai_rencana)}`} />
              <Row label="Total item" value={`${data.detail_count} line`} />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Daftar Item</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.lines.map((line, index) => {
                const qty = Number(line.jumlah);
                const price = Number(prices[line.detail_permintaan_id] ?? "");
                const subtotal = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;

                return (
                  <div key={line.detail_permintaan_id} className="flex items-center gap-3 rounded-xl border p-3">
                    <ReservationItemVisual
                      variant={index % 4 === 0 ? "tent" : index % 4 === 1 ? "carrier" : index % 4 === 2 ? "stove" : "gear"}
                      className={cn("size-12 shrink-0", artworkFor(index))}
                      compact
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{line.barang_nama ?? line.varian_nama ?? line.paket_nama}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{qty} unit · {formatReservationMoney(price, "IDR")} / unit</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatReservationMoney(subtotal, "IDR")}</p>
                  </div>
                );
              })}
              <Separator />
              <Row label="Total Estimasi" value={formatReservationMoney(total, "IDR")} strong />
            </CardContent>
          </Card>

          <Alert className="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100">
            <ShieldCheck className="size-4" />
            <AlertTitle>Pembayaran dikelola oleh menu Keuangan</AlertTitle>
            <AlertDescription>Nilai ini adalah perkiraan transaksi. Pencatatan pembayaran tetap dilakukan pada menu Keuangan.</AlertDescription>
          </Alert>

          {!allPricesFilled && (
            <Alert variant="destructive">
              <AlertTitle>Harga snapshot belum lengkap</AlertTitle>
              <AlertDescription>Kembali ke Permintaan untuk mengisi harga per item sebelum membuat reservasi.</AlertDescription>
            </Alert>
          )}

          <StickyAction>
            <Button className="h-12 w-full rounded-xl" disabled={!allPricesFilled || createMutation.isPending || !capabilities.mutation} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Membuat Reservasi…" : "Buat Reservasi"} <ArrowRight className="size-4" />
            </Button>
          </StickyAction>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Transaksi aman untuk Usaha aktif
      </div>
    </div>
  );
}

function ButtonLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-2">{children}</Link>;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1 px-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {subtitle && <p className="text-xs leading-5 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm", strong ? "text-base font-bold" : "font-medium")}>{value}</span>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4 text-left">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold", danger && "text-rose-600 dark:text-rose-300")}>{value}</p>
    </div>
  );
}

function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-2 bottom-2 z-40 rounded-2xl border bg-background/95 p-2 shadow-[0_14px_44px_rgba(20,40,30,.16)] backdrop-blur-md lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-0">
      {children}
    </div>
  );
}

ReservationCreate.displayName = "ReservationCreate";
