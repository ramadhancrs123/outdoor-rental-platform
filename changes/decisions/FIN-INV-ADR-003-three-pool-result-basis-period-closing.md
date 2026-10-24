# FIN-INV Backend Decision — Three Money Pools, Result Basis, Period Closing

Status: ACCEPTED
Date: 2026-10-08
Scope: Finance + Investor backend

## Decisions

1. Three money pools
   - Akun Usaha is the only operational money pool. All operational payments/expenses during an open period use this pool.
   - Akun Investor and Akun Pengelola/Admin are non-operational stakeholder balances. They are not included in the main operational cash balance and must not be used for business expenses.

2. Open-period investor result
   - Basis: Net Operational Result = recorded income - recorded expense.
   - Open-period investor estimate: max(Net Operational Result, 0) × Investor Percentage.
   - This estimate is recalculated from current financial facts so the Investor dashboard can follow operational inflow/outflow during an open period.
   - Negative operational result produces Investor Allocation/Estimate = Rp0.

3. Operational reserve
   - Admin configures the amount that must remain available for the next operating period.
   - Reserve and investor percentage are effective-dated configuration, editable before the period is closed, and auditable.

4. Period closing
   - A period closes in business timezone and snapshots income, expense, net result, investor percentage, reserve, operational cash, distributable cash, and allocations.
   - Closed-period values are historical facts and are not silently overwritten.

5. Allocation vs distribution
   - Allocation = entitlement created by period result.
   - Distribution/withdrawal = actual transfer of money from the operational account to the stakeholder account.
   - Actual distribution must preserve the configured operational reserve.
   - Investor/operator balances may remain unpaid/undrawn across periods.

6. Owner/pengelola withdrawal
   - Operator withdrawal is not an operational expense and must not reduce operational result.

7. Account movement safety
   - Stakeholder accounts cannot be ordinary operational-expense sources.
   - Operational account outbound movements cannot exceed current balance.
   - Internal account transfer is constrained to operational accounts.

8. Realtime
   - Finance/Investor changes emit low-latency Realtime events on finance:usaha:{usaha_id}.
   - Events are also journaled durably for checkpoint/replay recovery.
   - Realtime delivery failure must not fail the originating financial business transaction.

9. Currency
   - Investor period calculation can read only one currency as canonical. Multi-currency periods require review and are not closed automatically by the Investor closing command.

## Production boundaries

Frontend/UI/UX is out of scope for this backend wave. Production activation additionally requires configuring the live three accounts and business reserve/percentage for the target usaha; the backend does not invent those values.
