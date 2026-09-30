import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { listNotifications, markAllNotificationsRead, markNotificationRead, resolveNotificationTarget } from "@/features/pemberitahuan/service";
import type { NotificationRecord } from "@/features/pemberitahuan/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, CheckCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
  }, [load]);

  async function handleRead(notificationId: string) {
    if (!current) return;
    await markNotificationRead(current.usahaId, current.akunAdminId, notificationId);
    setItems((rows) => rows.map((item) =>
      item.pemberitahuan_id === notificationId ? { ...item, dibaca_at: new Date().toISOString() } : item,
    ));
    setUnreadCount((count) => Math.max(0, count - 1));
  }

  async function handleReadAll() {
    if (!current || unreadCount === 0) return;
    await markAllNotificationsRead(current.usahaId, current.akunAdminId);
    const now = new Date().toISOString();
    setItems((rows) => rows.map((item) => ({ ...item, dibaca_at: item.dibaca_at ?? now })));
    setUnreadCount(0);
  }

  return (
    <div className="space-y-5 pb-8" data-testid="notifications-page">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Sistem</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Pemberitahuan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Attention layer untuk fakta bisnis yang sudah committed. Membuka notifikasi tidak mengubah source workflow.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="size-4" /> Muat ulang
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleReadAll()} disabled={busy || unreadCount === 0}>
            <CheckCheck className="size-4" /> Tandai dibaca
          </Button>
        </div>
      </section>

      {!current ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Konteks Usaha belum siap.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Inbox Admin</CardTitle>
            <Badge variant={unreadCount ? "default" : "secondary"}>{unreadCount} belum dibaca</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
            {busy && items.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Memuat pemberitahuan...
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center">
                <Bell className="size-8 text-muted-foreground/50" />
                <p className="font-medium">Belum ada pemberitahuan</p>
                <p className="text-sm text-muted-foreground">Notifikasi dibuat oleh trusted event consumer, bukan oleh browser.</p>
              </div>
            ) : items.map((item) => {
              const target = resolveNotificationTarget(item);
              const unread = !item.dibaca_at;
              return (
                <article key={item.pemberitahuan_id} className={unread ? "rounded-xl border bg-primary/5 p-4" : "rounded-xl border bg-background p-4"}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bell className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{item.judul}</h2>
                        {unread ? <Badge variant="secondary">Baru</Badge> : null}
                        {!item.source_exists ? <Badge variant="destructive">Sumber tidak tersedia</Badge> : null}
                        <Badge variant="outline">{item.prioritas}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.pesan}</p>
                      {!item.source_exists ? (
                        <p className="mt-2 text-xs text-destructive">
                          Source workflow sudah tidak tersedia saat direvalidasi. Notifikasi dipertahankan sebagai riwayat.
                        </p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-muted-foreground">{formatDate(item.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      {unread ? <Button variant="ghost" size="sm" onClick={() => void handleRead(item.pemberitahuan_id)}>Tandai dibaca</Button> : null}
                      {target ? (
                        <Button asChild variant="outline" size="sm" onClick={() => unread && void handleRead(item.pemberitahuan_id)}>
                          <Link to={target}><ExternalLink className="size-4" /> Buka sumber</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

PemberitahuanList.displayName = "PemberitahuanList";
