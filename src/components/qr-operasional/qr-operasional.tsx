import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import { Bluetooth, Camera, Download, FileDown, LockKeyhole, MessageCircle, Printer, QrCode, ScanLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  buildRentalReceiptFileName,
  buildRentalReceiptHtml,
  buildUnitQrPrintDocument,
  buildUnitQrUrl,
  generateQrPngDataUrl,
  generateUnitQrLabelPdf,
  normalizeReceiptWhatsAppPhone,
  listQrUnitRecords,
  printHtmlDocument,
  resolveQrPenyewaanToken,
  resolveQrUnitToken,
  type RentalReceiptData,
  type UnitQrLabelData,
} from "@/features/qr-operasional";
import { downloadPdfBytes } from "@/features/qr-operasional/download";
import type { InventoryContext, InventoryUnit } from "@/features/inventaris";
import { parseQrValue } from "@/features/qr-operasional/scan";

export type QrScanResult =
  | { jenis: "unit"; id: string }
  | { jenis: "penyewaan"; id: string };

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

        const { BrowserQRCodeReader } = await import("@zxing/browser");
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
      const { BrowserQRCodeReader } = await import("@zxing/browser");
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
      await downloadPdfBytes(bytes, labelData.kode_unit + "-qr.pdf");
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
              QR ini membuka detail penyewaan. Nota dan cetak thermal 58 mm tersedia: cetak langsung atau unduh PDF dari tombol di bawah.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}


type ReceiptAndroidBridge = {
  savePdfFromBase64?: (base64Payload: string, fileName: string) => boolean;
  shareReceiptPngToWhatsApp?: (base64Png: string, fileName: string, phoneNumber: string, caption: string) => boolean;
  getThermalPrinterInfo?: () => string;
  openThermalPrinterSettings?: () => boolean;
};

type ThermalPrinterInfo = {
  supported?: boolean;
  permissionGranted?: boolean;
  configured?: boolean;
  printerName?: string;
  bluetoothEnabled?: boolean;
};

function getReceiptAndroidBridge() {
  return (window as Window & { AndroidInterface?: ReceiptAndroidBridge }).AndroidInterface;
}

async function loadReceiptLogoDataUrl() {
  const assetPath = `${import.meta.env.BASE_URL}logo.webp`;
  const response = await fetch(assetPath, { cache: "force-cache" });
  if (!response.ok) throw new Error("Logo Akasha Outdoor tidak dapat dimuat.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Logo tidak dapat dibaca."));
    reader.onerror = () => reject(new Error("Logo tidak dapat dibaca."));
    reader.readAsDataURL(blob);
  });
}

async function captureReceiptCanvas(frame: HTMLIFrameElement | null) {
  const doc = frame?.contentDocument;
  if (!doc?.body) throw new Error("Pratinjau struk belum siap untuk diekspor.");

  await doc.fonts?.ready;
  await Promise.all(Array.from(doc.images).map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("Logo atau QR struk gagal dimuat.")), { once: true });
      });
    }
    if (image.naturalWidth === 0) throw new Error("Logo atau QR struk gagal dimuat.");
  }));

  const { default: html2canvas } = await import("html2canvas");
  return await html2canvas(doc.body, {
    backgroundColor: "#ffffff",
    scale: 3,
    useCORS: true,
    allowTaint: false,
    logging: false,
    width: Math.ceil(doc.body.scrollWidth),
    height: Math.ceil(doc.body.scrollHeight),
    windowWidth: Math.ceil(doc.documentElement.scrollWidth),
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function downloadReceiptBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

function pngDataUrlToBlob(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}

export function RentalReceiptDialog({
  open,
  onOpenChange,
  receipt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: RentalReceiptData;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [workingAction, setWorkingAction] = useState<"print" | "pdf" | "whatsapp" | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [previewHeight, setPreviewHeight] = useState(480);
  const [printerInfo, setPrinterInfo] = useState<ThermalPrinterInfo | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open || !receipt.url) return;
    let cancelled = false;
    setQrDataUrl("");
    setLogoDataUrl("");
    setActionError("");
    setActionMessage("");
    void Promise.all([generateQrPngDataUrl(receipt.url, 768), loadReceiptLogoDataUrl()])
      .then(([qr, logo]) => {
        if (!cancelled) {
          setQrDataUrl(qr);
          setLogoDataUrl(logo);
        }
      })
      .catch((cause) => {
        if (!cancelled) setActionError(cause instanceof Error ? cause.message : "Struk gagal disiapkan.");
      });
    return () => { cancelled = true; };
  }, [open, receipt.url]);

  const receiptHtml = useMemo(
    () => qrDataUrl && logoDataUrl ? buildRentalReceiptHtml(receipt, qrDataUrl, logoDataUrl) : "",
    [qrDataUrl, logoDataUrl, receipt],
  );
  useEffect(() => {
    if (!open) return;
    const bridge = getReceiptAndroidBridge();
    if (!bridge) {
      setPrinterInfo(null);
      return;
    }

    const refreshPrinterInfo = () => {
      if (typeof bridge.getThermalPrinterInfo !== "function") {
        setPrinterInfo({ supported: true, configured: false });
        return;
      }
      try {
        setPrinterInfo(JSON.parse(bridge.getThermalPrinterInfo() || "{}") as ThermalPrinterInfo);
      } catch {
        setPrinterInfo({ supported: true, configured: false });
      }
    };
    const handlePrinterChanged = () => refreshPrinterInfo();
    const handlePrintResult = (event: Event) => {
      const detail = (event as CustomEvent<{ success?: boolean; message?: string }>).detail;
      setWorkingAction(null);
      if (detail?.success) {
        setActionError("");
        setActionMessage(detail.message || "Struk berhasil dikirim ke printer.");
      } else if (detail) {
        setActionError(detail.message || "Pencetakan Bluetooth gagal.");
        setActionMessage("");
      }
    };

    refreshPrinterInfo();
    window.addEventListener("akasha:thermal-printer-changed", handlePrinterChanged);
    window.addEventListener("akasha:thermal-print-result", handlePrintResult);
    return () => {
      window.removeEventListener("akasha:thermal-printer-changed", handlePrinterChanged);
      window.removeEventListener("akasha:thermal-print-result", handlePrintResult);
    };
  }, [open]);

  const documentName = useMemo(() => buildRentalReceiptFileName(receipt), [receipt]);
  const whatsappPhone = useMemo(() => normalizeReceiptWhatsAppPhone(receipt.penyewa_telepon), [receipt.penyewa_telepon]);
  const isWorking = workingAction !== null;

  const printReceipt = async () => {
    if (!receiptHtml) return;
    setWorkingAction("print");
    setActionError("");
    setActionMessage("");
    const bridge = getReceiptAndroidBridge();
    const waitsForNativeResult = Boolean(bridge
      && typeof bridge.getThermalPrinterInfo === "function"
      && typeof bridge.openThermalPrinterSettings === "function");
    let nativeJobAccepted = false;
    try {
      await printHtmlDocument(receiptHtml, { androidThermal: true, documentName });
      if (waitsForNativeResult) {
        nativeJobAccepted = true;
        setActionMessage("Menyiapkan struk dan menghubungkan printer Bluetooth…");
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Struk gagal disiapkan untuk dicetak.");
    } finally {
      if (!nativeJobAccepted) setWorkingAction(null);
    }
  };

  const openPrinterSettings = () => {
    setActionError("");
    setActionMessage("");
    const bridge = getReceiptAndroidBridge();
    if (!bridge) {
      setActionError("Konfigurasi Bluetooth printer tersedia melalui aplikasi Android Akasha Outdoor.");
      return;
    }
    if (typeof bridge.openThermalPrinterSettings !== "function") {
      setActionError("Versi aplikasi Android belum mendukung konfigurasi printer Bluetooth. Perbarui APK Akasha Outdoor.");
      return;
    }
    if (!bridge.openThermalPrinterSettings()) {
      setActionError("Dialog konfigurasi printer tidak dapat dibuka. Coba buka ulang aplikasi.");
    }
  };

  const createReceiptPng = async () => {
    const canvas = await captureReceiptCanvas(previewRef.current);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("Gambar PNG struk gagal dibuat.");
    return { canvas, dataUrl, blob: pngDataUrlToBlob(dataUrl) };
  };

  const saveReceiptPdf = async () => {
    if (!receiptHtml) return;
    setWorkingAction("pdf");
    setActionError("");
    setActionMessage("");
    try {
      const { dataUrl, canvas } = await createReceiptPng();
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const image = await pdf.embedPng(dataUrl);
      const pageWidth = (58 / 25.4) * 72;
      const pageHeight = pageWidth * (canvas.height / canvas.width);
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      const pdfBytes = await pdf.save();
      const pdfBase64 = bytesToBase64(pdfBytes);
      const fileName = `${documentName}.pdf`;
      const bridge = getReceiptAndroidBridge();
      if (typeof bridge?.savePdfFromBase64 === "function") {
        if (!bridge.savePdfFromBase64(pdfBase64, fileName)) throw new Error("Android gagal menyimpan PDF struk.");
        setActionMessage(`PDF disimpan di Downloads/${fileName}`);
      } else {
        const pdfBlobBuffer = new ArrayBuffer(pdfBytes.byteLength);
        new Uint8Array(pdfBlobBuffer).set(pdfBytes);
        downloadReceiptBlob(new Blob([pdfBlobBuffer], { type: "application/pdf" }), fileName);
        setActionMessage(`Unduhan ${fileName} dimulai.`);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "PDF struk gagal dibuat.");
    } finally {
      setWorkingAction(null);
    }
  };

  const shareReceiptToWhatsApp = async () => {
    if (!receiptHtml) return;
    if (!whatsappPhone) {
      setActionError("Nomor WhatsApp penyewa tidak valid. Perbarui nomor pada data penyewa.");
      return;
    }
    setWorkingAction("whatsapp");
    setActionError("");
    setActionMessage("");
    try {
      const { dataUrl, blob } = await createReceiptPng();
      const fileName = `${documentName}.png`;
      const caption = `Halo ${receipt.penyewa_nama}, berikut struk transaksi Akasha Outdoor untuk penyewaan Anda.`;
      const base64Png = dataUrl.split(",", 2)[1] ?? "";
      const bridge = getReceiptAndroidBridge();

      if (bridge && typeof bridge.shareReceiptPngToWhatsApp !== "function") {
        throw new Error("Aplikasi Android yang terpasang belum memiliki fitur berbagi langsung ke WhatsApp. Perbarui APK Akasha Outdoor terlebih dahulu.");
      }
      if (typeof bridge?.shareReceiptPngToWhatsApp === "function") {
        const accepted = bridge.shareReceiptPngToWhatsApp(base64Png, fileName, whatsappPhone, caption);
        if (!accepted) throw new Error("Android tidak dapat membuka WhatsApp. Periksa aplikasi WhatsApp dan coba lagi.");
        setActionMessage(`WhatsApp dibuka dengan PNG terlampir. Periksa chat ${receipt.penyewa_telepon} dan tekan Kirim.`);
      } else {
        const file = new File([blob], fileName, { type: "image/png" });
        if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "Struk Akasha Outdoor", text: caption });
          setActionMessage("Pilih WhatsApp pada menu berbagi untuk mengirim struk PNG.");
        } else {
          downloadReceiptBlob(blob, fileName);
          window.location.href = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(caption)}`;
          setActionMessage("WhatsApp dibuka. Lampirkan PNG yang baru diunduh pada chat penyewa.");
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setActionError(cause instanceof Error ? cause.message : "Struk PNG gagal dibagikan ke WhatsApp.");
    } finally {
      setWorkingAction(null);
    }
  };

  const handlePreviewLoad = () => {
    const document = previewRef.current?.contentDocument;
    const contentHeight = document?.documentElement?.scrollHeight ?? document?.body?.scrollHeight ?? 0;
    if (contentHeight > 0) setPreviewHeight(Math.max(300, contentHeight + 4));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-sm overflow-y-auto rounded-[24px] p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Struk Transaksi · 58 mm</DialogTitle>
          <DialogDescription>Satu tampilan untuk cetak thermal, simpan PDF, dan bagikan gambar PNG ke WhatsApp.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-4 pb-5">
          <div className="flex justify-center overflow-x-auto rounded-2xl border bg-muted/30 p-2">
            {receiptHtml ? (
              <iframe
                ref={previewRef}
                title="Pratinjau struk Akasha Outdoor 58 mm"
                srcDoc={receiptHtml}
                sandbox="allow-same-origin"
                onLoad={handlePreviewLoad}
                style={{ width: "58mm", height: `${previewHeight}px`, border: 0, background: "#fff", flex: "0 0 auto" }}
              />
            ) : (
              <div className="flex min-h-52 w-full items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                Menyiapkan pratinjau struk…
              </div>
            )}
          </div>

          {getReceiptAndroidBridge() ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Bluetooth className="size-4" /></div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold">PRINTER BLUETOOTH</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {printerInfo?.configured
                      ? `${printerInfo.printerName || "Printer tersimpan"}${printerInfo.permissionGranted === false ? " · Izin diperlukan" : printerInfo.bluetoothEnabled === false ? " · Bluetooth mati" : " · Printer utama"}`
                      : printerInfo?.supported === false ? "Bluetooth tidak tersedia" : "Belum ada printer utama"}
                  </p>
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 rounded-lg px-2.5 text-[10px]" onClick={openPrinterSettings}>
                {printerInfo?.configured ? "Ubah" : "Hubungkan"}
              </Button>
            </div>
          ) : null}

          <div className="rounded-xl bg-muted/40 px-3 py-2 text-[10px]">
            <p className="font-semibold">Nama file</p>
            <p className="mt-0.5 break-all font-mono text-muted-foreground">{documentName}.pdf</p>
            <p className="mt-0.5 text-muted-foreground">PNG WhatsApp: {documentName}.png</p>
          </div>

          {actionError ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{actionError}</p> : null}
          {actionMessage ? <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{actionMessage}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <Button className="h-11 rounded-xl" onClick={() => void printReceipt()} disabled={isWorking || !receiptHtml}>
              <Printer />{workingAction === "print" ? "Menyiapkan…" : "Cetak 58 mm"}
            </Button>
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => void saveReceiptPdf()} disabled={isWorking || !receiptHtml}>
              <FileDown />{workingAction === "pdf" ? "Menyimpan…" : "Simpan PDF"}
            </Button>
          </div>
          <Button className="h-11 w-full rounded-xl bg-[#1f9d58] text-white hover:bg-[#17834a]" onClick={() => void shareReceiptToWhatsApp()} disabled={isWorking || !receiptHtml || !whatsappPhone}>
            <MessageCircle />{workingAction === "whatsapp" ? "Menyiapkan PNG…" : "Bagikan PNG ke WhatsApp"}
          </Button>
          <p className="text-center text-[10px] leading-4 text-muted-foreground">PDF disimpan ke Download. Cetak mengirim langsung ke printer Bluetooth utama.</p>
          {!whatsappPhone ? <p className="text-center text-[10px] text-muted-foreground">Nomor WhatsApp penyewa belum valid; fitur bagikan dinonaktifkan.</p> : null}
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
      await downloadPdfBytes(bytes, "qr-unit-" + selectedUnits.length + "-label.pdf");
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
