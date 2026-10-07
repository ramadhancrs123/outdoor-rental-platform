-- Operational rental workspace backend: maintenance handoff + rental activation
-- Backend-only. Existing domain commands remain canonical.

CREATE OR REPLACE FUNCTION app_private.ensure_return_inspection_maintenance(
  p_detail_pengembalian_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_detail public.detail_pengembalian%ROWTYPE;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_existing public.perawatan%ROWTYPE;
  v_maintenance_id uuid := gen_random_uuid();
  v_admin_id uuid;
  v_type text;
  v_description text;
  v_note text;
  v_finding_summary text;
  v_requires_maintenance boolean := false;
BEGIN
  IF p_detail_pengembalian_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail pengembalian wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT *
  INTO v_detail
  FROM public.detail_pengembalian
  WHERE detail_pengembalian_id = p_detail_pengembalian_id
  FOR UPDATE;

  IF NOT FOUND OR v_detail.status_pemeriksaan <> 'completed' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id = v_detail.usaha_id
    AND detail_pengembalian_id = v_detail.detail_pengembalian_id
    AND hasil <> 'pending'
  ORDER BY diperiksa_at DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A normal inspection is not synthetic maintenance.
  v_requires_maintenance := (
    v_inspection.keputusan_operasional IN (
      'cleaning_required',
      'maintenance_required',
      'follow_up_required'
    )
    OR EXISTS (
      SELECT 1
      FROM public.temuan_pemeriksaan tf
      WHERE tf.usaha_id = v_inspection.usaha_id
        AND tf.pemeriksaan_id = v_inspection.pemeriksaan_id
        AND tf.jenis_temuan IN ('damage', 'dirty', 'missing_component')
    )
  );

  IF NOT v_requires_maintenance THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = v_detail.usaha_id
    AND unit_barang_id = v_detail.unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit pengembalian tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_admin_id := v_inspection.diperiksa_by_admin_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan tidak memiliki admin pemeriksa' USING ERRCODE='23514';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.perawatan
  WHERE usaha_id = v_inspection.usaha_id
    AND pemeriksaan_id = v_inspection.pemeriksaan_id
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_existing.perawatan_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.perawatan pm
    WHERE pm.usaha_id = v_unit.usaha_id
      AND pm.unit_barang_id = v_unit.unit_barang_id
      AND pm.status IN ('planned','in_progress')
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit sudah memiliki perawatan aktif lain' USING ERRCODE='23514';
  END IF;

  SELECT string_agg(
    left(
      coalesce(nullif(btrim(tf.jenis_temuan),''),'Temuan')
      || ': '
      || left(coalesce(nullif(btrim(tf.deskripsi),''),'Tanpa deskripsi'), 320),
      380
    ),
    '; ' ORDER BY tf.created_at
  )
  INTO v_finding_summary
  FROM public.temuan_pemeriksaan tf
  WHERE tf.usaha_id = v_inspection.usaha_id
    AND tf.pemeriksaan_id = v_inspection.pemeriksaan_id;

  IF v_inspection.keputusan_operasional IN ('maintenance_required','follow_up_required')
     OR EXISTS (
       SELECT 1
       FROM public.temuan_pemeriksaan tf
       WHERE tf.usaha_id = v_inspection.usaha_id
         AND tf.pemeriksaan_id = v_inspection.pemeriksaan_id
         AND tf.jenis_temuan IN ('damage','missing_component')
     )
  THEN
    v_type := 'repair';
    v_description := 'Tindak lanjut setelah penyewaan berdasarkan hasil pemeriksaan.';
  ELSIF v_inspection.keputusan_operasional = 'cleaning_required'
     OR EXISTS (
       SELECT 1
       FROM public.temuan_pemeriksaan tf
       WHERE tf.usaha_id = v_inspection.usaha_id
         AND tf.pemeriksaan_id = v_inspection.pemeriksaan_id
         AND tf.jenis_temuan = 'dirty'
     )
  THEN
    v_type := 'cleaning';
    v_description := 'Pembersihan setelah penyewaan berdasarkan hasil pemeriksaan.';
  ELSE
    v_type := 'inspection_follow_up';
    v_description := 'Tindak lanjut hasil pemeriksaan sebelum unit dinyatakan siap disewakan.';
  END IF;

  IF v_finding_summary IS NOT NULL AND btrim(v_finding_summary) <> '' THEN
    v_description := v_description || ' Temuan: ' || left(v_finding_summary, 1400);
  END IF;

  v_note := 'Dibuat otomatis setelah pemeriksaan pengembalian memerlukan tindak lanjut.';
  IF v_inspection.catatan IS NOT NULL AND btrim(v_inspection.catatan) <> '' THEN
    v_note := v_note || ' Catatan pemeriksaan: ' || left(btrim(v_inspection.catatan), 1200);
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_unit.usaha_id::text || ':maintenance-unit:' || v_unit.unit_barang_id::text, 0)
  );

  PERFORM app_private.apply_inventory_maintenance_state(
    v_unit.usaha_id,
    v_unit.unit_barang_id,
    'pemeriksaan',
    v_inspection.pemeriksaan_id,
    v_admin_id,
    v_note,
    v_unit.updated_at
  );

  INSERT INTO public.perawatan(
    perawatan_id, usaha_id, unit_barang_id, pemeriksaan_id,
    jenis_perawatan, deskripsi_pekerjaan, status,
    dimulai_at, selesai_at, biaya, currency_code, pelaksana, catatan
  )
  VALUES(
    v_maintenance_id,
    v_unit.usaha_id,
    v_unit.unit_barang_id,
    v_inspection.pemeriksaan_id,
    v_type,
    v_description,
    'planned',
    NULL, NULL, NULL, 'IDR', NULL, v_note
  );

  INSERT INTO public.audit_log(
    usaha_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, change_summary
  )
  VALUES(
    v_unit.usaha_id, v_admin_id, 'create_maintenance', 'perawatan',
    v_maintenance_id, 'inspection-handoff',
    jsonb_build_object(
      'unit_barang_id',v_unit.unit_barang_id,
      'pemeriksaan_id',v_inspection.pemeriksaan_id,
      'jenis_perawatan',v_type,
      'status','planned',
      'automatic_after_return_inspection',true
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES(
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

  RETURN v_maintenance_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.trigger_ensure_return_inspection_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status_pemeriksaan = 'completed'
     AND (
       TG_OP = 'INSERT'
       OR OLD.status_pemeriksaan IS DISTINCT FROM NEW.status_pemeriksaan
     )
  THEN
    PERFORM app_private.ensure_return_inspection_maintenance(NEW.detail_pengembalian_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS detail_pengembalian_auto_maintenance
  ON public.detail_pengembalian;

CREATE TRIGGER detail_pengembalian_auto_maintenance
AFTER INSERT OR UPDATE OF status_pemeriksaan
ON public.detail_pengembalian
FOR EACH ROW
EXECUTE FUNCTION app_private.trigger_ensure_return_inspection_maintenance();

CREATE OR REPLACE FUNCTION app_private.command_operational_activate_rental(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_rental public.penyewaan%ROWTYPE;
  v_detail public.detail_penyewaan%ROWTYPE;
  v_component public.komponen_penyewaan%ROWTYPE;
  v_candidate record;
  v_parent_barang_id uuid;
  v_remaining numeric;
  v_counter integer;
  v_assignment_count integer := 0;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_handover jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_penyewaan_id IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, rental, request_id, dan idempotency_key wajib diisi'
      USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha'
      USING ERRCODE='42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'penyewaan_id',p_penyewaan_id,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  )
  VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'operational_activate_rental',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='operational_activate_rental'
      AND key=btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: operational activation memiliki idempotency record tanpa response'
      USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':operational-rental:'||p_penyewaan_id::text,0)
  );

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id=p_usaha_id
    AND penyewaan_id=p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_rental.status NOT IN ('draft','ready_for_pickup') THEN
    IF v_rental.status='active' AND v_rental.actual_pickup_at IS NOT NULL THEN
      v_response := jsonb_build_object(
        'penyewaan_id',v_rental.penyewaan_id,
        'status',v_rental.status,
        'actual_pickup_at',v_rental.actual_pickup_at,
        'already_active',true
      );
      UPDATE public.idempotency_key
      SET response_status=200,response_body=v_response
      WHERE idempotency_key_id=v_idempotency_id;
      RETURN v_response;
    END IF;

    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental tidak berada pada state persiapan/serah-terima; status=%',
      v_rental.status USING ERRCODE='23514';
  END IF;

  FOR v_detail IN
    SELECT *
    FROM public.detail_penyewaan
    WHERE usaha_id=p_usaha_id
      AND penyewaan_id=p_penyewaan_id
    ORDER BY created_at,detail_penyewaan_id
  LOOP
    IF v_detail.paket_sewa_id IS NULL THEN
      v_remaining := v_detail.jumlah
        - (
          SELECT count(*)::numeric
          FROM public.penetapan_unit pu
          WHERE pu.usaha_id=p_usaha_id
            AND pu.detail_penyewaan_id=v_detail.detail_penyewaan_id
            AND pu.komponen_penyewaan_id IS NULL
            AND pu.status='assigned'
        );

      IF v_remaining < 0 OR v_remaining <> trunc(v_remaining) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: quantity fisik pada detail rental tidak dapat dipetakan ke unit utuh'
          USING ERRCODE='23514';
      END IF;

      IF v_remaining > 0 THEN
        IF v_detail.varian_barang_id IS NOT NULL THEN
          SELECT vb.barang_id
          INTO v_parent_barang_id
          FROM public.varian_barang vb
          WHERE vb.usaha_id=p_usaha_id
            AND vb.varian_barang_id=v_detail.varian_barang_id
            AND vb.status='active';

          IF v_parent_barang_id IS NULL THEN
            RAISE EXCEPTION 'NOT_FOUND: barang induk varian tidak ditemukan'
              USING ERRCODE='P0002';
          END IF;
        ELSE
          v_parent_barang_id := v_detail.barang_id;
        END IF;

        FOR v_counter IN 1..v_remaining::integer
        LOOP
          SELECT *
          INTO v_candidate
          FROM app_private.find_inventory_unit_candidates(
            p_usaha_id,
            v_parent_barang_id,
            v_detail.varian_barang_id,
            v_rental.jadwal_mulai,
            v_rental.jadwal_kembali,
            NULL,
            p_penyewaan_id,
            100
          )
          WHERE eligibility
          ORDER BY preferred DESC,unit_code
          LIMIT 1;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'BUSINESS_CONFLICT: tidak ada unit READY yang eligible untuk auto-assignment detail %',
              v_detail.detail_penyewaan_id USING ERRCODE='23514';
          END IF;

          PERFORM app_private.command_assign_rental_unit_checked(
            p_usaha_id,
            p_penyewaan_id,
            v_detail.detail_penyewaan_id,
            v_candidate.unit_barang_id,
            NULL,
            NULL,
            NULL,
            'Auto-assignment operational workspace',
            btrim(p_idempotency_key)||':assign:'||v_detail.detail_penyewaan_id::text||':'||v_counter::text,
            p_request_id
          );

          v_assignment_count := v_assignment_count + 1;
        END LOOP;
      END IF;
    ELSE
      FOR v_component IN
        SELECT *
        FROM public.komponen_penyewaan
        WHERE usaha_id=p_usaha_id
          AND detail_penyewaan_id=v_detail.detail_penyewaan_id
        ORDER BY created_at,komponen_penyewaan_id
      LOOP
        v_remaining := v_component.jumlah
          - (
            SELECT count(*)::numeric
            FROM public.penetapan_unit pu
            WHERE pu.usaha_id=p_usaha_id
              AND pu.komponen_penyewaan_id=v_component.komponen_penyewaan_id
              AND pu.status='assigned'
          );

        IF v_remaining < 0 OR v_remaining <> trunc(v_remaining) THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: quantity komponen paket tidak dapat dipetakan ke unit utuh'
            USING ERRCODE='23514';
        END IF;

        IF v_remaining > 0 THEN
          IF v_component.varian_barang_id IS NOT NULL THEN
            SELECT vb.barang_id
            INTO v_parent_barang_id
            FROM public.varian_barang vb
            WHERE vb.usaha_id=p_usaha_id
              AND vb.varian_barang_id=v_component.varian_barang_id
              AND vb.status='active';

            IF v_parent_barang_id IS NULL THEN
              RAISE EXCEPTION 'NOT_FOUND: barang induk varian komponen tidak ditemukan'
                USING ERRCODE='P0002';
            END IF;
          ELSE
            v_parent_barang_id := v_component.barang_id;
          END IF;

          FOR v_counter IN 1..v_remaining::integer
          LOOP
            SELECT *
            INTO v_candidate
            FROM app_private.find_inventory_unit_candidates(
              p_usaha_id,
              v_parent_barang_id,
              v_component.varian_barang_id,
              v_rental.jadwal_mulai,
              v_rental.jadwal_kembali,
              NULL,
              p_penyewaan_id,
              100
            )
            WHERE eligibility
            ORDER BY preferred DESC,unit_code
            LIMIT 1;

            IF NOT FOUND THEN
              RAISE EXCEPTION 'BUSINESS_CONFLICT: tidak ada unit READY yang eligible untuk auto-assignment komponen %',
                v_component.komponen_penyewaan_id USING ERRCODE='23514';
            END IF;

            PERFORM app_private.command_assign_rental_unit_checked(
              p_usaha_id,
              p_penyewaan_id,
              v_detail.detail_penyewaan_id,
              v_candidate.unit_barang_id,
              v_component.komponen_penyewaan_id,
              NULL,
              NULL,
              'Auto-assignment operational workspace',
              btrim(p_idempotency_key)||':assign:'||v_component.komponen_penyewaan_id::text||':'||v_counter::text,
              p_request_id
            );

            v_assignment_count := v_assignment_count + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  v_handover := app_private.command_complete_rental_handover(
    p_usaha_id,
    p_penyewaan_id,
    NULL,
    nullif(btrim(coalesce(p_catatan,'')),''),
    btrim(p_idempotency_key)||':handover',
    p_request_id
  );

  v_response := jsonb_build_object(
    'penyewaan_id',p_penyewaan_id,
    'status',v_handover->>'status',
    'actual_pickup_at',v_handover->'actual_pickup_at',
    'assigned_now',v_assignment_count,
    'handover',v_handover
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'operational_activate_rental',
    'penyewaan',p_penyewaan_id,'admin-command',p_request_id,
    jsonb_build_object('assigned_now',v_assignment_count)
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_operational_activate_rental(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.command_operational_activate_rental($1,$2,$3,$4,$5);
$function$;

REVOKE ALL ON FUNCTION app_private.command_operational_activate_rental(uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.command_operational_activate_rental(uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.command_operational_activate_rental(uuid,uuid,text,text,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.ensure_return_inspection_maintenance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION app_private.trigger_ensure_return_inspection_maintenance()
  FROM PUBLIC, anon, authenticated, service_role;
