-- Maintenance finance cash-out gate + multi-account settlement.
-- Scope: maintenance only. Purchase/manual expense UX remains unchanged.

create or replace function app_private.command_settle_expense_multi_account(
  p_usaha_id uuid,
  p_pengeluaran_id uuid,
  p_amount numeric,
  p_allocations jsonb,
  p_diselesaikan_at timestamp with time zone,
  p_catatan text,
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
  v_expense public.pengeluaran%rowtype;
  v_transaction public.transaksi_keuangan%rowtype;
  v_account public.akun_keuangan%rowtype;
  v_settlement_id uuid;
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_settled numeric := 0;
  v_outstanding numeric;
  v_allocated numeric := 0;
  v_allocation_count integer := 0;
  v_unique_account_count integer := 0;
  v_time timestamptz := coalesce(p_diselesaikan_at, now());
  v_note text := nullif(btrim(coalesce(p_catatan,'')), '');
  v_settlement_ids jsonb := '[]'::jsonb;
  v_alloc jsonb;
  v_account_id uuid;
  v_account_amount numeric;
  v_balance numeric;
  v_response jsonb;
begin
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  if p_pengeluaran_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION_ERROR: expense settlement belum lengkap' using errcode='22023';
  end if;

  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'VALIDATION_ERROR: minimal satu akun uang harus dipilih' using errcode='22023';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key)='' or p_request_id is null then
    raise exception 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' using errcode='22023';
  end if;

  select
    coalesce(sum((x->>'amount')::numeric),0),
    count(*),
    count(distinct nullif(x->>'akun_keuangan_id','')::uuid)
  into v_allocated, v_allocation_count, v_unique_account_count
  from jsonb_array_elements(p_allocations) x
  where (x ? 'akun_keuangan_id') and (x ? 'amount');

  if v_allocation_count = 0 or v_allocated <= 0 then
    raise exception 'VALIDATION_ERROR: alokasi akun uang tidak valid' using errcode='22023';
  end if;

  if v_allocation_count <> v_unique_account_count then
    raise exception 'VALIDATION_ERROR: akun uang tidak boleh muncul lebih dari satu kali' using errcode='22023';
  end if;

  if abs(v_allocated - p_amount) > 0.000001 then
    raise exception 'VALIDATION_ERROR: total alokasi akun (%) harus sama dengan pengeluaran (%)', v_allocated, p_amount using errcode='22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_allocations) x
    where coalesce(nullif(x->>'akun_keuangan_id',''),'') = ''
       or coalesce((x->>'amount')::numeric,0) <= 0
  ) then
    raise exception 'VALIDATION_ERROR: setiap alokasi akun harus memiliki akun dan nominal lebih dari 0' using errcode='22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'pengeluaran_id',p_pengeluaran_id,
    'amount',p_amount,
    'allocations',p_allocations,
    'time',v_time,
    'catatan',v_note
  )::text);

  insert into public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) values(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'settle_expense_multi_account',v_hash
  )
  on conflict(usaha_id,actor_auth_user_id,command_name,key) do nothing
  returning idempotency_key_id into v_idempotency_id;

  if v_idempotency_id is null then
    select response_body,request_hash
    into v_existing_response,v_existing_hash
    from public.idempotency_key
    where usaha_id=p_usaha_id
      and actor_auth_user_id=v_auth_user_id
      and command_name='settle_expense_multi_account'
      and key=btrim(p_idempotency_key);

    if v_existing_hash is distinct from v_hash then
      raise exception 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' using errcode='23505';
    end if;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    raise exception 'UNKNOWN_OUTCOME: idempotency record exists without response' using errcode='40001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  select * into v_expense
  from public.pengeluaran
  where usaha_id=p_usaha_id
    and pengeluaran_id=p_pengeluaran_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: pengeluaran tidak ditemukan' using errcode='P0002';
  end if;

  select * into v_transaction
  from public.transaksi_keuangan
  where usaha_id=p_usaha_id
    and transaksi_keuangan_id=v_expense.transaksi_keuangan_id
  for update;

  if not found then
    raise exception 'INTEGRITY_ERROR: transaksi expense tidak ditemukan' using errcode='23514';
  end if;

  if v_transaction.status<>'recorded' or v_transaction.arah<>'expense' then
    raise exception 'BUSINESS_CONFLICT: expense tidak dapat diselesaikan pada status saat ini' using errcode='23514';
  end if;

  select coalesce(sum(s.amount),0)
  into v_settled
  from public.penyelesaian_pengeluaran s
  where s.usaha_id=p_usaha_id
    and s.pengeluaran_id=p_pengeluaran_id
    and s.status='recorded';

  v_outstanding := v_expense.amount - v_settled;

  if p_amount > v_outstanding then
    raise exception 'BUSINESS_CONFLICT: nominal settlement (%) melebihi sisa pengeluaran (%)', p_amount, v_outstanding using errcode='23514';
  end if;

  for v_alloc in
    select value
    from jsonb_array_elements(p_allocations)
  loop
    v_account_id := (v_alloc->>'akun_keuangan_id')::uuid;
    v_account_amount := (v_alloc->>'amount')::numeric;

    select * into v_account
    from public.akun_keuangan
    where usaha_id=p_usaha_id
      and akun_keuangan_id=v_account_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: akun uang tidak ditemukan' using errcode='P0002';
    end if;

    if v_account.status<>'active' then
      raise exception 'BUSINESS_CONFLICT: akun "%" tidak aktif', v_account.nama_akun using errcode='23514';
    end if;

    if v_account.mata_uang<>v_expense.currency_code then
      raise exception 'BUSINESS_CONFLICT: akun "%" menggunakan mata uang berbeda dari pengeluaran', v_account.nama_akun using errcode='23514';
    end if;

    select
      coalesce(max(o.nominal),0)
      + coalesce(sum(m.amount) filter(where m.status='recorded' and m.arah='masuk'),0)
      - coalesce(sum(m.amount) filter(where m.status='recorded' and m.arah='keluar'),0)
    into v_balance
    from public.saldo_awal_akun_keuangan o
    full outer join public.pergerakan_akun_keuangan m
      on m.usaha_id=v_account.usaha_id
     and m.akun_keuangan_id=v_account.akun_keuangan_id
    where coalesce(o.usaha_id,v_account.usaha_id)=v_account.usaha_id
      and coalesce(o.akun_keuangan_id,v_account.akun_keuangan_id)=v_account.akun_keuangan_id;

    v_balance := coalesce(v_balance,0);

    if v_account_amount > v_balance then
      raise exception 'BUSINESS_CONFLICT: saldo akun "%" tidak cukup. Tersedia Rp %, dibutuhkan Rp %', v_account.nama_akun, v_balance, v_account_amount using errcode='23514';
    end if;

    v_settlement_id := gen_random_uuid();

    insert into public.penyelesaian_pengeluaran(
      penyelesaian_pengeluaran_id,usaha_id,pengeluaran_id,akun_keuangan_id,amount,mata_uang,
      diselesaikan_at,dicatat_by_admin_id,request_id,catatan,status
    ) values(
      v_settlement_id,p_usaha_id,p_pengeluaran_id,v_account_id,v_account_amount,v_expense.currency_code,
      v_time,v_admin_id,p_request_id,v_note,'recorded'
    );

    insert into public.pergerakan_akun_keuangan(
      usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
      sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
    ) values(
      p_usaha_id,v_account_id,v_expense.transaksi_keuangan_id,'keluar',v_account_amount,v_expense.currency_code,v_time,
      'expense_settlement',v_settlement_id,'recorded',v_admin_id,p_request_id,v_note
    );

    v_settlement_ids := v_settlement_ids || jsonb_build_object(
      'penyelesaian_pengeluaran_id',v_settlement_id,
      'akun_keuangan_id',v_account_id,
      'amount',v_account_amount
    );
  end loop;

  insert into public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) values(
    p_usaha_id,v_auth_user_id,v_admin_id,'settle_expense_multi_account','pengeluaran',p_pengeluaran_id,
    'admin-command',p_request_id,
    jsonb_build_object(
      'amount',p_amount,
      'allocations',p_allocations,
      'settlement_ids',v_settlement_ids
    )
  );

  insert into public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  values(
    p_usaha_id,'expense.settled','pengeluaran',p_pengeluaran_id,
    jsonb_build_object(
      'pengeluaran_id',p_pengeluaran_id,
      'amount',p_amount,
      'allocations',p_allocations,
      'settlement_ids',v_settlement_ids
    )
  );

  v_response := jsonb_build_object(
    'pengeluaran_id',p_pengeluaran_id,
    'amount',p_amount,
    'mata_uang',v_expense.currency_code,
    'diselesaikan_at',v_time,
    'status','recorded',
    'allocations',v_settlement_ids
  );

  update public.idempotency_key
  set response_status=200,response_body=v_response
  where idempotency_key_id=v_idempotency_id;

  return v_response;
end;
$function$;

create or replace function public.command_settle_expense_multi_account(
  p_usaha_id uuid,
  p_pengeluaran_id uuid,
  p_amount numeric,
  p_allocations jsonb,
  p_diselesaikan_at timestamp with time zone,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.command_settle_expense_multi_account(
    p_usaha_id,p_pengeluaran_id,p_amount,p_allocations,p_diselesaikan_at,p_catatan,p_idempotency_key,p_request_id
  );
$function$;

create or replace function app_private.command_complete_maintenance_with_finance_cashout(
  p_usaha_id uuid,
  p_perawatan_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_expected_unit_updated_at timestamp with time zone,
  p_pelaksana text,
  p_biaya numeric,
  p_currency_code text,
  p_catatan text,
  p_allocations jsonb,
  p_diselesaikan_at timestamp with time zone,
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
  v_maintenance public.perawatan%rowtype;
  v_unit_code text;
  v_unit_id uuid;
  v_jenis text;
  v_cost numeric;
  v_currency text;
  v_timezone text;
  v_expense jsonb := '{}'::jsonb;
  v_settlement jsonb := '{}'::jsonb;
  v_completion jsonb;
  v_response jsonb;
  v_inner_expense_key text;
  v_inner_settlement_key text;
  v_inner_maintenance_key text;
begin
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  if p_perawatan_id is null
     or p_expected_updated_at is null
     or p_expected_unit_updated_at is null
     or p_biaya is null
     or p_biaya < 0
     or p_request_id is null
     or p_idempotency_key is null
     or btrim(p_idempotency_key)=''
  then
    raise exception 'VALIDATION_ERROR: perawatan, expected state, biaya aktual, request_id, dan idempotency_key wajib diisi' using errcode='22023';
  end if;

  select * into v_maintenance
  from public.perawatan
  where usaha_id=p_usaha_id
    and perawatan_id=p_perawatan_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: perawatan tidak ditemukan' using errcode='P0002';
  end if;

  if v_maintenance.status<>'in_progress' then
    raise exception 'BUSINESS_CONFLICT: hanya perawatan yang sedang berjalan yang dapat diselesaikan melalui cash out Finance' using errcode='23514';
  end if;

  if v_maintenance.updated_at is distinct from p_expected_updated_at then
    raise exception 'CONCURRENCY_CONFLICT: data perawatan sudah berubah. Muat ulang sebelum menyelesaikan.' using errcode='40001';
  end if;

  select ub.kode_unit, ub.unit_barang_id, v_maintenance.jenis_perawatan, u.timezone
  into v_unit_code, v_unit_id, v_jenis, v_timezone
  from public.unit_barang ub
  join public.usaha u on u.usaha_id=p_usaha_id
  where ub.usaha_id=p_usaha_id
    and ub.unit_barang_id=v_maintenance.unit_barang_id;

  if v_unit_id is null then
    raise exception 'INTEGRITY_ERROR: unit perawatan tidak ditemukan' using errcode='23514';
  end if;

  v_cost := p_biaya;
  v_currency := upper(nullif(btrim(coalesce(p_currency_code,'')), ''));
  if v_currency is null then v_currency := 'IDR'; end if;

  if v_cost > 0 and (jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations)=0) then
    raise exception 'VALIDATION_ERROR: biaya aktual di atas nol membutuhkan minimal satu akun uang untuk cash out' using errcode='22023';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'perawatan_id',p_perawatan_id,
    'expected_updated_at',p_expected_updated_at,
    'expected_unit_updated_at',p_expected_unit_updated_at,
    'pelaksana',nullif(btrim(coalesce(p_pelaksana,'')),''),
    'biaya',v_cost,
    'currency_code',v_currency,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
    'allocations',coalesce(p_allocations,'[]'::jsonb),
    'diselesaikan_at',p_diselesaikan_at
  )::text);

  insert into public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) values(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'complete_maintenance_with_finance_cashout',v_request_hash
  )
  on conflict(usaha_id,actor_auth_user_id,command_name,key)
  do nothing
  returning idempotency_key_id into v_idempotency_id;

  if v_idempotency_id is null then
    select response_body,request_hash
    into v_existing_response,v_existing_hash
    from public.idempotency_key
    where usaha_id=p_usaha_id
      and actor_auth_user_id=v_auth_user_id
      and command_name='complete_maintenance_with_finance_cashout'
      and key=btrim(p_idempotency_key);

    if v_existing_hash is distinct from v_request_hash then
      raise exception 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' using errcode='23505';
    end if;
    if v_existing_response is not null then
      return v_existing_response;
    end if;
    raise exception 'UNKNOWN_OUTCOME: idempotency record exists without response' using errcode='40001';
  end if;

  v_inner_expense_key := btrim(p_idempotency_key) || ':expense';
  v_inner_settlement_key := btrim(p_idempotency_key) || ':settlement';
  v_inner_maintenance_key := btrim(p_idempotency_key) || ':maintenance';

  if v_cost > 0 then
    v_expense := app_private.command_record_expense(
      p_usaha_id,
      'maintenance',
      p_perawatan_id,
      NULL,
      'Perawatan',
      'Perawatan ' || coalesce(v_unit_code,'Unit') || ' · ' || coalesce(v_jenis,'Maintenance'),
      v_cost,
      ((coalesce(p_diselesaikan_at,now()) at time zone coalesce(v_timezone,'Asia/Jakarta'))::date),
      NULL,
      nullif(btrim(coalesce(p_catatan,'')),''),
      v_inner_expense_key,
      p_request_id
    );

    v_settlement := app_private.command_settle_expense_multi_account(
      p_usaha_id,
      (v_expense->>'pengeluaran_id')::uuid,
      v_cost,
      p_allocations,
      p_diselesaikan_at,
      nullif(btrim(coalesce(p_catatan,'')),''),
      v_inner_settlement_key,
      p_request_id
    );
  end if;

  v_completion := app_private.command_complete_maintenance(
    p_usaha_id,
    p_perawatan_id,
    p_expected_updated_at,
    p_expected_unit_updated_at,
    p_pelaksana,
    v_cost,
    v_currency,
    p_catatan,
    v_inner_maintenance_key,
    p_request_id
  );

  v_response := v_completion || jsonb_build_object(
    'finance_expense_recorded', v_cost > 0,
    'pengeluaran_id', nullif(v_expense->>'pengeluaran_id',''),
    'nomor_pengeluaran', nullif(v_expense->>'nomor_pengeluaran',''),
    'transaksi_keuangan_id', nullif(v_expense->>'transaksi_keuangan_id',''),
    'nomor_transaksi', nullif(v_expense->>'nomor_transaksi',''),
    'cash_out_recorded', v_cost > 0,
    'settlement', case when v_cost > 0 then v_settlement else null end
  );

  insert into public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,
    action,entity_type,entity_id,source_application,
    request_id,change_summary
  ) values(
    p_usaha_id,v_auth_user_id,v_admin_id,
    'complete_maintenance_with_finance_cashout',
    'perawatan',p_perawatan_id,'admin-command',
    p_request_id,
    jsonb_build_object(
      'biaya',v_cost,
      'pengeluaran_id',nullif(v_expense->>'pengeluaran_id',''),
      'cash_out_recorded',v_cost > 0,
      'settlement',case when v_cost > 0 then v_settlement else null end
    )
  );

  update public.idempotency_key
  set response_status=200,response_body=v_response
  where idempotency_key_id=v_idempotency_id;

  return v_response;
end;
$function$;

create or replace function public.command_complete_maintenance_with_finance_cashout(
  p_usaha_id uuid,
  p_perawatan_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_expected_unit_updated_at timestamp with time zone,
  p_pelaksana text,
  p_biaya numeric,
  p_currency_code text,
  p_catatan text,
  p_allocations jsonb,
  p_diselesaikan_at timestamp with time zone,
  p_idempotency_key text,
  p_request_id uuid
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.command_complete_maintenance_with_finance_cashout(
    p_usaha_id,p_perawatan_id,p_expected_updated_at,p_expected_unit_updated_at,
    p_pelaksana,p_biaya,p_currency_code,p_catatan,p_allocations,p_diselesaikan_at,
    p_idempotency_key,p_request_id
  );
$function$;

create or replace function app_private.command_reconcile_maintenance_mutation(
  p_usaha_id uuid,
  p_command_name text,
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

  if p_usaha_id is null or p_command_name not in (
    'create_maintenance',
    'start_maintenance',
    'complete_maintenance',
    'complete_maintenance_with_finance',
    'complete_maintenance_with_finance_cashout'
  ) or p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'VALIDATION_ERROR: reconciliation input tidak valid'
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
    raise exception 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha'
      using errcode='42501';
  end if;

  select * into v_row
  from public.idempotency_key ik
  where ik.usaha_id=p_usaha_id
    and ik.actor_auth_user_id=v_auth_user_id
    and ik.command_name=p_command_name
    and ik.key=btrim(p_idempotency_key);

  if not found then
    return jsonb_build_object('state','not_found','response',null,'command_name',p_command_name);
  end if;

  return jsonb_build_object(
    'state',case when v_row.response_body is null then 'unknown' else 'committed' end,
    'response',v_row.response_body,
    'command_name',p_command_name
  );
end;
$function$;

create or replace function public.command_reconcile_maintenance_mutation(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.command_reconcile_maintenance_mutation(p_usaha_id,p_command_name,p_idempotency_key);
$function$;

revoke all on function app_private.command_settle_expense_multi_account(uuid,uuid,numeric,jsonb,timestamptz,text,text,uuid) from public,anon,authenticated;
revoke all on function app_private.command_complete_maintenance_with_finance_cashout(uuid,uuid,timestamptz,timestamptz,text,numeric,text,text,jsonb,timestamptz,text,uuid) from public,anon,authenticated;
