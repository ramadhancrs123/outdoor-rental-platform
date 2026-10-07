import ExcelJS from "exceljs";
import { supabase } from "@/app/providers/supabase/client";
import type {
  InventoryListFilters,
  InventoryUnit,
} from "./types";
import { listInventoryPackageAvailability, listInventoryUnits } from "./service";

const COLORS = {
  navy: "17233B",
  blue: "2563EB",
  teal: "0F766E",
  green: "15803D",
  amber: "B45309",
  red: "B91C1C",
  slate: "475569",
  muted: "64748B",
  border: "CBD5E1",
  soft: "F8FAFC",
  softBlue: "EFF6FF",
  softGreen: "F0FDF4",
  softAmber: "FFFBEB",
  softRed: "FEF2F2",
  white: "FFFFFF",
};

const STATUS_LABELS: Record<string, string> = {
  ready: "Siap disewakan",
  rented: "Sedang disewa",
  inspection_pending: "Perlu pemeriksaan",
  maintenance: "Perawatan",
  damaged: "Rusak",
  lost: "Hilang",
  inactive: "Dinonaktifkan",
  active: "Aktif",
  planned: "Direncanakan",
  in_progress: "Sedang dikerjakan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  pending: "Menunggu",
};

const EVENT_LABELS: Record<string, string> = {
  unit_created: "Unit dibuat",
  unit_registered: "Unit didaftarkan",
  unit_moved: "Unit dipindahkan",
  unit_rented: "Unit disewa",
  unit_returned: "Unit dikembalikan",
  unit_inspection_pending: "Diteruskan ke pemeriksaan",
  inspection_completed: "Pemeriksaan selesai",
  maintenance_started: "Perawatan dimulai",
  maintenance_completed: "Perawatan selesai",
  maintenance_verification_passed: "Verifikasi perawatan berhasil",
  maintenance_verification_failed: "Verifikasi perawatan belum berhasil",
  unit_ready: "Unit ditetapkan siap disewakan",
  unit_status_changed: "Status unit berubah",
  unit_condition_corrected: "Kondisi unit dikoreksi",
  unit_deactivated: "Unit dinonaktifkan",
};

const SOURCE_LABELS: Record<string, string> = {
  penyewaan: "Penyewaan",
  pengembalian: "Pengembalian",
  pemeriksaan: "Pemeriksaan",
  perawatan: "Perawatan",
  pembelian: "Pembelian",
  sistem: "Sistem",
  admin: "Admin",
};

type BusinessProfile = {
  usaha_id: string;
  slug: string;
  nama: string;
  deskripsi: string | null;
  alamat: string | null;
  nomor_telepon: string | null;
  email: string | null;
  timezone: string;
  status: string;
};

type RentalAssignment = {
  unit_barang_id: string;
  assigned_rental_id: string | null;
  assigned_rental_number: string | null;
  assigned_rental_status: string | null;
  assigned_rental_start: string | null;
  assigned_rental_end: string | null;
  actual_pickup_at: string | null;
  actual_return_started_at: string | null;
  actual_return_completed_at: string | null;
};

type ReturnRow = {
  detail_pengembalian_id: string;
  pengembalian_id: string;
  unit_barang_id: string;
  diterima_at: string;
  status_pemeriksaan: string;
  catatan: string | null;
};

type InspectionRow = {
  pemeriksaan_id: string;
  unit_barang_id: string;
  diperiksa_at: string;
  hasil: string;
  kelengkapan_status: string;
  keputusan_operasional: string;
  catatan: string | null;
};

type MaintenanceRow = {
  perawatan_id: string;
  unit_barang_id: string;
  pemeriksaan_id: string | null;
  jenis_perawatan: string;
  deskripsi_pekerjaan: string;
  status: string;
  dimulai_at: string | null;
  selesai_at: string | null;
  pelaksana: string | null;
  catatan: string | null;
  created_at: string;
};

type PurchaseRef = {
  nomor_pembelian: string | null;
  pemasok_nama: string | null;
};

type HistoryRow = {
  riwayat_unit_id: string;
  unit_barang_id: string;
  kode_unit: string;
  jenis_kejadian: string;
  terjadi_at: string;
  status_sebelum: string | null;
  status_sesudah: string | null;
  lokasi_sebelum_id: string | null;
  lokasi_sesudah_id: string | null;
  sumber_type: string | null;
  sumber_id: string | null;
  catatan: string | null;
};

function labelOf(value: string | null | undefined, map: Record<string, string> = STATUS_LABELS) {
  if (!value) return "—";
  return map[value] ?? value;
}

function dateText(value: string | null | undefined, timezone = "Asia/Jakarta") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dateOnlyText(value: string | null | undefined, timezone = "Asia/Jakarta") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function availabilityLabel(status: string, unitStatus: string) {
  if (unitStatus === "ready") return "Siap secara fisik";
  if (unitStatus === "rented") return "Sedang disewa";
  if (["inspection_pending", "maintenance", "damaged", "lost"].includes(unitStatus)) return "Perlu perhatian";
  return labelOf(status);
}

function filterDescription(filters: InventoryListFilters) {
  const items: string[] = [];
  if (filters.search.trim()) items.push(`Pencarian: ${filters.search.trim()}`);
  if (filters.status !== "all") items.push(`Status: ${labelOf(filters.status)}`);
  if (filters.barangId !== "all") items.push("Barang: dipilih pada halaman Inventaris");
  if (filters.varianBarangId !== "all") items.push("Varian: dipilih pada halaman Inventaris");
  if (filters.locationId !== "all") items.push("Lokasi: dipilih pada halaman Inventaris");
  if (filters.availabilityContext !== "all") {
    items.push(
      `Konteks: ${
        filters.availabilityContext === "ready_now"
          ? "Siap secara fisik"
          : filters.availabilityContext === "rental_active"
            ? "Sedang disewa"
            : "Perlu perhatian"
      }`,
    );
  }
  return items.length ? items.join("  •  ") : "Semua unit dalam Usaha yang dipilih";
}

async function loadBusinessProfile(usahaId: string): Promise<BusinessProfile> {
  const { data, error } = await supabase
    .from("usaha")
    .select("usaha_id,slug,nama,deskripsi,alamat,nomor_telepon,email,timezone,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Informasi Usaha aktif tidak ditemukan.");
  return data as BusinessProfile;
}

async function loadAllUnits(usahaId: string, filters: InventoryListFilters) {
  const rows: InventoryUnit[] = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const result = await listInventoryUnits(usahaId, {
      ...filters,
      page,
      pageSize,
    });
    rows.push(...result.units);
    if (rows.length >= result.total || result.units.length < pageSize) break;
    page += 1;
  }

  return rows;
}

async function loadRentalAssignments(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, RentalAssignment>();
  const { data, error } = await supabase
    .from("v_admin_unit_detail")
    .select("unit_barang_id,assigned_rental_id,assigned_rental_number,assigned_rental_status,assigned_rental_start,assigned_rental_end")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", unitIds);
  if (error) throw error;

  const assignments = (data ?? []) as RentalAssignment[];
  const rentalIds = [...new Set(assignments.map((row) => row.assigned_rental_id).filter(Boolean) as string[])];
  const rentalById = new Map<string, { actual_pickup_at: string | null; actual_return_started_at: string | null; actual_return_completed_at: string | null }>();

  if (rentalIds.length) {
    const { data: rentals, error: rentalError } = await supabase
      .from("penyewaan")
      .select("penyewaan_id,actual_pickup_at,actual_return_started_at,actual_return_completed_at")
      .eq("usaha_id", usahaId)
      .in("penyewaan_id", rentalIds);
    if (rentalError) throw rentalError;
    for (const rental of rentals ?? []) {
      rentalById.set(rental.penyewaan_id as string, {
        actual_pickup_at: (rental.actual_pickup_at as string | null) ?? null,
        actual_return_started_at: (rental.actual_return_started_at as string | null) ?? null,
        actual_return_completed_at: (rental.actual_return_completed_at as string | null) ?? null,
      });
    }
  }

  return new Map(
    assignments.map((row) => [row.unit_barang_id, {
      ...row,
      actual_pickup_at: row.assigned_rental_id ? rentalById.get(row.assigned_rental_id)?.actual_pickup_at ?? null : null,
      actual_return_started_at: row.assigned_rental_id ? rentalById.get(row.assigned_rental_id)?.actual_return_started_at ?? null : null,
      actual_return_completed_at: row.assigned_rental_id ? rentalById.get(row.assigned_rental_id)?.actual_return_completed_at ?? null : null,
    }]),
  );
}

async function loadReturns(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, ReturnRow>();
  const { data, error } = await supabase
    .from("detail_pengembalian")
    .select("detail_pengembalian_id,pengembalian_id,unit_barang_id,diterima_at,status_pemeriksaan,catatan")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", unitIds)
    .order("diterima_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, ReturnRow>();
  for (const row of (data ?? []) as ReturnRow[]) {
    if (!latest.has(row.unit_barang_id)) latest.set(row.unit_barang_id, row);
  }
  return latest;
}

async function loadInspections(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, InspectionRow>();
  const { data, error } = await supabase
    .from("pemeriksaan")
    .select("pemeriksaan_id,unit_barang_id,diperiksa_at,hasil,kelengkapan_status,keputusan_operasional,catatan")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", unitIds)
    .order("diperiksa_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, InspectionRow>();
  for (const row of (data ?? []) as InspectionRow[]) {
    if (!latest.has(row.unit_barang_id)) latest.set(row.unit_barang_id, row);
  }
  return latest;
}

async function loadMaintenances(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, MaintenanceRow[]>();
  const { data, error } = await supabase
    .from("perawatan")
    .select("perawatan_id,unit_barang_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,status,dimulai_at,selesai_at,pelaksana,catatan,created_at")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", unitIds)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const byUnit = new Map<string, MaintenanceRow[]>();
  for (const row of (data ?? []) as MaintenanceRow[]) {
    const list = byUnit.get(row.unit_barang_id) ?? [];
    list.push(row);
    byUnit.set(row.unit_barang_id, list);
  }
  return byUnit;
}

async function loadPurchaseRefs(usahaId: string, units: InventoryUnit[]) {
  const detailIds = [...new Set(units.map((unit) => unit.sumber_pembelian_detail_id).filter(Boolean) as string[])];
  if (!detailIds.length) return new Map<string, PurchaseRef>();

  const { data: details, error: detailError } = await supabase
    .from("detail_pembelian")
    .select("detail_pembelian_id,pembelian_id")
    .eq("usaha_id", usahaId)
    .in("detail_pembelian_id", detailIds);
  if (detailError) throw detailError;

  const purchaseIds = [...new Set((details ?? []).map((row) => row.pembelian_id as string))];
  if (!purchaseIds.length) return new Map<string, PurchaseRef>();

  const { data: purchases, error: purchaseError } = await supabase
    .from("pembelian")
    .select("pembelian_id,nomor_pembelian,pemasok_id")
    .eq("usaha_id", usahaId)
    .in("pembelian_id", purchaseIds);
  if (purchaseError) throw purchaseError;

  const supplierIds = [...new Set((purchases ?? []).map((row) => row.pemasok_id as string).filter(Boolean))];
  const { data: suppliers, error: supplierError } = supplierIds.length
    ? await supabase.from("pemasok").select("pemasok_id,nama").eq("usaha_id", usahaId).in("pemasok_id", supplierIds)
    : { data: [], error: null };
  if (supplierError) throw supplierError;

  const supplierNames = new Map((suppliers ?? []).map((row) => [row.pemasok_id as string, row.nama as string]));
  const purchaseMap = new Map<string, PurchaseRef>();
  for (const purchase of purchases ?? []) {
    purchaseMap.set(purchase.pembelian_id as string, {
      nomor_pembelian: (purchase.nomor_pembelian as string | null) ?? null,
      pemasok_nama: purchase.pemasok_id ? supplierNames.get(purchase.pemasok_id as string) ?? null : null,
    });
  }

  const result = new Map<string, PurchaseRef>();
  for (const detail of details ?? []) {
    const ref = purchaseMap.get(detail.pembelian_id as string);
    if (ref) result.set(detail.detail_pembelian_id as string, ref);
  }
  return result;
}

async function loadHistory(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return [] as HistoryRow[];
  const { data, error } = await supabase
    .from("v_admin_unit_history")
    .select("riwayat_unit_id,unit_barang_id,kode_unit,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,catatan")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", unitIds)
    .order("terjadi_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as HistoryRow[];
}

function setTitleStyle(cell: ExcelJS.Cell, fill: string = COLORS.navy) {
  cell.font = { name: "Aptos Display", size: 18, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { vertical: "middle" };
}

function setSectionStyle(cell: ExcelJS.Cell, fill: string = COLORS.blue) {
  cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { vertical: "middle" };
}

function setHeaderStyle(cell: ExcelJS.Cell) {
  cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.teal } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };
}

function setDataStyle(cell: ExcelJS.Cell) {
  cell.font = { name: "Aptos", size: 10, color: { argb: COLORS.navy } };
  cell.alignment = { vertical: "top", wrapText: true };
  cell.border = {
    top: { style: "hair", color: { argb: COLORS.border } },
    bottom: { style: "hair", color: { argb: COLORS.border } },
    left: { style: "hair", color: { argb: COLORS.border } },
    right: { style: "hair", color: { argb: COLORS.border } },
  };
}

function addTopHeader(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  profile: BusinessProfile,
  totalColumns: number,
) {
  const lastColumn = Math.max(totalColumns, 8);
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(2, 1).value = subtitle;
  setTitleStyle(sheet.getCell(1, 1));
  sheet.getCell(2, 1).font = { name: "Aptos", size: 10, color: { argb: "E2E8F0" }, italic: true };
  sheet.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 20;

  sheet.mergeCells(4, 1, 4, 2);
  sheet.getCell(4, 1).value = "Informasi Usaha";
  setSectionStyle(sheet.getCell(4, 1), COLORS.blue);
  sheet.mergeCells(4, 3, 4, lastColumn);
  sheet.getCell(4, 3).value = profile.nama;
  setSectionStyle(sheet.getCell(4, 3), COLORS.navy);

  const businessRows = [
    ["Nama Usaha", profile.nama, "Alamat", profile.alamat || "—"],
    ["Nomor Telepon", profile.nomor_telepon || "—", "Email", profile.email || "—"],
    ["Zona Waktu", profile.timezone || "Asia/Jakarta", "Status Usaha", labelOf(profile.status)],
  ];

  businessRows.forEach((values, index) => {
    const row = sheet.getRow(5 + index);
    row.values = [undefined, ...values];
    for (let column = 1; column <= 4; column += 1) {
      const cell = row.getCell(column);
      setDataStyle(cell);
      if (column % 2 === 1) {
        cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.slate } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.soft } };
      }
    }
    sheet.mergeCells(5 + index, 4, 5 + index, lastColumn);
  });
  const descriptionRow = sheet.getRow(8);
  descriptionRow.getCell(1).value = "Deskripsi Usaha";
  descriptionRow.getCell(2).value = profile.deskripsi || "—";
  setDataStyle(descriptionRow.getCell(1));
  setDataStyle(descriptionRow.getCell(2));
  descriptionRow.getCell(1).font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.slate } };
  descriptionRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.soft } };
  sheet.mergeCells(8, 2, 8, lastColumn);
  sheet.getColumn(1).width = 19;
  sheet.getColumn(2).width = 27;
  sheet.getColumn(3).width = 17;
  sheet.getColumn(4).width = 28;
  if (lastColumn > 4) {
    for (let column = 5; column <= lastColumn; column += 1) sheet.getColumn(column).width = 16;
  }
}

function prepareDataSheet(sheet: ExcelJS.Worksheet, startRow: number, headers: string[], tabColor: string) {
  sheet.properties.tabColor = { argb: tabColor };
  sheet.views = [{ state: "frozen", ySplit: startRow }];
  sheet.getRow(startRow).height = 32;
  sheet.getRow(startRow).values = [undefined, ...headers];
  headers.forEach((_, index) => setHeaderStyle(sheet.getCell(startRow, index + 1)));
  sheet.autoFilter = {
    from: { row: startRow, column: 1 },
    to: { row: startRow, column: headers.length },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
}

function styleDataRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 30;
    for (let column = 1; column <= row.cellCount; column += 1) {
      const cell = row.getCell(column);
      setDataStyle(cell);
      if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.soft } };
    }
  }
}

function setStatusCell(cell: ExcelJS.Cell, status: string) {
  const colors: Record<string, [string, string]> = {
    ready: [COLORS.softGreen, COLORS.green],
    rented: [COLORS.softAmber, COLORS.amber],
    maintenance: ["FEF3C7", COLORS.amber],
    inspection_pending: [COLORS.softBlue, COLORS.blue],
    damaged: [COLORS.softRed, COLORS.red],
    lost: [COLORS.softRed, COLORS.red],
    inactive: ["F1F5F9", COLORS.slate],
  };
  const [fill, font] = colors[status] ?? [COLORS.soft, COLORS.slate];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: font } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

export async function exportInventoryToExcel(usahaId: string, filters: InventoryListFilters) {
  const [profile, units, packages] = await Promise.all([
    loadBusinessProfile(usahaId),
    loadAllUnits(usahaId, filters),
    listInventoryPackageAvailability(usahaId),
  ]);

  const unitIds = units.map((unit) => unit.unit_barang_id);
  const [assignments, returns, inspections, maintenances, purchaseRefs, history] = await Promise.all([
    loadRentalAssignments(usahaId, unitIds),
    loadReturns(usahaId, unitIds),
    loadInspections(usahaId, unitIds),
    loadMaintenances(usahaId, unitIds),
    loadPurchaseRefs(usahaId, units),
    loadHistory(usahaId, unitIds),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rental Outdoor";
  workbook.lastModifiedBy = "Rental Outdoor";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;

  const summary = workbook.addWorksheet("Ringkasan");
  summary.properties.tabColor = { argb: COLORS.navy };
  addTopHeader(summary, "Laporan Inventaris", `Data fisik dan konteks operasional • ${dateText(new Date().toISOString(), profile.timezone)}`, profile, 8);
  summary.mergeCells(9, 1, 9, 8);
  summary.getCell(9, 1).value = `Filter ekspor: ${filterDescription(filters)}`;
  summary.getCell(9, 1).font = { name: "Aptos", size: 10, color: { argb: COLORS.slate }, italic: true };
  summary.getCell(9, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.softBlue } };
  summary.getRow(9).height = 24;

  const statusCounts = units.reduce<Record<string, number>>((acc, unit) => {
    acc[unit.status] = (acc[unit.status] ?? 0) + 1;
    return acc;
  }, {});
  const readyCount = statusCounts.ready ?? 0;
  const rentedCount = statusCounts.rented ?? 0;
  const attentionCount = ["inspection_pending", "maintenance", "damaged", "lost"].reduce(
    (total, status) => total + (statusCounts[status] ?? 0),
    0,
  );
  const inactiveCount = statusCounts.inactive ?? 0;
  const availablePackages = packages.filter((pkg) => pkg.status === "available").length;

  const kpis: Array<[string, number, string]> = [
    ["Unit dalam ekspor", units.length, COLORS.blue],
    ["Siap disewakan", readyCount, COLORS.green],
    ["Sedang disewa", rentedCount, COLORS.amber],
    ["Perlu perhatian", attentionCount, COLORS.red],
    ["Dinonaktifkan", inactiveCount, COLORS.slate],
    ["Paket tersedia", availablePackages, COLORS.teal],
  ];
  kpis.forEach(([label, value, color], index) => {
    const startColumn = 1 + (index % 3) * 3;
    const row = 11 + Math.floor(index / 3) * 3;
    summary.mergeCells(row, startColumn, row, startColumn + 1);
    summary.mergeCells(row + 1, startColumn, row + 1, startColumn + 1);
    summary.getCell(row, startColumn).value = label;
    summary.getCell(row + 1, startColumn).value = value;
    summary.getCell(row, startColumn).font = { name: "Aptos", size: 9, bold: true, color: { argb: COLORS.muted } };
    summary.getCell(row + 1, startColumn).font = { name: "Aptos Display", size: 18, bold: true, color: { argb: color } };
    summary.getCell(row, startColumn).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.soft } };
    summary.getCell(row + 1, startColumn).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.soft } };
  });

  const summaryStart = 18;
  summary.mergeCells(summaryStart, 1, summaryStart, 8);
  summary.getCell(summaryStart, 1).value = "Isi workbook";
  setSectionStyle(summary.getCell(summaryStart, 1), COLORS.teal);
  const summaryRows = [
    ["Unit Barang", "Satu baris untuk satu unit fisik aktual yang dimiliki Usaha."],
    ["Konteks Operasional", "Informasi penyewaan, pengembalian, pemeriksaan, dan perawatan yang tersedia saat ekspor."],
    ["Riwayat Unit", "Riwayat peristiwa unit sesuai sumber histori Inventaris."],
    ["Paket Sewa", "Ringkasan paket berdasarkan komposisi dan jumlah unit fisik yang siap saat ekspor."],
    ["Komponen Paket", "Rincian kebutuhan komponen dan kondisi unit yang membatasi ketersediaan paket."],
  ];
  summaryRows.forEach(([name, description], index) => {
    const row = summary.getRow(summaryStart + 1 + index);
    row.values = [undefined, name, description];
    row.getCell(2).font = { name: "Aptos", size: 10, bold: true, color: { argb: COLORS.navy } };
    row.getCell(3).font = { name: "Aptos", size: 10, color: { argb: COLORS.slate } };
    summary.mergeCells(summaryStart + 1 + index, 3, summaryStart + 1 + index, 8);
    setDataStyle(row.getCell(2));
    setDataStyle(row.getCell(3));
  });
  summary.getColumn(1).width = 18;
  summary.getColumn(2).width = 24;
  summary.getColumn(3).width = 22;
  summary.getColumn(4).width = 18;
  summary.getColumn(5).width = 18;
  summary.getColumn(6).width = 18;
  summary.getColumn(7).width = 18;
  summary.getColumn(8).width = 18;
  summary.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };

  const unitSheet = workbook.addWorksheet("Unit Barang");
  addTopHeader(unitSheet, "Unit Barang", `Data unit fisik • ${units.length.toLocaleString("id-ID")} unit`, profile, 16);
  const unitHeaderRow = 10;
  const unitHeaders = [
    "No",
    "Kode Unit",
    "Barang",
    "Varian",
    "Kode Varian",
    "Nomor Seri",
    "Status Unit",
    "Kondisi",
    "Lokasi",
    "Tipe Lokasi",
    "Tanggal Diperoleh",
    "Nomor Pembelian",
    "Pemasok",
    "Catatan Internal",
    "Dibuat Pada",
    "Terakhir Diperbarui",
  ];
  prepareDataSheet(unitSheet, unitHeaderRow, unitHeaders, COLORS.blue);
  units.forEach((unit, index) => {
    const purchase = unit.sumber_pembelian_detail_id ? purchaseRefs.get(unit.sumber_pembelian_detail_id) : null;
    const row = unitSheet.getRow(unitHeaderRow + 1 + index);
    row.values = [
      index + 1,
      unit.kode_unit,
      unit.barang?.nama ?? "—",
      unit.varian?.nama ?? "—",
      unit.varian?.kode_internal ?? "—",
      unit.serial_number ?? "—",
      labelOf(unit.status),
      unit.kondisi_ringkas ?? "—",
      unit.lokasi?.nama ?? "—",
      unit.lokasi?.tipe ? labelOf(unit.lokasi.tipe) : "—",
      unit.tanggal_diperoleh ? dateOnlyText(unit.tanggal_diperoleh, profile.timezone) : "—",
      purchase?.nomor_pembelian ?? "—",
      purchase?.pemasok_nama ?? "—",
      unit.catatan_internal ?? "—",
      dateText(unit.created_at, profile.timezone),
      dateText(unit.updated_at, profile.timezone),
    ];
  });
  styleDataRows(unitSheet, unitHeaderRow + 1, Math.max(unitHeaderRow + 1, unitHeaderRow + units.length));
  units.forEach((unit, index) => setStatusCell(unitSheet.getCell(unitHeaderRow + 1 + index, 7), unit.status));
  [5, 6, 12, 13, 14].forEach((column) => unitSheet.getColumn(column).alignment = { vertical: "top", wrapText: true });
  ["K", "O", "P"].forEach((column) => unitSheet.getColumn(column).numFmt = "dd/mm/yyyy hh:mm");
  const unitWidths = [8, 18, 24, 19, 16, 19, 19, 24, 22, 16, 17, 18, 22, 32, 21, 23];
  unitWidths.forEach((width, index) => (unitSheet.getColumn(index + 1).width = width));

  const contextSheet = workbook.addWorksheet("Konteks Operasional");
  addTopHeader(contextSheet, "Konteks Operasional", "Keadaan lintas proses yang tersedia pada saat ekspor", profile, 20);
  const contextHeaderRow = 10;
  const contextHeaders = [
    "No",
    "Kode Unit",
    "Status Unit Saat Ekspor",
    "Konteks Saat Ini",
    "Nomor Penyewaan",
    "Status Penyewaan",
    "Jadwal Mulai",
    "Jadwal Kembali",
    "Pengambilan",
    "Pengembalian Dimulai",
    "Pengembalian Selesai",
    "Pemeriksaan Terakhir",
    "Hasil Pemeriksaan",
    "Kelengkapan",
    "Keputusan Operasional",
    "Perawatan Terakhir",
    "Status Perawatan",
    "Perawatan Aktif",
    "Pelaksana Terakhir",
    "Catatan Perawatan",
  ];
  prepareDataSheet(contextSheet, contextHeaderRow, contextHeaders, COLORS.teal);
  units.forEach((unit, index) => {
    const assignment = assignments.get(unit.unit_barang_id);
    const returned = returns.get(unit.unit_barang_id);
    const inspected = inspections.get(unit.unit_barang_id);
    const maintenanceList = maintenances.get(unit.unit_barang_id) ?? [];
    const latestMaintenance = maintenanceList[0];
    const openMaintenance = maintenanceList.filter((item) => item.status === "planned" || item.status === "in_progress");
    const row = contextSheet.getRow(contextHeaderRow + 1 + index);
    row.values = [
      index + 1,
      unit.kode_unit,
      labelOf(unit.status),
      availabilityLabel(unit.status, unit.status),
      assignment?.assigned_rental_number ?? "—",
      labelOf(assignment?.assigned_rental_status),
      assignment?.assigned_rental_start ? dateText(assignment.assigned_rental_start, profile.timezone) : "—",
      assignment?.assigned_rental_end ? dateText(assignment.assigned_rental_end, profile.timezone) : "—",
      assignment?.actual_pickup_at ? dateText(assignment.actual_pickup_at, profile.timezone) : "—",
      assignment?.actual_return_started_at ? dateText(assignment.actual_return_started_at, profile.timezone) : "—",
      assignment?.actual_return_completed_at ? dateText(assignment.actual_return_completed_at, profile.timezone) : (returned?.diterima_at ? dateText(returned.diterima_at, profile.timezone) : "—"),
      inspected?.diperiksa_at ? dateText(inspected.diperiksa_at, profile.timezone) : "—",
      labelOf(inspected?.hasil),
      labelOf(inspected?.kelengkapan_status),
      labelOf(inspected?.keputusan_operasional),
      latestMaintenance ? dateText(latestMaintenance.created_at, profile.timezone) : "—",
      labelOf(latestMaintenance?.status),
      openMaintenance.length ? `${openMaintenance.length} pekerjaan` : "Tidak ada",
      latestMaintenance?.pelaksana ?? "—",
      latestMaintenance?.catatan ?? "—",
    ];
  });
  styleDataRows(contextSheet, contextHeaderRow + 1, Math.max(contextHeaderRow + 1, contextHeaderRow + units.length));
  units.forEach((unit, index) => setStatusCell(contextSheet.getCell(contextHeaderRow + 1 + index, 3), unit.status));
  const contextWidths = [8, 18, 20, 21, 19, 20, 21, 21, 24, 23, 23, 23, 20, 20, 24, 23, 20, 18, 22, 32];
  contextWidths.forEach((width, index) => (contextSheet.getColumn(index + 1).width = width));

  const historySheet = workbook.addWorksheet("Riwayat Unit");
  addTopHeader(historySheet, "Riwayat Unit", `${history.length.toLocaleString("id-ID")} peristiwa yang tersedia untuk unit hasil ekspor`, profile, 11);
  const historyHeaderRow = 10;
  const historyHeaders = [
    "No",
    "Kode Unit",
    "Waktu Kejadian",
    "Jenis Kejadian",
    "Status Sebelum",
    "Status Sesudah",
    "Lokasi Sebelum",
    "Lokasi Sesudah",
    "Sumber Kejadian",
    "Referensi Sumber",
    "Catatan",
  ];
  prepareDataSheet(historySheet, historyHeaderRow, historyHeaders, COLORS.slate);
  const locationIds = [...new Set(history.flatMap((row) => [row.lokasi_sebelum_id, row.lokasi_sesudah_id]).filter(Boolean) as string[])];
  const locationNames = new Map<string, string>();
  if (locationIds.length) {
    const { data: locations, error } = await supabase
      .from("lokasi")
      .select("lokasi_id,nama")
      .eq("usaha_id", usahaId)
      .in("lokasi_id", locationIds);
    if (error) throw error;
    for (const location of locations ?? []) locationNames.set(location.lokasi_id as string, location.nama as string);
  }
  history.forEach((item, index) => {
    const row = historySheet.getRow(historyHeaderRow + 1 + index);
    row.values = [
      index + 1,
      item.kode_unit,
      dateText(item.terjadi_at, profile.timezone),
      labelOf(item.jenis_kejadian, EVENT_LABELS),
      labelOf(item.status_sebelum),
      labelOf(item.status_sesudah),
      item.lokasi_sebelum_id ? locationNames.get(item.lokasi_sebelum_id) ?? "Lokasi tidak ditemukan" : "—",
      item.lokasi_sesudah_id ? locationNames.get(item.lokasi_sesudah_id) ?? "Lokasi tidak ditemukan" : "—",
      labelOf(item.sumber_type, SOURCE_LABELS),
      item.sumber_id ?? "—",
      item.catatan ?? "—",
    ];
  });
  styleDataRows(historySheet, historyHeaderRow + 1, Math.max(historyHeaderRow + 1, historyHeaderRow + history.length));
  [3, 10].forEach((column) => (historySheet.getColumn(column).width = column === 3 ? 22 : 38));
  [1, 2, 4, 5, 6, 7, 8, 9, 11].forEach((column) => {
    if (!historySheet.getColumn(column).width) historySheet.getColumn(column).width = 21;
  });

  const packageSheet = workbook.addWorksheet("Paket Sewa");
  addTopHeader(packageSheet, "Paket Sewa", `${packages.length.toLocaleString("id-ID")} paket aktif dan ketersediaan fisiknya`, profile, 8);
  const packageHeaderRow = 10;
  const packageHeaders = [
    "No",
    "Nama Paket",
    "Deskripsi",
    "Harga Dasar",
    "Mata Uang",
    "Ketersediaan Saat Ekspor",
    "Jumlah Paket Siap Disewakan",
    "Komponen Pembatas",
  ];
  prepareDataSheet(packageSheet, packageHeaderRow, packageHeaders, COLORS.blue);
  packages.forEach((pkg, index) => {
    const row = packageSheet.getRow(packageHeaderRow + 1 + index);
    row.values = [
      index + 1,
      pkg.nama,
      pkg.deskripsi ?? "—",
      pkg.harga_dasar ?? null,
      pkg.currency_code,
      pkg.status === "available" ? "Tersedia" : "Belum mencukupi",
      pkg.available_package_quantity,
      pkg.limiting_component_name ?? "—",
    ];
  });
  styleDataRows(packageSheet, packageHeaderRow + 1, Math.max(packageHeaderRow + 1, packageHeaderRow + packages.length));
  packages.forEach((pkg, index) => {
    const cell = packageSheet.getCell(packageHeaderRow + 1 + index, 6);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pkg.status === "available" ? COLORS.softGreen : COLORS.softAmber } };
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: pkg.status === "available" ? COLORS.green : COLORS.amber } };
  });
  packageSheet.getColumn(4).numFmt = '#,##0';
  [2, 3, 8].forEach((column) => (packageSheet.getColumn(column).alignment = { vertical: "top", wrapText: true }));
  [8, 28, 44, 18, 14, 24, 25, 32].forEach((width, index) => (packageSheet.getColumn(index + 1).width = width));

  const componentSheet = workbook.addWorksheet("Komponen Paket");
  addTopHeader(componentSheet, "Komponen Paket", "Kebutuhan fisik setiap paket dan kondisi unit yang tersedia", profile, 11);
  const componentHeaderRow = 10;
  const componentHeaders = [
    "No",
    "Nama Paket",
    "Barang / Varian",
    "Jumlah Dibutuhkan",
    "Unit Siap",
    "Sedang Disewa",
    "Perawatan",
    "Menunggu Pemeriksaan",
    "Tidak Tersedia",
    "Kekurangan",
    "Catatan",
  ];
  prepareDataSheet(componentSheet, componentHeaderRow, componentHeaders, COLORS.teal);
  const components = packages.flatMap((pkg) => pkg.components.map((component) => ({ pkg, component })));
  components.forEach(({ pkg, component }, index) => {
    const row = componentSheet.getRow(componentHeaderRow + 1 + index);
    row.values = [
      index + 1,
      pkg.nama,
      component.nama,
      component.required_quantity,
      component.ready_quantity,
      component.rented_quantity,
      component.maintenance_quantity,
      component.inspection_pending_quantity,
      component.blocked_quantity,
      component.shortfall_quantity,
      "—",
    ];
  });
  styleDataRows(componentSheet, componentHeaderRow + 1, Math.max(componentHeaderRow + 1, componentHeaderRow + components.length));
  components.forEach(({ component }, index) => {
    if (component.shortfall_quantity > 0) setStatusCell(componentSheet.getCell(componentHeaderRow + 1 + index, 10), "damaged");
  });
  [4, 5, 6, 7, 8, 9, 10].forEach((column) => (componentSheet.getColumn(column).numFmt = "0"));
  [26, 38, 18, 13, 13, 16, 13, 22, 16, 14, 26].forEach((width, index) => (componentSheet.getColumn(index + 1).width = width));

  const allSheets = workbook.worksheets;
  allSheets.forEach((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && cell.value.length > 90) cell.alignment = { ...cell.alignment, wrapText: true };
      });
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeSlug = profile.slug.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "usaha";
  const timestamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: profile.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(/[^0-9]+/g, "");
  anchor.href = url;
  anchor.download = `inventaris-${safeSlug}-${timestamp}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
