import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
  getPenyewaanContext: vi.fn(),
  listRentals: vi.fn(),
  getRental: vi.fn(),
  getRentalCapabilities: vi.fn(),
}));

vi.mock("@/features/penyewaan/service", () => serviceMock);
vi.mock("@/features/penyewaan/utils", () => ({
  semanticRentalLabel: (value: string | null | undefined) => value ?? "-",
  rentalStatusVariant: () => "secondary",
  formatRentalDateTime: (value: string | null | undefined) => value ?? "-",
  formatRentalMoney: (value: string | number | null | undefined) => String(value ?? "-"),
}));

import { RentalList } from "@/pages/penyewaan/list";
import { RentalShow } from "@/pages/penyewaan/show";

const context = { akunAdminId:"admin-1", usahaId:"usaha-a", usahaNama:"Usaha A" };
const rental = {
  penyewaan_id:"rental-1", usaha_id:"usaha-a", reservasi_id:"reservation-1", penyewa_id:"renter-1", nomor_penyewaan:"RNT-001",
  jadwal_mulai:"2026-10-01T10:00:00Z", jadwal_kembali:"2026-10-03T10:00:00Z", tolerance_deadline:"2026-10-03T20:00:00Z",
  actual_pickup_at:"2026-10-01T10:15:00Z", actual_return_started_at:null, actual_return_completed_at:null, status:"active",
  total_amount:"750000", currency_code:"IDR", catatan:null, created_at:"2026-10-01T09:00:00Z", updated_at:"2026-10-01T10:15:00Z",
  penyewa_nama:"Ahmad Outdoor", detail_count:1, assignment_count:2,
};

function wrapper(element: React.ReactNode, route: string) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions:{queries:{retry:false}} })}><MemoryRouter initialEntries={[route]}>{element}</MemoryRouter></QueryClientProvider>); }

describe("Penyewaan read-side",()=> {
  beforeEach(()=> {
    serviceMock.getPenyewaanContext.mockReset();
    serviceMock.listRentals.mockReset();
    serviceMock.getRental.mockReset();
    serviceMock.getRentalCapabilities.mockReturnValue({read:true,mutation:false,reason:"Trusted rental command belum tersedia."});
  });
  test("rental list stays tenant-scoped and separates assignment from pickup",async()=> {
    serviceMock.getPenyewaanContext.mockResolvedValue(context);
    serviceMock.listRentals.mockResolvedValue({rentals:[rental],total:1});
    wrapper(<RentalList/>,"/penyewaan");
    expect((await screen.findAllByText("RNT-001")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Data Penyewaan/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
  test("rental detail keeps inventory and finance ownership boundaries",async()=> {
    serviceMock.getPenyewaanContext.mockResolvedValue(context);
    serviceMock.getRental.mockResolvedValue({
      ...rental,
      lines:[{detail_penyewaan_id:"detail-1",usaha_id:"usaha-a",penyewaan_id:"rental-1",barang_id:"barang-1",varian_barang_id:null,paket_sewa_id:null,jumlah:"2",unit_price:"375000",currency_code:"IDR",subtotal:"750000",catatan:null,barang_nama:"Tenda Dome 4P",varian_nama:null,paket_nama:null}],
      components:[],
      assignments:[{penetapan_unit_id:"assign-1",usaha_id:"usaha-a",detail_penyewaan_id:"detail-1",komponen_penyewaan_id:null,unit_barang_id:"unit-1",asal_pilihan_unit_id:null,status:"assigned",ditetapkan_at:"2026-10-01T09:30:00Z",dibatalkan_at:null,alasan_substitusi:null,ditetapkan_by_admin_id:"admin-1",catatan:null,kode_unit:"TD4P-001"}],
      handover:{serah_terima_id:"handover-1",usaha_id:"usaha-a",penyewaan_id:"rental-1",serah_terima_at:"2026-10-01T10:15:00Z",actor_admin_id:"admin-1",status:"completed",catatan:null},
      extensions:[],
    });
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={["/penyewaan/rental-1"]}><Routes><Route path="/penyewaan/:id" element={<RentalShow/>}/></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading",{level:1,name:"RNT-001"})).toBeInTheDocument();
    expect(screen.getByText("TD4P-001")).toBeInTheDocument();
    expect(screen.getByText(/Pembayaran tetap dikelola oleh Keuangan/)).toBeInTheDocument();
  });
});
