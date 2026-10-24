# FIN-INV Backend Decision — Entitlement, Physical Cash, and External Payout

Status: ACCEPTED
Date: 2026-10-10
Scope: Finance + Investor backend
Supersedes: FIN-INV-ADR-003 decisions 5 and 7 where they equate internal account movement with payout.

## Decisions

1. **Rights and money location are different facts.**
   - Finance account balances describe where physical money is recorded.
   - Investor and Pengelola allocations describe the rights earned from a closed or currently calculated period.
   - A physical balance change alone must not silently settle or reduce an Investor/Pengelola entitlement.

2. **External payout is the settlement event.**
   - An Investor/Pengelola payout is recorded only when money is paid to an external recipient and leaves the business-controlled cash/bank account.
   - The command records the source account, recipient, amount, currency, timestamp, request, and audit evidence.
   - Payout is not an operational expense and must not change Net Operational Result.
   - A payout reduces remaining entitlement.

3. **Internal entitlement transfer is a separate event.**
   - Investor rights may be reclassified to the business pool (usaha) or transferred to a Pengelola allocation.
   - Investor remaining rights = allocation - external payouts - rights transferred out.
   - Pengelola remaining rights = allocation + rights transferred in - external payouts.
   - A transfer to usaha does not create income or increase physical cash merely because ownership of the right changed.

4. **Physical movement is optional and independent.**
   - An entitlement transfer may happen without moving money between Finance accounts.
   - When money actually moves, the command may record the paired account movement atomically with the entitlement transfer.
   - Moving money between operational, Investor, and Pengelola accounts is not itself an external payout. It must be separately represented in the physical cash ledger and must not change operational result.
   - Legacy movements into internal Investor/Pengelola accounts remain cash-segregation history, not proof that the recipient was paid.

5. **Investor-initiated transfer out of an already-recorded Investor balance is a separate cash event.**
   - The authenticated Investor may record a transfer from an active Finance account explicitly assigned to that same Investor.
   - This command requires Investor principal resolution; an account with admin-first principal precedence cannot use the Investor self-service command.
   - The event uses `payout_kind = investor_self_transfer`, records the source Investor account, recipient, amount, timestamp, request, and audit evidence, and requires no period/allocation ID.
   - It reduces only the physical balance of that Investor account. It does not settle, reduce, or reclassify period rights and does not change Net Operational Result.
   - The app records the real-world transfer after it has actually happened. It does not initiate or send bank payments.
   - The cash movement must not be presented as an allocation payout; history identifies it separately.
  
6. **UX stays simple.**
   - The user records the real-world event they performed: external payout, transfer of rights, movement of physical cash, or a transfer out of their own recorded Investor balance.
   - The system derives internal status and remaining balances. Do not ask the user to manage ledger lifecycle or closing states.
   - History must show the event type, amount, source/target, time, and whether physical money moved, so internal transfers cannot look like payouts.

## Compatibility and activation

- Existing internal transfer RPCs must not be presented as external payout APIs.
- Read models and reconciliation must count payouts and entitlement transfers independently.
- Apply to the live Supabase project only after the candidate SHA is verified and the required regression evidence is recorded.
