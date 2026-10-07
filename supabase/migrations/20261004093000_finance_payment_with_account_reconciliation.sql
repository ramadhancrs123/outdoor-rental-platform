-- Finance payment hotfix: keep reconciliation aligned with the trusted account-aware payment command.
-- Read-only over idempotency_key; no financial fact semantics are changed.

create or replace function app_private.reconcile_finance_command(
  p_usaha_id uuid,
  p_idempotency_key text,
  p_command_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_response jsonb;
  v_command text := lower(btrim(coalesce(p_command_name,'')));
begin
  perform app_private.assert_finance_admin(p_usaha_id);

  if v_command not in (
    'record_payment_with_account',
    'record_extension_payment',
    'record_consequence_payment',
    'refund_payment',
    'transfer_finance_account',
    'review_rental_consequence',
    'correct_payment',
    'correct_expense',
    'set_replacement_value',
    'create_finance_account',
    'set_finance_account_opening_balance'
  ) or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'VALIDATION_ERROR: perintah rekonsiliasi tidak valid' using errcode='22023';
  end if;

  select response_body into v_response
  from public.idempotency_key
  where usaha_id=p_usaha_id
    and actor_auth_user_id=v_auth_user_id
    and command_name=v_command
    and key=btrim(p_idempotency_key);

  if v_response is null then
    if not exists (
      select 1 from public.idempotency_key
      where usaha_id=p_usaha_id
        and actor_auth_user_id=v_auth_user_id
        and command_name=v_command
        and key=btrim(p_idempotency_key)
    ) then
      return jsonb_build_object('state','not_found','response',null);
    end if;
    return jsonb_build_object('state','unknown','response',null);
  end if;

  return jsonb_build_object('state','committed','response',v_response);
end;
$function$;

revoke all on function app_private.reconcile_finance_command(uuid,text,text) from public,anon,authenticated;
