import {
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCheck2,
  FilePlus2,
  LockKeyhole,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import {
  addRenterIdentityEvidence,
  addRenterPhoto,
  getRenter,
  getRenterIdentityEvidence,
  getRenterPhoto,
  listRenterIdentityEvidence,
  maskPhone,
  reconcileRenterMutation,
  removeRenterPrivateFile,
  RenterReadError,
  RenterUnknownOutcomeError,
  updateRenterProfile,
  uploadRenterPrivateFile,
  verifyRenterIdentityEvidence,
  type RenterDetail,
  type RenterIdentityEvidence,
  type RenterPhoto,
} from "@/features/penyewa/service";
import {
  CurrentUsahaCard,
  IdentityVerificationBadge,
  PrivacyCard,
  RenterAvatar,
} from "@/components/penyewa/renter-ui";
import { renterStatusLabel, renterStatusVariant } from "@/features/penyewa/ui";
import { listRentalsByRenter } from "@/features/penyewaan";
import { formatRentalDateTime, formatRentalMoney, semanticRentalLabel } from "@/features/penyewaan";
import { paths } from "@/routes/paths";

const PRIVATE_IDENTITY_BUCKET = "rental-private-identity";
const PRIVATE_RENTER_BUCKET = "rental-private-renter";

function readErrorTitle(error: RenterReadError | null) {
  if (!error) return "Detail tidak tersedia";
  if (error.status === 401) return "Sesi admin perlu diperbarui";
  if (error.status === 403) return "Akses ditolak";
  if (error.status === 404) return "Penyewa tidak ditemukan";
  if (error.status === 409) return "Data perlu dimuat ulang";
  return "Detail tidak tersedia";
}

function readErrorDescription(error: RenterReadError | null) {
  if (!error) return "Penyewa tidak ditemukan atau tidak tersedia dalam Usaha aktif.";
  if (error.status === 401) return "Sesi admin tidak valid atau telah berakhir. Muat ulang setelah masuk kembali.";
  if (error.status === 403) return "Anda tidak memiliki akses ke data penyewa pada Usaha ini.";
  if (error.status === 404) return "Penyewa tidak ditemukan atau tidak tersedia dalam Usaha aktif.";
  return error.message || "Detail penyewa gagal dimuat.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Belum tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fileExtension(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  return "jpg";
}

function copyPhone(phone: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(phone);
  }
}

function OperationalRentalCard({
  rental,
}: {
  rental: Awaited<ReturnType<typeof listRentalsByRenter>>[number];
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Rental Aktif</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{semanticRentalLabel(rental.status)}</p>
          </div>
          <Badge variant="default" className="rounded-full">
            Aktif
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Nomor penyewaan</p>
          <p className="mt-1 font-semibold">{rental.nomor_penyewaan}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Nilai</p>
          <p className="mt-1 font-semibold">
            {formatRentalMoney(rental.total_amount, rental.currency_code)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Mulai</p>
          <p className="mt-1 text-sm font-medium">{formatRentalDateTime(rental.jadwal_mulai)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Jadwal kembali</p>
          <p className="mt-1 text-sm font-medium">{formatRentalDateTime(rental.jadwal_kembali)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceRow({
  evidence,
  onOpen,
}: {
  evidence: RenterIdentityEvidence;
  onOpen: () => void;
}) {
  const status = evidence.statusVerifikasi?.toLowerCase();
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <FileCheck2 className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{evidence.jenisIdentitas || "Identitas"}</p>
            <IdentityVerificationBadge status={evidence.statusVerifikasi} compact />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Nomor: {evidence.nomorIdentitasMasked || "Tidak ditampilkan"}
          </p>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <span>Ditambahkan {formatDate(evidence.createdAt)}</span>
            <span>
              {status === "verified"
                ? "Diverifikasi " + formatDate(evidence.verifiedAt)
                : "Belum terverifikasi"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {evidence.storageBucket && evidence.storagePath ? (
            <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={onOpen}>
              Lihat bukti
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function RenterShow() {
  const { id } = useParams<{ id: string }>();
  const {
    status: usahaStatus,
    current: usaha,
    error: usahaError,
    refresh: refreshUsaha,
  } = useCurrentUsaha();

  const [renter, setRenter] = useState<RenterDetail | null>(null);
  const [photo, setPhoto] = useState<RenterPhoto | null>(null);
  const [evidenceRows, setEvidenceRows] = useState<RenterIdentityEvidence[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<RenterIdentityEvidence | null>(null);
  const [activeTab, setActiveTab] = useState("ringkasan");
  const [loading, setLoading] = useState(false);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [error, setError] = useState<RenterReadError | null>(null);
  const [identityError, setIdentityError] = useState<RenterReadError | null>(null);
  const [rentals, setRentals] = useState<Awaited<ReturnType<typeof listRentalsByRenter>>>([]);
  const [rentalsLoading, setRentalsLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editError, setEditError] = useState<Error | null>(null);
  const [profileUnknown, setProfileUnknown] = useState<RenterUnknownOutcomeError | null>(null);
  const [editPending, setEditPending] = useState(false);

  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceType, setEvidenceType] = useState<"KTP" | "SIM">("KTP");
  const [evidenceNumber, setEvidenceNumber] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePending, setEvidencePending] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<RenterIdentityEvidence | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyPending, setVerifyPending] = useState(false);

  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPending, setPhotoPending] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const loadBase = useCallback(
    async (context: NonNullable<typeof usaha>, penyewaId: string) => {
      setLoading(true);
      setError(null);
      setRenter(null);
      setRentals([]);
      try {
        const currentRenter = await getRenter(context, penyewaId);
        setRenter(currentRenter);

        setRentalsLoading(true);
        try {
          setRentals(await listRentalsByRenter(context.usahaId, penyewaId));
        } catch {
          setRentals([]);
        } finally {
          setRentalsLoading(false);
        }
      } catch (cause) {
        setRenter(null);
        setRentals([]);
        setError(
          cause instanceof RenterReadError
            ? cause
            : new RenterReadError(cause instanceof Error ? cause.message : "Detail penyewa gagal dimuat.", 500),
        );
        setRentalsLoading(false);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadIdentitySurface = useCallback(
    async (context: NonNullable<typeof usaha>, penyewaId: string) => {
      setIdentityLoading(true);
      setIdentityError(null);
      try {
        const [rows, currentPhoto] = await Promise.all([
          listRenterIdentityEvidence(context, penyewaId),
          getRenterPhoto(context, penyewaId),
        ]);
        setEvidenceRows(rows);
        setPhoto(currentPhoto);
      } catch (cause) {
        setIdentityError(
          cause instanceof RenterReadError
            ? cause
            : new RenterReadError(cause instanceof Error ? cause.message : "Identitas gagal dimuat.", 500),
        );
      } finally {
        setIdentityLoading(false);
      }
    },
    [],
  );

  const reloadIdentity = useCallback(async () => {
    if (!usaha || !renter) return;
    await loadIdentitySurface(usaha, renter.penyewa_id);
  }, [loadIdentitySurface, renter, usaha]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(new RenterReadError("Identitas penyewa pada tautan tidak valid.", 404));
      return;
    }
    if (usahaStatus !== "ready" || !usaha) {
      setRenter(null);
      setRentals([]);
      setEvidenceRows([]);
      setPhoto(null);
      setError(null);
      return;
    }
    void loadBase(usaha, id);
  }, [id, loadBase, usaha, usahaStatus]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const activeError = usahaStatus === "error" ? usahaError : error;
  const activeRentals = useMemo(() => rentals.filter((rental) => rental.status === "active"), [rentals]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === "identitas" && usaha && renter) {
      void loadIdentitySurface(usaha, renter.penyewa_id);
    }
  };

  const refreshBase = () => {
    if (usaha && id) void loadBase(usaha, id);
  };

  const openEdit = () => {
    if (!renter) return;
    setEditName(renter.nama_lengkap);
    setEditPhone(renter.nomor_telepon);
    setEditAddress(renter.alamat ?? "");
    setEditNote(renter.catatan_internal ?? "");
    setEditError(null);
    setProfileUnknown(null);
    setEditOpen(true);
  };

  const saveProfile = async () => {
    if (!usaha || !renter) return;
    if (!editName.trim() || !editPhone.trim()) {
      setEditError(new Error("Nama lengkap dan nomor telepon wajib diisi."));
      return;
    }
    setEditPending(true);
    setEditError(null);
    setProfileUnknown(null);

    try {
      const updated = await updateRenterProfile(usaha.usahaId, {
        penyewa_id: renter.penyewa_id,
        expected_updated_at: renter.updated_at,
        nama_lengkap: editName,
        nomor_telepon: editPhone,
        alamat: editAddress || null,
        catatan_internal: editNote || null,
      });
      setRenter((current) => (current ? { ...current, ...updated } : current));
      setEditOpen(false);
    } catch (cause) {
      if (cause instanceof RenterUnknownOutcomeError) {
        setProfileUnknown(cause);
        return;
      }
      setEditError(cause instanceof Error ? cause : new Error("Perubahan profil gagal."));
    } finally {
      setEditPending(false);
    }
  };

  const reconcileProfile = async () => {
    if (!usaha || !profileUnknown) return;
    try {
      const result = await reconcileRenterMutation<RenterDetail>(usaha.usahaId, profileUnknown.idempotencyKey);
      if (result.state === "committed") {
        setEditOpen(false);
        setProfileUnknown(null);
        refreshBase();
      }
    } catch (cause) {
      setEditError(cause instanceof Error ? cause : new Error("Status perubahan belum dapat diperiksa."));
    }
  };

  const saveEvidence = async () => {
    if (!usaha || !renter || !evidenceFile) return;
    setEvidencePending(true);
    let uploadedPath = "";
    try {
      const evidenceId = crypto.randomUUID();
      uploadedPath =
        usaha.usahaId +
        "/" +
        renter.penyewa_id +
        "/identity/" +
        evidenceId +
        "/" +
        crypto.randomUUID() +
        "." +
        fileExtension(evidenceFile);

      await uploadRenterPrivateFile(PRIVATE_IDENTITY_BUCKET, uploadedPath, evidenceFile);
      await addRenterIdentityEvidence(usaha.usahaId, {
        penyewa_id: renter.penyewa_id,
        bukti_identitas_id: evidenceId,
        jenis_identitas: evidenceType,
        nomor_identitas_masked: evidenceNumber || null,
        storage_bucket: PRIVATE_IDENTITY_BUCKET,
        storage_path: uploadedPath,
        catatan: evidenceNote || null,
      });

      setEvidenceOpen(false);
      setEvidenceFile(null);
      setEvidenceNumber("");
      setEvidenceNote("");
      await reloadIdentity();
    } catch (cause) {
      if (!(cause instanceof RenterUnknownOutcomeError) && uploadedPath) {
        try {
          await removeRenterPrivateFile(PRIVATE_IDENTITY_BUCKET, uploadedPath);
        } catch {
          // Preserve the mutation error. Cleanup failure is secondary.
        }
      }
      setIdentityError(
        cause instanceof RenterReadError
          ? cause
          : new RenterReadError(cause instanceof Error ? cause.message : "Bukti identitas gagal disimpan.", 500),
      );
    } finally {
      setEvidencePending(false);
    }
  };

  const openEvidenceViewer = async (evidence: RenterIdentityEvidence) => {
    if (!usaha || !renter || !evidence.buktiIdentitasId) return;
    try {
      const selected = await getRenterIdentityEvidence(usaha, renter.penyewa_id, evidence.buktiIdentitasId);
      setSelectedEvidence(selected);
    } catch (cause) {
      setIdentityError(
        cause instanceof RenterReadError
          ? cause
          : new RenterReadError(cause instanceof Error ? cause.message : "Bukti identitas gagal dibuka.", 500),
      );
    }
  };

  const openVerify = (evidence: RenterIdentityEvidence) => {
    setVerifyTarget(evidence);
    setVerifyNote("");
    setVerifyOpen(true);
  };

  const saveVerification = async (status: "verified" | "rejected") => {
    if (!usaha || !renter || !verifyTarget?.buktiIdentitasId || !verifyTarget.updatedAt) return;
    setVerifyPending(true);
    try {
      await verifyRenterIdentityEvidence(usaha.usahaId, {
        penyewa_id: renter.penyewa_id,
        bukti_identitas_id: verifyTarget.buktiIdentitasId,
        status_verifikasi: status,
        catatan: verifyNote || null,
        expected_updated_at: verifyTarget.updatedAt,
      });
      setVerifyOpen(false);
      setVerifyTarget(null);
      setVerifyNote("");
      await reloadIdentity();
    } catch (cause) {
      setIdentityError(
        cause instanceof RenterReadError
          ? cause
          : new RenterReadError(cause instanceof Error ? cause.message : "Verifikasi identitas gagal.", 500),
      );
    } finally {
      setVerifyPending(false);
    }
  };

  const savePhoto = async () => {
    if (!usaha || !renter || !photoFile) return;
    setPhotoPending(true);
    let uploadedPath = "";
    try {
      const photoId = crypto.randomUUID();
      uploadedPath =
        usaha.usahaId +
        "/" +
        renter.penyewa_id +
        "/photo/" +
        photoId +
        "/" +
        crypto.randomUUID() +
        "." +
        fileExtension(photoFile);

      await uploadRenterPrivateFile(PRIVATE_RENTER_BUCKET, uploadedPath, photoFile);
      await addRenterPhoto(usaha.usahaId, {
        penyewa_id: renter.penyewa_id,
        foto_penyewa_id: photoId,
        konteks: "operational_verification",
        storage_bucket: PRIVATE_RENTER_BUCKET,
        storage_path: uploadedPath,
      });

      setPhotoOpen(false);
      setPhotoFile(null);
      await reloadIdentity();
    } catch (cause) {
      if (!(cause instanceof RenterUnknownOutcomeError) && uploadedPath) {
        try {
          await removeRenterPrivateFile(PRIVATE_RENTER_BUCKET, uploadedPath);
        } catch {
          // Preserve the mutation error. Cleanup failure is secondary.
        }
      }
      setIdentityError(
        cause instanceof RenterReadError
          ? cause
          : new RenterReadError(cause instanceof Error ? cause.message : "Foto penyewa gagal disimpan.", 500),
      );
    } finally {
      setPhotoPending(false);
    }
  };

  if (usahaStatus === "loading" && !activeError) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4" role="status" aria-busy="true">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (loading && !activeError) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4" role="status" aria-busy="true">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (activeError || !renter || !usaha) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.penyewa}>
            <ArrowLeft />Kembali ke Penyewa
          </Link>
        </Button>
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
                  : usaha && id && loadBase(usaha, id))
              }
            >
              <RefreshCw />Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-8 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="-ml-3 rounded-xl">
          <Link to={paths.penyewa}>
            <ArrowLeft />Kembali
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="hidden rounded-full sm:inline-flex">
            Scope: {usaha.usahaNama}
          </Badge>
          <Button type="button" variant="outline" className="rounded-xl" onClick={openEdit}>
            <Pencil />Edit Profil Penyewa
          </Button>
          <Button asChild className="rounded-xl">
            <Link to={paths.penyewaanWalkIn + "?renter_id=" + renter.penyewa_id}>
              Buat Penyewaan
            </Link>
          </Button>
        </div>
      </div>

      <CurrentUsahaCard />

      <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <RenterAvatar name={renter.nama_lengkap} src={photo?.photoUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{renter.nama_lengkap}</h1>
              <Badge variant={renterStatusVariant(renter.status)} className="rounded-full">
                {renterStatusLabel(renter.status)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Penyewa · {usaha.usahaNama}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Terakhir diperbarui {formatDate(renter.updated_at)}</span>
              {photo?.photoUrl ? (
                <span className="inline-flex items-center gap-1">
                  <Camera className="size-3.5" aria-hidden="true" />
                  Foto privat tersedia
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CameraOff className="size-3.5" aria-hidden="true" />
                  Foto belum tersedia
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="w-max min-w-full justify-start rounded-xl bg-muted/60 p-1 sm:w-auto sm:min-w-0">
            <TabsTrigger value="ringkasan" className="rounded-lg px-4">Ringkasan</TabsTrigger>
            <TabsTrigger value="identitas" className="rounded-lg px-4">Identitas</TabsTrigger>
            <TabsTrigger value="kontak" className="rounded-lg px-4">Kontak</TabsTrigger>
            <TabsTrigger value="operasional" className="rounded-lg px-4">Operasional</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="ringkasan" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Ringkasan Identitas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Nama lengkap</p>
                  <p className="mt-1 font-semibold">{renter.nama_lengkap}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-1 font-semibold">{renterStatusLabel(renter.status)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nomor telepon</p>
                  <p className="mt-1 font-semibold">{maskPhone(renter.nomor_telepon)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Alamat</p>
                  <p className="mt-1 font-semibold">{renter.alamat || "Belum tersedia"}</p>
                </div>
              </CardContent>
            </Card>
            <PrivacyCard />
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Riwayat Penyewaan</CardTitle>
              <p className="text-sm text-muted-foreground">
                Fakta transaksi berasal dari source owner Penyewaan.
              </p>
            </CardHeader>
            <CardContent>
              {rentalsLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl" />
                </div>
              ) : rentals.length ? (
                <div className="space-y-2">
                  {rentals.slice(0, 6).map((rental) => (
                    <div key={rental.penyewaan_id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{rental.nomor_penyewaan}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRentalDateTime(rental.jadwal_mulai)} · {semanticRentalLabel(rental.status)}
                        </p>
                      </div>
                      <div className="text-sm font-semibold">{formatRentalMoney(rental.total_amount, rental.currency_code)}</div>
                      <Badge variant="outline" className="w-fit rounded-full">
                        {semanticRentalLabel(rental.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <p className="font-semibold">Belum ada riwayat penyewaan</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Penyewa ini belum memiliki transaksi rental yang tersedia pada read-side.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identitas" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">Bukti Identitas</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload dan verifikasi adalah dua langkah berbeda. Bukti lama tetap disimpan sebagai histori.
                  </p>
                </div>
                <Button type="button" className="rounded-xl" onClick={() => setEvidenceOpen(true)}>
                  <FilePlus2 />Tambah KTP/SIM
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {identityLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                  </div>
                ) : identityError ? (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>Identitas tidak dapat dimuat</AlertTitle>
                    <AlertDescription className="gap-3">
                      <p>{identityError.message}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => void reloadIdentity()}>
                        <RefreshCw />Coba lagi
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : evidenceRows.length ? (
                  evidenceRows.map((evidence) => (
                    <EvidenceRow
                      key={evidence.buktiIdentitasId}
                      evidence={evidence}
                      onOpen={() => void openEvidenceViewer(evidence)}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-center">
                    <ShieldCheck className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-3 font-semibold">Belum ada bukti identitas</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Tambahkan KTP atau SIM ketika identitas siap diperiksa oleh admin.
                    </p>
                    <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={() => setEvidenceOpen(true)}>
                      Tambah bukti identitas
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Foto Penyewa</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Disimpan terpisah dari dokumen identitas dan tetap privat.
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => setPhotoOpen(true)}>
                    <Camera />Ambil Foto
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {identityLoading ? (
                  <Skeleton className="aspect-square w-full rounded-2xl" />
                ) : photo?.photoUrl ? (
                  <div className="overflow-hidden rounded-2xl border bg-muted">
                    <img
                      src={photo.photoUrl}
                      alt={"Foto penyewa " + renter.nama_lengkap}
                      className="aspect-square w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center">
                    <CameraOff className="size-8 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-3 font-semibold">Belum ada foto penyewa</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Ambil foto, tinjau hasilnya, lalu simpan ke penyewa.
                    </p>
                    <Button type="button" className="mt-4 rounded-xl" onClick={() => setPhotoOpen(true)}>
                      <Camera />Ambil Foto
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 bg-muted/20 shadow-none">
            <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Dokumen dan foto hanya ditampilkan setelah akses admin dan Usaha aktif terotorisasi. Detail nomor identitas tetap diminimalkan.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kontak" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Kontak Penyewa</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Informasi profil yang dapat diperbarui oleh admin.</p>
              </div>
              <Button type="button" variant="outline" className="rounded-xl" onClick={openEdit}>
                <Pencil />Edit Profil
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="size-4" aria-hidden="true" />
                  Nomor telepon
                </div>
                <p className="mt-2 font-semibold">{maskPhone(renter.nomor_telepon)}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2 rounded-lg px-2"
                  onClick={() => copyPhone(renter.nomor_telepon)}
                >
                  <Copy />Salin nomor
                </Button>
              </div>

              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="size-4" aria-hidden="true" />
                  Alamat
                </div>
                <p className="mt-2 font-semibold">{renter.alamat || "Belum tersedia"}</p>
              </div>

              <div className="rounded-xl border p-4 sm:col-span-2">
                <p className="text-xs text-muted-foreground">Catatan internal</p>
                <p className="mt-2 text-sm leading-6">{renter.catatan_internal || "Belum ada catatan internal."}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-muted/20 shadow-none">
            <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Perubahan profil menggunakan optimistic concurrency dengan updated_at agar edit bersamaan tidak diam-diam menimpa perubahan admin lain.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operasional" className="space-y-4">
          {activeRentals.length ? (
            activeRentals.map((rental) => (
              <OperationalRentalCard key={rental.penyewaan_id} rental={rental} />
            ))
          ) : (
            <Card className="shadow-sm">
              <CardContent className="flex min-h-48 flex-col items-center justify-center p-6 text-center">
                <CheckCircle2 className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-semibold">Tidak ada rental aktif</p>
                <p className="mt-1 max-w-md text-sm leading-5 text-muted-foreground">
                  Read-side Penyewaan saat ini tidak menunjukkan rental dengan status aktif untuk penyewa ini.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="border-dashed shadow-none">
            <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
              <ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Reservasi dan Pengembalian tetap dimiliki modul masing-masing; halaman Penyewa tidak membuat salinan status lintas modul yang belum terverifikasi.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Profil Penyewa</DialogTitle>
            <DialogDescription>
              Perubahan ini hanya mengubah identitas canonical penyewa, bukan membuat transaksi baru.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editError ? (
              <Alert variant="destructive">
                <AlertTitle>Profil belum tersimpan</AlertTitle>
                <AlertDescription>{editError.message}</AlertDescription>
              </Alert>
            ) : null}
            {profileUnknown ? (
              <Alert variant="destructive">
                <AlertTitle>Hasil perubahan belum diketahui</AlertTitle>
                <AlertDescription className="gap-3">
                  <p>Periksa status command sebelum mencoba menyimpan ulang.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void reconcileProfile()}>
                    Periksa status
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-renter-name">Nama lengkap</label>
              <Input id="edit-renter-name" value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-renter-phone">Nomor telepon</label>
              <Input id="edit-renter-phone" inputMode="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-renter-address">Alamat</label>
              <Textarea id="edit-renter-address" value={editAddress} onChange={(event) => setEditAddress(event.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-renter-note">Catatan internal</label>
              <Textarea id="edit-renter-note" value={editNote} onChange={(event) => setEditNote(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button type="button" className="rounded-xl" disabled={editPending || Boolean(profileUnknown)} onClick={() => void saveProfile()}>
              {editPending ? "Menyimpan…" : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Bukti Identitas</DialogTitle>
            <DialogDescription>
              File disimpan privat. Menyimpan bukti belum berarti identitas sudah terverifikasi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Jenis identitas</label>
              <Select value={evidenceType} onValueChange={(value) => setEvidenceType(value as "KTP" | "SIM")}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KTP">KTP</SelectItem>
                  <SelectItem value="SIM">SIM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="evidence-number">Nomor identitas (opsional, masked)</label>
              <Input
                id="evidence-number"
                value={evidenceNumber}
                onChange={(event) => setEvidenceNumber(event.target.value)}
                placeholder="Contoh: 3273••••••9012"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Jangan masukkan nomor identitas penuh pada tampilan atau catatan.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="evidence-file">File KTP/SIM</label>
              <Input
                id="evidence-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Di mobile, pilih kamera bila perangkat menawarkannya; tinjau file sebelum menyimpan.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="evidence-note">Catatan</label>
              <Textarea id="evidence-note" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setEvidenceOpen(false)}>
              Batal
            </Button>
            <Button type="button" className="rounded-xl" disabled={!evidenceFile || evidencePending} onClick={() => void saveEvidence()}>
              {evidencePending ? "Mengunggah…" : "Simpan Bukti"}
              {!evidencePending ? <Upload /> : null}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verifikasi Identitas</DialogTitle>
            <DialogDescription>
              Periksa bukti secara manusiawi sebelum menetapkan status verifikasi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-4">
              <p className="font-semibold">{verifyTarget?.jenisIdentitas || "Identitas"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {verifyTarget?.nomorIdentitasMasked || "Nomor tidak ditampilkan"}
              </p>
              {verifyTarget?.signedUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 rounded-lg"
                  onClick={() => window.open(verifyTarget.signedUrl ?? "", "_blank", "noopener,noreferrer")}
                >
                  Buka bukti
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Buka bukti terlebih dahulu untuk memuat dokumen privat.
                </p>
              )}
            </div>
            <Textarea
              value={verifyNote}
              onChange={(event) => setVerifyNote(event.target.value)}
              placeholder="Catatan hasil pemeriksaan admin"
              rows={4}
              aria-label="Catatan hasil verifikasi"
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="rounded-xl" disabled={verifyPending} onClick={() => void saveVerification("rejected")}>
              Perlu diperbaiki
            </Button>
            <Button type="button" className="rounded-xl" disabled={verifyPending} onClick={() => void saveVerification("verified")}>
              {verifyPending ? "Menyimpan…" : "Konfirmasi terverifikasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ambil Foto Penyewa</DialogTitle>
            <DialogDescription>
              Tinjau hasil terlebih dahulu. Foto tersimpan privat dan terpisah dari bukti identitas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {photoPreview ? (
              <div className="overflow-hidden rounded-2xl border bg-muted">
                <img
                  src={photoPreview}
                  alt="Pratinjau foto penyewa"
                  className="aspect-[4/5] w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center">
                <Camera className="size-9 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-semibold">Belum ada foto dipilih</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ambil foto dari kamera atau pilih gambar dari perangkat.
                </p>
              </div>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="user"
              className="sr-only"
              onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => photoInputRef.current?.click()}
            >
              <Camera />{photoPreview ? "Ambil / pilih ulang" : "Ambil Foto"}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setPhotoOpen(false)}>
              Batal
            </Button>
            <Button type="button" className="rounded-xl" disabled={!photoFile || photoPending} onClick={() => void savePhoto()}>
              {photoPending ? "Mengunggah…" : "Gunakan Foto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedEvidence)}
        onOpenChange={(open) => {
          if (!open) setSelectedEvidence(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bukti Identitas Privat</DialogTitle>
            <DialogDescription>
              Akses ini menggunakan signed URL sementara. Jangan bagikan tautan dokumen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">
                {selectedEvidence?.jenisIdentitas || "Identitas"}
              </Badge>
              <IdentityVerificationBadge status={selectedEvidence?.statusVerifikasi} compact />
            </div>
            {selectedEvidence?.signedUrl ? (
              <iframe
                src={selectedEvidence.signedUrl}
                title="Bukti identitas privat"
                className="min-h-[60vh] w-full rounded-2xl border bg-muted"
              />
            ) : (
              <div className="rounded-2xl border border-dashed p-10 text-center">
                <p className="font-semibold">Bukti belum dapat ditampilkan</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Muat ulang identitas atau periksa kembali akses file privat.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setSelectedEvidence(null)}>
              Tutup
            </Button>
            {selectedEvidence?.statusVerifikasi === "pending" ? (
              <Button
                type="button"
                className="rounded-xl"
                onClick={() => {
                  openVerify(selectedEvidence);
                  setSelectedEvidence(null);
                }}
              >
                Verifikasi
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
