import { Authenticated } from "@refinedev/core";
import { NavigateToResource } from "@refinedev/react-router";
import { Navigate, Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
import { Login } from "@/pages/login";
import { Dashboard } from "@/pages/dashboard";
import { InventoryCreate, InventoryList, InventoryShow } from "@/pages/inventaris";
import { CatalogEdit, CatalogList, CatalogManage, CatalogShow } from "@/pages/katalog";
import { RenterCreate, RenterList, RenterShow } from "@/pages/penyewa";
import { PemasokList, PemasokShow } from "@/pages/pemasok";
import { SupplierCreate } from "@/pages/pemasok/create";
import { PembelianList, PembelianShow } from "@/pages/pembelian";
import { PurchaseCreate } from "@/pages/pembelian/create";
import { PermintaanList, PermintaanShow } from "@/pages/permintaan";
import { ReservasiList, ReservasiShow } from "@/pages/reservasi";
import { ReservationCreate } from "@/pages/reservasi/create";
import { KeuanganHome, TransaksiList, TransaksiShow, PembayaranList, PembayaranShow, PengeluaranList, PengeluaranShow } from "@/pages/keuangan";
import { PaymentCreate } from "@/pages/keuangan/create-payment";
import { ExpenseCreate } from "@/pages/keuangan/create-expense";
import { PenyewaanList, PenyewaanShow, RentalWalkIn } from "@/pages/penyewaan";
import { PengembalianList, PengembalianShow } from "@/pages/pengembalian";
import { PemeriksaanList, PemeriksaanShow } from "@/pages/pemeriksaan";
import { PerawatanCreate, PerawatanList, PerawatanShow } from "@/pages/perawatan";
import { PemberitahuanList } from "@/pages/pemberitahuan";
import { LaporanPage } from "@/pages/laporan";
import { paths } from "./paths";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Authenticated key="admin-auth" fallback={<Navigate to="/login" replace />}>
            <Layout><Outlet /></Layout>
          </Authenticated>
        }
      >
        <Route index element={<NavigateToResource resource="dashboard" />} />
        <Route path={paths.dashboard} element={<Dashboard />} />

        <Route path={paths.pemberitahuan} element={<PemberitahuanList />} />
        <Route path={paths.laporan} element={<LaporanPage />} />

        <Route path={paths.inventaris}>
          <Route index element={<InventoryList />} />
          <Route path="create" element={<InventoryCreate />} />
          <Route path=":id" element={<InventoryShow />} />
        </Route>

        <Route path={paths.katalog}>
          <Route index element={<CatalogList />} />
          <Route path="manage" element={<CatalogManage />} />
          <Route path="edit/:id" element={<CatalogEdit />} />
          <Route path="show/:id" element={<CatalogShow />} />
        </Route>

        <Route path={paths.penyewa}>
          <Route index element={<RenterList />} />
          <Route path="create" element={<RenterCreate />} />
          <Route path=":id" element={<RenterShow />} />
        </Route>

        <Route path={paths.pemasok}>
          <Route index element={<PemasokList />} />
          <Route path="create" element={<SupplierCreate />} />
          <Route path=":id/edit" element={<SupplierCreate />} />
          <Route path=":id" element={<PemasokShow />} />
        </Route>

        <Route path={paths.pembelian}>
          <Route index element={<PembelianList />} />
          <Route path="create" element={<PurchaseCreate />} />
          <Route path=":id/edit" element={<PurchaseCreate />} />
          <Route path=":id" element={<PembelianShow />} />
        </Route>

        <Route path={paths.permintaan}>
          <Route index element={<PermintaanList />} />
          <Route path=":id" element={<PermintaanShow />} />
        </Route>

        <Route path={paths.reservasi}>
          <Route index element={<ReservasiList />} />
          <Route path="create" element={<ReservationCreate />} />
          <Route path=":id" element={<ReservasiShow />} />
        </Route>

        <Route path={paths.keuangan}>
          <Route index element={<KeuanganHome />} />
          <Route path="transaksi" element={<TransaksiList />} />
          <Route path="transaksi/:id" element={<TransaksiShow />} />
          <Route path="pembayaran" element={<PembayaranList />} />
          <Route path="pembayaran/create" element={<PaymentCreate />} />
          <Route path="pembayaran/:id" element={<PembayaranShow />} />
          <Route path="pengeluaran" element={<PengeluaranList />} />
          <Route path="pengeluaran/create" element={<ExpenseCreate />} />
          <Route path="pengeluaran/:id" element={<PengeluaranShow />} />
        </Route>

        <Route path={paths.penyewaan}>
          <Route index element={<PenyewaanList />} />
          <Route path="walk-in" element={<RentalWalkIn />} />
          <Route path=":id" element={<PenyewaanShow />} />
        </Route>

        <Route path={paths.pengembalian}>
          <Route index element={<PengembalianList />} />
          <Route path=":id" element={<PengembalianShow />} />
        </Route>

        <Route path={paths.pemeriksaan}>
          <Route index element={<PemeriksaanList />} />
          <Route path=":id" element={<PemeriksaanShow />} />
        </Route>

        <Route path={paths.perawatan}>
          <Route index element={<PerawatanList />} />
          <Route path="create" element={<PerawatanCreate />} />
          <Route path=":id" element={<PerawatanShow />} />
        </Route>

        <Route path="*" element={<ErrorComponent />} />
      </Route>
    </Routes>
  );
}
