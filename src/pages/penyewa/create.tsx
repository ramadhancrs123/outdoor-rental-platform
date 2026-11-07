import { createClientId } from "@/lib/client-id";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, RefreshCw, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import {
  createRenter,
  findDuplicateRenterCandidates,
  reconcileRenterCreation,
  RenterUnknownOutcomeError,
  type RenterListItem,
} from "@/features/penyewa/service";
import { DuplicateRenterNotice, CurrentUsahaCard } from "@/components/penyewa/renter-ui";
import { maskPhone } from "@/features/penyewa/service";
import { paths } from "@/routes/paths";

function createIdempotencyKey() {
  return "create-renter-" + createClientId();
}

type RenterCreateProps = {
  presentation?: "page" | "dialog";
  onCreated?: (renterId: string) => void;
  onCancel?: () => void;
};

export function RenterCreate({ presentation = "page", onCreated, onCancel }: RenterCreateProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    status: usahaStatus,
    current: usaha,
    error: usahaError,
    refresh: refreshUsaha,
  } = useCurrentUsaha();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [candidates, setCandidates] = useState<RenterListItem[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});

  const origin = searchParams.get("from");
  const isQuickAdd = origin === "walk-in";
  const returnTo = isQuickAdd
    ? paths.penyewaanWalkIn
    : paths.penyewa;

  const navigateToRenter = (renterId: string) => {
    if (onCreated) {
      onCreated(renterId);
      return;
    }
    if (isQuickAdd) {
      navigate(returnTo + "?renter_id=" + encodeURIComponent(renterId));
      return;
    }
    navigate(paths.penyewa + "/" + renterId);
  };

  useEffect(() => {
    setDuplicateDismissed(false);
  }, [name, phone]);

  useEffect(() => {
    if (!usaha || (name.trim().length < 3 && phone.replace(/\D/g, "").length < 6)) {
      setCandidates([]);
      setDuplicateLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDuplicateLoading(true);
      void findDuplicateRenterCandidates(usaha, name, phone)
        .then((rows) => {
          if (!cancelled) setCandidates(rows);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        })
        .finally(() => {
          if (!cancelled) setDuplicateLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [name, phone, usaha]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!usaha) throw new Error("Usaha aktif belum tersedia.");

      const nextErrors: typeof fieldErrors = {};
      if (!name.trim()) nextErrors.name = "Nama lengkap wajib diisi.";
      if (!phone.trim()) nextErrors.phone = "Nomor telepon wajib diisi.";
      setFieldErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        throw new Error("Periksa data wajib sebelum mendaftarkan penyewa.");
      }

      return createRenter(
        usaha.usahaId,
        {
          nama_lengkap: name,
          nomor_telepon: phone,
          alamat: address || null,
          catatan_internal: note || null,
        },
        { idempotencyKey },
      );
    },
    onSuccess: (result) => navigateToRenter(result.penyewa_id),
    onError: (error) => {
      if (!(error instanceof RenterUnknownOutcomeError)) {
        setIdempotencyKey(createIdempotencyKey());
      }
    },
  });

  const reconciliation = useMutation({
    mutationFn: () => {
      if (!usaha) throw new Error("Usaha aktif belum tersedia.");
      return reconcileRenterCreation(usaha.usahaId, idempotencyKey);
    },
    onSuccess: (result) => {
      if (result.state === "committed" && result.response) {
        navigateToRenter(result.response.penyewa_id);
        return;
      }

      if (result.state === "not_found") {
        setIdempotencyKey(createIdempotencyKey());
      }
    },
  });

  const reviewReady = Boolean(name.trim() && phone.trim());
  const duplicateVisible = candidates.length > 0 && !duplicateDismissed;
  const submitDisabled = !reviewReady || mutation.isPending || reconciliation.isPending;

  const reviewItems = useMemo(
    () => [
      ["Nama", name.trim() || "Belum diisi"],
      ["Nomor telepon", phone.trim() ? maskPhone(phone.trim()) : "Belum diisi"],
      ["Alamat", address.trim() || "Tidak diisi"],
      ["Catatan internal", note.trim() || "Tidak diisi"],
    ],
    [address, name, note, phone],
  );

  if (usahaStatus === "loading") {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 text-sm text-muted-foreground">
        Memuat konteks Usaha…
      </div>
    );
  }

  if (usahaStatus === "error" || !usaha) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.penyewa}>
            <ArrowLeft />Kembali ke Penyewa
          </Link>
        </Button>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Konteks Usaha tidak tersedia</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{usahaError?.message ?? "Tidak dapat menentukan Usaha aktif."}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshUsaha()}>
              <RefreshCw />Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const unknownOutcome = mutation.error instanceof RenterUnknownOutcomeError;

  if (presentation === "dialog") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="renter-name">Nama lengkap <span aria-hidden="true">*</span></label>
            <Input
              id="renter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "renter-name-error" : undefined}
              placeholder="Nama pelanggan"
              className="h-10 rounded-xl"
            />
            {fieldErrors.name ? <p id="renter-name-error" className="text-xs text-destructive">{fieldErrors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="renter-phone">Nomor telepon <span aria-hidden="true">*</span></label>
            <Input
              id="renter-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? "renter-phone-error" : undefined}
              placeholder="08xxxxxxxxxx"
              className="h-10 rounded-xl"
            />
            {fieldErrors.phone ? <p id="renter-phone-error" className="text-xs text-destructive">{fieldErrors.phone}</p> : null}
          </div>
        </div>

        <details className="group rounded-xl border border-border/80 bg-muted/15">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium">
            Informasi tambahan <span className="text-xs font-normal text-muted-foreground">Alamat & catatan</span>
          </summary>
          <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="renter-address">Alamat</label>
              <Textarea id="renter-address" value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" placeholder="Alamat pelanggan" rows={3} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="renter-note">Catatan internal</label>
              <Textarea id="renter-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Catatan untuk tim operasional" rows={3} />
            </div>
          </div>
        </details>

        {duplicateLoading ? (
          <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground" role="status" aria-live="polite">Memeriksa kecocokan pelanggan…</div>
        ) : duplicateVisible ? (
          <DuplicateRenterNotice
            candidates={candidates.map((candidate) => ({
              penyewa_id: candidate.penyewa_id,
              nama_lengkap: candidate.nama_lengkap,
              nomor_telepon: maskPhone(candidate.nomor_telepon),
              status: candidate.status,
            }))}
            onUse={navigateToRenter}
            onKeep={() => setDuplicateDismissed(true)}
          />
        ) : null}

        {mutation.error && !unknownOutcome ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Pendaftaran belum berhasil</AlertTitle>
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {unknownOutcome ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Hasil pendaftaran belum diketahui</AlertTitle>
            <AlertDescription className="gap-2">
              <p>Periksa status pendaftaran sebelum mencoba kembali.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => reconciliation.mutate()} disabled={reconciliation.isPending}>
                {reconciliation.isPending ? "Memeriksa…" : "Periksa status"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {reconciliation.error ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Status belum dapat diperiksa</AlertTitle>
            <AlertDescription>{reconciliation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel} disabled={mutation.isPending || reconciliation.isPending}>
            Batal
          </Button>
          <Button
            className="rounded-xl"
            disabled={submitDisabled || unknownOutcome}
            onClick={() => {
              setFieldErrors({});
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Mendaftarkan…" : "Daftarkan penyewa"}
            {!mutation.isPending ? <Check /> : null}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-8 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={returnTo}>
            <ArrowLeft />{isQuickAdd ? "Kembali ke penyewaan" : "Kembali ke Penyewa"}
          </Link>
        </Button>
        {isQuickAdd ? (
          <Badge variant="secondary" className="rounded-full">
            Tambah dari alur penyewaan
          </Badge>
        ) : null}
      </div>

      <CurrentUsahaCard />

      <section className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">Penyewa</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Daftarkan Penyewa</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Buat identitas penyewa yang dapat digunakan kembali oleh alur operasional lain. Pendaftaran ini tidak membuat penyewaan atau pembayaran.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-5" />
            Data utama
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="renter-name">
              Nama lengkap <span aria-hidden="true">*</span>
            </label>
            <Input
              id="renter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "renter-name-error" : undefined}
              placeholder="Contoh: Ahmad Fauzi"
              className="h-11 rounded-xl"
            />
            {fieldErrors.name ? (
              <p id="renter-name-error" className="text-xs text-destructive">
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="renter-phone">
              Nomor telepon <span aria-hidden="true">*</span>
            </label>
            <Input
              id="renter-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? "renter-phone-error" : "renter-phone-help"}
              placeholder="Contoh: 08123456789"
              className="h-11 rounded-xl"
            />
            <p id="renter-phone-help" className="text-xs leading-5 text-muted-foreground">
              Nomor akan dinormalisasi di sistem untuk pencarian dan pencegahan duplikasi saat perubahan profil.
            </p>
            {fieldErrors.phone ? (
              <p id="renter-phone-error" className="text-xs text-destructive">
                {fieldErrors.phone}
              </p>
            ) : null}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="renter-address">Alamat</label>
              <Textarea
                id="renter-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="street-address"
                placeholder="Alamat domisili atau alamat kontak"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="renter-note">Catatan internal</label>
              <Textarea
                id="renter-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Catatan operasional yang memang perlu disimpan"
                rows={4}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Hindari menyimpan data sensitif yang tidak dibutuhkan oleh operasi rental.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {duplicateLoading ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-4 text-sm text-muted-foreground" role="status" aria-live="polite">
            Memeriksa penyewa serupa…
          </CardContent>
        </Card>
      ) : duplicateVisible ? (
        <DuplicateRenterNotice
          candidates={candidates.map((candidate) => ({
            penyewa_id: candidate.penyewa_id,
            nama_lengkap: candidate.nama_lengkap,
            nomor_telepon: maskPhone(candidate.nomor_telepon),
            status: candidate.status,
          }))}
          onUse={navigateToRenter}
          onKeep={() => setDuplicateDismissed(true)}
        />
      ) : null}

      <Card className="border-border/80 bg-muted/20 shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Tinjau sebelum mendaftarkan</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Pastikan identitas dasar benar. Verifikasi KTP/SIM dan foto dilakukan setelah penyewa terdaftar.
              </p>
            </div>
            <Badge variant="outline" className="rounded-full">
              {reviewReady ? "Siap ditinjau" : "Belum lengkap"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {reviewItems.map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-background p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-medium">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {mutation.error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{unknownOutcome ? "Hasil belum dapat dipastikan" : "Penyewa belum terdaftar"}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{mutation.error.message}</p>
            {unknownOutcome ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => reconciliation.mutate()}
                disabled={reconciliation.isPending}
              >
                {reconciliation.isPending ? "Memeriksa…" : "Periksa status"}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {reconciliation.error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Status belum dapat diperiksa</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{reconciliation.error instanceof Error ? reconciliation.error.message : "Pemeriksaan gagal."}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => reconciliation.mutate()}>
              Coba periksa lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="pt-2">
        <div className="mx-auto max-w-3xl">
          <Button
            className="h-12 w-full rounded-xl"
            disabled={submitDisabled || unknownOutcome}
            onClick={() => {
              setFieldErrors({});
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Mendaftarkan…" : "Daftarkan Penyewa"}
            {!mutation.isPending ? <Check /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}


export function RenterCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (renterId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden rounded-2xl p-0 sm:max-w-xl">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle>Tambah penyewa</DialogTitle>
          <DialogDescription>Masukkan nama dan nomor telepon pelanggan.</DialogDescription>
        </DialogHeader>
        {open ? (
          <div className="max-h-[calc(90dvh-104px)] overflow-y-auto px-5 pb-5">
            <RenterCreate
              presentation="dialog"
              onCancel={() => onOpenChange(false)}
              onCreated={onCreated}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
