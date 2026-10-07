import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listCatalogProductCovers } from "@/features/katalog";
import type { InventoryPackageAvailability } from "@/features/inventaris";

export function InventoryPackageAvailabilityView({
  packages,
  usahaId,
}: {
  packages: InventoryPackageAvailability[];
  usahaId: string;
}) {
  const packageProductIds = Array.from(
    new Set(
      packages.flatMap((pkg) =>
        pkg.components.map((component) => component.barang_id).filter(Boolean) as string[],
      ),
    ),
  );

  const covers = useQuery({
    queryKey: ["inventaris", "package-covers", usahaId, packageProductIds.join(",")],
    queryFn: () => listCatalogProductCovers(usahaId, packageProductIds),
    enabled: Boolean(usahaId && packageProductIds.length),
    staleTime: 60_000,
  });

  const coverByProduct = new Map(
    (covers.data ?? []).map((item) => [item.barang_id, item.url]),
  );

  if (!packages.length) {
    return (
      <Card>
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-2 text-center">
          <Package className="size-8 text-muted-foreground" />
          <p className="font-semibold">Belum ada paket aktif</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Paket dihitung dari komposisi katalog dan ketersediaan unit fisik saat ini.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {packages.map((pkg) => {
        const coverUrl =
          pkg.components
            .map((component) =>
              component.barang_id ? coverByProduct.get(component.barang_id) : null,
            )
            .find(Boolean) ?? null;

        return (
          <Card key={pkg.paket_sewa_id} className="overflow-hidden rounded-xl shadow-sm">
            <div className="relative h-16 bg-gradient-to-br from-emerald-950/10 via-muted to-muted sm:h-20">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Package className="size-6" aria-hidden="true" />
                </div>
              )}
              <div className="absolute right-2 top-2">
                <Badge
                  variant={pkg.status === "available" ? "secondary" : "destructive"}
                  className="rounded-full bg-background/90 px-2 py-1 text-[11px] backdrop-blur"
                >
                  {pkg.status === "available" ? "Tersedia" : "Belum siap"}
                </Badge>
              </div>
            </div>

            <CardHeader className="space-y-2 p-3 pb-2">
              <div className="min-w-0">
                <CardTitle className="truncate text-sm">{pkg.nama}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pkg.harga_dasar == null
                    ? "Harga belum ditentukan"
                    : pkg.harga_dasar.toLocaleString("id-ID") + " " + pkg.currency_code}
                </p>
              </div>

              {pkg.status === "available" ? (
                <p className="text-xs font-semibold text-primary">
                  {pkg.available_package_quantity} paket siap disewakan
                </p>
              ) : (
                <p className="text-xs font-medium text-destructive">
                  {pkg.limiting_component_name
                    ? "Terbatas pada " + pkg.limiting_component_name
                    : "Komponen belum mencukupi"}
                </p>
              )}
            </CardHeader>

            <CardContent className="space-y-1.5 p-3 pt-1">
              {pkg.components.map((component) => (
                <div
                  key={component.komponen_paket_id}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{component.nama}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Butuh {component.required_quantity} · Siap {component.ready_quantity}
                    </p>
                  </div>
                  <span
                    className={
                      component.shortfall_quantity > 0
                        ? "shrink-0 text-[10px] font-semibold text-destructive"
                        : "shrink-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                    }
                  >
                    {component.shortfall_quantity > 0
                      ? "Kurang " + component.shortfall_quantity
                      : "Cukup"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
