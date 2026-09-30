import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  createSupplier,
  getPemasokContext,
  getSupplierForEdit,
  getProcurementCapabilities,
  reconcileProcurementMutation,
  updateSupplier,
  type CreateSupplierInput,
} from "@/features/pemasok";
import { ProcurementCommandState, ProcurementSteps } from "@/components/pemasok/procurement-ui";
import { paths } from "@/routes/paths";

type Mode = "form" | "review" | "processing" | "success" | "error" | "unknown" | "stale";

const emptyForm: CreateSupplierInput = { nama: "", nomorTelepon: "", email: "", alamat: "", catatan: "" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Perubahan pemasok gagal.";
}

export function SupplierCreate() {
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const commandRef = useRef<string | null>(null);
  const [mode, setMode] = useState<Mode>("form");
  const [form, setForm] = useState<CreateSupplierInput>(emptyForm);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [savedSupplierId, setSavedSupplierId] = useState<string | null>(editing ? id ?? null : null);

  const context = useQuery({ queryKey: ["pemasok", "context"], queryFn: getPemasokContext, staleTime: 60_000 });
  const existing = useQuery({
    queryKey: ["pemasok", "edit", context.data?.usahaId, id],
    queryFn: () => getSupplierForEdit(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 30_000,
    retry: false,
  });
  const capabilities = getProcurementCapabilities();

  useEffect(() => {
    if (!existing.data || expectedUpdatedAt !== "") return;
    setExpectedUpdatedAt(existing.data.updated_at);
    setForm({
      nama: existing.data.nama,
      nomorTelepon: existing.data.nomor_telepon ?? "",
      email: existing.data.email ?? "",
      alamat: existing.data.alamat ?? "",
      catatan: existing.data.catatan ?? "",
    });
  }, [existing.data, expectedUpdatedAt]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Konteks Usaha belum siap.");
      commandRef.current ??= crypto.randomUUID();
      if (editing) {
        return updateSupplier(
          context.data.usahaId,
          id!,
          { ...form, expectedUpdatedAt },
          { idempotencyKey: commandRef.current, requestId: crypto.randomUUID() },
        );
      }
      return createSupplier(context.data.usahaId, form, { idempotencyKey: commandRef.current, requestId: crypto.randomUUID() });
    },
    onMutate: () => { setFeedback(""); setMode("processing"); },
    onSuccess: async (result) => {
      setSavedSupplierId(result.pemasok_id);
      setExpectedUpdatedAt(result.updated_at);
      commandRef.current = null;
      setMode("success");
      await queryClient.invalidateQueries({ queryKey: ["pemasok"] });
    },
    onError: (error) => {
      const message = errorMessage(error);
      setFeedback(message);
      if (message.startsWith("UNKNOWN_OUTCOME:")) setMode("unknown");
      else if (message.startsWith("STALE_DATA:")) setMode("stale");
      else setMode("error");
    },
  });

  const reconcile = async () => {
    if (!context.data?.usahaId || !commandRef.current) return;
    try {
      const result = await reconcileProcurementMutation(
        context.data.usahaId,
        editing ? "update_supplier" : "create_supplier",
        commandRef.current,
      );
      if (result.state === "committed" && result.response && "pemasok_id" in result.response) {
        setSavedSupplierId(result.response.pemasok_id);
        commandRef.current = null;
        setFeedback("");
        setMode("success");
      } else if (result.state === "not_found") {
        setFeedback("Command tidak ditemukan. State terbaru dapat diperiksa sebelum mencoba kembali.");
        commandRef.current = null;
        if (editing) {
          await existing.refetch();
          setMode("form");
        } else {
          setMode("form");
        }
      } else {
        setFeedback("Command masih belum dapat dipastikan. Jangan kirim command kedua.");
      }
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  };

  const reloadLatest = async () => {
    if (!editing) {
      setMode("form");
      setFeedback("Silakan periksa kembali data sebelum menyimpan.");
      return;
    }
    await existing.refetch();
    setExpectedUpdatedAt("");
    setFeedback("");
    setMode("form");
  };

  if (context.isPending || (editing && existing.isPending)) {
    return <div className="space-y-4"><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-72 animate-pulse rounded-2xl bg-muted" /></div>;
  }

  if (context.error || !context.data) {
    return <Alert variant="destructive"><AlertTitle>Pemasok belum siap</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>;
  }

  if (editing && (existing.error || !existing.data)) {
    return <Alert variant="destructive"><AlertTitle>Data pemasok tidak dapat dibuka</AlertTitle><AlertDescription>{errorMessage(existing.error ?? new Error("Pemasok tidak ditemukan."))}</AlertDescription></Alert>;
  }

  if (mode === "processing") {
    return <ProcurementCommandState state="processing" title={editing ? "Menyimpan perubahan..." : "Membuat pemasok..."} message="Perubahan sedang diproses. Jangan kirim ulang selama proses berlangsung." />;
  }

  if (mode === "success") {
    return (
      <div className="mx-auto w-full max-w-md space-y-2 pb-10">
        <ProcurementCommandState
          state="success"
          title={editing ? "Pemasok Berhasil Diperbarui" : "Pemasok Berhasil Dibuat"}
          message={editing ? "Perubahan pemasok telah tersimpan." : "Pemasok baru telah ditambahkan ke dalam data usaha Anda."}
        />
        <Card className="rounded-2xl">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid size-11 place-items-center rounded-full bg-muted"><Building2 className="size-5 text-muted-foreground" /></div>
            <div className="min-w-0"><p className="font-semibold">{form.nama}</p><p className="text-xs text-muted-foreground">Pemasok · {context.data.usahaNama}</p></div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2 pt-2">
          <Button className="h-12 rounded-xl" onClick={() => savedSupplierId ? navigate(paths.pemasok + "/" + savedSupplierId) : navigate(paths.pemasok)}>Lihat Detail Pemasok <ArrowRight /></Button>
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate(paths.pemasok)}>Kembali ke Daftar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-24 lg:pb-10">
      <header className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 rounded-xl" aria-label="Kembali ke pemasok"><Link to={paths.pemasok}><ArrowLeft /></Link></Button>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Pemasok</p>
          <h1 className="text-[22px] font-bold tracking-tight">{editing ? "Edit Pemasok" : "Tambah Pemasok"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{context.data.usahaNama}</p>
        </div>
      </header>

      <ProcurementSteps current={mode === "review" ? 2 : 1} labels={["Isi", "Tinjau", "Simpan"]} />

      {mode === "unknown" || mode === "stale" || mode === "error" ? (
        <ProcurementCommandState
          state={mode}
          message={feedback}
          onRetry={mode === "stale" ? reloadLatest : () => setMode("form")}
          onReconcile={mode === "unknown" ? reconcile : undefined}
        />
      ) : null}

      {mode === "review" ? (
        <>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Tinjau Data Pemasok</CardTitle><p className="text-sm text-muted-foreground">Pastikan data berikut sudah benar.</p></CardHeader>
            <CardContent className="space-y-3">
              <ReviewRow label="Nama Pemasok" value={form.nama} />
              <ReviewRow label="Telepon" value={form.nomorTelepon || "-"} />
              <ReviewRow label="Email" value={form.email || "-"} />
              <ReviewRow label="Alamat" value={form.alamat || "-"} />
              <ReviewRow label="Catatan" value={form.catatan || "-"} />
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" className="h-12 flex-1 rounded-xl" onClick={() => setMode("form")}>Kembali</Button>
            <Button className="h-12 flex-1 rounded-xl" disabled={!capabilities.mutation || !form.nama.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} {editing ? "Simpan Perubahan" : "Simpan Pemasok"}
            </Button>
          </div>
        </>
      ) : (
        <Card className="rounded-2xl shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="size-5" />Informasi Pemasok</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Nama Pemasok" id="supplier-name" value={form.nama} required onChange={(value) => setForm((current) => ({ ...current, nama: value }))} placeholder="Contoh: PT Outdoor Sejahtera" />
            <Field label="Telepon" id="supplier-phone" value={form.nomorTelepon ?? ""} onChange={(value) => setForm((current) => ({ ...current, nomorTelepon: value }))} placeholder="Contoh: 0812 3456 7890" />
            <Field label="Email" id="supplier-email" value={form.email ?? ""} onChange={(value) => setForm((current) => ({ ...current, email: value }))} placeholder="Contoh: info@pemasok.co.id" type="email" />
            <label className="grid gap-2 text-sm font-medium" htmlFor="supplier-address">Alamat<textarea id="supplier-address" className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm" value={form.alamat ?? ""} onChange={(event) => setForm((current) => ({ ...current, alamat: event.target.value }))} placeholder="Alamat lengkap pemasok..." /></label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="supplier-note">Catatan (Opsional)<Textarea id="supplier-note" rows={4} className="rounded-xl" value={form.catatan ?? ""} onChange={(event) => setForm((current) => ({ ...current, catatan: event.target.value }))} placeholder="Catatan tambahan..." /></label>
          </CardContent>
        </Card>
      )}

      {mode === "form" ? (
        <div className="sticky bottom-2 z-20 rounded-2xl border bg-background/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <Button className="h-12 w-full rounded-xl" disabled={!form.nama.trim()} onClick={() => setMode("review")}>Lanjut ke Tinjau <ArrowRight /></Button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 rounded-xl border p-3 sm:grid-cols-[140px_1fr]"><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium break-words">{value}</p></div>;
}

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={id}>
      <span>{label} {required ? <span className="text-destructive">*</span> : null}</span>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 rounded-xl" />
    </label>
  );
}
