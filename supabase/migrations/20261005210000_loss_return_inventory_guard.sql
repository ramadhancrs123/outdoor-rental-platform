-- Harden loss/unavailable return flow:
-- - loss findings become an explicit Inventory physical-state handoff
-- - the handoff is guarded at the database boundary so alternate entrypoints cannot
--   leave the returned unit stuck in inspection_pending
-- - existing stuck loss inspections are reconciled once
-- - operational read contract exposes lost as a first-class readiness state

CREATE OR REPLACE FUNCTION app_private.apply_loss_inspection_inventory_guard(
  p_pemeriksaan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_inspection public.pemeriksaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_loss public.temuan_pemeriksaan%ROWTYPE;
  v_actor_id uuid;
  v_reason text;
BEGIN
  SELECT *
  INTO v_inspection
  FROM public.pemeriksaan
  WHERE pemeriksaan_id = p_pemeriksaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemeriksaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_inspection.hasil <> 'issue_found'
     OR v_inspection.keputusan_operasional <> 'unavailable'
  THEN
    RETURN jsonb_build_object(
      'state','not_applicable',
      'pemeriksaan_id',p_pemeriksaan_id
    );
  END IF;

  SELECT *
  INTO v_loss
  FROM public.temuan_pemeriksaan
  WHERE usaha_id = v_inspection.usaha_id
    AND pemeriksaan_id = p_pemeriksaan_id
    AND jenis_temuan = 'loss'
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state','not_applicable',
      'pemeriksaan_id',p_pemeriksaan_id
    );
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = v_inspection.usaha_id
    AND unit_barang_id = v_inspection.unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit pemeriksaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_actor_id := v_inspection.diperiksa_by_admin_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan loss tidak memiliki admin pemeriksa' USING ERRCODE='23514';
  END IF;

  v_reason := COALESCE(
    nullif(btrim(v_loss.deskripsi), ''),
    'Unit dinyatakan hilang pada hasil pemeriksaan return.'
  );

  IF v_unit.status = 'rented' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: temuan loss tidak boleh mengubah unit yang masih berstatus rented' USING ERRCODE='23514';
  END IF;

  IF v_unit.status = 'lost' THEN
    RETURN jsonb_build_object(
      'state','unchanged',
      'pemeriksaan_id',p_pemeriksaan_id,
      'unit_barang_id',v_unit.unit_barang_id,
      'unit_status','lost'
    );
  END IF;

  IF v_unit.status <> 'inspection_pending' THEN
    RETURN jsonb_build_object(
      'state','deferred',
      'pemeriksaan_id',p_pemeriksaan_id,
      'unit_barang_id',v_unit.unit_barang_id,
      'unit_status',v_unit.status
    );
  END IF;

  UPDATE public.unit_barang
  SET status = 'lost',
      updated_at = now()
  WHERE usaha_id = v_unit.usaha_id
    AND unit_barang_id = v_unit.unit_barang_id;

  INSERT INTO public.riwayat_unit(
    usaha_id,
    unit_barang_id,
    jenis_kejadian,
    terjadi_at,
    status_sebelum,
    status_sesudah,
    lokasi_sebelum_id,
    lokasi_sesudah_id,
    sumber_type,
    sumber_id,
    actor_akun_admin_id,
    catatan,
    metadata
  )
  VALUES(
    v_unit.usaha_id,
    v_unit.unit_barang_id,
    'unit_marked_lost',
    now(),
    v_unit.status,
    'lost',
    v_unit.lokasi_id,
    v_unit.lokasi_id,
    'pemeriksaan',
    p_pemeriksaan_id,
    v_actor_id,
    v_reason,
    jsonb_build_object(
      'pemeriksaan_id', p_pemeriksaan_id,
      'temuan_pemeriksaan_id', v_loss.temuan_pemeriksaan_id,
      'source_decision', v_inspection.keputusan_operasional,
      'automatic_guard', true,
      'status_before', v_unit.status,
      'status_after', 'lost'
    )
  );

  INSERT INTO public.audit_log(
    usaha_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    change_summary
  )
  VALUES(
    v_unit.usaha_id,
    v_actor_id,
    'set_inventory_unit_lost_from_inspection',
    'unit_barang',
    v_unit.unit_barang_id,
    'inspection-guard',
    jsonb_build_object(
      'pemeriksaan_id', p_pemeriksaan_id,
      'temuan_pemeriksaan_id', v_loss.temuan_pemeriksaan_id,
      'status_before', v_unit.status,
      'status_after', 'lost',
      'reason', v_reason,
      'automatic_guard', true
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES(
    v_unit.usaha_id,
    'inventory.unit_status_changed',
    'unit_barang',
    v_unit.unit_barang_id,
    jsonb_build_object(
      'unit_barang_id', v_unit.unit_barang_id,
      'status_before', v_unit.status,
      'status_after', 'lost',
      'reason', v_reason,
      'source_type', 'pemeriksaan',
      'source_id', p_pemeriksaan_id,
      'automatic_guard', true
    )
  );

  RETURN jsonb_build_object(
    'state','changed',
    'pemeriksaan_id',p_pemeriksaan_id,
    'unit_barang_id',v_unit.unit_barang_id,
    'unit_status','lost'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.apply_loss_inspection_inventory_guard(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.trigger_apply_loss_inspection_inventory_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.jenis_temuan = 'loss' THEN
    PERFORM app_private.apply_loss_inspection_inventory_guard(NEW.pemeriksaan_id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.trigger_apply_loss_inspection_inventory_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_temuan_pemeriksaan_loss_inventory_guard
  ON public.temuan_pemeriksaan;

CREATE TRIGGER trg_temuan_pemeriksaan_loss_inventory_guard
AFTER INSERT OR UPDATE OF jenis_temuan, pemeriksaan_id
ON public.temuan_pemeriksaan
FOR EACH ROW
EXECUTE FUNCTION app_private.trigger_apply_loss_inspection_inventory_guard();

-- Reconcile data produced before this guard existed.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.pemeriksaan_id
    FROM public.pemeriksaan p
    JOIN public.unit_barang u
      ON u.usaha_id = p.usaha_id
     AND u.unit_barang_id = p.unit_barang_id
    WHERE p.hasil = 'issue_found'
      AND p.keputusan_operasional = 'unavailable'
      AND u.status = 'inspection_pending'
      AND EXISTS (
        SELECT 1
        FROM public.temuan_pemeriksaan tf
        WHERE tf.usaha_id = p.usaha_id
          AND tf.pemeriksaan_id = p.pemeriksaan_id
          AND tf.jenis_temuan = 'loss'
      )
  LOOP
    PERFORM app_private.apply_loss_inspection_inventory_guard(r.pemeriksaan_id);
  END LOOP;
END;
$$;

-- First-class lost readiness state for the operational return read contract.
CREATE OR REPLACE FUNCTION public.get_operational_return_workspace(
  p_usaha_id uuid,
  p_penyewaan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id
      AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha'
      USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'rental',jsonb_build_object(
      'penyewaan_id',r.penyewaan_id,
      'nomor_penyewaan',r.nomor_penyewaan,
      'status',r.status,
      'jadwal_mulai',r.jadwal_mulai,
      'jadwal_kembali',r.jadwal_kembali,
      'tolerance_deadline',r.tolerance_deadline,
      'actual_pickup_at',r.actual_pickup_at,
      'actual_return_started_at',r.actual_return_started_at,
      'actual_return_completed_at',r.actual_return_completed_at,
      'total_amount',r.total_amount,
      'currency_code',r.currency_code
    ),
    'renter',jsonb_build_object(
      'penyewa_id',s.penyewa_id,
      'nama_lengkap',s.nama_lengkap,
      'nomor_telepon',s.nomor_telepon
    ),
    'units',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'unit_barang_id',u.unit_barang_id,
          'kode_unit',u.kode_unit,
          'barang_id',u.barang_id,
          'varian_barang_id',u.varian_barang_id,
          'unit_status',u.status,
          'kondisi_ringkas',u.kondisi_ringkas,
          'assignment',(
            SELECT jsonb_build_object(
              'penetapan_unit_id',pu.penetapan_unit_id,
              'detail_penyewaan_id',pu.detail_penyewaan_id,
              'komponen_penyewaan_id',pu.komponen_penyewaan_id,
              'status',pu.status
            )
            FROM public.penetapan_unit pu
            JOIN public.detail_penyewaan dp
              ON dp.usaha_id=pu.usaha_id
             AND dp.detail_penyewaan_id=pu.detail_penyewaan_id
            WHERE pu.usaha_id=p_usaha_id
              AND pu.unit_barang_id=u.unit_barang_id
              AND pu.status='assigned'
              AND dp.penyewaan_id=p_penyewaan_id
            ORDER BY pu.ditetapkan_at DESC,pu.created_at DESC
            LIMIT 1
          ),
          'return',(
            SELECT jsonb_build_object(
              'detail_pengembalian_id',dr.detail_pengembalian_id,
              'pengembalian_id',dr.pengembalian_id,
              'diterima_at',dr.diterima_at,
              'kondisi_awal',dr.kondisi_awal,
              'status_pemeriksaan',dr.status_pemeriksaan,
              'catatan',dr.catatan
            )
            FROM public.detail_pengembalian dr
            JOIN public.pengembalian pr
              ON pr.usaha_id=dr.usaha_id
             AND pr.pengembalian_id=dr.pengembalian_id
            WHERE dr.usaha_id=p_usaha_id
              AND dr.unit_barang_id=u.unit_barang_id
              AND pr.penyewaan_id=p_penyewaan_id
            ORDER BY dr.diterima_at DESC,dr.created_at DESC
            LIMIT 1
          ),
          'inspection',(
            SELECT jsonb_build_object(
              'pemeriksaan_id',pi.pemeriksaan_id,
              'detail_pengembalian_id',pi.detail_pengembalian_id,
              'hasil',pi.hasil,
              'kelengkapan_status',pi.kelengkapan_status,
              'keputusan_operasional',pi.keputusan_operasional,
              'diperiksa_at',pi.diperiksa_at,
              'catatan',pi.catatan,
              'finding_count',(
                SELECT count(*) FROM public.temuan_pemeriksaan tf
                WHERE tf.usaha_id=pi.usaha_id
                  AND tf.pemeriksaan_id=pi.pemeriksaan_id
              )
            )
            FROM public.pemeriksaan pi
            WHERE pi.usaha_id=p_usaha_id
              AND pi.unit_barang_id=u.unit_barang_id
            ORDER BY pi.diperiksa_at DESC,pi.created_at DESC
            LIMIT 1
          ),
          'maintenance',(
            SELECT jsonb_build_object(
              'perawatan_id',pm.perawatan_id,
              'pemeriksaan_id',pm.pemeriksaan_id,
              'jenis_perawatan',pm.jenis_perawatan,
              'status',pm.status,
              'dimulai_at',pm.dimulai_at,
              'selesai_at',pm.selesai_at,
              'biaya',pm.biaya,
              'currency_code',pm.currency_code,
              'pelaksana',pm.pelaksana
            )
            FROM public.perawatan pm
            WHERE pm.usaha_id=p_usaha_id
              AND pm.unit_barang_id=u.unit_barang_id
            ORDER BY pm.created_at DESC
            LIMIT 1
          ),
          'readiness_state',CASE
            WHEN u.status='lost' THEN 'lost'
            WHEN u.status='ready' THEN 'ready'
            WHEN EXISTS(
              SELECT 1 FROM public.perawatan pm
              WHERE pm.usaha_id=p_usaha_id
                AND pm.unit_barang_id=u.unit_barang_id
                AND pm.status IN ('planned','in_progress')
            ) THEN 'maintenance_required'
            WHEN EXISTS(
              SELECT 1 FROM public.pemeriksaan pi
              WHERE pi.usaha_id=p_usaha_id
                AND pi.unit_barang_id=u.unit_barang_id
                AND pi.hasil<>'normal'
            ) THEN 'blocked'
            WHEN u.status='inspection_pending' THEN 'inspection_pending'
            ELSE 'blocked'
          END
        )
        ORDER BY u.kode_unit
      )
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id
        AND u.unit_barang_id IN(
          SELECT pu.unit_barang_id
          FROM public.penetapan_unit pu
          JOIN public.detail_penyewaan dp
            ON dp.usaha_id=pu.usaha_id
           AND dp.detail_penyewaan_id=pu.detail_penyewaan_id
          WHERE pu.usaha_id=p_usaha_id
            AND dp.penyewaan_id=p_penyewaan_id
            AND pu.status='assigned'
        )
    ),'[]'::jsonb)
  )
  INTO v_result
  FROM public.penyewaan r
  JOIN public.penyewa s
    ON s.usaha_id=r.usaha_id
   AND s.penyewa_id=r.penyewa_id
  WHERE r.usaha_id=p_usaha_id
    AND r.penyewaan_id=p_penyewaan_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: operational return workspace tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_operational_return_workspace(uuid,uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_operational_return_workspace(uuid,uuid)
  TO authenticated;
