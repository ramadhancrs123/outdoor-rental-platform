import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardCheck, Filter, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getPemeriksaanContext, listInspectionQueue } from "@/features/pemeriksaan";
import { formatInspectionDateTime, semanticInspectionLabel } from "@/features/pemeriksaan/utils";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Daftar pemeriksaan gagal dimuat.";
}
function stateLabel(state: string) {
  if (state === "waiting") return "Menunggu Pemeriksaan";
  if (state === "in_progress") return "Pemeriksaan Berjalan";
  if (state === "completed") return "Pemeriksaan Selesai";
  return semanticInspectionLabel(state);
}
function resultLabel(value: string | null) {
  if (value === "normal") return "Normal";
  if (value === "issue_found") return "Ada Temuan";
  return "Belum Ada";
}

const CARD_TONES = [
  "bg-card",
  "bg-emerald-50/40 dark:bg-emerald-950/10",
  "bg-sky-50/40 dark:bg-sky-950/10",
  "bg-amber-50/40 dark:bg-amber-950/10",
] as const;

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={[
        "h-10 shrink-0 rounded-full px-4 shadow-none",
        active ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
      ].join(" ")}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function InspectionQueueCard({ item, index }: { item: Awaited<ReturnType<typeof listInspectionQueue>>[number]; index: number }) {
  const inProgress = item.inspection_state === "in_progress";
  const completed = item.inspection_state === "completed";

  return (
    <Card className={`overflow-hidden rounded-[20px] border-border/70 ${CARD_TONES[index % CARD_TONES.length]} shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition hover:-translate-y-px`}>
      <CardContent className="p-3.5">
        <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary/[0.08] text-primary">
            <ClipboardCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-semibold">{item.kode_unit}</p>
              <Badge variant={completed ? "outline" : "secondary"} className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
                {stateLabel(item.inspection_state)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {item.barang_nama ?? "Barang tidak ditemukan"}{item.varian_nama ? " · " + item.varian_nama : ""}
            </p>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">{item.nomor_pengembalian} · {item.penyewa_nama ?? "Penyewa tidak ditemukan"}</p>
          </div>
          <CheckCircle2 className={completed ? "mt-1 size-4 text-primary" : "mt-1 size-4 text-muted-foreground"} />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-background/70 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Diterima</p>
            <p className="mt-1 truncate text-[12px] font-semibold">{formatInspectionDateTime(item.diterima_at)}</p>
          </div>
          <div className="rounded-xl bg-background/70 px-2.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">Hasil</p>
            <p className="mt-1 truncate text-[12px] font-semibold">{resultLabel(item.latest_hasil)}</p>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Keputusan</p>
            <p className="truncate text-[12px] font-medium">
              {item.latest_keputusan_operasional ? semanticInspectionLabel(item.latest_keputusan_operasional) : "Belum ditetapkan"}
            </p>
          </div>
          <Button asChild className="h-9 shrink-0 rounded-xl px-3">
            <Link to={paths.pemeriksaan + "/" + item.detail_pengembalian_id}>
              {inProgress ? "Lanjutkan" : completed ? "Lihat" : "Periksa"}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function InspectionList() {
  const [searchParams] = useSearchParams();
  const unitFilter = searchParams.get("unit_id")?.trim() ?? "";
  const [search, setSearch] = useState(unitFilter);
  const [activeState, setActiveState] = useState<"all" | "waiting" | "in_progress" | "completed">("all");

  const context = useQuery({
    queryKey: ["pemeriksaan", "context"],
    queryFn: getPemeriksaanContext,
    staleTime: 60_000,
  });
  const queue = useQuery({
    queryKey: ["pemeriksaan", "queue", context.data?.usahaId, search],
    queryFn: () => listInspectionQueue(context.data!.usahaId, search),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (unitFilter) setSearch(unitFilter);
  }, [unitFilter]);

  const rows = useMemo(
    () => activeState === "all" ? (queue.data ?? []) : (queue.data ?? []).filter((item) => item.inspection_state === activeState),
    [activeState, queue.data],
  );

  if (context.isPending) {
    return <div className="space-y-4"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div></div>;
  }
  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pemeriksaan belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-4 pb-28 sm:space-y-5 lg:pb-10">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">Pemeriksaan</p>
            <h1 className="text-[25px] font-bold leading-tight tracking-tight sm:text-[28px]">Antrian Pemeriksaan</h1>
          </div>
          <div className="inline-flex h-10 items-center gap-2 rounded-full border bg-background px-3.5 text-sm font-medium">
            <ClipboardCheck className="size-4 text-primary" />
            Usaha: {context.data.usahaNama}
          </div>
        </div>
        <p className="max-w-2xl text-sm leading-5 text-muted-foreground">Periksa kondisi unit yang benar-benar sudah diterima sebelum keputusan operasional berikutnya.</p>
      </header>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="inspection-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void queue.refetch(); }}
              className="h-11 rounded-xl bg-background pl-10 pr-10"
              placeholder="Cari kode unit, barang, nomor pengembalian, atau nama penyewa..."
              autoComplete="off"
            />
            {search ? (
              <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground" aria-label="Hapus pencarian pemeriksaan" onClick={() => setSearch("")}>
                <X />
              </Button>
            ) : null}
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <FilterChip label="Semua" active={activeState === "all"} onClick={() => setActiveState("all")} />
            <FilterChip label="Menunggu" active={activeState === "waiting"} onClick={() => setActiveState("waiting")} />
            <FilterChip label="Dalam Proses" active={activeState === "in_progress"} onClick={() => setActiveState("in_progress")} />
            <FilterChip label="Selesai" active={activeState === "completed"} onClick={() => setActiveState("completed")} />
            <Button type="button" variant="outline" className="h-10 shrink-0 rounded-full px-4 shadow-none" onClick={() => { setSearch(""); setActiveState("all"); }}>
              <Filter />
              Reset
            </Button>
          </div>

          {search || activeState !== "all" ? (
            <div className="flex items-center justify-between gap-2 px-1 text-xs">
              <span className="text-muted-foreground">Saringan aktif diterapkan pada antrean pemeriksaan.</span>
              <Button type="button" variant="ghost" className="h-7 rounded-full px-2.5 text-xs text-primary" onClick={() => { setSearch(""); setActiveState("all"); }}>
                Reset
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {queue.isPending ? (
        <div className="grid gap-2.5 lg:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-[20px]" />)}</div>
      ) : queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Queue gagal dimuat</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{errorMessage(queue.error)}</span>
            <Button variant="outline" size="sm" onClick={() => void queue.refetch()}><RefreshCw />Coba lagi</Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><ClipboardCheck className="size-6" /></div>
            <div>
              <p className="font-semibold">{activeState === "all" && !search ? "Tidak ada unit menunggu pemeriksaan" : "Tidak ada hasil sesuai filter"}</p>
              <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
                {activeState === "all" && !search ? "Unit yang benar-benar sudah diterima dan menunggu pemeriksaan akan muncul di sini." : "Ubah kata pencarian atau saringan untuk melihat unit lain."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between px-0.5 text-sm">
            <span className="text-muted-foreground">{rows.length} unit pemeriksaan</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Sumber: Pengembalian</span>
          </div>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {rows.map((item, index) => <InspectionQueueCard key={item.detail_pengembalian_id} item={item} index={index} />)}
          </div>
        </>
      )}

      <div className="hidden items-center justify-between border-t pt-3 text-xs text-muted-foreground sm:flex">
        <span>Warna card membantu membedakan item dengan cepat.</span>
        <span>Alur tetap: Pengembalian → Pemeriksaan → Perawatan → verifikasi kesiapan.</span>
      </div>
    </div>
  );
}
