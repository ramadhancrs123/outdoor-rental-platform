import { AlertTriangle, Check, CircleAlert, Info, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProcurementMutationState } from "@/features/pemasok";

export function ProcurementSteps({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <nav aria-label="Tahapan workflow" className="flex items-center gap-2">
      {labels.map((label, index) => {
        const step = index + 1;
        const active = step === current;
        const done = step < current;
        return (
          <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-col items-center gap-1.5 sm:flex-1 sm:flex-row sm:gap-2">
              <span
                className={[
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors",
                  active || done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : step}
              </span>
              <span className={active ? "truncate text-xs font-semibold text-foreground" : "truncate text-xs text-muted-foreground"}>
                {label}
              </span>
            </div>
            {index < labels.length - 1 ? <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </nav>
  );
}

export function ProcurementCommandState({
  state,
  title,
  message,
  onRetry,
  onReconcile,
}: {
  state: ProcurementMutationState;
  title?: string;
  message: string;
  onRetry?: () => void;
  onReconcile?: () => void;
}) {
  if (state === "processing") {
    return (
      <div className="flex min-h-[62vh] flex-col items-center justify-center gap-5 px-5 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-9 animate-spin" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-[22px] font-bold tracking-tight">{title ?? "Memproses..."}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="relative flex min-h-[62vh] flex-col items-center justify-center gap-5 overflow-hidden px-5 text-center">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="absolute left-[12%] top-[20%] size-2 rounded-full bg-amber-400/80" />
          <span className="absolute left-[25%] top-[35%] size-1.5 rounded-full bg-sky-500/80" />
          <span className="absolute right-[18%] top-[24%] size-2 rounded-full bg-orange-400/80" />
          <span className="absolute right-[24%] top-[52%] size-1.5 rounded-full bg-emerald-400/70" />
          <span className="absolute left-[20%] bottom-[28%] size-1.5 rounded-full bg-rose-300/90" />
          <span className="absolute right-[12%] bottom-[25%] size-2 rounded-full bg-sky-400/80" />
        </div>
        <div className="relative grid size-24 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="size-12" strokeWidth={2.25} aria-hidden="true" />
        </div>
        <div className="relative">
          <h2 className="text-[24px] font-bold tracking-tight">{title ?? "Berhasil disimpan"}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  if (state === "unknown") {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="text-amber-700" />
        <AlertTitle>Hasil belum dapat dipastikan</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          {onReconcile ? (
            <Button type="button" variant="outline" onClick={onReconcile}>
              Periksa status
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "stale") {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="text-amber-700" />
        <AlertTitle>Data berubah sejak dibuka</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              Muat data terbaru
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "error") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Perubahan belum berhasil</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              Kembali ke form
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

export function ProcurementBoundaryNote({
  title = "Fakta procurement",
  children,
}: {
  title?: string;
  children: string;
}) {
  return (
    <Alert className="border-primary/10 bg-primary/[0.03]">
      <Info />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function ProcurementStatusBadge({
  status,
  tone = "default",
}: {
  status: string;
  tone?: "default" | "secondary" | "outline" | "destructive";
}) {
  return <Badge variant={tone} className="rounded-full px-2.5 py-0.5 text-[11px]">{status}</Badge>;
}
