-- ADR-011
-- Actual return remains human-driven.
-- Financial consequences are persisted as review candidates, never as automatic payment.

create table if not exists public.evaluasi_konsekuensi_penyewaan (
  evaluasi_konsekuensi_id uuid primary key default gen_random_uuid(),
  usaha_id uuid not null,
  penyewaan_id uuid not null,
  penyewa_id uuid not null,
  unit_barang_id uuid null,
  sumber_type text not null,
  sumber_id uuid not null,
  jenis_konsekuensi text not null,
  pihak_tanggung_jawab text not null default 'penyewa',
  nominal_kandidat numeric(14,2) null,
  nominal_disetujui numeric(14,2) null,
  currency_code char(3) not null default 'IDR',
  status text not null default 'pending_review',
  alasan text not null,
  catatan_review text null,
  reviewed_by_admin_id uuid null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint evaluasi_konsekuensi_usaha_fk
    foreign key (usaha_id) references public.usaha(usaha_id),
  constraint evaluasi_konsekuensi_rental_fk
    foreign key (usaha_id, penyewaan_id)
    references public.penyewaan(usaha_id, penyewaan_id),
  constraint evaluasi_konsekuensi_renter_fk
    foreign key (usaha_id, penyewa_id)
    references public.penyewa(usaha_id, penyewa_id),
  constraint evaluasi_konsekuensi_unit_fk
    foreign key (usaha_id, unit_barang_id)
    references public.unit_barang(usaha_id, unit_barang_id),
  constraint evaluasi_konsekuensi_admin_fk
    foreign key (reviewed_by_admin_id) references public.akun_admin(akun_admin_id),
  constraint evaluasi_konsekuensi_source_check
    check (btrim(sumber_type) <> '' and length(sumber_type) <= 80),
  constraint evaluasi_konsekuensi_kind_check
    check (jenis_konsekuensi in ('late_fee','damage','loss','missing_component','other')),
  constraint evaluasi_konsekuensi_responsibility_check
    check (pihak_tanggung_jawab in ('penyewa','usaha','belum_ditentukan')),
  constraint evaluasi_konsekuensi_status_check
    check (status in ('pending_review','approved','rejected')),
  constraint evaluasi_konsekuensi_candidate_amount_check
    check (nominal_kandidat is null or nominal_kandidat >= 0),
  constraint evaluasi_konsekuensi_approved_amount_check
    check (nominal_disetujui is null or nominal_disetujui >= 0),
  constraint evaluasi_konsekuensi_currency_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint evaluasi_konsekuensi_reason_check
    check (btrim(alasan) <> '' and length(alasan) <= 4000)
);

create unique index if not exists evaluasi_konsekuensi_source_unique_idx
  on public.evaluasi_konsekuensi_penyewaan (usaha_id, sumber_type, sumber_id, jenis_konsekuensi);

create index if not exists evaluasi_konsekuensi_rental_idx
  on public.evaluasi_konsekuensi_penyewaan (usaha_id, penyewaan_id, status, created_at desc);

create index if not exists evaluasi_konsekuensi_renter_idx
  on public.evaluasi_konsekuensi_penyewaan (usaha_id, penyewa_id, status, created_at desc);

alter table public.evaluasi_konsekuensi_penyewaan enable row level security;

grant select on public.evaluasi_konsekuensi_penyewaan to authenticated;

drop policy if exists evaluasi_konsekuensi_select_member
  on public.evaluasi_konsekuensi_penyewaan;

create policy evaluasi_konsekuensi_select_member
on public.evaluasi_konsekuensi_penyewaan
for select
to authenticated
using (
  exists (
    select 1
    from public.keanggotaan_usaha ku
    join public.akun_admin aa on aa.akun_admin_id = ku.akun_admin_id
    where ku.usaha_id = evaluasi_konsekuensi_penyewaan.usaha_id
      and ku.status = 'active'
      and ku.revoked_at is null
      and aa.auth_user_id = auth.uid()
      and aa.status = 'active'
  )
);

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
begin
  if p_usaha_id is null or p_penyewaan_id is null or p_penyewa_id is null
     or p_sumber_type is null or p_sumber_id is null
     or p_jenis_konsekuensi is null or p_alasan is null
  then
    raise exception 'VALIDATION_ERROR: konteks consequence review wajib lengkap' using errcode='22023';
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
  do update set
    penyewa_id = excluded.penyewa_id,
    unit_barang_id = excluded.unit_barang_id,
    nominal_kandidat = coalesce(excluded.nominal_kandidat, evaluasi_konsekuensi_penyewaan.nominal_kandidat),
    alasan = excluded.alasan,
    updated_at = now()
  returning evaluasi_konsekuensi_id into v_id;

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
  )
  on conflict do nothing;

  return v_id;
end;
$function$;

revoke all on function app_private.record_rental_consequence_review(
  uuid,uuid,uuid,uuid,text,uuid,text,numeric,text
) from public, anon, authenticated, service_role;

create or replace function app_private.trigger_rental_late_fee_review()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_late_fee_enabled boolean;
  v_rate numeric;
  v_late_hours bigint;
  v_amount numeric;
begin
  if new.status <> 'completed'
     or old.status = 'completed'
     or new.actual_return_completed_at is null
     or new.tolerance_deadline is null
  then
    return new;
  end if;

  select u.late_fee_enabled, u.late_fee_per_hour
    into v_late_fee_enabled, v_rate
  from public.usaha u
  where u.usaha_id = new.usaha_id
    and u.status = 'active';

  if not coalesce(v_late_fee_enabled, false)
     or coalesce(v_rate, 0) <= 0
     or new.actual_return_completed_at <= new.tolerance_deadline
  then
    return new;
  end if;

  v_late_hours := ceil(
    extract(epoch from (new.actual_return_completed_at - new.tolerance_deadline)) / 3600.0
  );
  v_amount := v_late_hours * v_rate;

  perform app_private.record_rental_consequence_review(
    new.usaha_id,
    new.penyewaan_id,
    new.penyewa_id,
    null,
    'penyewaan',
    new.penyewaan_id,
    'late_fee',
    v_amount,
    'Denda keterlambatan setelah batas toleransi. Penilaian akhir tetap perlu ditinjau Finance.'
  );

  return new;
end;
$function$;

drop trigger if exists penyewaan_late_fee_review
on public.penyewaan;

create trigger penyewaan_late_fee_review
after update of status, actual_return_completed_at
on public.penyewaan
for each row
execute function app_private.trigger_rental_late_fee_review();

create or replace function app_private.trigger_inspection_consequence_review()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_penyewaan_id uuid;
  v_penyewa_id uuid;
begin
  if new.jenis_temuan not in ('damage','loss','missing_component') then
    return new;
  end if;

  select r.penyewaan_id, s.penyewa_id
    into v_penyewaan_id, v_penyewa_id
  from public.pemeriksaan p
  join public.detail_pengembalian dp
    on dp.usaha_id = p.usaha_id
   and dp.detail_pengembalian_id = p.detail_pengembalian_id
  join public.pengembalian r
    on r.usaha_id = dp.usaha_id
   and r.pengembalian_id = dp.pengembalian_id
  join public.penyewaan s
    on s.usaha_id = r.usaha_id
   and s.penyewaan_id = r.penyewaan_id
  where p.usaha_id = new.usaha_id
    and p.pemeriksaan_id = new.pemeriksaan_id
    and p.hasil <> 'pending';

  if v_penyewaan_id is null or v_penyewa_id is null then
    return new;
  end if;

  perform app_private.record_rental_consequence_review(
    new.usaha_id,
    v_penyewaan_id,
    v_penyewa_id,
    null,
    'temuan_pemeriksaan',
    new.temuan_pemeriksaan_id,
    new.jenis_temuan,
    new.nominal_potensi_biaya,
    'Temuan ' || new.jenis_temuan || ' pada pemeriksaan pengembalian; perlu ditinjau Finance sebelum menjadi konsekuensi finansial final.'
  );

  return new;
end;
$function$;

drop trigger if exists temuan_pemeriksaan_consequence_review
on public.temuan_pemeriksaan;

create trigger temuan_pemeriksaan_consequence_review
after insert
on public.temuan_pemeriksaan
for each row
execute function app_private.trigger_inspection_consequence_review();

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
  v_response jsonb;
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

  update public.evaluasi_konsekuensi_penyewaan
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
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
      'status', case when p_decision = 'approve' then 'approved' else 'rejected' end
    )
  );

  v_response := jsonb_build_object(
    'evaluasi_konsekuensi_id', p_evaluasi_konsekuensi_id,
    'decision', p_decision,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'nominal_disetujui', p_nominal_disetujui
  );

  return v_response;
end;
$function$;

revoke all on function app_private.command_review_rental_consequence(uuid,uuid,text,numeric,text,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function app_private.command_review_rental_consequence(uuid,uuid,text,numeric,text,text,uuid)
to authenticated;

create or replace function public.command_review_rental_consequence(
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
begin
  return app_private.command_review_rental_consequence(
    p_usaha_id,
    p_evaluasi_konsekuensi_id,
    p_decision,
    p_nominal_disetujui,
    p_catatan_review,
    p_idempotency_key,
    p_request_id
  );
end;
$function$;

revoke all on function public.command_review_rental_consequence(
  uuid,uuid,text,numeric,text,text,uuid
) from public, anon;
grant execute on function public.command_review_rental_consequence(
  uuid,uuid,text,numeric,text,text,uuid
) to authenticated;

revoke all on function app_private.trigger_rental_late_fee_review()
from public, anon, authenticated, service_role;

revoke all on function app_private.trigger_inspection_consequence_review()
from public, anon, authenticated, service_role;
