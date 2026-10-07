-- Operational rental workspace backend: return/inspection orchestration + read contracts
-- Backend-only. Existing domain commands remain canonical.

CREATE OR REPLACE FUNCTION app_private.command_operational_process_unit_return(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_unit_barang_id uuid,
  p_hasil text,
  p_kelengkapan_status text,
  p_keputusan_operasional text,
  p_catatan text,
  p_findings jsonb,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_rental_updated_at timestamptz
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
  v_unit public.unit_barang%ROWTYPE;
  v_detail_id uuid;
  v_inspection_id uuid;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_maintenance_id uuid;
  v_return_response jsonb;
  v_start_response jsonb;
  v_complete_response jsonb;
  v_ready_response jsonb;
  v_response jsonb;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_readiness_state text := 'blocked';
  v_block_reason text;
  v_findings jsonb := COALESCE(p_findings,'[]'::jsonb);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_penyewaan_id IS NULL
     OR p_unit_barang_id IS NULL
     OR p_hasil IS NULL
     OR p_kelengkapan_status IS NULL
     OR p_keputusan_operasional IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
     OR p_expected_rental_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks return/inspection wajib lengkap'
      USING ERRCODE='22023';
  END IF;

  IF jsonb_typeof(v_findings) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: findings harus berupa array' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha'
      USING ERRCODE='42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'penyewaan_id',p_penyewaan_id,
    'unit_barang_id',p_unit_barang_id,
    'hasil',p_hasil,
    'kelengkapan_status',p_kelengkapan_status,
    'keputusan_operasional',p_keputusan_operasional,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
    'findings',v_findings,
    'expected_rental_updated_at',p_expected_rental_updated_at
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  )
  VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'operational_process_unit_return',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='operational_process_unit_return'
      AND key=btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: return orchestration memiliki idempotency record tanpa response'
      USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_usaha_id::text||':operational-return:'||p_penyewaan_id::text||':'||p_unit_barang_id::text,
      0
    )
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

  IF v_rental.updated_at IS DISTINCT FROM p_expected_rental_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: rental berubah sejak dibuka. Muat ulang sebelum memproses unit return.'
      USING ERRCODE='40001';
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  -- Step 1: canonical Return command.
  v_return_response := app_private.command_process_unit_return(
    p_usaha_id,
    p_penyewaan_id,
    ARRAY[p_unit_barang_id],
    nullif(btrim(coalesce(p_catatan,'')),''),
    btrim(p_idempotency_key)||':return',
    p_request_id,
    p_expected_rental_updated_at
  );

  v_detail_id := (v_return_response->'detail_pengembalian_ids'->>0)::uuid;

  -- Step 2: canonical Inspection start.
  v_start_response := public.command_start_inspection(
    p_usaha_id,
    v_detail_id,
    p_unit_barang_id,
    btrim(p_idempotency_key)||':inspection:start',
    p_request_id
  );

  v_inspection_id := (v_start_response->>'pemeriksaan_id')::uuid;

  SELECT *
  INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=v_inspection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: inspection start berhasil tetapi record tidak ditemukan'
      USING ERRCODE='40001';
  END IF;

  -- Step 3: canonical Inspection completion.
  v_complete_response := public.command_complete_inspection(
    p_usaha_id,
    v_inspection_id,
    p_hasil,
    p_kelengkapan_status,
    p_keputusan_operasional,
    p_catatan,
    v_findings,
    btrim(p_idempotency_key)||':inspection:complete',
    p_request_id,
    v_inspection.updated_at,
    v_unit.updated_at
  );

  -- Refresh unit state after inspection + its trigger.
  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  SELECT pm.perawatan_id
  INTO v_maintenance_id
  FROM public.perawatan pm
  WHERE pm.usaha_id=p_usaha_id
    AND pm.pemeriksaan_id=v_inspection_id
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_maintenance_id IS NOT NULL THEN
    v_readiness_state := 'maintenance_required';
    v_block_reason := 'Unit memerlukan tindak lanjut perawatan sebelum readiness.';
  ELSIF p_hasil <> 'normal' THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Hasil pemeriksaan tidak memenuhi readiness normal.';
  ELSIF p_kelengkapan_status <> 'complete' THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Kelengkapan unit belum complete.';
  ELSIF p_keputusan_operasional NOT IN ('ready_review','no_action','readiness_review') THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Keputusan operasional belum memenuhi readiness review.';
  ELSE
    BEGIN
      v_ready_response := public.command_mark_inventory_unit_ready(
        p_usaha_id,
        p_unit_barang_id,
        nullif(btrim(coalesce(p_catatan,'')),''),
        btrim(p_idempotency_key)||':ready',
        p_request_id,
        v_unit.updated_at
      );

      v_readiness_state := 'ready';
      v_block_reason := NULL;
    EXCEPTION
      WHEN SQLSTATE '23514' THEN
        v_readiness_state := 'blocked';
        v_block_reason := SQLERRM;
    END;
  END IF;

  v_response := jsonb_build_object(
    'pengembalian_id',v_return_response->>'pengembalian_id',
    'detail_pengembalian_id',v_detail_id,
    'pemeriksaan_id',v_inspection_id,
    'perawatan_id',v_maintenance_id,
    'penyewaan_id',p_penyewaan_id,
    'unit_barang_id',p_unit_barang_id,
    'return',v_return_response,
    'inspection',v_complete_response,
    'maintenance_required',v_maintenance_id IS NOT NULL,
    'readiness_state',v_readiness_state,
    'block_reason',v_block_reason,
    'unit_status',(
      SELECT status
      FROM public.unit_barang
      WHERE usaha_id=p_usaha_id
        AND unit_barang_id=p_unit_barang_id
    ),
    'ready_response',v_ready_response
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'operational_process_unit_return',
    'detail_pengembalian',v_detail_id,'admin-command',p_request_id,
    jsonb_build_object(
      'penyewaan_id',p_penyewaan_id,
      'unit_barang_id',p_unit_barang_id,
      'pemeriksaan_id',v_inspection_id,
      'perawatan_id',v_maintenance_id,
      'readiness_state',v_readiness_state
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  )
  VALUES(
    p_usaha_id,
    'operational.unit_return_processed',
    'detail_pengembalian',
    v_detail_id,
    jsonb_build_object(
      'penyewaan_id',p_penyewaan_id,
      'unit_barang_id',p_unit_barang_id,
      'pemeriksaan_id',v_inspection_id,
      'perawatan_id',v_maintenance_id,
      'readiness_state',v_readiness_state
    )
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_operational_process_unit_return(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_unit_barang_id uuid,
  p_hasil text,
  p_kelengkapan_status text,
  p_keputusan_operasional text,
  p_catatan text,
  p_findings jsonb,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_rental_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.command_operational_process_unit_return(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
  );
$function$;

REVOKE ALL ON FUNCTION app_private.command_operational_process_unit_return(
  uuid,uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.command_operational_process_unit_return(
  uuid,uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.command_operational_process_unit_return(
  uuid,uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz
) TO authenticated;

-- ============================================================
-- Read contract: Rental operational workspace
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_operational_rental_workspace(
  p_usaha_id uuid,
  p_penyewaan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
    'rental',to_jsonb(r),
    'renter',jsonb_build_object(
      'penyewa_id',s.penyewa_id,
      'nama_lengkap',s.nama_lengkap,
      'nomor_telepon',s.nomor_telepon
    ),
    'lines',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'detail_penyewaan_id',dp.detail_penyewaan_id,
          'barang_id',dp.barang_id,
          'barang_nama',b.nama,
          'varian_barang_id',dp.varian_barang_id,
          'varian_nama',vb.nama,
          'paket_sewa_id',dp.paket_sewa_id,
          'paket_nama',ps.nama,
          'jumlah',dp.jumlah,
          'unit_price',dp.unit_price,
          'currency_code',dp.currency_code,
          'subtotal',dp.subtotal,
          'catatan',dp.catatan,
          'assignments',COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'penetapan_unit_id',pu.penetapan_unit_id,
                'unit_barang_id',pu.unit_barang_id,
                'kode_unit',ub.kode_unit,
                'status',pu.status,
                'komponen_penyewaan_id',pu.komponen_penyewaan_id,
                'asal_pilihan_unit_id',pu.asal_pilihan_unit_id,
                'alasan_substitusi',pu.alasan_substitusi
              )
              ORDER BY ub.kode_unit
            )
            FROM public.penetapan_unit pu
            JOIN public.unit_barang ub
              ON ub.usaha_id=pu.usaha_id
             AND ub.unit_barang_id=pu.unit_barang_id
            WHERE pu.usaha_id=p_usaha_id
              AND pu.detail_penyewaan_id=dp.detail_penyewaan_id
          ),'[]'::jsonb)
        )
        ORDER BY dp.created_at,dp.detail_penyewaan_id
      )
      FROM public.detail_penyewaan dp
      LEFT JOIN public.barang b
        ON b.usaha_id=dp.usaha_id
       AND b.barang_id=dp.barang_id
      LEFT JOIN public.varian_barang vb
        ON vb.usaha_id=dp.usaha_id
       AND vb.varian_barang_id=dp.varian_barang_id
      LEFT JOIN public.paket_sewa ps
        ON ps.usaha_id=dp.usaha_id
       AND ps.paket_sewa_id=dp.paket_sewa_id
      WHERE dp.usaha_id=p_usaha_id
        AND dp.penyewaan_id=p_penyewaan_id
    ),'[]'::jsonb),
    'payments',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'pembayaran_id',p.pembayaran_id,
          'nomor_pembayaran',p.nomor_pembayaran,
          'jenis',p.jenis,
          'metode',p.metode,
          'amount',p.amount,
          'currency_code',p.currency_code,
          'dibayar_at',p.dibayar_at,
          'status',p.status,
          'reference_text',p.reference_text
        )
        ORDER BY p.dibayar_at,p.created_at
      )
      FROM public.pembayaran p
      WHERE p.usaha_id=p_usaha_id
        AND p.penyewaan_id=p_penyewaan_id
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
    RAISE EXCEPTION 'NOT_FOUND: operational rental workspace tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_operational_rental_workspace(uuid,uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_operational_rental_workspace(uuid,uuid)
  TO authenticated;

-- ============================================================
-- Read contract: Return/Readiness operational workspace
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_operational_return_workspace(
  p_usaha_id uuid,
  p_penyewaan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
