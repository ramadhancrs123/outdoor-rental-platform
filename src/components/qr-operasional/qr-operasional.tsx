import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, Download, LockKeyhole, Printer, QrCode, ScanLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  buildUnitQrPrintDocument,
  buildUnitQrUrl,
  generateQrPngDataUrl,
  generateUnitQrLabelPdf,
  listQrUnitRecords,
  printHtmlDocument,
  resolveQrPenyewaanToken,
  resolveQrUnitToken,
  type UnitQrLabelData,
} from "@/features/qr-operasional";
import type { InventoryContext, InventoryUnit } from "@/features/inventaris";

export type QrScanResult =
  | { jenis: "unit"; id: string }
  | { jenis: "penyewaan"; id: string };

function parseQrValue(value: string): { jenis?: "unit" | "penyewaan"; token: string } {
  const raw = value.trim();
  if (!raw) return { token: "" };

  try {
    const url = new URL(raw, window.location.origin);
    const segments = url.pathname.split("/").filter(Boolean);
    const qrIndex = segments.indexOf("qr");
    if (qrIndex >= 0 && segments[qrIndex + 1] === "unit" && segments[qrIndex + 2]) {
      return { jenis: "unit", token: decodeURIComponent(segments[qrIndex + 2]) };
    }
    if (qrIndex >= 0 && segments[qrIndex + 1] === "penyewaan" && segments[qrIndex + 2]) {
      return { jenis: "penyewaan", token: decodeURIComponent(segments[qrIndex + 2]) };
    }
  } catch {
    // Raw token fallback.
  }

  return { token: raw };
}

async function resolveScan(value: string): Promise<QrScanResult> {
  const parsed = parseQrValue(value);
  if (!parsed.token) throw new Error("QR belum terbaca.");

  if (parsed.jenis === "unit") {
    const rows = await resolveQrUnitToken(parsed.token);
    if (!rows.length) throw new Error("QR unit tidak ditemukan atau sudah tidak aktif.");
    return { jenis: "unit", id: rows[0].unit_barang_id };
  }

  if (parsed.jenis === "penyewaan") {
    const rows = await resolveQrPenyewaanToken(parsed.token);
    if (!rows.length) throw new Error("QR penyewaan tidak ditemukan atau sudah tidak aktif.");
    return { jenis: "penyewaan", id: rows[0].penyewaan_id };
  }

  try {
    const units = await resolveQrUnitToken(parsed.token);
    if (units.length) return { jenis: "unit", id: units[0].unit_barang_id };
  } catch {
    // Try rental token next.
  }

  const rentals = await resolveQrPenyewaanToken(parsed.token);
  if (rentals.length) return { jenis: "penyewaan", id: rentals[0].penyewaan_id };

  throw new Error("QR tidak dikenali.");
}

function cameraErrorMessage(cause: unknown) {
  const error = cause as { name?: string; message?: string } | null;
  switch (error?.name) {
    case "NotAllowedError":
      return "Akses kamera ditolak. Izinkan kamera untuk situs ini, lalu coba lagi.";
    case "NotFoundError":
      return "Kamera tidak ditemukan pada perangkat ini.";
    case "NotReadableError":
      return "Kamera sedang digunakan aplikasi lain atau tidak dapat dibaca.";
    case "OverconstrainedError":
      return "Kamera belakang tidak dapat dipilih pada browser ini.";
    case "SecurityError":
      return "Browser menolak akses kamera pada koneksi ini. Gunakan HTTPS atau localhost.";
    default:
      return error?.message || "Akses kamera tidak dapat digunakan.";
  }
}

function isOverconstrainedError(cause: unknown) {
  return (cause as { name?: string } | null)?.name === "OverconstrainedError";
}

function isCameraUnavailableError(cause: unknown) {
  const name = (cause as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "OverconstrainedError";
}

async function requestRearCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Browser tidak menyediakan akses kamera web.");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: "environment" } },
      audio: false,
    });
  } catch (cause) {
    if (!isOverconstrainedError(cause)) throw cause;
  }

  const probe = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const rearCamera = devices.find((device) => {
      if (device.kind !== "videoinput") return false;
      const label = device.label.toLowerCase();
      return /back|rear|environment|belakang|world/.test(label);
    });

    if (!rearCamera) {
      throw new Error("Browser tidak dapat mengidentifikasi kamera belakang.");
    }

    return await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: rearCamera.deviceId } },
      audio: false,
    });
  } finally {
    probe.getTracks().forEach((track) => track.stop());
  }
}

async function decodeImageFile(reader: BrowserQRCodeReader, file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const result = await reader.decodeFromImageUrl(objectUrl);
    return result.getText().trim();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function QrScanDialog({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: (result: QrScanResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<BrowserQRCodeReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const resolvingRef = useRef(false);
  const lastDecodedValueRef = useRef("");
  const lastInvalidAtRef = useRef(0);
  const [manualValue, setManualValue] = useState("");
  const [status, setStatus] = useState("Menyiapkan pemindai…");
  const [error, setError] = useState("");
  const [cameraFallback, setCameraFallback] = useState(false);
  const [insecureContext, setInsecureContext] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const stopCamera = () => {
      try {
        controlsRef.current?.stop();
      } catch {
        // Best effort cleanup.
      }
      controlsRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      scannerRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      resolvingRef.current = false;
      lastDecodedValueRef.current = "";
      lastInvalidAtRef.current = 0;
    };

    const startCamera = async () => {
      setError("");
      setManualValue("");
      setCapturing(false);
      setCameraFallback(false);
      setInsecureContext(false);

      const secureContext = window.isSecureContext;
      const mediaDevicesAvailable = Boolean(navigator.mediaDevices?.getUserMedia);

      if (!secureContext) {
        setInsecureContext(true);
        setStatus("Kamera live hanya tersedia melalui HTTPS atau localhost.");
        return;
      }

      if (!mediaDevicesAvailable) {
        setCameraFallback(true);
        setStatus("Browser tidak menyediakan kamera live. Gunakan kamera/foto atau kode QR manual.");
        return;
      }

      setStatus("Meminta akses kamera belakang…");

      try {
        const stream = await requestRearCamera();
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const scanner = new BrowserQRCodeReader();
        scannerRef.current = scanner;
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const controls = await scanner.decodeFromStream(
          stream,
          video,
          (result) => {
            if (cancelled || !result || resolvingRef.current) {
              return;
            }

            const value = result.getText().trim();
            if (!value) return;

            const now = Date.now();
            if (value === lastDecodedValueRef.current && now - lastInvalidAtRef.current < 1500) {
              return;
            }
            lastDecodedValueRef.current = value;
            resolvingRef.current = true;
            setError("");
            setStatus("QR terbaca. Memverifikasi…");

            void resolveScan(value)
              .then((resolved) => {
                if (cancelled) return;
                stopCamera();
                onOpenChange(false);
                onResolved(resolved);
              })
              .catch((cause) => {
                if (cancelled) return;
                resolvingRef.current = false;
                lastInvalidAtRef.current = Date.now();
                setStatus("QR terbaca, tetapi belum valid.");
                setError(cause instanceof Error ? cause.message : "QR tidak dapat diverifikasi.");
              });
          },
        );

        if (cancelled) {
          controls.stop();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        controlsRef.current = controls;
        const settings = stream.getVideoTracks()[0]?.getSettings();
        const facingMode = settings?.facingMode;
        if (facingMode && facingMode !== "environment") {
          setCameraFallback(true);
          setStatus("Kamera live berhasil dibuka, tetapi browser tidak memilih kamera belakang.");
          setError("Silakan gunakan Buka Kamera untuk memilih kamera belakang perangkat.");
          stopCamera();
          return;
        }

        setCameraFallback(false);
        setStatus("Arahkan kamera belakang ke QR.");
      } catch (cause) {
        if (cancelled) return;
        setCameraFallback(true);
        setStatus("Kamera live tidak dapat digunakan. Gunakan Buka Kamera atau kode QR.");
        setError(cameraErrorMessage(cause));
        stopCamera();

        if (isCameraUnavailableError(cause)) {
          setStatus("Kamera belakang tidak tersedia. Gunakan Buka Kamera atau kode QR.");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, onOpenChange, onResolved]);

  const handleCameraCapture = async (file: File | undefined) => {
    if (!file) return;

    setCapturing(true);
    setError("");
    setStatus("Membaca QR dari kamera/foto…");

    try {
      const reader = new BrowserQRCodeReader();
      const value = await decodeImageFile(reader, file);
      if (!value) throw new Error("QR belum terbaca. Arahkan kamera lebih dekat dan coba lagi.");

      setStatus("QR terbaca. Memverifikasi…");
      const result = await resolveScan(value);
      onOpenChange(false);
      onResolved(result);
    } catch (cause) {
      setStatus("Belum berhasil membaca QR.");
      setError(cause instanceof Error ? cause.message : "Foto QR tidak dapat dibaca.");
    } finally {
      setCapturing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleManual = async () => {
    setError("");
    setStatus("Memverifikasi…");
    try {
      const result = await resolveScan(manualValue);
      onOpenChange(false);
      onResolved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QR tidak dikenali.");
      setStatus("Belum berhasil.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] max-w-md overflow-y-auto rounded-[24px] p-0">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="size-5 text-primary" />
            Scan QR
          </DialogTitle>
          <DialogDescription>
            Scan QR Unit atau QR Penyewaan untuk membuka detail yang sesuai.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-5">
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border bg-muted/25">
            {insecureContext ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <LockKeyhole className="size-7" />
                </div>
                <p className="mt-4 text-sm font-semibold">Kamera live membutuhkan HTTPS</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Alamat aplikasi saat ini menggunakan HTTP. Buka aplikasi melalui URL HTTPS untuk mengaktifkan live scanner kamera.
                </p>
              </div>
            ) : cameraFallback ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Camera className="size-7" />
                </div>
                <p className="mt-4 text-sm font-semibold">Kamera live tidak tersedia</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  {status}
                </p>
                <Button
                  type="button"
                  className="mt-4 h-11 rounded-xl px-5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={capturing}
                >
                  <Camera />
                  {capturing ? "Membaca…" : "Gunakan Kamera / Foto"}
                </Button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="size-full object-cover"
                  playsInline
                  muted
                  aria-label="Pratinjau kamera untuk scan QR"
                />
                <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-primary/70" />
              </>
            )}
            {!insecureContext && !cameraFallback ? (
              <div className="absolute inset-x-0 bottom-0 bg-black/55 px-4 py-3 text-center text-xs font-medium text-white backdrop-blur">
                {status}
              </div>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void handleCameraCapture(event.target.files?.[0])}
          />

          {cameraFallback ? (
            <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] px-4 py-3 text-xs leading-5 text-muted-foreground">
              Fallback tetap memproses QR melalui decoder ZXing, tanpa bergantung pada BarcodeDetector bawaan browser.
            </div>
          ) : null}

          {error ? <p className="text-sm leading-5 text-destructive">{error}</p> : null}

          <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Atau gunakan kode QR</p>
              <QrCode className="size-4 text-primary" />
            </div>
            <div className="flex gap-2">
              <Input
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleManual();
                }}
                placeholder="Tempel kode / tautan QR"
                aria-label="Kode atau tautan QR"
                className="h-11 rounded-xl"
              />
              <Button className="h-11 shrink-0 rounded-xl" onClick={() => void handleManual()} disabled={!manualValue.trim()}>
                Buka
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QrPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  code,
  kind,
  url,
  labelData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  code: string;
  kind: "unit" | "penyewaan";
  url: string;
  labelData?: UnitQrLabelData | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    void generateQrPngDataUrl(url, 768).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const printUnit = async () => {
    if (!labelData || !qrDataUrl) return;
    setWorking(true);
    try {
      const html = buildUnitQrPrintDocument([labelData], [qrDataUrl]);
      await printHtmlDocument(html);
    } catch (cause) {
      console.error(cause);
    } finally {
      setWorking(false);
    }
  };

  const downloadUnitPdf = async () => {
    if (!labelData) return;
    setWorking(true);
    try {
      const bytes = await generateUnitQrLabelPdf([labelData]);
      const blobBytes = new Uint8Array(bytes.byteLength);
      blobBytes.set(bytes);
      const blob = new Blob([blobBytes.buffer], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = labelData.kode_unit + "-qr.pdf";
      anchor.click();
      URL.revokeObjectURL(href);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-[24px] p-0">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-5">
          <div className="grid place-items-center rounded-3xl border bg-white p-5">
            {qrDataUrl ? <img src={qrDataUrl} alt={"QR " + code} className="size-64 max-w-full" /> : <div className="size-64 max-w-full animate-pulse rounded-2xl bg-muted" />}
          </div>

          <div className="rounded-2xl bg-muted/30 px-4 py-3">
            <p className="text-[11px] text-muted-foreground">Referensi</p>
            <p className="mt-1 break-all text-sm font-semibold">{code}</p>
          </div>

          {kind === "unit" && labelData ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => void printUnit()} disabled={!qrDataUrl || working}>
                <Printer />
                {working ? "Menyiapkan…" : "Cetak"}
              </Button>
              <Button className="h-11 rounded-xl" onClick={() => void downloadUnitPdf()} disabled={working}>
                <Download />
                PDF
              </Button>
            </div>
          ) : null}

          {kind === "penyewaan" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              QR ini membuka detail penyewaan. Nota dan cetak thermal belum termasuk pada tahap ini.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UnitQrBatchPrintDialog({
  open,
  onOpenChange,
  context,
  units,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: InventoryContext;
  units: InventoryUnit[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(units.map((unit) => unit.unit_barang_id));
      setMessage("");
    }
  }, [open, units]);

  const selectedUnits = useMemo(
    () => units.filter((unit) => selected.includes(unit.unit_barang_id)),
    [selected, units],
  );

  const buildLabels = async () => {
    const qrRows = await listQrUnitRecords(context.usahaId, selectedUnits.map((unit) => unit.unit_barang_id));
    const byUnit = new Map(qrRows.map((row) => [row.unit_barang_id, row]));
    return selectedUnits.flatMap((unit) => {
      const qr = byUnit.get(unit.unit_barang_id);
      if (!qr) return [];
      return [{
        kode_unit: unit.kode_unit,
        nama_barang: unit.barang?.nama ?? "Barang",
        nama_varian: unit.varian?.nama ?? null,
        token_qr: qr.token_qr,
        url: buildUnitQrUrl(window.location.origin, qr.token_qr),
      }];
    });
  };

  const print = async () => {
    if (!selectedUnits.length) {
      setMessage("Pilih minimal satu unit.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const labels = await buildLabels();
      if (!labels.length) throw new Error("QR unit belum tersedia untuk pilihan ini.");

      const dataUrls = await Promise.all(labels.map((label) => generateQrPngDataUrl(label.url, 768)));
      const html = buildUnitQrPrintDocument(labels, dataUrls, { format: "a4", labelsPerPage: 8 });
      await printHtmlDocument(html);
      onOpenChange(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Label QR gagal dicetak.");
    } finally {
      setWorking(false);
    }
  };

  const downloadPdf = async () => {
    if (!selectedUnits.length) {
      setMessage("Pilih minimal satu unit.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const labels = await buildLabels();
      if (!labels.length) throw new Error("QR unit belum tersedia untuk pilihan ini.");

      const bytes = await generateUnitQrLabelPdf(labels, { format: "a4", labelsPerPage: 8 });
      const blobBytes = new Uint8Array(bytes.byteLength);
      blobBytes.set(bytes);
      const blob = new Blob([blobBytes.buffer], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "qr-unit-" + selectedUnits.length + "-label.pdf";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "PDF QR gagal dibuat.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] max-w-lg overflow-y-auto rounded-[24px] p-0">
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle>Cetak QR Unit</DialogTitle>
          <DialogDescription>
            Pilih unit pada halaman ini. Setiap label mempertahankan QR identity unit yang sama. Batch akan disusun pada lembar A4 agar kode unit dan QR mudah dibaca.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[58dvh] space-y-2 overflow-y-auto px-5 py-4">
          {units.map((unit) => (
            <label key={unit.unit_barang_id} className="flex items-center gap-3 rounded-2xl border px-3.5 py-3">
              <Checkbox checked={selected.includes(unit.unit_barang_id)} onCheckedChange={() => setSelected((current) => current.includes(unit.unit_barang_id) ? current.filter((item) => item !== unit.unit_barang_id) : [...current, unit.unit_barang_id])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{unit.kode_unit}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {unit.barang?.nama ?? "Barang"}{unit.varian?.nama ? " · " + unit.varian.nama : ""}
                </span>
              </span>
            </label>
          ))}
        </div>

        {message ? <p className="px-5 text-sm leading-5 text-destructive">{message}</p> : null}

        <div className="grid grid-cols-2 gap-2 border-t px-5 py-4 sm:flex sm:items-center sm:justify-end">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={working}>
            Batal
          </Button>
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => void downloadPdf()} disabled={working}>
            <Download />
            PDF A4
          </Button>
          <Button className="h-11 rounded-xl" onClick={() => void print()} disabled={working}>
            <Printer />
            {working ? "Menyiapkan…" : "Cetak A4"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
