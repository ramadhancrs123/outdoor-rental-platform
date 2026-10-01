import { supabase } from "@/app/providers/supabase/client";
import type { NotificationListResult, NotificationRecord, NotificationRevalidation } from "./types";

const SELECT =
  "pemberitahuan_id,usaha_id,penerima_akun_admin_id,jenis,prioritas,judul,pesan,sumber_type,sumber_id,action_type,action_target,dibaca_at,created_at,outbox_event_id";

export async function listNotifications(
  usahaId: string,
  adminId: string,
  limit = 20,
): Promise<NotificationListResult> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const [rowsResult, unreadResult] = await Promise.all([
    supabase
      .from("pemberitahuan")
      .select(SELECT)
      .eq("usaha_id", usahaId)
      .eq("penerima_akun_admin_id", adminId)
      .order("created_at", { ascending: false })
      .limit(safeLimit),
    supabase
      .from("pemberitahuan")
      .select("pemberitahuan_id", { count: "exact", head: true })
      .eq("usaha_id", usahaId)
      .eq("penerima_akun_admin_id", adminId)
      .is("dibaca_at", null),
  ]);

  if (rowsResult.error) throw rowsResult.error;
  if (unreadResult.error) throw unreadResult.error;

  const rows = (rowsResult.data ?? []) as NotificationRecord[];
  const revalidated = await Promise.all(
    rows.map((item) => revalidateNotification(item.pemberitahuan_id)),
  );

  const revalidationById = new Map(
    revalidated.map((item) => [item.pemberitahuan_id, item]),
  );

  return {
    items: rows.map((item) => {
      const source = revalidationById.get(item.pemberitahuan_id);
      return {
        ...item,
        source_exists: source?.source_exists ?? false,
        action_target: source?.action_target ?? null,
      };
    }),
    unreadCount: unreadResult.count ?? 0,
  };
}

export async function revalidateNotification(
  notificationId: string,
): Promise<NotificationRevalidation> {
  const { data, error } = await supabase.rpc("revalidate_notification", {
    p_pemberitahuan_id: notificationId,
  });

  if (error) throw error;
  return data as NotificationRevalidation;
}

export async function getUnreadNotificationCount(
  usahaId: string,
  adminId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("pemberitahuan")
    .select("pemberitahuan_id", { count: "exact", head: true })
    .eq("usaha_id", usahaId)
    .eq("penerima_akun_admin_id", adminId)
    .is("dibaca_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(
  usahaId: string,
  adminId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("pemberitahuan")
    .update({ dibaca_at: new Date().toISOString() })
    .eq("usaha_id", usahaId)
    .eq("penerima_akun_admin_id", adminId)
    .eq("pemberitahuan_id", notificationId)
    .is("dibaca_at", null);

  if (error) throw error;
}

export async function markAllNotificationsRead(
  usahaId: string,
  adminId: string,
): Promise<void> {
  const { error } = await supabase
    .from("pemberitahuan")
    .update({ dibaca_at: new Date().toISOString() })
    .eq("usaha_id", usahaId)
    .eq("penerima_akun_admin_id", adminId)
    .is("dibaca_at", null);

  if (error) throw error;
}

export function resolveNotificationTarget(notification: NotificationRecord): string | null {
  if (!notification.source_exists) return null;
  return notification.action_target?.trim() || null;
}


export function subscribeToAdminNotifications(
  usahaId: string,
  adminId: string,
  onNotification: (notification: NotificationRecord) => void,
) {
  const channel = supabase
    .channel("admin-notifications:" + usahaId + ":" + adminId + ":" + crypto.randomUUID())
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "pemberitahuan" },
      (payload) => {
        const row = payload.new as Partial<NotificationRecord>;
        if (row.usaha_id !== usahaId || row.penerima_akun_admin_id !== adminId) return;
        onNotification(payload.new as NotificationRecord);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
