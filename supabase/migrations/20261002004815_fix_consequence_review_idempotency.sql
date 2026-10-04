-- Reliability follow-up for ADR-011.
-- Consequence creation and finance review must both be idempotent.

create or replace function app_private.record_rental_consequence_review(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_penyewa_id uuid,
  p_unit_barang_id uuid,
  p_sumber_type text,
  p_sumber_id uuid,
  p_jenis_konsekuensi text,
  p_nominal_kandidat numeric,
  p_alasan text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_existing_id uuid;
  v_new_record boolean := false;
begin
  if p_usaha_id is null or p_penyewaan_id is null or p_penyewa_id is null
     or p_sumber_type is null or p_sumber_id is null
     or p_jenis_konsekuensi is null or p_alasan is null
  then
    raise exception 'VALIDATION_ERROR: konteks consequence review wajib lengkap' using errcode='22023';
  end if;

  select evaluasi_konsekuensi_id
    into v_existing_id
  from public.evaluasi_konsekuensi_penyewaan
  where usaha_id = p_usaha_id
    and sumber_type = btrim(p_sumber_type)
    and sumber_id = p_sumber_id
    and jenis_konsekuensi = p_jenis_konsekuensi
  for update;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  insert into public.evaluasi_konsekuensi_penyewaan (
    usaha_id,
    penyewaan_id,
    penyewa_id,
    unit_barang_id,
    sumber_type,
    sumber_id,
    jenis_konsekuensi,
    pihak_tanggung_jawab,
    nominal_kandidat,
    currency_code,
    status,
    alasan
  )
  values (
    p_usaha_id,
    p_penyewaan_id,
    p_penyewa_id,
    p_unit_barang_id,
    btrim(p_sumber_type),
    p_sumber_id,
    p_jenis_konsekuensi,
    'penyewa',
    p_nominal_kandidat,
    'IDR',
    'pending_review',
    left(btrim(p_alasan), 4000)
  )
  on conflict (usaha_id, sumber_type, sumber_id, jenis_konsekuensi)
  do nothing
  returning evaluasi_konsekuensi_id into v_id;

  if v_id is null then
    select evaluasi_konsekuensi_id
      into v_id
    from public.evaluasi_konsekuensi_penyewaan
    where usaha_id = p_usaha_id
      and sumber_type = btrim(p_sumber_type)
      and sumber_id = p_sumber_id
      and jenis_konsekuensi = p_jenis_konsekuensi;
    return v_id;
  end if;

  v_new_record := true;

  insert into public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  values (
    p_usaha_id,
    'rental.consequence_review_required',
    'evaluasi_konsekuensi_penyewaan',
    v_id,
    jsonb_build_object(
      'evaluasi_konsekuensi_id', v_id,
      'penyewaan_id', p_penyewaan_id,
      'penyewa_id', p_penyewa_id,
      'unit_barang_id', p_unit_barang_id,
      'sumber_type', p_sumber_type,
      'sumber_id', p_sumber_id,
      'jenis_konsekuensi', p_jenis_konsekuensi,
      'nominal_kandidat', p_nominal_kandidat,
      'status', 'pending_review'
    )
  );

  return v_id;
end;
$function$;

create or replace function app_private.command_review_rental_consequence(
  p_usaha_id uuid,
  p_evaluasi_konsekuensi_id uuid,
  p_decision text,
  p_nominal_disetujui numeric,
  p_catatan_review text,
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
  v_row public.evaluasi_konsekuensi_penyewaan%rowtype;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_status text;
begin
  if v_auth_user_id is null then
    raise exception 'UNAUTHORIZED: authenticated user required' using errcode='28000';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'VALIDATION_ERROR: keputusan harus approve atau reject' using errcode='22023';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or p_request_id is null then
    raise exception 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' using errcode='22023';
  end if;

  if p_decision = 'approve' and (p_nominal_disetujui is null or p_nominal_disetujui < 0) then
    raise exception 'VALIDATION_ERROR: nominal disetujui wajib diisi saat konsekuensi disetujui' using errcode='22023';
  end if;

  select aa.akun_admin_id
    into v_admin_id
  from public.akun_admin aa
  join public.keanggotaan_usaha ku
    on ku.akun_admin_id = aa.akun_admin_id
   and ku.usaha_id = p_usaha_id
   and ku.status = 'active'
   and ku.revoked_at is null
  where aa.auth_user_id = v_auth_user_id
    and aa.status = 'active'
    and aa.role = 'super_admin';

  if v_admin_id is null then
    raise exception 'AUTHORIZATION_ERROR: admin tidak memiliki akses Finance pada Usaha ini' using errcode='42501';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'evaluasi_konsekuensi_id', p_evaluasi_konsekuensi_id,
    'decision', p_decision,
    'nominal_disetujui', p_nominal_disetujui,
    'catatan_review', nullif(btrim(coalesce(p_catatan_review,'')), '')
  )::text);

  insert into public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  values (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'review_rental_consequence',
    v_request_hash
  )
  on conflict (usaha_id, actor_auth_user_id, command_name, key)
  do nothing
  returning idempotency_key_id into v_idempotency_id;

  if v_idempotency_id is null then
    select ik.response_body, ik.request_hash
      into v_existing_response, v_existing_hash
    from public.idempotency_key ik
    where ik.usaha_id = p_usaha_id
      and ik.actor_auth_user_id = v_auth_user_id
      and ik.command_name = 'review_rental_consequence'
      and ik.key = btrim(p_idempotency_key);

    if v_existing_hash is distinct from v_request_hash then
      raise exception 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' using errcode='23505';
    end if;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    raise exception 'UNKNOWN_OUTCOME: review consequence memiliki idempotency record tanpa response' using errcode='40001';
  end if;

  select *
    into v_row
  from public.evaluasi_konsekuensi_penyewaan
  where usaha_id = p_usaha_id
    and evaluasi_konsekuensi_id = p_evaluasi_konsekuensi_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: evaluasi konsekuensi tidak ditemukan' using errcode='P0002';
  end if;

  if v_row.status <> 'pending_review' then
    raise exception 'BUSINESS_CONFLICT: evaluasi konsekuensi sudah diputuskan' using errcode='23514';
  end if;

  v_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  update public.evaluasi_konsekuensi_penyewaan
  set status = v_status,
      nominal_disetujui = case when p_decision = 'approve' then p_nominal_disetujui else null end,
      catatan_review = nullif(btrim(coalesce(p_catatan_review,'')),''),
      reviewed_by_admin_id = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  where usaha_id = p_usaha_id
    and evaluasi_konsekuensi_id = p_evaluasi_konsekuensi_id;

  insert into public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  values (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'review_rental_consequence',
    'evaluasi_konsekuensi_penyewaan',
    p_evaluasi_konsekuensi_id,
    'finance-review',
    p_request_id,
    jsonb_build_object(
      'decision', p_decision,
      'nominal_disetujui', p_nominal_disetujui,
      'catatan_review', nullif(btrim(coalesce(p_catatan_review,'')),'')
    )
  );

  insert into public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  values (
    p_usaha_id,
    'rental.consequence_reviewed',
    'evaluasi_konsekuensi_penyewaan',
    p_evaluasi_konsekuensi_id,
    jsonb_build_object(
      'evaluasi_konsekuensi_id', p_evaluasi_konsekuensi_id,
      'decision', p_decision,
      'nominal_disetujui', p_nominal_disetujui,
      'status', v_status
    )
  );

  v_response := jsonb_build_object(
    'evaluasi_konsekuensi_id', p_evaluasi_konsekuensi_id,
    'decision', p_decision,
    'status', v_status,
    'nominal_disetujui', p_nominal_disetujui
  );

  update public.idempotency_key
  set response_status = 200,
      response_body = v_response
  where idempotency_key_id = v_idempotency_id;

  return v_response;
end;
$function$;

grant execute on function app_private.command_review_rental_consequence(
  uuid,uuid,text,numeric,text,text,uuid
) to authenticated;
