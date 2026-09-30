import { BadgeCheck, Building2, ChevronRight, LockKeyhole, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import { getInitials, renterStatusLabel, renterStatusVariant } from "@/features/penyewa/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentUsaha } from "@/app/current-usaha-context";

export function RenterAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "size-16" : size === "sm" ? "size-10" : "size-12";

  return (
    <Avatar className={sizeClass}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function CurrentUsahaCard({ className = "" }: { className?: string }) {
  const { status, current, available, selectUsaha } = useCurrentUsaha();
  const busy = status === "loading";
  const canSwitch = available.length > 1;

  return (
    <Card className={`border-border/80 shadow-sm ${className}`}>
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Building2 className="size-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">Usaha Aktif</p>
          <p className="truncate text-sm font-semibold">
            {busy ? "Mengganti Usaha…" : current?.usahaNama ?? "Pilih Usaha"}
          </p>
        </div>

        {canSwitch ? (
          <Select
            value={current?.usahaId ?? ""}
            onValueChange={(value) => void selectUsaha(value)}
            disabled={busy}
          >
            <SelectTrigger
              className="h-9 w-auto min-w-[84px] rounded-lg px-3 text-xs font-semibold"
              aria-label="Ganti Usaha"
            >
              <SelectValue placeholder="Ubah" />
            </SelectTrigger>
            <SelectContent align="end">
              {available.map((usaha) => (
                <SelectItem key={usaha.usahaId} value={usaha.usahaId}>
                  {usaha.usahaNama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary" className="shrink-0 rounded-lg px-2.5 py-1 text-[11px]">
            Aktif
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}


export function IdentityVerificationBadge({
  status,
  compact = false,
}: {
  status?: string | null;
  compact?: boolean;
}) {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized === "verified") {
    return (
      <Badge variant="default" className="gap-1 rounded-full px-2.5 py-1 text-[11px]">
        <BadgeCheck className="size-3.5" aria-hidden="true" />
        {compact ? "Terverifikasi" : "Identitas terverifikasi"}
      </Badge>
    );
  }
  if (normalized === "rejected") {
    return (
      <Badge variant="destructive" className="rounded-full px-2.5 py-1 text-[11px]">
        Perlu diperbaiki
      </Badge>
    );
  }
  if (normalized === "pending") {
    return (
      <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
        Menunggu verifikasi
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
      Belum diverifikasi
    </Badge>
  );
}

export function DuplicateRenterNotice({
  candidates,
  onUse,
  onKeep,
}: {
  candidates: Array<{
    penyewa_id: string;
    nama_lengkap: string;
    nomor_telepon: string;
    status: string;
  }>;
  onUse: (id: string) => void;
  onKeep: () => void;
}) {
  if (!candidates.length) return null;
  return (
    <Card className="border-amber-300/70 bg-amber-50/60 shadow-none dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="font-semibold">Penyewa serupa ditemukan</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Periksa kandidat sebelum mendaftarkan penyewa baru. Nomor telepon yang sama bukan bukti identitas.
          </p>
        </div>
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <div
              key={candidate.penyewa_id}
              className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{candidate.nama_lengkap}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {candidate.nomor_telepon}
                </p>
              </div>
              <Badge variant={renterStatusVariant(candidate.status)} className="w-fit rounded-full text-[11px]">
                {renterStatusLabel(candidate.status)}
              </Badge>
              <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => onUse(candidate.penyewa_id)}>
                Gunakan Penyewa Ini
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" className="rounded-lg" onClick={onKeep}>
          Tetap Buat Penyewa Baru
        </Button>
      </CardContent>
    </Card>
  );
}

export function RenterResultCard({
  name,
  phone,
  status,
  verificationStatus,
  updatedAt,
  href,
}: {
  name: string;
  phone: string;
  status: string;
  verificationStatus?: string | null;
  updatedAt?: string;
  href: string;
}) {
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(updatedAt))
    : null;

  return (
    <Link
      to={href}
      aria-label={"Lihat detail penyewa " + name}
      className="group block rounded-2xl border border-border/80 bg-card p-3 shadow-sm outline-none transition hover:-translate-y-px hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <RenterAvatar name={name} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{phone}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <IdentityVerificationBadge status={verificationStatus} compact />
            {updatedLabel ? (
              <span className="text-[11px] text-muted-foreground">Diperbarui {updatedLabel}</span>
            ) : null}
          </div>
        </div>

        <Badge
          variant={renterStatusVariant(status)}
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px]"
        >
          {renterStatusLabel(status)}
        </Badge>

        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

export function PrivacyCard() {
  return (
    <Card className="border-border/80 bg-muted/20 shadow-none">
      <CardContent className="flex gap-3 p-4">
        <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
          <LockKeyhole className="size-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold">Privasi & akses</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Data penyewa hanya dapat dilihat dalam konteks Usaha aktif yang terotorisasi. Data ini bukan profil publik.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function CapabilityPlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex min-h-32 flex-col justify-center gap-2 p-4">
        <Users className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">{title}</p>
        <p className="text-sm leading-5 text-muted-foreground">
          {description ?? "Belum tersedia pada read-side contract yang terverifikasi."}
        </p>
      </CardContent>
    </Card>
  );
}
