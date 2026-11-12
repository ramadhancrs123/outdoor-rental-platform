import { Link } from "react-router";
import { ArrowRight, CalendarDays, Clock3, PackageCheck, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/routes/paths";
import {
  addCalendarDays,
  getReservationCalendarRange,
  monthLabel,
  shiftReservationCalendarMonth,
} from "./reservation-calendar-utils";
import type {
  AkashaSmartBookingCalendar,
  AkashaSmartBookingCalendarAgendaItem,
  AkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/types";
import type { SmartBookingTotalDisplay } from "@/features/akasha-smart-booking/estimate";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function dateLabel(value: string, options: Intl.DateTimeFormatOptions = {}) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function currency(value: number, code = "IDR") {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(value);
}

function statusLabel(status: AkashaSmartBookingStatus) {
  const labels: Record<AkashaSmartBookingStatus, string> = {
    received: "Belum dikonfirmasi",
    reviewing: "Belum dikonfirmasi",
    acknowledged: "Belum dikonfirmasi",
    customer_action_required: "Perlu respons",
    change_requested: "Perubahan diminta",
    cancellation_pending: "Pembatalan diminta",
    ready_for_checkout: "Terkonfirmasi",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
    fulfilled: "Selesai",
  };
  return labels[status];
}

function statusClass(status: AkashaSmartBookingStatus) {
  if (["received", "reviewing", "acknowledged"].includes(status)) {
    return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  }
  if (["customer_action_required", "change_requested", "cancellation_pending"].includes(status)) {
    return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (status === "ready_for_checkout") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-border bg-muted/70 text-muted-foreground";
}

function AgendaItem({ item, selectedDate, estimate }: {
  item: AkashaSmartBookingCalendarAgendaItem;
  selectedDate: string;
  estimate: SmartBookingTotalDisplay | undefined;
}) {
  const phone = item.customer_phone.replace(/[^0-9]/g, "");
  const whatsapp = phone
    ? "https://wa.me/" + phone + "?text=" + encodeURIComponent("Halo " + item.customer_name + ", kami dari Akasha Outdoor ingin menindaklanjuti reservasi " + item.reference_code + ".")
    : null;
  const roles = [
    item.is_pickup ? "Pengambilan" : null,
    item.is_in_period ? "Dalam periode" : null,
  ].filter((role): role is string => Boolean(role));

  return (
    <article className="rounded-xl border border-border/70 bg-background/75 p-2.5 transition-colors hover:border-primary/30 sm:p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold tracking-wide">{item.reference_code}</span>
            <Badge variant="outline" className={"h-5 rounded-full px-2 text-[9px] " + statusClass(item.workflow_status)}>
              {statusLabel(item.workflow_status)}
            </Badge>
            {item.workflow_status === "ready_for_checkout" ? (
              <Badge variant="outline" className="h-5 rounded-full border-emerald-500/20 bg-emerald-500/[0.06] px-2 text-[9px] text-emerald-700 dark:text-emerald-300">
                Siap diproses
              </Badge>
            ) : null}
            {item.pending_change_count > 0 ? (
              <Badge variant="outline" className="h-5 rounded-full border-rose-500/20 bg-rose-500/10 px-2 text-[9px] text-rose-700 dark:text-rose-300">
                {item.pending_change_count} tindak lanjut
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs font-semibold">{item.customer_name}</p>
          <p className="text-[10px] text-muted-foreground">{item.customer_phone}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] font-bold">{estimate?.total == null ? "Nominal belum tersedia" : currency(estimate.total, item.currency_code)}</p>
          <p className="text-[9px] text-muted-foreground">
            {estimate?.source === "snapshot"
              ? "Nominal saat booking"
              : estimate?.source === "calculated"
                ? "Total estimasi"
                : "Nominal belum tersedia"} · {item.line_summary.length} item
          </p>
        </div>
      </div>

      {roles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <span
              key={role}
              className="rounded-md bg-muted px-2 py-1 text-[9px] font-medium text-muted-foreground"
            >
              {role}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="text-[10px] text-muted-foreground">
          {item.requested_return_date
            ? dateLabel(item.requested_pickup_date, { day: "2-digit", month: "short" }) + " – " + dateLabel(item.requested_return_date, { day: "2-digit", month: "short" })
            : dateLabel(item.requested_pickup_date, { day: "2-digit", month: "short" })}
        </span>
        <div className="flex items-center gap-1">
          {whatsapp ? (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[10px]">
              <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="h-7 px-2 text-[10px]">
            <Link to={paths.reservasi + "/" + item.smart_booking_id + "?date=" + selectedDate}>
              Detail <ArrowRight className="size-3" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ReservationCalendar({
  month,
  selectedDate,
  data,
  estimates,
  isLoading,
  error,
  onMonthChange,
  onDateSelect,
  onRetry,
  onShowList,
  todayBusinessDate,
}: {
  month: string;
  selectedDate: string;
  data?: AkashaSmartBookingCalendar;
  estimates: ReadonlyMap<string, SmartBookingTotalDisplay>;
  isLoading: boolean;
  error?: Error | null;
  onMonthChange: (month: string) => void;
  onDateSelect: (date: string) => void;
  onRetry: () => void;
  onShowList: () => void;
  todayBusinessDate: string;
}) {
  const range = getReservationCalendarRange(month);
  const dayMap = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const cells = Array.from({ length: 42 }, (_, index) => addCalendarDays(range.from, index));
  const agenda = data?.agenda ?? [];

  return (
    <section className="grid min-w-0 gap-2.5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]" data-testid="reservation-calendar">
      <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="space-y-2 border-b border-border/60 bg-gradient-to-r from-primary/[0.055] via-background to-background px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Kalender reservasi</CardTitle>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Pantau jadwal booking dan aktivitas pengambilan.</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => onMonthChange(shiftReservationCalendarMonth(month, -1))} aria-label="Bulan sebelumnya">
                ‹
              </Button>
              <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2.5 text-[10px]" onClick={() => onDateSelect(todayBusinessDate)} disabled={!todayBusinessDate}>
                Hari ini
              </Button>
              <Button variant="outline" size="icon" className="size-8 rounded-lg" onClick={() => onMonthChange(shiftReservationCalendarMonth(month, 1))} aria-label="Bulan berikutnya">
                ›
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="text-base font-bold capitalize tracking-tight">{monthLabel(month)}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-sky-500" /> Pengambilan</span>
              <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-muted-foreground/60" /> Dalam periode</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-2 sm:p-3">
          {error ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-5 text-center">
              <p className="text-xs font-semibold">Kalender belum dapat dimuat.</p>
              <p className="max-w-sm text-[10px] leading-4 text-muted-foreground">Periksa koneksi lalu coba kembali. Daftar reservasi tetap dapat dibuka.</p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRetry}>Coba lagi</Button>
            </div>
          ) : isLoading && !data ? (
            <div className="space-y-2 p-1">
              <Skeleton className="h-7 w-full" />
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 42 }).map((_, index) => <Skeleton key={index} className="h-[54px] rounded-lg sm:h-[62px]" />)}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1" role="row">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="pb-1 text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[10px]">{day}</div>
                ))}
                {cells.map((date) => {
                  const day = dayMap.get(date);
                  const count = day?.booking_count ?? 0;
                  const isCurrentMonth = date.slice(0, 7) === month;
                  const selected = date === selectedDate;
                  const today = date === todayBusinessDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={dateLabel(date) + "; " + count + " reservasi; " + (day?.pickup_count ?? 0) + " pengambilan"}
                      aria-pressed={selected}
                      data-testid={"reservation-calendar-day-" + date}
                      onClick={() => onDateSelect(date)}
                      className={[
                        "flex min-h-[49px] min-w-0 flex-col items-start rounded-lg border p-1 text-left transition-all sm:min-h-[62px] sm:p-1.5",
                        selected
                          ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
                          : count > 0
                            ? "border-border/80 bg-muted/45 hover:border-primary/40 hover:bg-primary/[0.045]"
                            : "border-transparent hover:border-border hover:bg-muted/35",
                        !isCurrentMonth ? "opacity-40" : "",
                      ].join(" ")}
                    >
                      <span className="flex w-full items-center justify-between gap-0.5">
                        <span className={[
                          "grid size-5 place-items-center rounded-full text-[10px] font-semibold sm:size-6 sm:text-[11px]",
                          selected ? "bg-primary text-primary-foreground" : today ? "border border-primary/50 text-primary" : "text-foreground",
                        ].join(" ")}>
                          {Number(date.slice(-2))}
                        </span>
                        {count > 0 ? (
                          <span className="min-w-3.5 rounded-full bg-primary/10 px-1 py-0.5 text-center text-[8px] font-bold leading-none text-primary">
                            {count}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-auto flex min-h-2 items-center gap-1">
                        {day && day.pickup_count > 0 ? <i className="size-1.5 rounded-full bg-sky-500" title={day.pickup_count + " pengambilan"} /> : null}
                        {day && day.in_period_count > 0 ? <i className="size-1.5 rounded-full bg-muted-foreground/60" title={day.in_period_count + " dalam periode"} /> : null}
                        {today && !count ? <i className="size-1.5 rounded-full bg-primary" title="Hari ini" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                <p className="text-[9px] text-muted-foreground">Pantau pengambilan dan periode booking.</p>
                {data ? <span className="text-[9px] font-medium text-muted-foreground">{data.scheduled_count} booking terjadwal</span> : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/20 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-xs sm:text-sm">
                <CalendarDays className="size-4 text-primary" />
                Agenda {dateLabel(selectedDate, { day: "numeric", month: "long" })}
              </CardTitle>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {data?.agenda_total ?? 0} reservasi pada tanggal ini
              </p>
            </div>
            {isLoading && data ? <Clock3 className="size-4 animate-pulse text-muted-foreground" /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-2.5 sm:p-3">
          {!isLoading && agenda.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/15 px-3 py-5 text-center sm:min-h-40">
              <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground"><PackageCheck className="size-4" /></span>
              <p className="mt-2 text-xs font-semibold">Tidak ada jadwal pada tanggal ini</p>
              <p className="mt-1 max-w-xs text-[10px] leading-4 text-muted-foreground">Pilih tanggal lain untuk melihat reservasi.</p>
            </div>
          ) : (
            agenda.map((item) => (
              <AgendaItem
                key={item.smart_booking_id}
                item={item}
                selectedDate={selectedDate}
                estimate={estimates.get(item.smart_booking_id)}
              />
            ))
          )}
          {data && data.agenda_total > agenda.length ? (
            <p className="text-center text-[10px] text-muted-foreground">
              Menampilkan {agenda.length} dari {data.agenda_total} reservasi.
            </p>
          ) : null}
          {data && data.unscheduled_count > 0 ? (
            <button type="button" onClick={onShowList} className="flex w-full items-center justify-between rounded-lg border border-dashed px-3 py-2.5 text-left text-[10px] hover:bg-muted/30">
              <span>{data.unscheduled_count} booking tanpa jadwal pengambilan</span>
              <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
