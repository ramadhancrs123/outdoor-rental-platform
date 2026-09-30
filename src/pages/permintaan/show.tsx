import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatReservationDate,
  formatReservationDateTime,
  formatReservationMoney,
  getRequest,
  getReservationCapabilities,
  getReservasiContext,
  requestSourceLabel,
  semanticStatusLabel,
  statusVariant,
} from "@/features/reservasi";
import { paths } from "@/routes/paths";

export function RequestShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [prices, setPrices] = useState<Record<string, string>>({});

  const context = useQuery({
    queryKey: ["permintaan", "context"],
    queryFn: getReservasiContext,
    staleTime: 60_000,
  });

  const detail = useQuery({
    queryKey: ["permintaan", "detail", context.data?.usahaId, id],
    queryFn: () => getRequest(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });


  if (context.isPending || detail.isPending) {
    return (
      <Card>
        <CardContent className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">
          Memuat detail permintaan…
        </CardContent>
      </Card>
    );
  }

  if (context.error || detail.error || !detail.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" className="-ml-3">
          <Link to={paths.permintaan}><ArrowLeft />Kembali ke permintaan</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Detail permintaan tidak tersedia</AlertTitle>
          <AlertDescription className="gap-3">
            <p>
              {context.error?.message ??
                detail.error?.message ??
                "Permintaan tidak ditemukan atau Anda tidak memiliki akses."}
            </p>
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              <RefreshCw />Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const request = detail.data;
  const capabilities = getReservationCapabilities();
  const canCreateReservation =
    capabilities.mutation &&
    !request.reservasi_id &&
    (request.status === "submitted" || request.status === "under_review") &&
    request.lines.length > 0;

  const allPricesFilled = request.lines.every((line) => prices[line.detail_permintaan_id] !== undefined && prices[line.detail_permintaan_id] !== "");
  const previewTotal = request.lines.reduce((total, line) => {
    const unitPrice = Number(prices[line.detail_permintaan_id]);
    const quantity = Number(line.jumlah);
    if (!Number.isFinite(unitPrice) || !Number.isFinite(quantity)) return total;
    return total + quantity * unitPrice;
  }, 0);

  return (
    <div className="space-y-5 pb-10">
      <header>
        <Button asChild variant="ghost" className="-ml-3 mb-2">
          <Link to={paths.permintaan}><ArrowLeft />Kembali ke permintaan</Link>
        </Button>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Usaha: {context.data.usahaNama}</p>
            <h1 className="text-2xl font-bold tracking-tight">{request.nomor_permintaan}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {request.penyewa_nama ?? "Penyewa tidak ditemukan"} · {requestSourceLabel(request.sumber)}
            </p>
          </div>
          <Badge variant={statusVariant()}>{semanticStatusLabel(request.status)}</Badge>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Periode & proses</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Mulai</p><p className="mt-1 font-medium">{formatReservationDate(request.mulai_rencana)}</p></div>
            <div><p className="text-xs text-muted-foreground">Selesai</p><p className="mt-1 font-medium">{formatReservationDate(request.selesai_rencana)}</p></div>
            <div><p className="text-xs text-muted-foreground">Dikirim</p><p className="mt-1 font-medium">{formatReservationDateTime(request.submitted_at)}</p></div>
            <div><p className="text-xs text-muted-foreground">Diproses</p><p className="mt-1 font-medium">{formatReservationDateTime(request.processed_at)}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Reservation</CardTitle></CardHeader>
          <CardContent>
            {request.reservasi_id ? (
              <Link className="font-medium hover:underline" to={paths.reservasi + "/" + request.reservasi_id}>
                {request.nomor_reservasi}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Belum menjadi reservation.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {canCreateReservation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Konversi menjadi reservation</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tetapkan snapshot harga yang benar-benar disepakati. Server memvalidasi subtotal dan menyimpan snapshot transaksi.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Target</th>
                    <th className="px-4 py-3 font-medium">Jumlah</th>
                    <th className="px-4 py-3 font-medium">Harga/unit (IDR)</th>
                    <th className="px-4 py-3 font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {request.lines.map((line) => {
                    const quantity = Number(line.jumlah);
                    const unitPrice = Number(prices[line.detail_permintaan_id]);
                    const subtotal = Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : 0;

                    return (
                      <tr key={line.detail_permintaan_id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{line.barang_nama ?? line.varian_nama ?? line.paket_nama ?? "Target tidak ditemukan"}</td>
                        <td className="px-4 py-3">{line.jumlah}</td>
                        <td className="px-4 py-3">
                          <Label htmlFor={"price-" + line.detail_permintaan_id} className="sr-only">Harga/unit</Label>
                          <Input
                            id={"price-" + line.detail_permintaan_id}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={prices[line.detail_permintaan_id] ?? ""}
                            onChange={(event) =>
                              setPrices((current) => ({
                                ...current,
                                [line.detail_permintaan_id]: event.target.value,
                              }))
                            }
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">{formatReservationMoney(subtotal, "IDR")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total snapshot</p>
                <p className="text-lg font-semibold">{formatReservationMoney(previewTotal, "IDR")}</p>
              </div>
              <Button
                onClick={() => navigate(`${paths.reservasiCreate}?requestId=${id}`, { state: { prices } })}
                disabled={!allPricesFilled}
              >
                Lanjutkan <ArrowLeft className="size-4 rotate-180" />
              </Button>
            </div>

          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail kebutuhan</CardTitle>
          <p className="text-sm text-muted-foreground">
            {request.detail_count} detail · quantity adalah kebutuhan/commitment context sesuai tahap dokumen.
          </p>
        </CardHeader>
        <CardContent>
          {request.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada detail.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Target</th>
                    <th className="px-4 py-3 font-medium">Jumlah</th>
                    <th className="px-4 py-3 font-medium">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {request.lines.map((line) => (
                    <tr key={line.detail_permintaan_id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{line.barang_nama ?? line.varian_nama ?? line.paket_nama ?? "Target tidak ditemukan"}</td>
                      <td className="px-4 py-3">{line.jumlah}</td>
                      <td className="px-4 py-3">{line.catatan ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pilihan unit</CardTitle>
          <p className="text-sm text-muted-foreground">
            Preference bukan assignment. Unit fisik tetap bukan ownership Reservasi.
          </p>
        </CardHeader>
        <CardContent>
          {request.preferences.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada pilihan unit.</p>
          ) : (
            <div className="space-y-3">
              {request.preferences.map((preference) => (
                <div key={preference.pilihan_unit_id} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{preference.kode_unit ?? "Unit tidak ditemukan"}</p>
                    <p className="text-xs text-muted-foreground">
                      Preferensi #{preference.urutan_preferensi} · {semanticStatusLabel(preference.status)}
                    </p>
                  </div>
                  {preference.catatan && <p className="text-sm text-muted-foreground">{preference.catatan}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Catatan</CardTitle></CardHeader>
        <CardContent><p className="whitespace-pre-wrap text-sm">{request.catatan ?? "Tidak ada catatan."}</p></CardContent>
      </Card>

      <Alert>
        <AlertTitle>{capabilities.mutation ? "Command aktif" : "Mode baca"}</AlertTitle>
        <AlertDescription>{capabilities.reason}</AlertDescription>
      </Alert>
    </div>
  );
}
