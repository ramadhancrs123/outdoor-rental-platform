import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Filter,
  Package,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Store,
  UserRound,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RentalPolicyDialog } from "@/components/penyewaan/rental-policy-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RentalTimingSummary } from "@/components/penyewaan/rental-timing";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_RENTAL_LIST_FILTERS,
  getPenyewaanContext,
  listRentals,
  type RentalListFilters,
  type RentalListLineSummary,
} from "@/features/penyewaan";
import { formatRentalDateTime, formatRentalMoney, semanticRentalLabel, rentalStatusVariant } from "@/features/penyewaan";
import { paths } from "@/routes/paths";

type FilterSection = "date" | "renter" | "status";

const RENTAL_STATUS_OPTIONS = [
  ["all", "Semua status"],
  ["draft", "Draf"],
  ["confirmed", "Dikonfirmasi"],
  ["ready_for_pickup", "Siap Diambil"],
  ["active", "Aktif"],
  ["return_in_progress", "Pengembalian Sedang Diproses"],
  ["completed", "Selesai"],
  ["cancelled", "Dibatalkan"],
] as const;

const CARD_TONES = [
  "bg-card",
  "bg-muted/20",
  "bg-primary/[0.035]",
  "bg-secondary/30",
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Penyewaan gagal dimuat.";
}

function lineKindLabel(kind: "barang" | "varian" | "paket") {
  if (kind === "paket") return "Paket";
  if (kind === "varian") return "Varian";
  return "Barang";
}

function RentalLineSummary({ line }: { line: RentalListLineSummary }) {
  const isPackage = line.kind === "paket";

  return (
    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted/70 text-primary">
          {isPackage ? <Package className="size-4" /> : <WalletCards className="size-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px]">
              {lineKindLabel(line.kind)}
            </Badge>
            <p className="min-w-0 truncate text-sm font-semibold leading-5">{line.label}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Jumlah {line.quantity}</p>

          {isPackage && line.component_count > 0 ? (
            <div className="mt-2.5 border-t pt-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Komponen paket · {line.component_count}
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {line.components.map((component) => (
                  <div
                    key={`${line.detail_penyewaan_id}-${component.label}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-muted/35 px-2.5 py-2 text-xs"
                  >
                    <span className="min-w-0 truncate">{component.label}</span>
                    <span className="shrink-0 text-muted-foreground">× {component.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "outline" : "outline"}
      className={[
        "h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium shadow-none",
        active ? "border-primary bg-primary/[0.04] text-primary ring-1 ring-primary/10" : "bg-background",
      ].join(" ")}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

export function RentalList() {
  const [filters, setFilters] = useState<RentalListFilters>(DEFAULT_RENTAL_LIST_FILTERS);
  const [filterSection, setFilterSection] = useState<FilterSection>("status");
  const [filterOpen, setFilterOpen] = useState(false);

  const context = useQuery({
    queryKey: ["penyewaan", "context"],
    queryFn: getPenyewaanContext,
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ["penyewaan", "list", context.data?.usahaId, context.data?.timezone, filters],
    queryFn: () => listRentals(context.data!.usahaId, filters, context.data!.timezone),
    enabled: Boolean(context.data?.usahaId),
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((query.data?.total ?? 0) / filters.pageSize)),
    [filters.pageSize, query.data?.total],
  );

  const hasActiveFilters = Boolean(
    filters.status !== "all" || filters.dateFrom || filters.dateTo || filters.renterSearch,
  );

  const openFilter = (section: FilterSection) => {
    setFilterSection(section);
    setFilterOpen(true);
  };

  const resetFilters = () => {
    setFilters((current) => ({
      ...current,
      status: "all",
      dateFrom: "",
      dateTo: "",
      renterSearch: "",
      page: 1,
    }));
    setFilterOpen(false);
  };

  if (context.isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (context.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Penyewaan belum dapat dibuka</AlertTitle>
        <AlertDescription>{errorMessage(context.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-24 sm:space-y-5 lg:pb-10">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Penyewaan</p>
        <h1 className="text-[25px] font-bold leading-tight tracking-tight sm:text-[28px]">Daftar Penyewaan</h1>
        <p className="max-w-2xl text-sm leading-5 text-muted-foreground">
          Penyewaan dikelompokkan berdasarkan penyewa. Buka baris untuk melihat barang atau paket yang disewa.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <div className="inline-flex h-10 items-center gap-2 rounded-full border bg-background px-3.5 text-sm font-medium">
          <Store className="size-4 text-primary" />
          Usaha: {context.data.usahaNama}
        </div>
        <RentalPolicyDialog
          usahaId={context.data.usahaId}
          currentToleranceHours={context.data.defaultToleranceHours}
          currentLateFeeEnabled={context.data.lateFeeEnabled}
          currentLateFeePerHour={context.data.lateFeePerHour}
          onSaved={() => void context.refetch()}
        />
      </div>

      <Button asChild className="h-11 w-full rounded-xl sm:w-auto">
        <Link to={paths.penyewaanWalkIn}>
          <Plus />
          Penyewaan Langsung
        </Link>
      </Button>

      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label className="sr-only" htmlFor="rental-search">
              Cari nomor penyewaan, penyewa, atau unit
            </label>
            <Input
              id="rental-search"
              value={filters.search}
              onChange={(e) =>
                setFilters((current) => ({ ...current, search: e.target.value, page: 1 }))
              }
              placeholder="Nama penyewa, nomor rental, atau unit..."
              className="h-11 rounded-xl bg-background pl-10 pr-3"
              autoComplete="off"
            />
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Filter penyewaan">
            <FilterChip
              label="Semua"
              icon={<SlidersHorizontal className="size-4" />}
              active={!hasActiveFilters}
              onClick={resetFilters}
            />
            <FilterChip
              label="Tanggal"
              icon={<CalendarDays className="size-4" />}
              active={Boolean(filters.dateFrom || filters.dateTo)}
              onClick={() => openFilter("date")}
            />
            <FilterChip
              label="Penyewa"
              icon={<UserRound className="size-4" />}
              active={Boolean(filters.renterSearch)}
              onClick={() => openFilter("renter")}
            />
            <FilterChip
              label="Status"
              icon={<WalletCards className="size-4" />}
              active={filters.status !== "all"}
              onClick={() => openFilter("status")}
            />
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center justify-between gap-2 px-1 text-xs">
              <span className="text-muted-foreground">Filter aktif diterapkan pada daftar penyewaan.</span>
              <Button
                type="button"
                variant="ghost"
                className="h-7 rounded-full px-2.5 text-xs text-primary"
                onClick={resetFilters}
              >
                Reset
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" className="max-h-[86vh] rounded-t-3xl p-0">
          <SheetHeader className="border-b px-4 py-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SheetTitle>Filter Penyewaan</SheetTitle>
                <SheetDescription>Pilih kondisi yang ingin ditampilkan pada daftar.</SheetDescription>
              </div>
              <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </SheetHeader>

          <div className="grid grid-cols-3 gap-1 border-b p-2">
            {(["date", "renter", "status"] as const).map((section) => (
              <Button
                key={section}
                type="button"
                variant={filterSection === section ? "default" : "ghost"}
                className="h-9 rounded-xl text-xs"
                onClick={() => setFilterSection(section)}
              >
                {section === "date" ? "Tanggal" : section === "renter" ? "Penyewa" : "Status"}
              </Button>
            ))}
          </div>

          <div className="space-y-4 overflow-y-auto p-4">
            {filterSection === "date" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Mulai</span>
                  <Input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        dateFrom: event.target.value,
                        page: 1,
                      }))
                    }
                    className="h-11 rounded-xl"
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Sampai</span>
                  <Input
                    type="date"
                    value={filters.dateTo}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        dateTo: event.target.value,
                        page: 1,
                      }))
                    }
                    className="h-11 rounded-xl"
                  />
                </label>
              </div>
            ) : null}

            {filterSection === "renter" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Nama penyewa</span>
                <Input
                  value={filters.renterSearch}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      renterSearch: event.target.value,
                      page: 1,
                    }))
                  }
                  placeholder="Cari nama penyewa"
                  autoComplete="off"
                  className="h-11 rounded-xl"
                />
              </label>
            ) : null}

            {filterSection === "status" ? (
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">Status penyewaan</span>
                <Select
                  value={filters.status}
                  onValueChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      status: value,
                      page: 1,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    {RENTAL_STATUS_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <Button type="button" className="h-11 w-full rounded-xl" onClick={() => setFilterOpen(false)}>
              Tampilkan Hasil
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {query.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Data penyewaan gagal dimuat</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{errorMessage(query.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw />
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : query.data.rentals.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
            <CalendarClock className="size-8 text-muted-foreground" />
            <p className="font-semibold">Belum ada penyewaan</p>
            <p className="text-sm text-muted-foreground">Tidak ada penyewaan yang cocok dalam Usaha ini.</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion
          type="single"
          collapsible
          className="grid gap-3"
          onValueChange={(value) => {
            if (!value || window.innerWidth >= 768) return;
            requestAnimationFrame(() => {
              const element = document.getElementById(`rental-${value}`);
              if (element) element.scrollIntoView({ block: "start" });
            });
          }}
        >
          {query.data.rentals.map((item, index) => {
            const canComplete = item.status === "active" || item.status === "return_in_progress";
            const tone = CARD_TONES[index % CARD_TONES.length];
            const detailSummary = item.lines.length
              ? item.lines.map((line) => `${line.label} × ${line.quantity}`).join(" · ")
              : "Detail barang belum tersedia";

            return (
              <AccordionItem
                id={`rental-${item.penyewaan_id}`}
                key={item.penyewaan_id}
                value={item.penyewaan_id}
                className={`overflow-hidden rounded-[20px] border border-border/75 ${tone} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}
              >
                <AccordionTrigger className="[&>svg:last-child]:hidden px-4 py-3.5 no-underline hover:no-underline sm:px-5 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <div className="grid grid-cols-[44px_minmax(0,1fr)_34px] items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/[0.08] text-primary">
                        <UserRound className="size-5" />
                      </div>

                      <div className="min-w-0 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-[16px] font-semibold leading-5">
                            {item.penyewa_nama ?? "Penyewa tidak ditemukan"}
                          </h2>
                          <Badge
                            variant={rentalStatusVariant()}
                            className="shrink-0 rounded-full bg-primary/[0.08] px-2.5 py-1 text-[11px] font-medium text-primary"
                          >
                            {semanticRentalLabel(item.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.nomor_penyewaan}</p>
                      </div>

                      <span className="grid size-9 place-items-center rounded-full bg-muted/70 text-foreground/80">
                        <ChevronDown className="size-4" />
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 divide-x rounded-2xl border border-border/60 bg-background/70">
                      <div className="min-w-0 px-2.5 py-2.5 sm:px-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarDays className="size-3.5 shrink-0" />
                          <span>Jadwal</span>
                        </div>
                        <p className="mt-1 truncate text-[13px] font-semibold leading-5">
                          {formatRentalDateTime(item.jadwal_mulai)}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          → {formatRentalDateTime(item.jadwal_kembali)}
                        </p>
                      </div>

                      <div className="min-w-0 px-2.5 py-2.5 sm:px-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <WalletCards className="size-3.5 shrink-0" />
                          <span>Total</span>
                        </div>
                        <p className="mt-1 truncate text-[13px] font-semibold leading-5">
                          {formatRentalMoney(item.total_amount, item.currency_code)}
                        </p>
                      </div>

                      <div className="min-w-0 px-2.5 py-2.5 sm:px-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Package className="size-3.5 shrink-0" />
                          <span>Isi sewa</span>
                        </div>
                        <p className="mt-1 truncate text-[13px] font-semibold leading-5">
                          {item.lines.length} {item.lines.length === 1 ? "jenis" : "jenis"}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">{item.assignment_count} unit ditetapkan</p>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-4 pb-4 sm:px-5 sm:pb-5">
                  <div className="space-y-4 border-t border-border/60 pt-4">
                    {canComplete ? (
                      <RentalTimingSummary
                        scheduleAt={item.jadwal_kembali}
                        toleranceDeadline={item.tolerance_deadline}
                        actualReturnAt={item.actual_return_completed_at}
                        lateFeeEnabled={context.data.lateFeeEnabled}
                        lateFeePerHour={context.data.lateFeePerHour}
                        compact
                        refreshMs={30_000}
                      />
                    ) : null}

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">Barang & paket yang disewa</p>
                          <p className="text-xs text-muted-foreground">
                            Detail barang muncul setelah baris dibuka.
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-full">
                          {item.lines.length} line
                        </Badge>
                      </div>

                      {item.lines.length ? (
                        <div className="grid gap-2">
                          {item.lines.map((line) => (
                            <RentalLineSummary key={line.detail_penyewaan_id} line={line} />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                          Belum ada detail barang pada penyewaan ini.
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
                      <Button asChild variant="outline" className="min-h-10 rounded-xl">
                        <Link to={paths.penyewaan + "/" + item.penyewaan_id}>Lihat Detail Sewa</Link>
                      </Button>
                      {canComplete ? (
                        <Button asChild className="min-h-10 rounded-xl">
                          <Link to={paths.pengembalian + "/" + item.penyewaan_id}>Selesaikan Sewa</Link>
                        </Button>
                      ) : null}
                    </div>

                    <p className="hidden text-xs text-muted-foreground sm:block">Ringkasan: {detailSummary}</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span className="whitespace-nowrap text-muted-foreground">
          {query.data?.total ?? 0} penyewaan · Halaman {filters.page} dari {totalPages}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <Button
            variant="outline"
            className="h-9 rounded-xl px-3 text-xs"
            disabled={filters.page <= 1}
            onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
          >
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-xl px-3 text-xs"
            disabled={filters.page >= totalPages}
            onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
          >
            Berikutnya
          </Button>
        </div>
      </div>

      <div className="sr-only" aria-hidden="true">
        <Filter />
      </div>
    </div>
  );
}
