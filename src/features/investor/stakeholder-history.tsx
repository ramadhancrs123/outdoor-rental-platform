import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  formatInvestorCurrency,
  formatInvestorDate,
  formatInvestorDateTime,
  type InvestorHistoryCashSegregation,
  type InvestorHistoryEntitlementTransfer,
  type InvestorHistoryPayout,
  type InvestorStakeholderHistory,
} from "./types";

type Props = {
  history?: InvestorStakeholderHistory;
  isLoading: boolean;
  error?: unknown;
  onRetry: () => void;
};

type HistoryEvent = {
  key: string;
  eventType: string;
  amount: number;
  currency: string;
  occurredAt: string;
  source: string;
  target: string;
  physicalMovement: string;
  note: string | null;
};

const amountNumber = (value: number | string) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function buildPayoutEvent(row: InvestorHistoryPayout, accountLabel: (id: string | null | undefined) => string): HistoryEvent {
  // The self-transfer record is intentionally not attached to a period or
  // allocation; old history payloads can therefore identify it without
  // treating it as a payout against Investor rights.
  const isSelfTransfer = row.payout_kind === "investor_self_transfer"
    || (row.stakeholder_type === "investor" && row.period_start === null
      && row.period_id === null && row.investor_allocation_id === null);

  return {
    key: "payout-" + row.payout_id,
    eventType: isSelfTransfer
      ? "Transfer keluar oleh Investor dari saldo tercatat"
      : row.stakeholder_type === "investor" ? "Pembayaran eksternal Investor" : "Pembayaran eksternal Pengelola",
    amount: amountNumber(row.amount),
    currency: row.currency_code,
    occurredAt: row.paid_at,
    source: isSelfTransfer ? accountLabel(row.source_account_id) + " · saldo milik Anda" : accountLabel(row.source_account_id),
    target: row.destination_name,
    physicalMovement: isSelfTransfer
      ? "Ya · uang keluar dari akun Investor pribadi"
      : "Ya · uang keluar dari akun sumber",
    note: row.catatan || row.destination_reference,
  };
}

function buildEntitlementTransferEvent(
  row: InvestorHistoryEntitlementTransfer,
  accountLabel: (id: string | null | undefined) => string,
): HistoryEvent {
  const target = row.target_type === "usaha" ? "Hak Usaha" : "Alokasi Pengelola";
  const physicalMovement = row.physical_money_moved
    ? `Ya · ${accountLabel(row.physical_source_account_id)} → ${accountLabel(row.physical_target_account_id)}`
    : "Tidak · hanya alih hak";
  return {
    key: "right-" + row.transfer_id,
    eventType: row.target_type === "usaha" ? "Alih hak Investor → Usaha" : "Alih hak Investor → Pengelola",
    amount: amountNumber(row.amount),
    currency: row.currency_code,
    occurredAt: row.transferred_at,
    source: "Hak Investor",
    target,
    physicalMovement,
    note: row.catatan,
  };
}

function buildCashSegregationEvent(
  row: InvestorHistoryCashSegregation,
  accountLabel: (id: string | null | undefined) => string,
): HistoryEvent {
  const isAccountTransfer = row.movement_kind === "investor_account_transfer";
  return {
    key: "cash-" + row.event_id,
    eventType: isAccountTransfer ? "Transfer internal akun Investor" : "Pemisahan kas antar akun internal",
    amount: amountNumber(row.amount),
    currency: row.currency_code,
    occurredAt: row.occurred_at,
    source: row.source_account_name ?? accountLabel(row.source_account_id),
    target: row.target_account_name ?? accountLabel(row.target_account_id),
    physicalMovement: "Ya · uang berpindah di dalam usaha",
    note: row.catatan,
  };
}

export function InvestorStakeholderHistoryCard({ history, isLoading, error, onRetry }: Props) {
  const accounts = history?.physical_accounts ?? [];
  const accountNames = new Map(accounts.map((account) => [
    account.account_id,
    account.account_name + " · " + account.currency_code,
  ]));
  const accountLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    return accountNames.get(id) ?? "Akun tidak tersedia";
  };

  const events: HistoryEvent[] = history ? [
    ...history.payouts.map((row) => buildPayoutEvent(row, accountLabel)),
    ...history.entitlement_transfers.map((row) => buildEntitlementTransferEvent(row, accountLabel)),
    ...history.cash_segregations.map((row) => buildCashSegregationEvent(row, accountLabel)),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 25) : [];

  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-3 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold tracking-tight text-slate-900 sm:text-[15px]">Riwayat Hak & Pergerakan Uang</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            Hak alokasi, pembayaran eksternal, dan perpindahan uang internal dicatat sebagai kejadian yang berbeda.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-lg px-2.5 text-[10px]" onClick={onRetry} disabled={isLoading}>
          Segarkan
        </Button>
      </div>

      {isLoading && !history ? (
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-[10px] text-slate-500">Memuat riwayat keuangan…</p>
      ) : null}
      {error && !history ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800">
          Riwayat belum dapat dimuat. Data keuangan tidak diubah.
        </div>
      ) : null}

      {history ? (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-100 p-3">
              <p className="text-[10px] font-bold text-slate-800">Uang fisik · saldo akun</p>
              <p className="mt-0.5 text-[9px] text-slate-500">Menunjukkan lokasi uang aktual, bukan hak yang belum dibayarkan.</p>
              <div className="mt-2 space-y-2">
                {accounts.map((account) => (
                  <div key={account.account_id} className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="min-w-0 truncate text-slate-600">{account.account_name} · {account.currency_code}</span>
                    <strong className="shrink-0 text-slate-900">{formatInvestorCurrency(amountNumber(account.physical_balance), account.currency_code)}</strong>
                  </div>
                ))}
                {!accounts.length ? <p className="text-[9px] text-slate-400">Tidak ada akun Investor/Pengelola yang terlihat.</p> : null}
              </div>
            </section>

            <section className="rounded-xl border border-slate-100 p-3">
              <p className="text-[10px] font-bold text-slate-800">Hak alokasi · saldo hak</p>
              <p className="mt-0.5 text-[9px] text-slate-500">Sisa hak dihitung setelah pembayaran dan alih hak yang tercatat.</p>
              <div className="mt-2 space-y-2">
                {history.allocations.map((allocation) => (
                  <div key={allocation.allocation_id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-semibold text-slate-700">
                        {allocation.stakeholder_type === "investor" ? "Investor" : "Pengelola"} · {formatInvestorDate(allocation.period_start)}
                      </span>
                      <strong className="text-[10px] text-slate-900">
                        {formatInvestorCurrency(amountNumber(allocation.remaining_amount), allocation.currency_code)}
                      </strong>
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-slate-500">
                      Hak awal {formatInvestorCurrency(amountNumber(allocation.allocation_amount), allocation.currency_code)}
                      {" · dibayar "}{formatInvestorCurrency(amountNumber(allocation.paid_amount), allocation.currency_code)}
                      {amountNumber(allocation.transferred_out_amount) > 0
                        ? " · dialihkan keluar " + formatInvestorCurrency(amountNumber(allocation.transferred_out_amount), allocation.currency_code)
                        : ""}
                      {amountNumber(allocation.transferred_in_amount) > 0
                        ? " · hak masuk " + formatInvestorCurrency(amountNumber(allocation.transferred_in_amount), allocation.currency_code)
                        : ""}
                    </p>
                    {amountNumber(allocation.advance_excess_amount) > 0 ? (
                      <p className="mt-1 text-[9px] font-semibold text-amber-700">
                        Pembayaran di muka melebihi hak periode sebesar {formatInvestorCurrency(amountNumber(allocation.advance_excess_amount), allocation.currency_code)}.
                      </p>
                    ) : null}
                  </div>
                ))}
                {!history.allocations.length ? <p className="text-[9px] text-slate-400">Belum ada alokasi hak.</p> : null}
              </div>
            </section>
          </div>

          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold text-slate-800">Kejadian terbaru</p>
              <span className="text-[9px] text-slate-400">Maks. 25 kejadian</span>
            </div>
            <div className="mt-2 divide-y divide-slate-100">
              {events.map((event) => (
                <article key={event.key} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-800">{event.eventType}</p>
                      <p className="mt-0.5 text-[9px] text-slate-500">{formatInvestorDateTime(event.occurredAt)}</p>
                    </div>
                    <strong className="shrink-0 text-[11px] font-bold text-slate-900">
                      {formatInvestorCurrency(event.amount, event.currency)}
                    </strong>
                  </div>
                  <div className="mt-2 grid gap-1 text-[9px] sm:grid-cols-2">
                    <p className="min-w-0 break-words"><span className="text-slate-400">Sumber: </span><span className="font-medium text-slate-700">{event.source}</span></p>
                    <p className="min-w-0 break-words"><span className="text-slate-400">Tujuan: </span><span className="font-medium text-slate-700">{event.target}</span></p>
                  </div>
                  <p className="mt-1 text-[9px] leading-4 text-slate-500">
                    <span className="font-semibold text-slate-600">Perpindahan uang fisik: </span>{event.physicalMovement}
                  </p>
                  {event.note ? <p className="mt-1 break-words text-[9px] text-slate-500">Catatan: {event.note}</p> : null}
                </article>
              ))}
              {!events.length ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[10px] text-slate-400">
                  Belum ada pembayaran, alih hak, atau pemindahan uang internal yang tercatat.
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </Card>
  );
}
