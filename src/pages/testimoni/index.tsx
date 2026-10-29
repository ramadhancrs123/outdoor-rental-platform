import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, CheckCircle2, Clock3, MessageSquareQuote, Plus, RefreshCw,
  Send, ShieldCheck, Star, ThumbsDown, Undo2,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { supabase } from "@/app/providers/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type TestimoniStatus = "draft" | "pending" | "published" | "rejected" | "archived";
type TestimoniRow = {
  testimoni_id: string;
  usaha_id: string;
  nama_tampilan: string;
  konteks: string | null;
  rating: number;
  isi: string;
  sumber: "pengunjung" | "admin";
  status: TestimoniStatus;
  created_by_admin_id: string | null;
  verified_by_admin_id: string | null;
  verified_at: string | null;
  published_at: string | null;
  moderation_note: string | null;
  created_at: string;
  updated_at: string;
};

const FILTERS: Array<{ value: "all" | TestimoniStatus; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "pending", label: "Menunggu verifikasi" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Terbit" },
  { value: "rejected", label: "Ditolak" },
  { value: "archived", label: "Arsip" },
];

function statusLabel(status: TestimoniStatus) {
  return ({
    draft: "Draft",
    pending: "Menunggu verifikasi",
    published: "Terbit",
    rejected: "Ditolak",
    archived: "Diarsipkan",
  })[status];
}

function statusClass(status: TestimoniStatus) {
  if (status === "published") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "pending") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "rejected") return "border-destructive/25 bg-destructive/10 text-destructive";
  return "border-border bg-muted/60 text-muted-foreground";
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Operasi testimoni gagal. Silakan coba kembali.";
}

type MutationInput =
  | { action: "publish" | "reject" | "draft" | "pending" | "archive"; row: TestimoniRow; note: string }
  | { action: "create"; nama: string; konteks: string; rating: number; isi: string };

export function TestimoniList() {
  const { status: tenantStatus, current, error: tenantError } = useCurrentUsaha();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | TestimoniStatus>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [konteks, setKonteks] = useState("");
  const [rating, setRating] = useState("5");
  const [isi, setIsi] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const testimonials = useQuery({
    queryKey: ["admin", "testimoni", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: async () => {
      if (!current?.usahaId) throw new Error("Usaha aktif belum tersedia.");
      const query = supabase.from("testimoni").select("*").eq("usaha_id", current.usahaId).order("created_at", { ascending: false }).limit(150);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TestimoniRow[];
    },
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async (input: MutationInput) => {
      if (!current?.usahaId) throw new Error("Pilih Usaha aktif terlebih dahulu.");

      if (input.action === "create") {
        const cleanName = input.nama.trim();
        const cleanContext = input.konteks.trim();
        const cleanStory = input.isi.trim();
        if (cleanName.length < 2 || cleanName.length > 80) throw new Error("Nama harus terdiri dari 2–80 karakter.");
        if (cleanContext.length > 120) throw new Error("Konteks maksimal 120 karakter.");
        if (cleanStory.length < 12 || cleanStory.length > 1200) throw new Error("Cerita harus terdiri dari 12–1.200 karakter.");
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("Pilih rating dari 1 sampai 5.");

        const { error } = await supabase.from("testimoni").insert({
          usaha_id: current.usahaId,
          nama_tampilan: cleanName,
          konteks: cleanContext || null,
          rating: input.rating,
          isi: cleanStory,
          sumber: "admin",
          status: "draft",
          created_by_admin_id: current.akunAdminId,
        });
        if (error) throw error;
        return;
      }

      const now = new Date().toISOString();
      const note = input.note.trim();
      let update: Record<string, unknown>;

      switch (input.action) {
        case "publish":
          update = { status: "published", verified_by_admin_id: current.akunAdminId, verified_at: now, published_at: now, moderation_note: note || null, updated_at: now };
          break;
        case "reject":
          update = { status: "rejected", verified_by_admin_id: current.akunAdminId, verified_at: now, published_at: null, moderation_note: note || "Tidak disetujui oleh admin.", updated_at: now };
          break;
        case "pending":
          update = { status: "pending", published_at: null, moderation_note: note || null, updated_at: now };
          break;
        case "draft":
          update = { status: "draft", published_at: null, moderation_note: note || null, updated_at: now };
          break;
        default:
          update = { status: "archived", published_at: null, moderation_note: note || null, updated_at: now };
      }

      const { error } = await supabase.from("testimoni").update(update).eq("testimoni_id", input.row.testimoni_id).eq("usaha_id", current.usahaId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "testimoni", current?.usahaId] });
    },
    onError: (cause: unknown) => setFormError(readError(cause)),
  });

  const allRows = useMemo(() => testimonials.data ?? [], [testimonials.data]);
  const visibleRows = useMemo(
    () => filter === "all" ? allRows : allRows.filter((row) => row.status === filter),
    [filter, allRows],
  );
  const counts = useMemo(() => ({
    total: allRows.length,
    pending: allRows.filter((row) => row.status === "pending").length,
    published: allRows.filter((row) => row.status === "published").length,
    draft: allRows.filter((row) => row.status === "draft").length,
  }), [allRows]);

  if (tenantStatus === "loading") {
    return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>;
  }

  if (tenantStatus === "error" || !current) {
    return <Alert variant="destructive"><AlertTitle>Testimoni belum dapat dibuka</AlertTitle><AlertDescription>{tenantError?.message ?? "Pilih Usaha aktif sebelum mengelola testimoni."}</AlertDescription></Alert>;
  }

  const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await mutation.mutateAsync({ action: "create", nama, konteks, rating: Number(rating), isi });
      setNama("");
      setKonteks("");
      setRating("5");
      setIsi("");
      setCreateOpen(false);
    } catch {
      // The mutation error is surfaced in the shared status panel below.
    }
  };

  const act = async (action: Exclude<MutationInput, { action: "create" }>['action'], row: TestimoniRow) => {
    setFormError(null);
    try {
      await mutation.mutateAsync({ action, row, note: notes[row.testimoni_id] ?? "" });
    } catch {
      // The mutation error is surfaced in the shared status panel below.
    }
  };

  return (
    <div className="space-y-5 pb-24 lg:space-y-6 lg:pb-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs text-muted-foreground">Website publik · {current.usahaNama}</p>
          <h1 className="mt-1 text-[26px] font-bold tracking-tight">Testimoni pelanggan</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Tinjau cerita pengunjung, tulis testimoni dari admin sebagai draft, dan publikasikan hanya setelah diverifikasi.</p>
        </div>
        <Button onClick={() => setCreateOpen((value) => !value)} className="h-10 rounded-xl"><Plus className="size-4" /> Tambah dari admin</Button>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-4"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><MessageSquareQuote className="size-5" /></span><div><p className="text-xs text-muted-foreground">Data pada filter</p><p className="text-xl font-bold">{counts.total}</p></div></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-4"><span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700"><Clock3 className="size-5" /></span><div><p className="text-xs text-muted-foreground">Menunggu</p><p className="text-xl font-bold">{counts.pending}</p></div></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-4"><span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><CheckCircle2 className="size-5" /></span><div><p className="text-xs text-muted-foreground">Sudah terbit</p><p className="text-xl font-bold">{counts.published}</p></div></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-4"><span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><ShieldCheck className="size-5" /></span><div><p className="text-xs text-muted-foreground">Draft</p><p className="text-xl font-bold">{counts.draft}</p></div></CardContent></Card>
      </div>

      {createOpen && (
        <Card className="rounded-2xl border-primary/20">
          <CardContent className="p-4 sm:p-6">
            <div className="mb-5"><h2 className="font-semibold">Testimoni dari admin</h2><p className="mt-1 text-sm text-muted-foreground">Data baru disimpan sebagai draft. Admin tetap harus melakukan verifikasi sebelum publikasi.</p></div>
            <form onSubmit={submitCreate} className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">Nama tampilan<Input required minLength={2} maxLength={80} value={nama} onChange={(event) => setNama(event.target.value)} placeholder="Nama pelanggan" /></label>
              <label className="grid gap-1.5 text-sm font-medium">Konteks (opsional)<Input maxLength={120} value={konteks} onChange={(event) => setKonteks(event.target.value)} placeholder="Mis. Camping akhir pekan" /></label>
              <label className="grid max-w-xs gap-1.5 text-sm font-medium">Rating<select value={rating} onChange={(event) => setRating(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="5">5 — Sangat puas</option><option value="4">4 — Puas</option><option value="3">3 — Cukup</option><option value="2">2 — Kurang puas</option><option value="1">1 — Tidak puas</option></select></label>
              <label className="grid gap-1.5 text-sm font-medium md:col-span-2">Isi testimoni<Textarea required minLength={12} maxLength={1200} rows={4} value={isi} onChange={(event) => setIsi(event.target.value)} placeholder="Tulis cerita pelanggan yang sudah dikonfirmasi kebenarannya." /></label>
              <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={mutation.isPending}><Plus className="size-4" /> {mutation.isPending ? "Menyimpan…" : "Simpan sebagai draft"}</Button><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter status testimoni">
        {FILTERS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} onClick={() => setFilter(item.value)} className={"shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors " + (filter === item.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted")}>{item.label}</button>)}
        <Button type="button" size="sm" variant="ghost" className="ml-auto shrink-0" onClick={() => void testimonials.refetch()}><RefreshCw className="size-3.5" /> Muat ulang</Button>
      </div>

      {formError && <Alert variant="destructive"><AlertTitle>Perubahan belum tersimpan</AlertTitle><AlertDescription>{formError}</AlertDescription></Alert>}

      {testimonials.isPending ? (
        <div className="grid gap-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-2xl" />)}</div>
      ) : testimonials.error ? (
        <Alert variant="destructive"><AlertTitle>Data testimoni gagal dimuat</AlertTitle><AlertDescription className="space-y-3"><p>{readError(testimonials.error)}</p><Button variant="outline" size="sm" onClick={() => void testimonials.refetch()}><RefreshCw className="size-4" />Coba lagi</Button></AlertDescription></Alert>
      ) : (testimonials.data ?? []).length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><MessageSquareQuote className="size-8 text-muted-foreground" /><h2 className="mt-4 font-semibold">Belum ada testimoni pada filter ini</h2><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Cerita yang dikirim pengunjung akan terlihat di antrean setelah disimpan sebagai pending, bukan di halaman publik.</p></CardContent></Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleRows.map((row) => (
            <Card key={row.testimoni_id} className="rounded-2xl">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><MessageSquareQuote className="size-5" /></span>
                    <div className="min-w-0"><h2 className="truncate font-semibold">{row.nama_tampilan}</h2><p className="mt-0.5 text-xs text-muted-foreground">{row.konteks || "Tanpa konteks"} · {dateLabel(row.created_at)}</p><div className="mt-2 flex items-center gap-0.5 text-amber-600" aria-label={"Rating " + row.rating + " dari 5"}>{Array.from({ length: 5 }).map((_, index) => <Star key={index} className={"size-3.5 " + (index < row.rating ? "fill-current" : "opacity-25")} />)}</div></div>
                  </div>
                  <Badge variant="outline" className={statusClass(row.status)}>{statusLabel(row.status)}</Badge>
                </div>
                <p className="mt-4 whitespace-pre-line break-words text-sm leading-6">{row.isi}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="rounded-full border border-border px-2 py-1">Sumber: {row.sumber === "pengunjung" ? "Pengunjung" : "Admin"}</span>{row.published_at && <span>Terbit {dateLabel(row.published_at)}</span>}</div>
                <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted-foreground">Catatan moderasi (opsional)<Input value={notes[row.testimoni_id] ?? row.moderation_note ?? ""} onChange={(event) => setNotes((old) => ({ ...old, [row.testimoni_id]: event.target.value }))} maxLength={500} placeholder="Alasan penolakan atau catatan internal" className="h-9 text-sm font-normal text-foreground" /></label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {row.status === "pending" && <>
                    <Button size="sm" disabled={mutation.isPending} onClick={() => void act("publish", row)}><CheckCircle2 className="size-3.5" /> Verifikasi & terbitkan</Button>
                    <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act("reject", row)}><ThumbsDown className="size-3.5" /> Tolak</Button>
                  </>}
                  {row.status === "draft" && <>
                    <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act("pending", row)}><Send className="size-3.5" /> Ajukan verifikasi</Button>
                    <Button size="sm" disabled={mutation.isPending} onClick={() => void act("publish", row)}><CheckCircle2 className="size-3.5" /> Verifikasi & terbitkan</Button>
                  </>}
                  {row.status === "rejected" && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act("draft", row)}><Undo2 className="size-3.5" /> Kembalikan ke draft</Button>}
                  {row.status === "published" && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act("archive", row)}><Archive className="size-3.5" /> Sembunyikan dari publik</Button>}
                  {row.status === "archived" && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void act("draft", row)}><Undo2 className="size-3.5" /> Kembalikan ke draft</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">Keamanan: pengunjung hanya dapat membuat ulasan berstatus pending. Perubahan status publik membutuhkan sesi admin aktif pada Usaha yang sesuai; data draft, pending, rejected, dan archived tidak muncul di landing page.</p>
    </div>
  );
}
