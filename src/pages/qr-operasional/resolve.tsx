import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveQrPenyewaanToken, resolveQrUnitToken } from "@/features/qr-operasional";
import { paths } from "@/routes/paths";

export function QrResolvePage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const jenis = location.pathname.startsWith(paths.qrUnit + "/")
    ? "unit"
    : location.pathname.startsWith(paths.qrPenyewaan + "/")
      ? "penyewaan"
      : "";
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!jenis || !token) {
        setError("QR tidak lengkap.");
        return;
      }

      try {
        if (jenis === "unit") {
          const rows = await resolveQrUnitToken(token);
          if (!rows.length) throw new Error("QR unit tidak ditemukan atau sudah tidak aktif.");
          if (!cancelled) navigate(paths.inventaris + "/" + rows[0].unit_barang_id, { replace: true });
          return;
        }

        if (jenis === "penyewaan") {
          const rows = await resolveQrPenyewaanToken(token);
          if (!rows.length) throw new Error("QR penyewaan tidak ditemukan atau sudah tidak aktif.");
          if (!cancelled) navigate(paths.penyewaan + "/" + rows[0].penyewaan_id, { replace: true });
          return;
        }

        throw new Error("Jenis QR tidak dikenali.");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "QR tidak dapat dibuka.");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [jenis, navigate, token]);

  if (error) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center">
        <Card className="w-full rounded-[24px]">
          <CardContent className="space-y-4 p-5">
            <Alert variant="destructive">
              <AlertTitle>QR tidak dapat dibuka</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button className="h-11 w-full rounded-xl" onClick={() => navigate(paths.dashboard, { replace: true })}>
              Kembali ke Beranda
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card className="mx-auto mt-10 w-full max-w-md rounded-[24px]">
      <CardContent className="flex min-h-36 items-center justify-center p-5 text-sm text-muted-foreground">
        Membuka detail…
      </CardContent>
    </Card>
  );
}
