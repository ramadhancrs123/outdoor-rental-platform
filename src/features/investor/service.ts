import { supabase } from "@/app/providers/supabase/client";
import type {
  FinanceOperationalAccountSummary,
  InvestorActivity,
  InvestorFinanceConfigResponse,
  InvestorEntitlementTransferResult,
  InvestorStakeholderHistory,
  InvestorStakeholderPayoutResult,
  InvestorOverview,
  InvestorParticipationHistory,
  InvestorPeriodCloseResult,
  InvestorPrincipal,
  InvestorReconciliation,
  InvestorRealtimeCheckpoint,
  InvestorAdminOperator,
  InvestorStakeholderAccount,
  InvestorAccountTransferTarget,
  InvestorAccountTransferResult,
  InvestorPendingAllocation,
} from "./types";

export type InvestorServiceErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "AUTHORIZATION_ERROR"
  | "BUSINESS_CONFLICT"
  | "CONFIG_REQUIRED"
  | "UNKNOWN_OUTCOME"
  | "UNAVAILABLE"
  | "UNKNOWN";

export class InvestorServiceError extends Error {
  readonly code: InvestorServiceErrorCode;
  readonly causeMessage: string;

  constructor(code: InvestorServiceErrorCode, message: string, causeMessage: string) {
    super(message);
    this.name = "InvestorServiceError";
    this.code = code;
    this.causeMessage = causeMessage;
  }
}

function classifyServiceError(message: string): InvestorServiceErrorCode {
  const code = message.match(/(?:^|\\s)([A-Z_]{4,})(?::|\\s|$)/)?.[1];
  if (
    code === "VALIDATION_ERROR" ||
    code === "NOT_FOUND" ||
    code === "AUTHORIZATION_ERROR" ||
    code === "BUSINESS_CONFLICT" ||
    code === "CONFIG_REQUIRED" ||
    code === "UNKNOWN_OUTCOME"
  ) {
    return code;
  }
  if (/fetch|network|timeout|timed out|offline/i.test(message)) return "UNAVAILABLE";
  return "UNKNOWN";
}

function friendlyServiceMessage(code: InvestorServiceErrorCode) {
  return {
    VALIDATION_ERROR: "Input konfigurasi investor tidak valid.",
    NOT_FOUND: "Data Investor atau akun keuangan tidak ditemukan.",
    AUTHORIZATION_ERROR: "Anda tidak memiliki akses untuk tindakan Investor ini.",
    BUSINESS_CONFLICT: "Tindakan ditolak karena kondisi keuangan atau periode tidak memenuhi aturan bisnis.",
    CONFIG_REQUIRED: "Konfigurasi Investor belum tersedia untuk periode ini.",
    UNKNOWN_OUTCOME: "Hasil tindakan belum dapat dipastikan. Data harus direkonsiliasi sebelum mencoba ulang.",
    UNAVAILABLE: "Sumber Investor/Finance sedang tidak tersedia.",
    UNKNOWN: "Terjadi kesalahan saat memproses data Investor.",
  }[code];
}

function throwServiceError(error: { message: string }): never {
  const code = classifyServiceError(error.message);
  throw new InvestorServiceError(code, friendlyServiceMessage(code), error.message);
}

function unwrapRpc<T>(data: unknown): T {
  if (!data || typeof data !== "object") {
    throw new InvestorServiceError("UNKNOWN", "Respons Investor tidak valid.", "empty RPC response");
  }
  return data as T;
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throwServiceError(error);
  return unwrapRpc<T>(data);
}

export async function getInvestorPrincipal(
  usahaIdOverride?: string,
  adminSelectedInvestorId?: string | null,
): Promise<InvestorPrincipal | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  // Match the database read principal: active, business-scoped admin membership
  // takes precedence over an Investor row on the same authentication user.
  let adminPrincipalForBusiness = false;
  if (usahaIdOverride) {
    const { data: activeAdmin, error: activeAdminError } = await supabase
      .from("akun_admin")
      .select("akun_admin_id")
      .eq("auth_user_id", userData.user.id)
      .eq("status", "active")
      .eq("role", "super_admin")
      .limit(1)
      .maybeSingle();
    if (activeAdminError) throwServiceError(activeAdminError);

    if (activeAdmin) {
      const [membership, business] = await Promise.all([
        supabase
          .from("keanggotaan_usaha")
          .select("akun_admin_id")
          .eq("akun_admin_id", activeAdmin.akun_admin_id)
          .eq("usaha_id", usahaIdOverride)
          .eq("status", "active")
          .is("revoked_at", null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("usaha")
          .select("usaha_id")
          .eq("usaha_id", usahaIdOverride)
          .eq("status", "active")
          .maybeSingle(),
      ]);
      if (membership.error) throwServiceError(membership.error);
      if (business.error) throwServiceError(business.error);
      adminPrincipalForBusiness = Boolean(membership.data && business.data);
    }
  }

  let investorQuery = supabase
    .from("investor")
    .select("investor_id,usaha_id,nama_tampilan,status")
    .eq("auth_user_id", userData.user.id)
    .eq("status", "active");
  if (usahaIdOverride) investorQuery = investorQuery.eq("usaha_id", usahaIdOverride);
  const { data, error } = await investorQuery.maybeSingle();

  if (error) throwServiceError(error);
  if (data && !adminPrincipalForBusiness) {
    return {
      investorId: data.investor_id,
      usahaId: data.usaha_id,
      namaTampilan: data.nama_tampilan,
      status: data.status,
    } satisfies InvestorPrincipal;
  }

  if (!usahaIdOverride) return null;

  // For an admin, the server overview is the source of truth for which Investor
  // is represented by the current effective-dated configuration. When no id is
  // supplied yet, mirror app_private.get_investor_overview: newest active
  // participation effective today wins (never the Investor linked to auth.uid()).
  let selectedInvestorId = adminSelectedInvestorId ?? null;
  if (!selectedInvestorId) {
    const { data: usaha, error: usahaError } = await supabase
      .from("usaha")
      .select("timezone")
      .eq("usaha_id", usahaIdOverride)
      .maybeSingle();
    if (usahaError) throwServiceError(usahaError);
    if (!usaha?.timezone) return null;

    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: usaha.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const datePart = (type: "year" | "month" | "day") =>
      dateParts.find((part) => part.type === type)?.value ?? "";
    const today = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
    const { data: participation, error: participationError } = await supabase
      .from("investor_participation")
      .select("investor_id")
      .eq("usaha_id", usahaIdOverride)
      .eq("status", "active")
      .lte("effective_from", today)
      .or("effective_until.is.null,effective_until.gt." + today)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (participationError) throwServiceError(participationError);
    selectedInvestorId = participation?.investor_id ?? null;
  }
  if (!selectedInvestorId) return null;

  const { data: configuredInvestor, error: configuredInvestorError } = await supabase
    .from("investor")
    .select("investor_id,usaha_id,nama_tampilan,status")
    .eq("usaha_id", usahaIdOverride)
    .eq("investor_id", selectedInvestorId)
    .maybeSingle();

  if (configuredInvestorError) throwServiceError(configuredInvestorError);
  return configuredInvestor
    ? {
        investorId: configuredInvestor.investor_id,
        usahaId: configuredInvestor.usaha_id,
        namaTampilan: configuredInvestor.nama_tampilan,
        status: configuredInvestor.status,
      }
    : null;
}

export async function listInvestorAdminPrincipals(usahaId: string): Promise<InvestorPrincipal[]> {
  const { data, error } = await supabase
    .from("investor")
    .select("investor_id,usaha_id,nama_tampilan,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) throwServiceError(error);
  return (data ?? []).map((item) => ({
    investorId: item.investor_id,
    usahaId: item.usaha_id,
    namaTampilan: item.nama_tampilan,
    status: item.status,
  }));
}

export async function getInvestorOverview(usahaId: string, asOfDate?: string) {
  return rpc<InvestorOverview>("get_investor_overview", {
    p_usaha_id: usahaId,
    ...(asOfDate ? { p_as_of_date: asOfDate } : {}),
  });
}

export async function getInvestorPeriodResult(
  usahaId: string,
  periodStart: string,
  periodEndExclusive: string,
) {
  return rpc<InvestorOverview>("get_investor_period_result", {
    p_usaha_id: usahaId,
    p_period_start: periodStart,
    p_period_end_exclusive: periodEndExclusive,
  });
}

export async function getInvestorParticipationHistory(
  usahaId: string,
  investorId?: string,
) {
  return rpc<InvestorParticipationHistory>("get_investor_participation_history", {
    p_usaha_id: usahaId,
    ...(investorId ? { p_investor_id: investorId } : {}),
  });
}

export async function getInvestorActivity(
  usahaId: string,
  periodStart: string,
  periodEndExclusive: string,
  limit = 50,
  offset = 0,
) {
  return rpc<InvestorActivity>("get_investor_activity", {
    p_usaha_id: usahaId,
    p_period_start: periodStart,
    p_period_end_exclusive: periodEndExclusive,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function getInvestorAdminFinanceConfig(
  usahaId: string,
  investorId?: string | null,
) {
  return rpc<InvestorFinanceConfigResponse>("get_investor_admin_finance_config", {
    p_usaha_id: usahaId,
    p_investor_id: investorId ?? null,
  });
}

export async function listInvestorAdminOperators(usahaId: string) {
  return rpc<{ status: "OK"; operators: InvestorAdminOperator[] }>(
    "get_investor_admin_operators",
    { p_usaha_id: usahaId },
  );
}

export async function getInvestorStakeholderAccounts(usahaId: string) {
  return rpc<{
    status: "OK";
    accounts: InvestorStakeholderAccount[];
    transfer_targets: InvestorAccountTransferTarget[];
    investor_allocations: InvestorPendingAllocation[];
    operator_allocations: InvestorPendingAllocation[];
  }> (
    "get_investor_stakeholder_accounts",
    { p_usaha_id: usahaId },
  );
}

export async function getOperationalAccountSummary(usahaId: string) {
  return rpc<FinanceOperationalAccountSummary>("finance_operational_account_summary", {
    p_usaha_id: usahaId,
  });
}

export async function getInvestorReconciliation(usahaId: string) {
  return rpc<InvestorReconciliation>("investor_reconciliation", {
    p_usaha_id: usahaId,
  });
}

export async function setInvestorFinanceConfig(input: {
  usahaId: string;
  investorId: string;
  pengelolaAkunAdminId: string;
  investorPercentage: number;
  operationalReserveAmount: number;
  periodStartDay: number;
  periodEndDay: number;
  effectiveFrom: string;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<{
    participation_id: string;
    investor_id: string;
    percentage: number;
    operational_reserve_amount: number;
    pengelola_akun_admin_id: string;
    period_start_day: number;
    period_end_day: number;
    effective_from: string;
    effective_until: string | null;
    basis_type: "net_operational_result";
  }>("command_set_investor_finance_config", {
    p_usaha_id: input.usahaId,
    p_investor_id: input.investorId,
    p_pengelola_akun_admin_id: input.pengelolaAkunAdminId,
    p_investor_percentage: input.investorPercentage,
    p_operational_reserve_amount: input.operationalReserveAmount,
    p_period_start_day: input.periodStartDay,
    p_period_end_day: input.periodEndDay,
    p_effective_from: input.effectiveFrom,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function setFinanceAccountRole(input: {
  usahaId: string;
  akunKeuanganId: string;
  fungsiAkun: "operasional" | "investor" | "pengelola";
  investorId?: string | null;
  pengelolaAkunAdminId?: string | null;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<{
    akun_keuangan_id: string;
    fungsi_akun: "operasional" | "investor" | "pengelola";
    investor_id: string | null;
    pengelola_akun_admin_id: string | null;
  }>("command_set_finance_account_role", {
    p_usaha_id: input.usahaId,
    p_akun_keuangan_id: input.akunKeuanganId,
    p_fungsi_akun: input.fungsiAkun,
    p_investor_id: input.investorId ?? null,
    p_pengelola_akun_admin_id: input.pengelolaAkunAdminId ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function closeInvestorPeriod(input: {
  usahaId: string;
  periodStart: string;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<InvestorPeriodCloseResult>("command_close_investor_period", {
    p_usaha_id: input.usahaId,
    p_period_start: input.periodStart,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function payoutInvestorBalance(input: {
  usahaId: string;
  periodStart: string;
  allocationId: string | null;
  sourceAccountId: string;
  amount: number;
  paidAt?: string;
  destinationName: string;
  destinationReference?: string | null;
  catatan?: string | null;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<InvestorStakeholderPayoutResult>("command_payout_investor_balance", {
    p_usaha_id: input.usahaId,
    p_period_start: input.periodStart,
    p_allocation_id: input.allocationId,
    p_source_account_id: input.sourceAccountId,
    p_amount: input.amount,
    p_paid_at: input.paidAt ?? null,
    p_destination_name: input.destinationName,
    p_destination_reference: input.destinationReference ?? null,
    p_catatan: input.catatan ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function withdrawOperatorBalance(input: {
  usahaId: string;
  periodStart: string;
  allocationId: string | null;
  sourceAccountId: string;
  amount: number;
  paidAt?: string;
  destinationName: string;
  destinationReference?: string | null;
  catatan?: string | null;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<InvestorStakeholderPayoutResult>("command_withdraw_operator_balance", {
    p_usaha_id: input.usahaId,
    p_period_start: input.periodStart,
    p_allocation_id: input.allocationId,
    p_source_account_id: input.sourceAccountId,
    p_amount: input.amount,
    p_paid_at: input.paidAt ?? null,
    p_destination_name: input.destinationName,
    p_destination_reference: input.destinationReference ?? null,
    p_catatan: input.catatan ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function transferInvestorEntitlement(input: {
  usahaId: string;
  sourceInvestorAllocationId: string;
  targetType: "usaha" | "pengelola";
  targetOperatorAllocationId?: string | null;
  amount: number;
  transferredAt?: string;
  physicalSourceAccountId?: string | null;
  physicalTargetAccountId?: string | null;
  catatan?: string | null;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<InvestorEntitlementTransferResult>("command_transfer_investor_entitlement", {
    p_usaha_id: input.usahaId,
    p_source_investor_allocation_id: input.sourceInvestorAllocationId,
    p_target_type: input.targetType,
    p_target_operator_allocation_id: input.targetOperatorAllocationId ?? null,
    p_amount: input.amount,
    p_transferred_at: input.transferredAt ?? null,
    p_physical_source_account_id: input.physicalSourceAccountId ?? null,
    p_physical_target_account_id: input.physicalTargetAccountId ?? null,
    p_catatan: input.catatan ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function transferInvestorAccountBalance(input: {
  usahaId: string;
  sourceAccountId: string;
  targetAccountId: string;
  amount: number;
  transferredAt?: string;
  catatan?: string | null;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<InvestorAccountTransferResult>("command_investor_account_transfer", {
    p_usaha_id: input.usahaId,
    p_source_account_id: input.sourceAccountId,
    p_target_account_id: input.targetAccountId,
    p_amount: input.amount,
    p_transferred_at: input.transferredAt ?? new Date().toISOString(),
    p_catatan: input.catatan ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}

export async function getInvestorStakeholderHistory(usahaId: string) {
  return rpc<InvestorStakeholderHistory>("get_investor_stakeholder_history", {
    p_usaha_id: usahaId,
  });
}

export async function getInvestorActivityExport(usahaId: string, periodStart: string, periodEndExclusive: string) {
  return rpc<InvestorActivity>("get_investor_activity_export", {
    p_usaha_id: usahaId,
    p_period_start: periodStart,
    p_period_end_exclusive: periodEndExclusive,
  });
}

export async function getInvestorRealtimeCheckpoint(usahaId: string) {
  return rpc<InvestorRealtimeCheckpoint>("get_investor_realtime_checkpoint", {
    p_usaha_id: usahaId,
  });
}

export async function replayInvestorRealtimeEvents(
  usahaId: string,
  afterEventSeq: number,
  limit = 100,
) {
  return rpc<{ principal: "investor" | "admin"; replayed: number; after_event_seq: number }>(
    "replay_investor_realtime_events",
    {
      p_usaha_id: usahaId,
      p_after_event_seq: afterEventSeq,
      p_limit: limit,
    },
  );
}

export async function createInvestor(input: {
  usahaId: string;
  authUserId: string;
  namaTampilan: string;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<{ investor_id: string; usaha_id: string; auth_user_id: string; status: "active" | "inactive" }>(
    "command_create_investor",
    {
      p_usaha_id: input.usahaId,
      p_auth_user_id: input.authUserId,
      p_nama_tampilan: input.namaTampilan,
      p_idempotency_key: input.idempotencyKey,
      p_request_id: input.requestId,
    },
  );
}

export async function setInvestorStatus(input: {
  usahaId: string;
  investorId: string;
  status: "active" | "inactive";
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<{ investor_id: string; status: "active" | "inactive" }>(
    "command_set_investor_status",
    {
      p_usaha_id: input.usahaId,
      p_investor_id: input.investorId,
      p_status: input.status,
      p_idempotency_key: input.idempotencyKey,
      p_request_id: input.requestId,
    },
  );
}

export async function setInvestorParticipation(input: {
  usahaId: string;
  investorId: string;
  percentage: number;
  periodStartDay: number;
  periodEndDay: number;
  effectiveFrom: string;
  idempotencyKey: string;
  requestId: string;
}) {
  return rpc<{
    participation_id: string;
    investor_id: string;
    percentage: number;
    operational_reserve_amount: number;
    pengelola_akun_admin_id: string | null;
    period_start_day: number;
    period_end_day: number;
    effective_from: string;
    effective_until: string | null;
    basis_type: "net_operational_result";
  }>("command_set_investor_participation", {
    p_usaha_id: input.usahaId,
    p_investor_id: input.investorId,
    p_percentage: input.percentage,
    p_period_start_day: input.periodStartDay,
    p_period_end_day: input.periodEndDay,
    p_effective_from: input.effectiveFrom,
    p_idempotency_key: input.idempotencyKey,
    p_request_id: input.requestId,
  });
}
