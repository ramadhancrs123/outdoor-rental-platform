-- ADR-010
-- Every completed rental return inspection creates exactly one maintenance task.
-- Maintenance completion still requires readiness verification before inventory can be ready.

create unique index if not exists perawatan_one_per_inspection_idx
  on public.perawatan (usaha_id, pemeriksaan_id)
  where pemeriksaan_id is not null;

create or replace function app_private.ensure_return_inspection_maintenance(
  p_detail_pengembalian_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_detail public.detail_pengembalian%rowtype;
  v_inspection public.pemeriksaan%rowtype;
  v_unit public.unit_barang%rowtype;
  v_existing public.perawatan%rowtype;
  v_maintenance_id uuid := gen_random_uuid();
  v_admin_id uuid;
  v_type text;
  v_description text;
  v_note text;
  v_finding_summary text;
begin
  if p_detail_pengembalian_id is null then
    raise exception 'VALIDATION_ERROR: detail pengembalian wajib diisi' using errcode='22023';
  end if;

  select *
  into v_detail
  from public.detail_pengembalian
  where detail_pengembalian_id = p_detail_pengembalian_id
  for update;

  if not found or v_detail.status_pemeriksaan <> 'completed' then
    return null;
  end if;

  select *
  into v_inspection
  from public.pemeriksaan
  where usaha_id = v_detail.usaha_id
    and detail_pengembalian_id = v_detail.detail_pengembalian_id
    and hasil <> 'pending'
  order by diperiksa_at desc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  select *
  into v_unit
  from public.unit_barang
  where usaha_id = v_detail.usaha_id
    and unit_barang_id = v_detail.unit_barang_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: unit pengembalian tidak ditemukan' using errcode='P0002';
  end if;

  v_admin_id := v_inspection.diperiksa_by_admin_id;
  if v_admin_id is null then
    raise exception 'BUSINESS_CONFLICT: pemeriksaan tidak memiliki admin pemeriksa' using errcode='23514';
  end if;

  select *
  into v_existing
  from public.perawatan
  where usaha_id = v_inspection.usaha_id
    and pemeriksaan_id = v_inspection.pemeriksaan_id
  order by created_at asc
  limit 1
  for update;

  if found then
    return v_existing.perawatan_id;
  end if;

  if exists (
    select 1
    from public.perawatan pm
    where pm.usaha_id = v_unit.usaha_id
      and pm.unit_barang_id = v_unit.unit_barang_id
      and pm.status in ('planned','in_progress')
  ) then
    raise exception 'BUSINESS_CONFLICT: unit sudah memiliki perawatan aktif lain' using errcode='23514';
  end if;

  select string_agg(
    left(
      coalesce(nullif(btrim(tf.jenis_temuan),''),'Temuan')
      || ': '
      || left(coalesce(nullif(btrim(tf.deskripsi),''),'Tanpa deskripsi'), 320),
      380
    ),
    '; '
    order by tf.created_at
  )
  into v_finding_summary
  from public.temuan_pemeriksaan tf
  where tf.usaha_id = v_inspection.usaha_id
    and tf.pemeriksaan_id = v_inspection.pemeriksaan_id;

  if v_inspection.keputusan_operasional = 'maintenance_required'
     or exists (
       select 1
       from public.temuan_pemeriksaan tf
       where tf.usaha_id = v_inspection.usaha_id
         and tf.pemeriksaan_id = v_inspection.pemeriksaan_id
         and tf.jenis_temuan = 'damage'
     )
  then
    v_type := 'repair';
    v_description := 'Perbaikan setelah penyewaan berdasarkan hasil pemeriksaan.';
  elsif v_inspection.keputusan_operasional = 'cleaning_required'
     or exists (
       select 1
       from public.temuan_pemeriksaan tf
       where tf.usaha_id = v_inspection.usaha_id
         and tf.pemeriksaan_id = v_inspection.pemeriksaan_id
         and tf.jenis_temuan = 'dirty'
     )
  then
    v_type := 'cleaning';
    v_description := 'Pembersihan setelah penyewaan berdasarkan hasil pemeriksaan.';
  elsif v_inspection.hasil = 'normal'
     or v_inspection.keputusan_operasional in ('ready_review','readiness_review','no_action')
  then
    v_type := 'cleaning';
    v_description := 'Pembersihan standar setelah penyewaan.';
  else
    v_type := 'inspection_follow_up';
    v_description := 'Tindak lanjut hasil pemeriksaan sebelum unit dinyatakan siap disewakan.';
  end if;

  if v_finding_summary is not null and btrim(v_finding_summary) <> '' then
    v_description := v_description || ' Temuan: ' || left(v_finding_summary, 1400);
  end if;

  v_note := 'Dibuat otomatis setelah pemeriksaan pengembalian selesai.';
  if v_inspection.catatan is not null and btrim(v_inspection.catatan) <> '' then
    v_note := v_note || ' Catatan pemeriksaan: ' || left(btrim(v_inspection.catatan), 1200);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_unit.usaha_id::text || ':maintenance-unit:' || v_unit.unit_barang_id::text, 0)
  );

  perform app_private.apply_inventory_maintenance_state(
    v_unit.usaha_id,
    v_unit.unit_barang_id,
    'pemeriksaan',
    v_inspection.pemeriksaan_id,
    v_admin_id,
    v_note,
    v_unit.updated_at
  );

  insert into public.perawatan(
    perawatan_id,
    usaha_id,
    unit_barang_id,
    pemeriksaan_id,
    jenis_perawatan,
    deskripsi_pekerjaan,
    status,
    dimulai_at,
    selesai_at,
    biaya,
    currency_code,
    pelaksana,
    catatan
  )
  values(
    v_maintenance_id,
    v_unit.usaha_id,
    v_unit.unit_barang_id,
    v_inspection.pemeriksaan_id,
    v_type,
    v_description,
    'planned',
    null,
    null,
    null,
    'IDR',
    null,
    v_note
  );

  insert into public.audit_log(
    usaha_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    change_summary
  )
  values(
    v_unit.usaha_id,
    v_admin_id,
    'create_maintenance',
    'perawatan',
    v_maintenance_id,
    'inspection-handoff',
    jsonb_build_object(
      'unit_barang_id',v_unit.unit_barang_id,
      'pemeriksaan_id',v_inspection.pemeriksaan_id,
      'jenis_perawatan',v_type,
      'status','planned',
      'automatic_after_return_inspection',true
    )
  );

  insert into public.outbox_event(
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  values(
    v_unit.usaha_id,
    'maintenance.created',
    'perawatan',
    v_maintenance_id,
    jsonb_build_object(
      'perawatan_id',v_maintenance_id,
      'unit_barang_id',v_unit.unit_barang_id,
      'pemeriksaan_id',v_inspection.pemeriksaan_id,
      'jenis_perawatan',v_type,
      'status','planned',
      'automatic_after_return_inspection',true
    )
  );

  return v_maintenance_id;
end;
$function$;

create or replace function app_private.trigger_ensure_return_inspection_maintenance()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status_pemeriksaan = 'completed'
     and (
       tg_op = 'INSERT'
       or old.status_pemeriksaan is distinct from new.status_pemeriksaan
     )
  then
    perform app_private.ensure_return_inspection_maintenance(new.detail_pengembalian_id);
  end if;

  return new;
end;
$function$;

drop trigger if exists detail_pengembalian_auto_maintenance
  on public.detail_pengembalian;

create trigger detail_pengembalian_auto_maintenance
after insert or update of status_pemeriksaan
on public.detail_pengembalian
for each row
execute function app_private.trigger_ensure_return_inspection_maintenance();

revoke all on function app_private.ensure_return_inspection_maintenance(uuid)
  from public, anon, authenticated, service_role;

revoke all on function app_private.trigger_ensure_return_inspection_maintenance()
  from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select dp.detail_pengembalian_id
    from public.detail_pengembalian dp
    join public.unit_barang ub
      on ub.usaha_id = dp.usaha_id
     and ub.unit_barang_id = dp.unit_barang_id
    where dp.status_pemeriksaan = 'completed'
      and ub.status = 'inspection_pending'
      and exists (
        select 1
        from public.pemeriksaan p
        where p.usaha_id = dp.usaha_id
          and p.detail_pengembalian_id = dp.detail_pengembalian_id
          and p.hasil <> 'pending'
      )
      and not exists (
        select 1
        from public.perawatan pm
        where pm.usaha_id = dp.usaha_id
          and pm.pemeriksaan_id in (
            select p2.pemeriksaan_id
            from public.pemeriksaan p2
            where p2.usaha_id = dp.usaha_id
              and p2.detail_pengembalian_id = dp.detail_pengembalian_id
              and p2.hasil <> 'pending'
          )
      )
  loop
    perform app_private.ensure_return_inspection_maintenance(r.detail_pengembalian_id);
  end loop;
end;
$$;
