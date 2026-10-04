-- The public cash-out RPC is an invoker wrapper.
-- Its trusted implementation remains in app_private, but must be callable
-- by authenticated sessions because the wrapper delegates into that command.
grant execute on function app_private.command_record_expense_with_finance_cashout(
  uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid
) to authenticated;

grant execute on function app_private.command_reconcile_expense_with_finance_cashout(
  uuid,text
) to authenticated;
