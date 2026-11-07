import { useEffect, useState } from "react";
import { CheckCircle2, Gift, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LoyaltyProgram } from "@/features/event-promotions/types";

export type LoyaltyPreview = {
  program_loyalitas_id: string | null;
  is_enabled: boolean;
  is_in_period: boolean;
  eligible: boolean;
  completed_rental_count: number;
  minimum_completed_rentals: number | null;
  recommended_discount_percent: number;
  recommended_amount: number;
  program_version: number | null;
};

export function LoyaltyProgressCard({
  program,
  preview,
  isLoading,
  isError,
  renterActive,
  onRetry,
}: {
  program: LoyaltyProgram | null | undefined;
  preview: LoyaltyPreview | null | undefined;
  isLoading: boolean;
  isError: boolean;
  renterActive: boolean;
  onRetry: () => void;
}) {
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const now = Date.now();
  const startsAt = program?.valid_from ? new Date(program.valid_from).getTime() : 0;
  const endsAt = program?.valid_until ? new Date(program.valid_until).getTime() : null;
  const inPeriod = Boolean(program && startsAt <= now && (endsAt === null || endsAt > now));
  const programActive = Boolean(program?.is_enabled && inPeriod && preview?.is_enabled === true && preview?.is_in_period === true);
  const target = Math.max(1, Number(program?.minimum_completed_rentals ?? 1));
  const completed = Math.max(0, Number(preview?.completed_rental_count ?? 0));
  const qualified = Boolean(programActive && renterActive && preview?.eligible === true);
  const progress = qualified ? 100 : Math.min(100, (completed / target) * 100);

  useEffect(() => {
    setAnimatedProgress(0);
    const frame = window.requestAnimationFrame(() => setAnimatedProgress(progress));
    return () => window.cancelAnimationFrame(frame);
  }, [progress]);

  let statusLabel = "Belum diatur";
  let statusVariant: "default" | "secondary" | "outline" = "outline";
  if (!renterActive) {
    statusLabel = "Penyewa nonaktif";
    statusVariant = "secondary";
  } else if (qualified) {
    statusLabel = "Kelayakan tercapai";
    statusVariant = "default";
  } else if (program && (!program.is_enabled || preview?.is_enabled === false)) {
    statusLabel = "Program nonaktif";
    statusVariant = "secondary";
  } else if (program && endsAt !== null && endsAt <= now) {
    statusLabel = "Periode berakhir";
    statusVariant = "secondary";
  } else if (program && (startsAt > now || preview?.is_in_period === false)) {
    statusLabel = "Belum berlaku";
    statusVariant = "secondary";
  } else if (programActive && preview) {
    statusLabel = "Sedang berprogres";
    statusVariant = "outline";
  } else if (program) {
    statusLabel = "Belum tersedia";
    statusVariant = "secondary";
  }

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Gift className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">PROGRAM LOYALITAS</p>
              <h2 className="mt-0.5 text-base font-semibold tracking-tight">Perjalanan pelanggan</h2>
            </div>
          </div>
          <Badge variant={statusVariant} className="shrink-0 rounded-full text-[10px]">
            {statusLabel}
          </Badge>
        </div>

        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite" aria-busy="true">
            <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.04] p-3">
            <p className="text-sm text-muted-foreground">Kelayakan belum dapat diperiksa.</p>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" onClick={onRetry}>
              <RefreshCw className="size-3.5" /> Coba lagi
            </Button>
          </div>
        ) : !program ? (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm font-medium">Program loyalitas belum dikonfigurasi.</p>
            <p className="mt-1 text-xs text-muted-foreground">Atur program melalui Event & Promosi.</p>
          </div>
        ) : !renterActive ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Penyewa nonaktif. Kelayakan tidak diperiksa untuk transaksi baru.
          </div>
        ) : !programActive ? (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm font-medium">{program.is_enabled ? "Program belum berlaku saat ini." : "Program sedang dinonaktifkan."}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {program.minimum_completed_rentals} penyewaan selesai · rekomendasi {Number(program.recommended_discount_percent)}%.
            </p>
          </div>
        ) : preview ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-bold tracking-tight tabular-nums">{completed}</p>
                <p className="text-xs text-muted-foreground">penyewaan selesai</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{target}</p>
                <p className="text-xs text-muted-foreground">target kelayakan</p>
              </div>
            </div>

            <div className="space-y-2">
              <div
                role="progressbar"
                aria-label="Progres program loyalitas"
                aria-valuemin={0}
                aria-valuemax={target}
                aria-valuenow={Math.min(completed, target)}
                className="h-2.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: String(animatedProgress) + "%" }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{qualified ? "Target tercapai" : String(Math.max(0, target - completed)) + " penyewaan lagi"}</span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
            </div>

            <div className={"flex items-center gap-3 rounded-xl border p-3 " + (qualified ? "border-primary/25 bg-primary/[0.06]" : "border-border/70 bg-muted/20")}>
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-primary">
                {qualified ? <CheckCircle2 className="size-5" aria-hidden="true" /> : <Sparkles className="size-5" aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{qualified ? "Rekomendasi loyalitas tersedia" : "Manfaat setelah memenuhi syarat"}</p>
                <p className="text-xl font-bold tracking-tight text-primary">{Number(program.recommended_discount_percent)}%</p>
              </div>
              {qualified ? <Badge className="rounded-full text-[10px]">Tersedia di Walk-in</Badge> : null}
            </div>

            <p className="text-[11px] leading-5 text-muted-foreground">
              Kelayakan berlanjut setelah ambang tercapai selama program aktif. Diskon diterapkan saat checkout rental, bukan otomatis.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Ringkasan loyalitas belum tersedia.</p>
        )}
      </CardContent>
    </Card>
  );
}
