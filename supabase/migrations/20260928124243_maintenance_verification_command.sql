create or replace function app_private.command_verify_maintenance_readiness(
  p_usaha_id uuid,
  p_perawatan_id uuid,
  p_verification_result text,
  p_catatan text,
  p_expected_maintenance_updated_at timestamptz,
  p_expected_unit_updated_at timestamptz,
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
  v_maintenance public.perawatan%rowtype;
  v_unit public.unit_barang%rowtype;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_note text := nullif(btrim(coalesce(p_catatan,'')),'');
  v_next_unit_status text;
  v_event_type text;
begin
  if v_auth_user_id is null then
    raise exception 'UNAUTHORIZED: authenticated user required' using errcode='28000';
  end if;

  if p_usaha_id is null or p_perawatan_id is null
     or p_verification_result not in ('passed','failed')
     or p_expected_maintenance_updated_at is null
     or p_expected_unit_updated_at is null
     or p_idempotency_key is null or btrim(p_idempotency_key)=''
     or p_request_id is null
  then
    raise exception 'VALIDATION_ERROR: konteks verification wajib lengkap' using errcode='22023';
  end if;

  select aa.akun_admin_id
  into v_admin_id
  from public.akun_admin aa
  join public.keanggotaan_usaha ku
    on ku.akun_admin_id=aa.akun_admin_id
   and ku.usaha_id=p_usaha_id
   and ku.status='active'
   and ku.revoked_at is null
  where aa.auth_user_id=v_auth_user_id
    and aa.status='active'
    and aa.role='super_admin';

  if v_admin_id is null then
    raise exception 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' using errcode='42501';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'perawatan_id',p_perawatan_id,
    'verification_result',p_verification_result,
    'catatan',v_note,
    'expected_maintenance_updated_at',p_expected_maintenance_updated_at,
    'expected_unit_updated_at',p_expected_unit_updated_at
  )::text);

  insert into public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  )
  values(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'verify_maintenance_readiness',v_request_hash
  )
  on conflict (usaha_id,actor_auth_user_id,command_name,key) do nothing
  returning idempotency_key_id into v_idempotency_id;

  if v_idempotency_id is null then
    select ik.response_body,ik.request_hash
    into v_existing_response,v_existing_hash
    from public.idempotency_key ik
    where ik.usaha_id=p_usaha_id
      and ik.actor_auth_user_id=v_auth_user_id
      and ik.command_name='verify_maintenance_readiness'
      and ik.key=btrim(p_idempotency_key);

    if v_existing_hash is distinct from v_request_hash then
      raise exception 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' using errcode='23505';
    end if;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    raise exception 'UNKNOWN_OUTCOME: verification memiliki idempotency record tanpa response' using errcode='40001';
  end if;

  select *
  into v_maintenance
  from public.perawatan
  where usaha_id=p_usaha_id
    and perawatan_id=p_perawatan_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: maintenance tidak ditemukan' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':maintenance-unit:'||v_maintenance.unit_barang_id::text,0)
  );

  select *
  into v_unit
  from public.unit_barang
  where usaha_id=p_usaha_id
    and unit_barang_id=v_maintenance.unit_barang_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: unit maintenance tidak ditemukan' using errcode='P0002';
  end if;

  if v_maintenance.updated_at is distinct from p_expected_maintenance_updated_at
     or v_unit.updated_at is distinct from p_expected_unit_updated_at
  then
    raise exception 'STALE_DATA: maintenance atau unit berubah sejak verification dibuka. Muat data terbaru.' using errcode='40001';
  end if;

  if v_maintenance.status <> 'completed' then
    raise exception 'BUSINESS_CONFLICT: verification hanya dapat dilakukan setelah maintenance completed' using errcode='23514';
  end if;

  if v_unit.status <> 'maintenance' then
    raise exception 'BUSINESS_CONFLICT: unit tidak berada pada state maintenance saat verification' using errcode='23514';
  end if;

  if exists (
    select 1 from public.perawatan pm
    where pm.usaha_id=p_usaha_id
      and pm.unit_barang_id=v_unit.unit_barang_id
      and pm.status in ('planned','in_progress')
  ) then
    raise exception 'BUSINESS_CONFLICT: unit masih memiliki maintenance aktif lain' using errcode='23514';
  end if;

  if p_verification_result='passed' then
    v_next_unit_status := 'ready';
    v_event_type := 'maintenance.verification_passed';

    update public.unit_barang
    set status='ready'
    where usaha_id=p_usaha_id
      and unit_barang_id=v_unit.unit_barang_id;

    insert into public.riwayat_unit(
      usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
      lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
    ) values(
      p_usaha_id,v_unit.unit_barang_id,'maintenance_verification_passed',now(),'maintenance','ready',
      v_unit.lokasi_id,v_unit.lokasi_id,'perawatan',p_perawatan_id,v_admin_id,v_note,
      jsonb_build_object('perawatan_id',p_perawatan_id,'verification_result','passed')
    );
  else
    v_next_unit_status := 'maintenance';
    v_event_type := 'maintenance.verification_failed';

    insert into public.riwayat_unit(
      usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
      lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
    ) values(
      p_usaha_id,v_unit.unit_barang_id,'maintenance_verification_failed',now(),'maintenance','maintenance',
      v_unit.lokasi_id,v_unit.lokasi_id,'perawatan',p_perawatan_id,v_admin_id,v_note,
      jsonb_build_object('perawatan_id',p_perawatan_id,'verification_result','failed')
    );
  end if;

  insert into public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) values(
    p_usaha_id,v_auth_user_id,v_admin_id,'verify_maintenance_readiness',
    'perawatan',p_perawatan_id,'admin-command',p_request_id,
    jsonb_build_object(
      'unit_barang_id',v_unit.unit_barang_id,
      'verification_result',p_verification_result,
      'status_before','maintenance',
      'status_after',v_next_unit_status,
      'catatan',v_note
    )
  );

  insert into public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) values(
    p_usaha_id,v_event_type,'perawatan',p_perawatan_id,
    jsonb_build_object(
      'perawatan_id',p_perawatan_id,
      'unit_barang_id',v_unit.unit_barang_id,
      'verification_result',p_verification_result,
      'unit_status',v_next_unit_status,
      'catatan',v_note
    )
  );

  if p_verification_result='passed' then
    insert into public.outbox_event(
      usaha_id,event_type,aggregate_type,aggregate_id,payload
    ) values(
      p_usaha_id,'inventory.unit_ready','unit_barang',v_unit.unit_barang_id,
      jsonb_build_object(
        'unit_barang_id',v_unit.unit_barang_id,
        'source_type','perawatan',
        'source_id',p_perawatan_id,
        'status','ready'
      )
    );
  end if;

  v_response := jsonb_build_object(
    'perawatan_id',p_perawatan_id,
    'unit_barang_id',v_unit.unit_barang_id,
    'verification_result',p_verification_result,
    'unit_status',v_next_unit_status
  );

  update public.idempotency_key
  set response_status=200,response_body=v_response
  where idempotency_key_id=v_idempotency_id;

  return v_response;
end;
$function$;

revoke all on function app_private.command_verify_maintenance_readiness(uuid,uuid,text,text,timestamptz,timestamptz,text,uuid) from public;
revoke all on function app_private.command_verify_maintenance_readiness(uuid,uuid,text,text,timestamptz,timestamptz,text,uuid) from anon;
revoke all on function app_private.command_verify_maintenance_readiness(uuid,uuid,text,text,timestamptz,timestamptz,text,uuid) from service_role;
grant execute on function app_private.command_verify_maintenance_readiness(uuid,uuid,text,text,timestamptz,timestamptz,text,uuid) to authenticated;
