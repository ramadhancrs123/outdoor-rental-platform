import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { listNotifications, markAllNotificationsRead, markNotificationRead, resolveNotificationTarget, subscribeToAdminNotifications } from "@/features/pemberitahuan/service";
import type { NotificationRecord } from "@/features/pemberitahuan/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Bell, Check, CheckCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function priorityLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "urgent" || normalized === "critical" || normalized === "kritis") return "Kritis";
  if (normalized === "high" || normalized === "tinggi") return "Tinggi";
  if (normalized === "low" || normalized === "rendah") return "Rendah";
  return "Normal";
}

function priorityClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "urgent" || normalized === "critical" || normalized === "kritis" || normalized === "high" || normalized === "tinggi") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300";
  }
  if (normalized === "low" || normalized === "rendah") {
    return "border-border bg-muted/50 text-muted-foreground";
  }
  return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/25 dark:text-sky-300";
}

export function PemberitahuanList() {
  const { current } = useCurrentUsaha();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usahaId = current?.usahaId;
  const adminId = current?.akunAdminId;

  const load = useCallback(async () => {
    if (!usahaId || !adminId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await listNotifications(usahaId, adminId);
      setItems(result.items);
      setUnreadCount(result.unreadCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pemberitahuan gagal dimuat.");
    } finally {
      setBusy(false);
    }
  }, [usahaId, adminId]);

  useEffect(() => {
    void load();
    if (!usahaId || !adminId) return;
    const unsubscribe = subscribeToAdminNotifications(usahaId, adminId, () => {
      void load();
    });
    const fallback = window.setInterval(() => void load(), 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(fallback);
    };
  }, [load, usahaId, adminId]);

  async function handleRead(notificationId: string) {
    if (!current) return;
    try {
      await markNotificationRead(current.usahaId, current.akunAdminId, notificationId);
      setItems((rows) => rows.map((item) =>
        item.pemberitahuan_id === notificationId ? { ...item, dibaca_at: new Date().toISOString() } : item,
      ));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status pemberitahuan gagal diperbarui.");
    }
  }

  async function handleReadAll() {
    if (!current || unreadCount === 0) return;
    setBusy(true);
    try {
      await markAllNotificationsRead(current.usahaId, current.akunAdminId);
      const now = new Date().toISOString();
      setItems((rows) => rows.map((item) => ({ ...item, dibaca_at: item.dibaca_at ?? now })));
      setUnreadCount(0);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pemberitahuan gagal ditandai dibaca.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-6 sm:space-y-5" data-testid="notifications-page">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/5 text-primary">
            <Bell className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Pemberitahuan</h1>
              <Badge variant={unreadCount ? "default" : "secondary"} className="h-5 rounded-full px-2 text-[10px] font-semibold">
                {unreadCount} belum dibaca
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
              Ringkasan aktivitas bisnis dan tindak lanjut yang perlu diketahui.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy} className="h-8 rounded-lg px-2.5 text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Muat ulang
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleReadAll()} disabled={busy || unreadCount === 0} className="h-8 rounded-lg px-2.5 text-xs">
            <CheckCheck className="size-3.5" />
            <span className="hidden min-[360px]:inline">Tandai semua dibaca</span>
            <span className="min-[360px]:hidden">Baca semua</span>
          </Button>
        </div>
      </header>

      {!current ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Konteks Usaha belum siap.
        </div>
      ) : (
        <>
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load()}>Coba lagi</button>
            </div>
          ) : null}

          <section aria-label="Daftar pemberitahuan" className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-3 py-2.5 sm:px-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">Semua aktivitas</span>
                <span className="text-[11px] text-muted-foreground">{items.length} item</span>
              </div>
              {busy && items.length > 0 ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Memperbarui daftar" /> : null}
            </div>

            {busy && items.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Memuat pemberitahuan…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Bell className="size-4" aria-hidden="true" />
                </span>
                <p className="text-sm font-semibold">Belum ada pemberitahuan</p>
                <p className="max-w-xs text-xs leading-5 text-muted-foreground">Aktivitas terbaru akan tampil di sini saat tersedia.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {items.map((item) => {
                  const target = resolveNotificationTarget(item);
                  const unread = !item.dibaca_at;
                  return (
                    <article
                      key={item.pemberitahuan_id}
                      data-notification-id={item.pemberitahuan_id}
                      className={cn(
                        "group flex gap-2.5 border-l-2 px-3 py-3 transition-colors sm:gap-3 sm:px-4",
                        unread ? "border-l-primary bg-primary/[0.035]" : "border-l-transparent hover:bg-muted/25",
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                        unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}>
                        <Bell className="size-3.5" aria-hidden="true" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <h2 className={cn("min-w-0 break-words text-[13px] font-semibold leading-5", unread && "text-foreground")}>
                            {item.judul}
                          </h2>
                          {unread ? <Badge variant="secondary" className="h-[18px] rounded-md px-1.5 text-[9px]">Baru</Badge> : null}
                          <Badge variant="outline" className={cn("h-[18px] rounded-md px-1.5 text-[9px] font-medium", priorityClass(item.prioritas))}>
                            {priorityLabel(item.prioritas)}
                          </Badge>
                          {!item.source_exists ? (
                            <Badge variant="destructive" className="h-[18px] rounded-md px-1.5 text-[9px]">Sumber tidak tersedia</Badge>
                          ) : null}
                        </div>

                        <p className="mt-0.5 line-clamp-2 break-words text-xs leading-[1.45rem] text-muted-foreground">
                          {item.pesan}
                        </p>

                        {!item.source_exists ? (
                          <p className="mt-1 text-[11px] leading-4 text-destructive">
                            Sumber asal tidak lagi tersedia; pemberitahuan disimpan sebagai riwayat.
                          </p>
                        ) : null}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
                          <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                          {item.sumber_type ? <span className="before:mr-1 before:content-['•']">{item.sumber_type.replaceAll("_", " ")}</span> : null}
                          {item.dibaca_at ? <span className="inline-flex items-center gap-1"><Check className="size-3" aria-hidden="true" /> Dibaca</span> : null}
                        </div>

                        {(unread || target) ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {unread ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-md px-2 text-[10px] font-medium text-muted-foreground"
                                onClick={() => void handleRead(item.pemberitahuan_id)}
                              >
                                <Check className="size-3" /> Tandai dibaca
                              </Button>
                            ) : null}
                            {target ? (
                              <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-7 rounded-md px-2 text-[10px] font-semibold"
                                onClick={() => unread && void handleRead(item.pemberitahuan_id)}
                              >
                                <Link to={target}><ExternalLink className="size-3" /> Buka sumber</Link>
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <p className="px-0.5 text-[10px] leading-4 text-muted-foreground">
            Pemberitahuan mengikuti aktivitas sumber; membuka atau menandai dibaca tidak mengubah fakta transaksi.
          </p>
        </>
      )}
    </div>
  );
}

PemberitahuanList.displayName = "PemberitahuanList";
