import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import { Bell, CalendarClock, CheckCircle2, ChevronRight, CreditCard, FileBarChart, Receipt, RotateCcw, Search, TentTree, Wrench } from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { getFinancialReport } from "@/features/laporan/service";
import { listNotifications } from "@/features/pemberitahuan/service";
import type { NotificationRecord } from "@/features/pemberitahuan/types";
import type { FinancialReport } from "@/features/laporan/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { paths } from "@/routes/paths";

type AdminIdentity = { id: string; name: string };

function dateOnly(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function period() {
  const now = new Date();
  return {
    start: dateOnly(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: dateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  };
}

function money(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export function Dashboard() {
  const { data: identity } = useGetIdentity<AdminIdentity>();
  const { current } = useCurrentUsaha();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usahaId = current?.usahaId;
  const adminId = current?.akunAdminId;
  const greetingName = identity?.name?.split(" ")[0] || "Admin";

  useEffect(() => {
    if (!usahaId || !adminId) return;
    const p = period();
    let active = true;
    Promise.all([
      listNotifications(usahaId, adminId, 5),
      getFinancialReport(usahaId, p.start, p.end),
    ])
      .then(([notificationData, reportData]) => {
        if (!active) return;
        setNotifications(notificationData.items);
        setUnreadCount(notificationData.unreadCount);
        setReport(reportData);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Dashboard gagal dimuat.");
      });
    return () => { active = false; };
  }, [usahaId, adminId]);

  const attention = notifications;

  return (
    <div data-testid="dashboard-root" className="space-y-5 pb-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative z-10 flex min-h-[210px] flex-col justify-between p-5 sm:min-h-[240px] sm:p-7 lg:p-8">
          <div className="max-w-xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-white/75 text-primary backdrop-blur dark:bg-black/20">
                Operational control center
              </Badge>
              <span className="text-xs text-muted-foreground">{current?.usahaNama ?? "Usaha aktif"}</span>
            </div>
            <p className="pt-2 text-sm font-medium text-muted-foreground">Selamat datang kembali,</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{greetingName}</h1>
            <p className="max-w-lg text-sm text-muted-foreground sm:text-base">
              Pantau pekerjaan yang membutuhkan perhatian dan kembali ke modul pemilik saat tindakan diperlukan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background/75 px-3 py-1.5 text-xs font-medium backdrop-blur">
              <span className={cn("size-2 rounded-full", error ? "bg-amber-500" : "bg-emerald-500")} aria-hidden="true" />
              {error ? "Perlu dimuat ulang" : "Source terhubung"}
            </span>
            <Link className="text-xs font-medium text-primary hover:underline" to={paths.laporan}>Buka Laporan</Link>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden="true">
          <svg viewBox="0 0 1200 320" className="absolute inset-y-0 right-0 h-full w-[75%] text-primary/10" preserveAspectRatio="none">
            <path d="M0 285 155 185 245 228 380 85 520 236 690 98 855 230 1010 125 1200 250V320H0Z" fill="currentColor" />
            <path d="M150 320 315 232 420 272 560 155 705 275 855 192 990 273 1125 204 1200 245V320H150Z" fill="currentColor" opacity=".7" />
          </svg>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {([
          ["Belum dibaca", String(unreadCount), "Attention layer", Bell, "bg-primary/10 text-primary", paths.pemberitahuan],
          ["Pemasukan", report ? money(report.summary.recorded_income) : "—", "Finance source", CreditCard, "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300", paths.keuangan],
          ["Pengeluaran", report ? money(report.summary.recorded_expense) : "—", "Finance source", Receipt, "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300", paths.keuangan + "/pengeluaran"],
          ["Net operasional", report ? money(report.summary.net_operational_movement) : "—", "Derived report", FileBarChart, "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200", paths.laporan],
          ["Pembayaran", report ? String(report.summary.recorded_payment_count) : "—", "Finance source", CreditCard, "bg-primary/10 text-primary", paths.keuangan + "/pembayaran"],
        ] as const).map(([label, value, delta, Icon, tone, href]) => (
          <Link key={label} to={href} className="block">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/30">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
                  </div>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}><Icon className="size-4" aria-hidden="true" /></span>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">{delta}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-base sm:text-lg">Perlu Perhatian</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Notifikasi terbaru dari committed domain events.</p>
            </div>
            <Button asChild variant="ghost" size="sm"><Link to={paths.pemberitahuan}>Lihat semua</Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Belum ada notifikasi. Critical tasks tetap harus tersedia di queue modul pemilik.
              </div>
            ) : attention.map((item) => (
              <Link key={item.pemberitahuan_id} to={item.action_target || paths.pemberitahuan} className="flex items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:bg-muted/40">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bell className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", !item.dibaca_at && "text-primary")}>{item.judul}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.pesan}</p>
                </div>
                {!item.dibaca_at && <Badge variant="secondary">Baru</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader><CardTitle className="text-base sm:text-lg">Workflow Entry</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {([
              ["Permintaan", paths.permintaan, Search],
              ["Reservasi", paths.reservasi, CalendarClock],
              ["Penyewaan", paths.penyewaan, TentTree],
              ["Pengembalian", paths.pengembalian, RotateCcw],
              ["Pemeriksaan", paths.pemeriksaan, CheckCircle2],
              ["Perawatan", paths.perawatan, Wrench],
              ["Laporan", paths.laporan, FileBarChart],
            ] as const).map(([label, href, Icon]) => (
              <Button key={label} asChild variant="outline" className="justify-between">
                <Link to={href}><span className="inline-flex items-center gap-2"><Icon className="size-4" />{label}</span><ChevronRight className="size-4" /></Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card className="shadow-sm">
          <CardHeader><CardTitle className="text-base sm:text-lg">Traceability</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Dashboard membaca source domain; tindakan tetap dilakukan pada halaman owner masing-masing.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link to={paths.laporan} className="rounded-lg border p-3 font-medium text-foreground hover:bg-muted/40">Finance → Laporan</Link>
              <Link to={paths.pemberitahuan} className="rounded-lg border p-3 font-medium text-foreground hover:bg-muted/40">Event → Pemberitahuan</Link>
            </div>
          </CardContent>
        </Card>
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Pencarian operasional</p>
              <p className="mt-1 text-xs text-muted-foreground">Cari penyewa, rental, unit, barang, atau QR dari satu tempat.</p>
            </div>
            <div className="relative w-full lg:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Cari operasional" placeholder="Cari penyewa, barang, kode rental, atau QR..." className="h-11 pl-9" />
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

Dashboard.displayName = "Dashboard";
