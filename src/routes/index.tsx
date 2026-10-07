import { lazy, Suspense, type ComponentType } from "react";
import { Authenticated } from "@refinedev/core";
import { NavigateToResource } from "@refinedev/react-router";
import { Navigate, Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
import { Dashboard } from "@/pages/dashboard";
import { paths } from "./paths";

function lazyNamed<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => ({ default: (await loader())[exportName] }));
}

const Login = lazyNamed(() => import("@/pages/login"), "Login");

const InventoryList = lazyNamed(() => import("@/pages/inventaris/list"), "InventoryList");
const InventoryCreate = lazyNamed(() => import("@/pages/inventaris/create"), "InventoryCreate");
const InventoryLocations = lazyNamed(() => import("@/pages/inventaris/locations"), "InventoryLocations");
const InventoryShow = lazyNamed(() => import("@/pages/inventaris/show"), "InventoryShow");
const InventoryProductShow = lazyNamed(() => import("@/pages/inventaris/product"), "InventoryProductShow");

const CatalogList = lazyNamed(() => import("@/pages/katalog/list"), "CatalogList");
const CatalogManage = lazyNamed(() => import("@/pages/katalog/manage"), "CatalogManage");
const CatalogQuickItem = lazyNamed(() => import("@/pages/katalog/quick-item"), "CatalogQuickItem");
const CatalogEdit = lazyNamed(() => import("@/pages/katalog/edit"), "CatalogEdit");
const CatalogShow = lazyNamed(() => import("@/pages/katalog/show"), "CatalogShow");
const CatalogPackage = lazyNamed(() => import("@/pages/katalog/package"), "CatalogPackagePage");

const RenterList = lazyNamed(() => import("@/pages/penyewa/list"), "RenterList");
const RenterCreate = lazyNamed(() => import("@/pages/penyewa/create"), "RenterCreate");
const RenterShow = lazyNamed(() => import("@/pages/penyewa/show"), "RenterShow");

const SupplierList = lazyNamed(() => import("@/pages/pemasok/list"), "SupplierList");
const SupplierShow = lazyNamed(() => import("@/pages/pemasok/show"), "SupplierShow");
const SupplierCreate = lazyNamed(() => import("@/pages/pemasok/create"), "SupplierCreate");

const PurchaseList = lazyNamed(() => import("@/pages/pembelian/list"), "PurchaseList");
const PurchaseShow = lazyNamed(() => import("@/pages/pembelian/show"), "PurchaseShow");
const PurchaseCreate = lazyNamed(() => import("@/pages/pembelian/create"), "PurchaseCreate");

const RequestList = lazyNamed(() => import("@/pages/permintaan/list"), "RequestList");
const RequestShow = lazyNamed(() => import("@/pages/permintaan/show"), "RequestShow");

const ReservationList = lazyNamed(() => import("@/pages/reservasi/list"), "ReservationList");
const ReservationShow = lazyNamed(() => import("@/pages/reservasi/show"), "ReservationShow");
const ReservationCreate = lazyNamed(() => import("@/pages/reservasi/create"), "ReservationCreate");

const FinanceHome = lazyNamed(() => import("@/pages/keuangan/home"), "FinanceHome");
const FinanceAccountList = lazyNamed(() => import("@/pages/keuangan/accounts"), "FinanceAccountList");
const FinanceAccountShow = lazyNamed(() => import("@/pages/keuangan/account-show"), "FinanceAccountShow");

const loadTransactions = () => import("@/pages/keuangan/transactions");
const TransaksiList = lazyNamed(loadTransactions, "TransactionList");
const TransaksiShow = lazyNamed(loadTransactions, "TransactionShow");

const loadPayments = () => import("@/pages/keuangan/payments");
const PembayaranList = lazyNamed(loadPayments, "PaymentList");
const PembayaranShow = lazyNamed(loadPayments, "PaymentShow");

const loadExpenses = () => import("@/pages/keuangan/expenses");
const PengeluaranList = lazyNamed(loadExpenses, "ExpenseList");
const PengeluaranShow = lazyNamed(loadExpenses, "ExpenseShow");

const PaymentCreate = lazyNamed(() => import("@/pages/keuangan/create-payment"), "PaymentCreate");
const ExpenseCreate = lazyNamed(() => import("@/pages/keuangan/create-expense"), "ExpenseCreate");

const RentalList = lazyNamed(() => import("@/pages/penyewaan/list"), "RentalList");
const RentalWalkIn = lazyNamed(() => import("@/pages/penyewaan/walk-in"), "RentalWalkIn");
const RentalShow = lazyNamed(() => import("@/pages/penyewaan/show"), "RentalShow");

const ReturnList = lazyNamed(() => import("@/pages/pengembalian/list"), "ReturnList");
const ReturnShow = lazyNamed(() => import("@/pages/pengembalian/show"), "ReturnShow");

const InspectionList = lazyNamed(() => import("@/pages/pemeriksaan/list"), "InspectionList");
const InspectionShow = lazyNamed(() => import("@/pages/pemeriksaan/show"), "InspectionShow");

const MaintenanceList = lazyNamed(() => import("@/pages/perawatan/list"), "PerawatanList");
const MaintenanceCreate = lazyNamed(() => import("@/pages/perawatan/create"), "PerawatanCreate");
const MaintenanceShow = lazyNamed(() => import("@/pages/perawatan/show"), "PerawatanShow");

const NotificationList = lazyNamed(() => import("@/pages/pemberitahuan"), "PemberitahuanList");
const Reports = lazyNamed(() => import("@/pages/laporan"), "LaporanPage");
const QrResolve = lazyNamed(() => import("@/pages/qr-operasional/resolve"), "QrResolvePage");

function RouteLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
        <span className="size-2.5 animate-pulse rounded-full bg-primary" />
        Memuat halaman…
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  return (
    <Authenticated key="admin-auth" fallback={<Navigate to="/login" replace />}>
      <Layout>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </Layout>
    </Authenticated>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<RouteLoading />}>
            <Login />
          </Suspense>
        }
      />
      <Route element={<AuthenticatedLayout />}>
          <Route index element={<NavigateToResource resource="dashboard" />} />
          <Route path={paths.dashboard} element={<Dashboard />} />

          <Route path={paths.pemberitahuan} element={<NotificationList />} />
          <Route path={paths.laporan} element={<Reports />} />
          <Route path={paths.qrUnit + "/:token"} element={<QrResolve />} />
          <Route path={paths.qrPenyewaan + "/:token"} element={<QrResolve />} />

          <Route path={paths.inventaris}>
            <Route index element={<InventoryList />} />
            <Route path="create" element={<InventoryCreate />} />
            <Route path="lokasi" element={<InventoryLocations />} />
            <Route path="barang/:id" element={<InventoryProductShow />} />
            <Route path=":id" element={<InventoryShow />} />
          </Route>

          <Route path={paths.katalog}>
            <Route index element={<CatalogList />} />
            <Route path="tambah" element={<CatalogQuickItem />} />
            <Route path="manage" element={<CatalogManage />} />
            <Route path="paket/tambah" element={<CatalogPackage />} />
            <Route path="paket/:id" element={<CatalogPackage />} />
            <Route path="edit/:id" element={<CatalogEdit />} />
            <Route path="show/:id" element={<CatalogShow />} />
          </Route>

          <Route path={paths.penyewa}>
            <Route index element={<RenterList />} />
            <Route path="create" element={<RenterCreate />} />
            <Route path=":id" element={<RenterShow />} />
          </Route>

          <Route path={paths.pemasok}>
            <Route index element={<SupplierList />} />
            <Route path="create" element={<SupplierCreate />} />
            <Route path=":id/edit" element={<SupplierCreate />} />
            <Route path=":id" element={<SupplierShow />} />
          </Route>

          <Route path={paths.pembelian}>
            <Route index element={<PurchaseList />} />
            <Route path="create" element={<PurchaseCreate />} />
            <Route path=":id/edit" element={<PurchaseCreate />} />
            <Route path=":id" element={<PurchaseShow />} />
          </Route>

          <Route path={paths.permintaan}>
            <Route index element={<RequestList />} />
            <Route path=":id" element={<RequestShow />} />
          </Route>

          <Route path={paths.reservasi}>
            <Route index element={<ReservationList />} />
            <Route path="create" element={<ReservationCreate />} />
            <Route path=":id" element={<ReservationShow />} />
          </Route>

          <Route path={paths.keuangan}>
            <Route index element={<FinanceHome />} />
            <Route path="akun" element={<FinanceAccountList />} />
            <Route path="akun/:id" element={<FinanceAccountShow />} />
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
            <Route index element={<RentalList />} />
            <Route path="walk-in" element={<RentalWalkIn />} />
            <Route path=":id" element={<RentalShow />} />
          </Route>

          <Route path={paths.pengembalian}>
            <Route index element={<ReturnList />} />
            <Route path=":id" element={<ReturnShow />} />
          </Route>

          <Route path={paths.pemeriksaan}>
            <Route index element={<InspectionList />} />
            <Route path=":id" element={<InspectionShow />} />
          </Route>

          <Route path={paths.perawatan}>
            <Route index element={<MaintenanceList />} />
            <Route path="create" element={<MaintenanceCreate />} />
            <Route path=":id" element={<MaintenanceShow />} />
          </Route>

          <Route path="*" element={<ErrorComponent />} />
        </Route>
      </Routes>
  );
}
