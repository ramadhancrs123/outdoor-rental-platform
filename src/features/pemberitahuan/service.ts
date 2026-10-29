import { supabase } from "@/app/providers/supabase/client";
import { createClientId } from "@/lib/client-id";
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
  const [displayRows, revalidated] = await Promise.all([
    humanizeNotificationCopies(rows, usahaId),
    Promise.all(rows.map((item) => revalidateNotification(item.pemberitahuan_id))),
  ]);

  const revalidationById = new Map(
    revalidated.map((item) => [item.pemberitahuan_id, item]),
  );

  return {
    items: displayRows.map((item) => {
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
    .channel("admin-notifications:" + usahaId + ":" + adminId + ":" + createClientId())
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


type CopyRental = { penyewaan_id: string; penyewa_id: string | null; nomor_penyewaan: string };
type CopyRenter = { penyewa_id: string; nama_lengkap: string | null };
type CopyReservation = { reservasi_id: string; penyewa_id: string | null };
type CopyPayment = { pembayaran_id: string; penyewaan_id: string | null; reservasi_id: string | null };
type CopyReturn = { pengembalian_id: string; penyewaan_id: string | null };
type CopyExtension = { perpanjangan_sewa_id: string; penyewaan_id: string | null };
type CopyConsequence = { evaluasi_konsekuensi_id: string; penyewaan_id: string | null };

const LEGACY_EVENT_NAMES: Record<string, string> = {
  rental_created: "rental.created",
  rental_picked_up: "rental.picked_up",
  rental_return_due: "rental.return_due",
  rental_tolerance_started: "rental.tolerance_started",
  rental_tolerance_warning_2h: "rental.tolerance_warning_2h",
  rental_tolerance_warning_1h: "rental.tolerance_warning_1h",
  rental_tolerance_warning_30m: "rental.tolerance_warning_30m",
  rental_tolerance_expired: "rental.tolerance_expired",
  rental_late_fee_applied: "rental.late_fee_applied",
  rental_late_fee_accrual_reminder: "rental.late_fee_accrual_reminder",
  rental_extension_requested: "rental.extension_requested",
  rental_extension_approved: "rental.extension_approved",
  rental_extension_rejected: "rental.extension_rejected",
  rental_consequence_review_required: "rental.consequence_review_required",
  rental_consequence_reviewed: "rental.consequence_reviewed",
  payment_recorded: "payment.recorded",
  payment_completed: "payment.completed",
  return_completed: "return.completed",
  reservation_confirmed: "reservation.confirmed",
};

function notificationEvent(item: NotificationRecord): string {
  const source = (item.sumber_type ?? "").trim().toLowerCase();
  if (LEGACY_EVENT_NAMES[source]) return LEGACY_EVENT_NAMES[source];
  if (source.includes(".")) return source;
  if (source !== "penyewaan") return source;

  const content = (item.judul + " " + item.pesan).toLowerCase();
  if (/pembayaran.*lunas|tagihan sewa telah terpenuhi|total pembayaran sewa mencapai/.test(content)) return "payment.completed";
  if (/pembayaran/.test(content)) return "payment.recorded";
  if (/toleransi/.test(content) && /30 menit/.test(content)) return "rental.tolerance_warning_30m";
  if (/toleransi/.test(content) && /1 jam/.test(content)) return "rental.tolerance_warning_1h";
  if (/toleransi/.test(content) && /2 jam/.test(content)) return "rental.tolerance_warning_2h";
  if (/melewati batas toleransi|toleransi habis/.test(content)) return "rental.tolerance_expired";
  if (/masa toleransi|toleransi dimulai/.test(content)) return "rental.tolerance_started";
  if (/denda/.test(content) && /estimasi|berjalan|bertambah/.test(content)) return "rental.late_fee_accrual_reminder";
  if (/denda/.test(content)) return "rental.late_fee_applied";
  if (/serah-terima|barang.*diambil/.test(content)) return "rental.picked_up";
  if (/pengembalian|waktu kembali|jadwal kembali/.test(content)) return "rental.return_due";
  return "rental.created";
}

async function readCopyRows<T>(query: PromiseLike<unknown>): Promise<T[]> {
  try {
    const response = await query as { data?: unknown; error?: unknown };
    return response.error || !Array.isArray(response.data) ? [] : response.data as T[];
  } catch {
    // Copy formatting is best-effort and must not prevent the inbox from loading.
    return [];
  }
}

function uniqueCopyIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function humanizeNotificationCopies(
  items: NotificationRecord[],
  usahaId: string,
): Promise<NotificationRecord[]> {
  const eventById = new Map(items.map((item) => [item.pemberitahuan_id, notificationEvent(item)]));
  const idsFor = (types: string[]) => uniqueCopyIds(
    items.filter((item) => types.includes(eventById.get(item.pemberitahuan_id) ?? ""))
      .map((item) => item.sumber_id),
  );

  const returnIds = idsFor(["return.completed"]);
  const extensionIds = idsFor(["rental.extension_requested", "rental.extension_approved", "rental.extension_rejected"]);
  const consequenceIds = idsFor(["rental.consequence_review_required", "rental.consequence_reviewed"]);
  const paymentIds = idsFor(["payment.recorded", "payment.completed"]);
  const reservationIds = idsFor(["reservation.confirmed"]);

  const [returns, extensions, consequences, payments] = await Promise.all([
    returnIds.length ? readCopyRows<CopyReturn>(
      supabase.from("pengembalian").select("pengembalian_id,penyewaan_id").eq("usaha_id", usahaId).in("pengembalian_id", returnIds),
    ) : Promise.resolve([] as CopyReturn[]),
    extensionIds.length ? readCopyRows<CopyExtension>(
      supabase.from("perpanjangan_sewa").select("perpanjangan_sewa_id,penyewaan_id").eq("usaha_id", usahaId).in("perpanjangan_sewa_id", extensionIds),
    ) : Promise.resolve([] as CopyExtension[]),
    consequenceIds.length ? readCopyRows<CopyConsequence>(
      supabase.from("evaluasi_konsekuensi_penyewaan").select("evaluasi_konsekuensi_id,penyewaan_id").eq("usaha_id", usahaId).in("evaluasi_konsekuensi_id", consequenceIds),
    ) : Promise.resolve([] as CopyConsequence[]),
    paymentIds.length ? readCopyRows<CopyPayment>(
      supabase.from("pembayaran").select("pembayaran_id,penyewaan_id,reservasi_id").eq("usaha_id", usahaId).in("pembayaran_id", paymentIds),
    ) : Promise.resolve([] as CopyPayment[]),
  ]);

  const rentalIds = uniqueCopyIds([
    ...idsFor([
      "rental.created", "rental.picked_up", "rental.return_due", "rental.tolerance_started",
      "rental.tolerance_warning_2h", "rental.tolerance_warning_1h", "rental.tolerance_warning_30m",
      "rental.tolerance_expired", "rental.late_fee_applied", "rental.late_fee_accrual_reminder",
    ]),
    ...returns.map((row) => row.penyewaan_id),
    ...extensions.map((row) => row.penyewaan_id),
    ...consequences.map((row) => row.penyewaan_id),
    ...payments.map((row) => row.penyewaan_id),
  ]);
  const reservationIdsAll = uniqueCopyIds([
    ...reservationIds,
    ...payments.map((row) => row.reservasi_id),
  ]);

  const [rentals, reservations] = await Promise.all([
    rentalIds.length ? readCopyRows<CopyRental>(
      supabase.from("penyewaan").select("penyewaan_id,penyewa_id,nomor_penyewaan").eq("usaha_id", usahaId).in("penyewaan_id", rentalIds),
    ) : Promise.resolve([] as CopyRental[]),
    reservationIdsAll.length ? readCopyRows<CopyReservation>(
      supabase.from("reservasi").select("reservasi_id,penyewa_id").eq("usaha_id", usahaId).in("reservasi_id", reservationIdsAll),
    ) : Promise.resolve([] as CopyReservation[]),
  ]);

  const renterIds = uniqueCopyIds([
    ...rentals.map((row) => row.penyewa_id),
    ...reservations.map((row) => row.penyewa_id),
  ]);
  const renters = renterIds.length ? await readCopyRows<CopyRenter>(
    supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).in("penyewa_id", renterIds),
  ) : [];

  const rentalById = new Map(rentals.map((row) => [row.penyewaan_id, row]));
  const reservationById = new Map(reservations.map((row) => [row.reservasi_id, row]));
  const renterById = new Map(renters.map((row) => [row.penyewa_id, row.nama_lengkap?.trim()]));
  const returnById = new Map(returns.map((row) => [row.pengembalian_id, row]));
  const extensionById = new Map(extensions.map((row) => [row.perpanjangan_sewa_id, row]));
  const consequenceById = new Map(consequences.map((row) => [row.evaluasi_konsekuensi_id, row]));
  const paymentById = new Map(payments.map((row) => [row.pembayaran_id, row]));

  const renterForRental = (id: string | null | undefined): string | null => {
    const rental = id ? rentalById.get(id) : undefined;
    if (!rental) return null;
    return renterById.get(rental.penyewa_id ?? "") || "penyewa";
  };
  const renterForReservation = (id: string | null | undefined): string | null => {
    const reservation = id ? reservationById.get(id) : undefined;
    if (!reservation) return null;
    return renterById.get(reservation.penyewa_id ?? "") || "penyewa";
  };

  return items.map((item) => {
    const event = eventById.get(item.pemberitahuan_id) ?? "";
    const sourceId = item.sumber_id ?? "";
    let name: string | null = null;

    if (event === "reservation.confirmed") name = renterForReservation(sourceId);
    else if (event === "return.completed") name = renterForRental(returnById.get(sourceId)?.penyewaan_id);
    else if (event.startsWith("rental.extension_")) name = renterForRental(extensionById.get(sourceId)?.penyewaan_id);
    else if (event.startsWith("rental.consequence_review_")) name = renterForRental(consequenceById.get(sourceId)?.penyewaan_id);
    else if (event === "payment.recorded" || event === "payment.completed") {
      const payment = paymentById.get(sourceId);
      name = renterForRental(payment?.penyewaan_id) ?? renterForReservation(payment?.reservasi_id);
      name ??= renterForRental(sourceId); // Handle legacy notices whose source points to a rental.
    } else if (event.startsWith("rental.")) name = renterForRental(sourceId);

    if (!name) return item;

    const amounts = [...item.pesan.matchAll(/Rp\s*([\d.]+)/gi)].map((match) => match[1]);
    const hoursMatch = item.pesan.match(/(\d+)\s*jam\s*(?:tagihan|keterlambatan)/i);
    const amountText = amounts[0];
    let judul = item.judul;
    let pesan = item.pesan;

    switch (event) {
      case "reservation.confirmed":
        judul = "Reservasi dikonfirmasi";
        pesan = "Reservasi atas nama " + name + " dikonfirmasi. Periksa jadwal dan kesiapan barang.";
        break;
      case "rental.created":
        judul = "Penyewaan baru";
        pesan = "Penyewaan atas nama " + name + " baru dibuat. Periksa pembayaran dan jadwal serah-terima.";
        break;
      case "rental.picked_up":
        judul = "Serah-terima dicatat";
        pesan = "Barang sewaan atas nama " + name + " sudah diserahkan.";
        break;
      case "rental.return_due":
        judul = "Jadwal pengembalian tiba";
        pesan = "Penyewaan atas nama " + name + " jatuh tempo sekarang. Pastikan barang kembali.";
        break;
      case "rental.tolerance_started":
        judul = "Masa toleransi dimulai";
        pesan = "Penyewaan atas nama " + name + " belum kembali sesuai jadwal. Masa toleransi dimulai.";
        break;
      case "rental.tolerance_warning_2h":
        judul = "Sisa toleransi: 2 jam";
        pesan = "Penyewaan atas nama " + name + ": sisa toleransi 2 jam. Tindak lanjuti pengembalian.";
        break;
      case "rental.tolerance_warning_1h":
        judul = "Sisa toleransi: 1 jam";
        pesan = "Penyewaan atas nama " + name + ": sisa toleransi 1 jam. Tindak lanjuti pengembalian.";
        break;
      case "rental.tolerance_warning_30m":
        judul = "Sisa toleransi: 30 menit";
        pesan = "Penyewaan atas nama " + name + ": sisa toleransi 30 menit. Segera tindak lanjuti.";
        break;
      case "rental.tolerance_expired":
        judul = "Toleransi pengembalian habis";
        pesan = "Penyewaan atas nama " + name + " melewati masa toleransi." +
          (amountText ? " Estimasi denda Rp " + amountText + (hoursMatch ? " (" + hoursMatch[1] + " jam keterlambatan)." : ".") : "") +
          " Nilai akhir diverifikasi saat pengembalian selesai.";
        break;
      case "rental.late_fee_applied":
        judul = "Denda keterlambatan";
        pesan = "Penyewaan atas nama " + name + " terkena denda keterlambatan. Periksa nominal sebelum menagih.";
        break;
      case "rental.late_fee_accrual_reminder":
        judul = "Denda terus bertambah";
        pesan = "Penyewaan atas nama " + name + " belum kembali setelah masa toleransi. Estimasi denda saat ini" +
          (amountText ? " Rp " + amountText : "") +
          (hoursMatch ? " untuk " + hoursMatch[1] + " jam keterlambatan." : ".") +
          " Nilai akhir diverifikasi saat pengembalian.";
        break;
      case "rental.consequence_review_required":
        judul = "Tinjau biaya tambahan";
        pesan = "Ada biaya tambahan" + (amountText ? " (calon nominal Rp " + amountText + ")" : "") +
          " untuk penyewaan atas nama " + name + ". Tinjau sebelum ditagihkan.";
        break;
      case "rental.consequence_reviewed": {
        const rejected = /ditolak|rejected/i.test(item.judul + " " + item.pesan);
        judul = rejected ? "Biaya tambahan ditolak" : "Biaya tambahan disetujui";
        pesan = rejected
          ? "Biaya tambahan untuk penyewaan atas nama " + name + " ditolak dan tidak dibebankan."
          : "Biaya tambahan untuk penyewaan atas nama " + name + " disetujui" +
            (amountText ? " sebesar Rp " + amountText : "") + ".";
        break;
      }
      case "rental.extension_requested":
        judul = "Permintaan perpanjangan";
        pesan = "Penyewaan atas nama " + name + " meminta tambahan waktu sewa. Tinjau permintaan ini.";
        break;
      case "rental.extension_approved":
        judul = "Perpanjangan disetujui";
        pesan = "Perpanjangan untuk penyewaan atas nama " + name + " disetujui. Jadwal kembali sudah diperbarui.";
        break;
      case "rental.extension_rejected":
        judul = "Perpanjangan ditolak";
        pesan = "Perpanjangan untuk penyewaan atas nama " + name + " ditolak. Jadwal kembali tidak berubah.";
        break;
      case "payment.recorded":
        judul = "Pembayaran dicatat";
        pesan = "Pembayaran" + (amountText ? " Rp " + amountText : "") + " dari " + name + " berhasil dicatat.";
        break;
      case "payment.completed":
        judul = "Sewa lunas";
        pesan = "Tagihan sewa atas nama " + name + " lunas" +
          (amounts[0] ? ": Rp " + amounts[0] : "") +
          (amounts[1] ? " dari total tagihan Rp " + amounts[1] : "") + ".";
        break;
      case "return.completed":
        judul = "Pengembalian selesai";
        pesan = "Barang sewaan atas nama " + name + " sudah dikembalikan. Periksa kondisi unit.";
        break;
      default:
        break;
    }

    return { ...item, judul, pesan };
  });
}
