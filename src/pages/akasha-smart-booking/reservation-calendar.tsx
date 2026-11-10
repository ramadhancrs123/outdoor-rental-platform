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
    received: "Menunggu konfirmasi",
    reviewing: "Menunggu konfirmasi",
    acknowledged: "Menunggu konfirmasi",
    customer_action_required: "Menunggu pelanggan",
    change_requested: "Perubahan diminta",
    cancellation_pending: "Pembatalan diminta",
    ready_for_checkout: "Siap diproses",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
    fulfilled: "Selesai",
  };
  return labels[status];
}

function statusVariant(status: AkashaSmartBookingStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "received" || status === "change_requested" || status === "cancellation_pending") return "default";
  if (status === "customer_action_required") return "destructive";
  if (status === "ready_for_checkout") return "secondary";
  return "outline";
}

function AgendaItem({ item, selectedDate }: {
  item: AkashaSmartBookingCalendarAgendaItem
  selectedDate: string
}) {
  const phone = item.customer_phone.replace(/[^0-9]/g, "");
  const whatsapp = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent("Halo " + item.customer_name + ", kami dari Akasha Outdoor ingin menindaklanjuti reservasi " + item.reference_code + ".")}`
    : null;
  const roles = [
    item.is_pickup ? "Pengambilan" : null,
    item.is_return ? "Pengembalian" : null,
    item.is_in_period ? "Dalam periode sewa" : null,
  ].filter((role): role is string => Boolean(role));

  return (
    <article className="rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold tracking-wide">{item.reference_code}</span>
            <Badge variant={statusVariant(item.workflow_status)} className="h-5 rounded-full px-2 text-[10px]">
              {statusLabel(item.workflow_status)}
            </Badge>
            {item.pending_change_count > 0 ? (
              <Badge variant="destructive" className="h-5 rounded-full px-2 text-[10px]">
                {item.pending_change_count} perubahan
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{item.customer_name}</p>
          <p className="text-[11px] text-muted-foreground">{item.customer_phone}</p>
        </div>
        <p className="shrink-0 text-right text-xs font-semibold">{currency(item.quote_total, item.currency_code)}</p>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {roles.map((role) => (
          <span
            key={role}
            className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
          >
            {role}
          </span>
        ))}
      </div>

      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
        {item.line_summary.slice(0, 3).map((line) =>
          (line.kind === "rental" ? "Sewa" : "Beli") + " · " + line.name +
          (line.variant ? " / " + line.variant : "") + " × " + line.quantity,
        ).join(" · ")}
        {item.line_summary.length > 3 ? ` · +${item.line_summary.length - 3} item` : ""}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="text-[10px] text-muted-foreground">
          {item.requested_return_date
            ? `${dateLabel(item.requested_pickup_date, { day: "2-digit", month: "short" })} – ${dateLabel(item.requested_return_date, { day: "2-digit", month: "short" })}`
            : dateLabel(item.requested_pickup_date, { day: "2-digit", month: "short" })}
        </span>
        <div className="flex items-center gap-1.5">
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
  isLoading,
  error,
  onMonthChange,
  onDateSelect,
  onRetry,
  onShowList,
  todayBusinessDate,
}: {
  month: string
  selectedDate: string
  data?: AkashaSmartBookingCalendar
  isLoading: boolean
  error?: Error | null
  onMonthChange: (month: string) => void
  onDateSelect: (date: string) => void
  onRetry: () => void
  onShowList: () => void
  todayBusinessDate: string
}) {
  const range = getReservationCalendarRange(month);
  const dayMap = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const cells = Array.from({ length: 42 }, (_, index) => addCalendarDays(range.from, index));
  const agenda = data?.agenda ?? [];

  return (
    <section className="grid gap-2.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]" data-testid="reservation-calendar">
      <Card className="min-w-0 border-border/70 shadow-none">
        <CardHeader className="space-y-2 border-b border-border/60 px-3 py-2.5 sm:px-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Kalender reservasi</CardTitle>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Pilih tanggal untuk melihat agenda pelanggan.</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={() => onMonthChange(shiftReservationCalendarMonth(month, -1))} aria-label="Bulan sebelumnya">
                ‹
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs capitalize" onClick={() => onDateSelect(todayBusinessDate)} disabled={!todayBusinessDate}>
                Hari ini
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={() => onMonthChange(shiftReservationCalendarMonth(month, 1))} aria-label="Bulan berikutnya">
                ›
              </Button>
            </div>
          </div>
          <p className="text-center text-sm font-semibold capitalize">{monthLabel(month)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-sky-500" /> Pengambilan</span>
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-amber-500" /> Pengembalian</span>
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-muted-foreground/60" /> Dalam periode</span>
          </div>
        </CardHeader>
        <CardContent className="p-2 sm:p-3">
          {error ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-5 text-center">
              <p className="text-xs font-medium">Kalender belum dapat dimuat.</p>
              <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">Periksa koneksi lalu coba kembali. Daftar reservasi tetap dapat dibuka sementara.</p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRetry}>Coba lagi</Button>
            </div>
          ) : isLoading && !data ? (
            <div className="space-y-2 p-1">
              <Skeleton className="h-7 w-full" />
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 42 }).map((_, index) => <Skeleton key={index} className="h-[76px] rounded-lg" />)}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1" role="row">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="pb-1 text-center text-[10px] font-semibold text-muted-foreground">{day}</div>
                ))}
                {cells.map((date) => {
                  const day = dayMap.get(date);
                  const count = day?.booking_count ?? 0;
                  const isCurrentMonth = date.slice(0, 7) === month;
                  const selected = date === selectedDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={`${dateLabel(date)}; ${count} reservasi; ${day?.pickup_count ?? 0} pengambilan; ${day?.return_count ?? 0} pengembalian`}
                      aria-pressed={selected}
                      data-testid={`reservation-calendar-day-${date}`}
                      onClick={() => onDateSelect(date)}
                      className={[
                        "flex min-h-[54px] min-w-0 flex-col items-start rounded-lg border p-1 text-left transition-colors sm:min-h-[64px] sm:p-1.5",
                        selected
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                          : count > 0
                            ? "border-border bg-muted/35 hover:border-primary/40 hover:bg-muted/60"
                            : "border-transparent hover:border-border hover:bg-muted/25",
                        !isCurrentMonth ? "opacity-45" : "",
                      ].join(" ")}
                    >
                      <span className="flex w-full items-center justify-between gap-1">
                        <span className={`grid size-6 place-items-center rounded-full text-[11px] font-semibold ${selected ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                          {Number(date.slice(-2))}
                        </span>
                        {count > 0 ? (
                          <span className="min-w-4 rounded-full bg-primary/10 px-1 py-0.5 text-center text-[9px] font-semibold leading-none text-primary">
                            {count}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-auto flex min-h-2.5 items-center gap-1">
                        {day && day.pickup_count > 0 ? <i className="size-1.5 rounded-full bg-sky-500" title={`${day.pickup_count} pengambilan`} /> : null}
                        {day && day.return_count > 0 ? <i className="size-1.5 rounded-full bg-amber-500" title={`${day.return_count} pengembalian`} /> : null}
                        {day && day.in_period_count > 0 ? <i className="size-1.5 rounded-full bg-muted-foreground/60" title={`${day.in_period_count} sedang dalam periode`} /> : null}
                      </span>

                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Pilih tanggal untuk melihat pelanggan dan barang yang dijadwalkan.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 border-border/70 shadow-none">
        <CardHeader className="border-b border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-xs sm:text-sm">
                <CalendarDays className="size-4 text-primary" />
                Agenda tanggal {dateLabel(selectedDate, { day: "numeric", month: "long" })}
              </CardTitle>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {data?.agenda_total ?? 0} reservasi terkait tanggal ini
              </p>
            </div>
            {isLoading && data ? <Clock3 className="size-4 animate-pulse text-muted-foreground" /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5 p-3 sm:p-4">
          {!isLoading && agenda.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center px-3 py-5 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><PackageCheck className="size-5" /></span>
              <p className="mt-2 text-xs font-semibold">Tidak ada jadwal pada tanggal ini</p>
              <p className="mt-1 max-w-xs text-[10px] leading-4 text-muted-foreground">Pilih tanggal lain untuk melihat jadwal pelanggan.</p>
            </div>
          ) : (
            agenda.map((item) => <AgendaItem key={item.smart_booking_id} item={item} selectedDate={selectedDate} />)
          )}
          {data && data.agenda_total > agenda.length ? (
            <p className="text-center text-[10px] text-muted-foreground">
              Menampilkan {agenda.length} dari {data.agenda_total} reservasi pada tanggal ini.
            </p>
          ) : null}
          {data && data.unscheduled_count > 0 ? (
            <button type="button" onClick={onShowList} className="flex w-full items-center justify-between rounded-lg border border-dashed px-3 py-2.5 text-left text-[11px] hover:bg-muted/30">
              <span>{data.unscheduled_count} Reservasi tanpa jadwal rental tercatat di daftar.</span>
              <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
