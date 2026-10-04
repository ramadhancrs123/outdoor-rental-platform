-- Manual / operational expense cash-out.
-- The expense fact and account cash-out are committed atomically in one command.
-- Purchase and maintenance source flows remain on their existing commands.

create or replace function app_private.command_record_expense_with_finance_cashout(
  p_usaha_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_pemasok_id uuid,
  p_kategori_biaya text,
  p_deskripsi text,
  p_amount numeric,
  p_tanggal_pengeluaran date,
  p_bukti_storage_path text,
  p_catatan text,
  p_allocations jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_timezone text;
  v_expense jsonb;
  v_settlement jsonb;
  v_expense_key text;
  v_settlement_key text;
  v_settlement_at timestamptz;
  v_response jsonb;
begin
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  if p_source_type not in ('operational','other','manual') then
    raise exception 'VALIDATION_ERROR: cash out satu-langkah hanya mendukung pengeluaran Operasional, Lainnya, atau Manual'
      using errcode='22023';
  end if;

  if p_source_id is not null then
    raise exception 'VALIDATION_ERROR: source_id tidak boleh diisi untuk pengeluaran manual/operasional'
      using errcode='22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION_ERROR: nominal pengeluaran harus lebih dari 0'
      using errcode='22023';
  end if;

  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'VALIDATION_ERROR: minimal satu akun uang harus dipilih'
      using errcode='22023';
  end if;

  if p_request_id is null or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'VALIDATION_ERROR: request_id dan idempotency_key wajib diisi'
      using errcode='22023';
  end if;

  select u.timezone
  into v_timezone
  from public.usaha u
  where u.usaha_id=p_usaha_id
    and u.status='active';

  if v_timezone is null then
    raise exception 'NOT_FOUND: usaha aktif tidak ditemukan'
      using errcode='P0002';
  end if;

  v_settlement_at := ((coalesce(p_tanggal_pengeluaran,current_date))::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'source_type',p_source_type,
    'source_id',p_source_id,
    'pemasok_id',p_pemasok_id,
    'kategori_biaya',p_kategori_biaya,
    'deskripsi',p_deskripsi,
    'amount',p_amount,
    'tanggal_pengeluaran',coalesce(p_tanggal_pengeluaran,current_date),
    'bukti_storage_path',p_bukti_storage_path,
    'catatan',p_catatan,
    'allocations',p_allocations
  )::text);

  insert into public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) values(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'record_expense_with_finance_cashout',v_request_hash
  )
  on conflict(usaha_id,actor_auth_user_id,command_name,key)
  do nothing
  returning idempotency_key_id into v_idempotency_id;

  if v_idempotency_id is null then
    select ik.response_body,ik.request_hash
    into v_existing_response,v_existing_hash
    from public.idempotency_key ik
    where ik.usaha_id=p_usaha_id
      and ik.actor_auth_user_id=v_auth_user_id
      and ik.command_name='record_expense_with_finance_cashout'
      and ik.key=btrim(p_idempotency_key);

    if v_existing_hash is distinct from v_request_hash then
      raise exception 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        using errcode='23505';
    end if;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    raise exception 'UNKNOWN_OUTCOME: idempotency record exists without response'
      using errcode='40001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  v_expense_key := btrim(p_idempotency_key) || ':expense';
  v_settlement_key := btrim(p_idempotency_key) || ':settlement';

  v_expense := app_private.command_record_expense(
    p_usaha_id,
    p_source_type,
    null,
    p_pemasok_id,
    p_kategori_biaya,
    p_deskripsi,
    p_amount,
    p_tanggal_pengeluaran,
    p_bukti_storage_path,
    p_catatan,
    v_expense_key,
    p_request_id
  );

  v_settlement := app_private.command_settle_expense_multi_account(
    p_usaha_id,
    (v_expense->>'pengeluaran_id')::uuid,
    p_amount,
    p_allocations,
    v_settlement_at,
    p_catatan,
    v_settlement_key,
    p_request_id
  );

  v_response := v_expense || jsonb_build_object(
    'cash_out_recorded',true,
    'settlement',v_settlement
  );

  insert into public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,
    action,entity_type,entity_id,source_application,
    request_id,change_summary
  ) values(
    p_usaha_id,v_auth_user_id,v_admin_id,
    'record_expense_with_finance_cashout',
    'pengeluaran',(v_expense->>'pengeluaran_id')::uuid,'admin-command',
    p_request_id,
    jsonb_build_object(
      'source_type',p_source_type,
      'amount',p_amount,
      'pengeluaran_id',v_expense->>'pengeluaran_id',
      'transaksi_keuangan_id',v_expense->>'transaksi_keuangan_id',
      'allocations',p_allocations,
      'settlement',v_settlement
    )
  );

  update public.idempotency_key
  set response_status=200,response_body=v_response
  where idempotency_key_id=v_idempotency_id;

  return v_response;
end;
$function$;

create or replace function public.command_record_expense_with_finance_cashout(
  p_usaha_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_pemasok_id uuid,
  p_kategori_biaya text,
  p_deskripsi text,
  p_amount numeric,
  p_tanggal_pengeluaran date,
  p_bukti_storage_path text,
  p_catatan text,
  p_allocations jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.command_record_expense_with_finance_cashout(
    p_usaha_id,p_source_type,p_source_id,p_pemasok_id,p_kategori_biaya,p_deskripsi,
    p_amount,p_tanggal_pengeluaran,p_bukti_storage_path,p_catatan,p_allocations,
    p_idempotency_key,p_request_id
  );
$function$;

create or replace function app_private.command_reconcile_expense_with_finance_cashout(
  p_usaha_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%rowtype;
begin
  if v_auth_user_id is null then
    raise exception 'UNAUTHORIZED: authenticated user required'
      using errcode='28000';
  end if;

  if p_usaha_id is null or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi'
      using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.akun_admin aa
    join public.keanggotaan_usaha ku
      on ku.akun_admin_id=aa.akun_admin_id
     and ku.usaha_id=p_usaha_id
     and ku.status='active'
     and ku.revoked_at is null
    where aa.auth_user_id=v_auth_user_id
      and aa.status='active'
      and aa.role='super_admin'
  ) then
    raise exception 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha'
      using errcode='42501';
  end if;

  select *
  into v_row
  from public.idempotency_key ik
  where ik.usaha_id=p_usaha_id
    and ik.actor_auth_user_id=v_auth_user_id
    and ik.command_name='record_expense_with_finance_cashout'
    and ik.key=btrim(p_idempotency_key);

  if not found then
    return jsonb_build_object('state','not_found','response',null);
  end if;

  return jsonb_build_object(
    'state',case when v_row.response_body is null then 'unknown' else 'committed' end,
    'response',v_row.response_body
  );
end;
$function$;

create or replace function public.command_reconcile_expense_with_finance_cashout(
  p_usaha_id uuid,
  p_idempotency_key text
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.command_reconcile_expense_with_finance_cashout(p_usaha_id,p_idempotency_key);
$function$;

revoke all on function public.command_record_expense_with_finance_cashout(uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid) from public,anon;
grant execute on function public.command_record_expense_with_finance_cashout(uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid) to authenticated;

revoke all on function public.command_reconcile_expense_with_finance_cashout(uuid,text) from public,anon;
grant execute on function public.command_reconcile_expense_with_finance_cashout(uuid,text) to authenticated;

revoke all on function app_private.command_record_expense_with_finance_cashout(uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function app_private.command_reconcile_expense_with_finance_cashout(uuid,text) from public,anon,authenticated;
