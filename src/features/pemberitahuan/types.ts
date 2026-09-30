export type NotificationRecord = {
  pemberitahuan_id: string;
  usaha_id: string;
  penerima_akun_admin_id: string;
  jenis: string;
  prioritas: string;
  judul: string;
  pesan: string;
  sumber_type: string | null;
  sumber_id: string | null;
  action_type: string | null;
  action_target: string | null;
  dibaca_at: string | null;
  created_at: string;
  outbox_event_id: string | null;
  source_exists: boolean;
};

export type NotificationRevalidation = {
  pemberitahuan_id: string;
  source_exists: boolean;
  action_target: string | null;
  source_type: string | null;
  source_id: string | null;
};

export type NotificationListResult = {
  items: NotificationRecord[];
  unreadCount: number;
};
