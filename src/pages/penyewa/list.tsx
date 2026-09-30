import { Plus, RefreshCw, Search, SlidersHorizontal, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import {
  listRenters,
  maskPhone,
  RenterReadError,
  type RenterListItem,
} from "@/features/penyewa/service";
import {
  CurrentUsahaCard,
  RenterResultCard,
  RenterAvatar,
  IdentityVerificationBadge,
} from "@/components/penyewa/renter-ui";
import { renterStatusLabel, renterStatusVariant } from "@/features/penyewa/ui";
import { paths } from "@/routes/paths";

type StatusFilter = "all" | "active" | "inactive";

function readErrorTitle(error: RenterReadError | null) {
  if (!error) return "Data belum dapat ditampilkan";
  if (error.status === 401) return "Sesi admin perlu diperbarui";
  if (error.status === 403) return "Akses ditolak";
  if (error.status === 409) return "Usaha aktif belum dapat ditentukan";
  return "Data belum dapat ditampilkan";
}

function readErrorDescription(error: RenterReadError | null) {
  if (!error) return "Data penyewa belum dapat dimuat.";
  if (error.status === 401) return "Sesi admin tidak valid atau telah berakhir. Muat ulang setelah masuk kembali.";
  if (error.status === 403) return "Anda tidak memiliki akses ke data penyewa pada Usaha ini.";
  if (error.status === 409) return error.message;
  return error.message || "Data penyewa gagal dimuat.";
}

export function RenterList() {
  const {
    status: usahaStatus,
    current: usaha,
    error: usahaError,
    refresh: refreshUsaha,
  } = useCurrentUsaha();

  const [renters, setRenters] = useState<RenterListItem[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RenterReadError | null>(null);

  const load = useCallback(
    async (context: NonNullable<typeof usaha>, term: string, filter: StatusFilter) => {
      setLoading(true);
      setError(null);
      setRenters([]);

      try {
        const rows = await listRenters(context, term, filter);
        setRenters(rows);
      } catch (cause) {
        setRenters([]);
        setError(
          cause instanceof RenterReadError
            ? cause
            : new RenterReadError(
                cause instanceof Error ? cause.message : "Data penyewa gagal dimuat.",
                500,
              ),
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (usahaStatus !== "ready" || !usaha) {
      setRenters([]);
      setLoading(false);
      setError(null);
      return;
    }

    void load(usaha, submittedSearch, statusFilter);
  }, [load, statusFilter, submittedSearch, usaha, usaha?.usahaId, usahaStatus]);

  const activeError = usahaStatus === "error" ? usahaError : error;
  const isSearching = Boolean(submittedSearch.trim());
  const showEmpty =
    usahaStatus === "ready" &&
    !loading &&
    !activeError &&
    renters.length === 0 &&
    !isSearching;
  const showNoResult =
    usahaStatus === "ready" &&
    !loading &&
    !activeError &&
    renters.length === 0 &&
    isSearching;

  const submitSearch = () => setSubmittedSearch(search.trim());

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-8 sm:space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Penyewa</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Daftar Penyewa</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Cari identitas penyewa dengan cepat untuk kebutuhan operasional Usaha aktif.
          </p>
        </div>
        <Button asChild className="w-full rounded-xl sm:w-auto">
          <Link to={paths.penyewa + "/create"}><Plus />Tambah Penyewa</Link>
        </Button>
      </header>

      <CurrentUsahaCard />

      <Card className="border-border/80 shadow-sm">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <label className="sr-only" htmlFor="renter-search">
              Cari berdasarkan nama atau nomor telepon
            </label>
            <Input
              id="renter-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
              placeholder="Cari nama atau nomor telepon…"
              className="h-11 rounded-xl bg-background pl-9 pr-12"
              autoComplete="off"
              disabled={usahaStatus !== "ready" || loading}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
              aria-label="Cari penyewa"
              onClick={submitSearch}
              disabled={usahaStatus !== "ready" || loading}
            >
              <Search className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5" aria-label="Filter status penyewa">
            {([
              ["all", "Semua"],
              ["active", "Aktif"],
              ["inactive", "Non-aktif"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                className="min-h-9 shrink-0 rounded-full px-4 text-xs"
                onClick={() => {
                  setStatusFilter(value);
                  setSubmittedSearch(search.trim());
                }}
                disabled={usahaStatus !== "ready" || loading}
              >
                {label}
              </Button>
            ))}
            <SlidersHorizontal className="ml-auto hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
          </div>
        </CardContent>
      </Card>

      {activeError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{readErrorTitle(activeError)}</AlertTitle>
          <AlertDescription className="gap-3">
            <p>{readErrorDescription(activeError)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void (usahaStatus === "error"
                  ? refreshUsaha()
                  : usaha && load(usaha, submittedSearch, statusFilter))
              }
            >
              <RefreshCw />Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {usahaStatus === "loading" && (
        <section className="space-y-3" aria-label="Memuat Usaha aktif" aria-busy="true">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        </section>
      )}

      {usahaStatus === "ready" && loading && !activeError && (
        <section className="space-y-2" role="status" aria-live="polite" aria-busy="true">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </section>
      )}

      {showEmpty && (
        <Card>
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Users className="size-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">Belum ada penyewa</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Belum ada data penyewa pada Usaha ini.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {showNoResult && (
        <Card>
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Search className="size-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">Penyewa tidak ditemukan</h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Tidak ada penyewa yang cocok dengan pencarian “{submittedSearch}”.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setSearch("");
                setSubmittedSearch("");
              }}
            >
              Hapus pencarian
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !activeError && renters.length > 0 && (
        <section aria-label="Hasil Penyewa" className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-sm text-muted-foreground">
              {renters.length} hasil · {renterStatusLabel(statusFilter === "all" ? "all" : statusFilter)}
            </p>
            <p className="text-xs text-muted-foreground">Scope: {usaha?.usahaNama}</p>
          </div>

          <div className="grid gap-2 md:hidden">
            {renters.map((renter) => (
              <RenterResultCard
                key={renter.penyewa_id}
                name={renter.nama_lengkap}
                phone={maskPhone(renter.nomor_telepon)}
                status={renter.status}
                verificationStatus={renter.status_verifikasi}
                updatedAt={renter.updated_at}
                href={paths.penyewa + "/" + renter.penyewa_id}
              />
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/35 text-left">
                  <tr>
                    <th className="px-5 py-3 font-medium">Penyewa</th>
                    <th className="px-5 py-3 font-medium">Kontak</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Identitas</th>
                    <th className="px-5 py-3 font-medium">Diperbarui</th>
                    <th className="px-5 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {renters.map((renter) => (
                    <tr key={renter.penyewa_id} className="border-b last:border-0">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <RenterAvatar name={renter.nama_lengkap} size="sm" />
                          <Link
                            className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            to={paths.penyewa + "/" + renter.penyewa_id}
                          >
                            {renter.nama_lengkap}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{maskPhone(renter.nomor_telepon)}</td>
                      <td className="px-5 py-4">
                        <Badge
                          variant={renterStatusVariant(renter.status)}
                          className="rounded-full px-2.5 py-1 text-[11px]"
                        >
                          {renterStatusLabel(renter.status)}
                        </Badge>
                      </td>
                      <td className="px-5 py-4">
                        <IdentityVerificationBadge status={renter.status_verifikasi} compact />
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(renter.updated_at))}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button asChild variant="ghost" size="sm" className="rounded-lg">
                          <Link to={paths.penyewa + "/" + renter.penyewa_id}>Lihat detail</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
