import type { ResourceProps } from "@refinedev/core";
import { paths } from "@/routes/paths";

export const resources: ResourceProps[] = [
  { name: "dashboard", list: paths.dashboard, meta: { label: "Dashboard" } },
  { name: "permintaan", list: paths.permintaan, meta: { label: "Permintaan" } },
  { name: "reservasi", list: paths.reservasi, meta: { label: "Reservasi" } },
  { name: "penyewaan", list: paths.penyewaan, meta: { label: "Penyewaan" } },
  { name: "pengembalian", list: paths.pengembalian, meta: { label: "Pengembalian" } },
  { name: "inventaris", list: paths.inventaris, create: paths.inventarisCreate, meta: { label: "Inventaris" } },
  { name: "perawatan", list: paths.perawatan, meta: { label: "Perawatan" } },
  { name: "penyewa", list: paths.penyewa, meta: { label: "Penyewa" } },
  { name: "katalog", list: paths.katalog, edit: paths.katalogEdit + "/:id", meta: { label: "Katalog" } },
  { name: "pemasok", list: paths.pemasok, meta: { label: "Pemasok" } },
  { name: "pembelian", list: paths.pembelian, meta: { label: "Pembelian" } },
  { name: "keuangan", list: paths.keuangan, meta: { label: "Keuangan" } },
  { name: "pemberitahuan", list: paths.pemberitahuan, meta: { label: "Pemberitahuan" } },
  { name: "laporan", list: paths.laporan, meta: { label: "Laporan" } },
];
