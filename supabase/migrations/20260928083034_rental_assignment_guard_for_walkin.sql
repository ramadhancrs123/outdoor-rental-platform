-- Guard the existing assignment command with the domain's locked prerequisites.
-- The wrapper reuses the existing idempotency/audit/outbox command so its
-- reconciliation contract remains command_name='assign_rental_unit'.

CREATE OR REPLACE FUNCTION app_private.command_assign_rental_unit_checked(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_detail_penyewaan_id uuid,
  p_unit_barang_id uuid,
  p_komponen_penyewaan_id uuid,
  p_asal_pilihan_unit_id uuid,
  p_alasan_substitusi text,
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
  v_unit public.unit_barang%ROWTYPE;
  v_component public.komponen_penyewaan%ROWTYPE;
  v_conflict boolean;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_penyewaan_id IS NULL OR p_detail_penyewaan_id IS NULL OR p_unit_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id, penyewaan_id, detail_penyewaan_id, dan unit_barang_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text, 0));

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_detail
  FROM public.detail_penyewaan
  WHERE usaha_id = p_usaha_id
    AND detail_penyewaan_id = p_detail_penyewaan_id
    AND penyewaan_id = p_penyewaan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: detail penyewaan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_unit.status <> 'ready' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak READY dan tidak dapat ditetapkan ke rental normal', v_unit.kode_unit USING ERRCODE = '23514';
  END IF;

  IF v_detail.paket_sewa_id IS NULL THEN
    IF v_detail.varian_barang_id IS NOT NULL THEN
      IF v_unit.varian_barang_id IS DISTINCT FROM v_detail.varian_barang_id THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak cocok dengan varian rental' USING ERRCODE = '23514';
      END IF;
    ELSIF v_unit.barang_id IS DISTINCT FROM v_detail.barang_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak cocok dengan barang rental' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF p_komponen_penyewaan_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: package rental assignment wajib memilih komponen penyewaan' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_component
    FROM public.komponen_penyewaan
    WHERE usaha_id = p_usaha_id
      AND komponen_penyewaan_id = p_komponen_penyewaan_id
      AND detail_penyewaan_id = p_detail_penyewaan_id
      AND paket_sewa_id = v_detail.paket_sewa_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: komponen penyewaan tidak ditemukan pada detail rental' USING ERRCODE = 'P0002';
    END IF;

    IF v_component.varian_barang_id IS NOT NULL THEN
      IF v_unit.varian_barang_id IS DISTINCT FROM v_component.varian_barang_id THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak cocok dengan varian komponen paket' USING ERRCODE = '23514';
      END IF;
    ELSIF v_unit.barang_id IS DISTINCT FROM v_component.barang_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak cocok dengan barang komponen paket' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.penetapan_unit pu
    JOIN public.detail_penyewaan dp
      ON dp.usaha_id = pu.usaha_id
     AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
    JOIN public.penyewaan r
      ON r.usaha_id = dp.usaha_id
     AND r.penyewaan_id = dp.penyewaan_id
    WHERE pu.usaha_id = p_usaha_id
      AND pu.unit_barang_id = p_unit_barang_id
      AND pu.status = 'assigned'
      AND r.penyewaan_id <> p_penyewaan_id
      AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
  )
  INTO v_conflict;

  IF v_conflict THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % sudah memiliki assignment yang masih beroperasi pada rental lain', v_unit.kode_unit USING ERRCODE = '23505';
  END IF;

  RETURN app_private.command_assign_rental_unit(
    p_usaha_id,
    p_penyewaan_id,
    p_detail_penyewaan_id,
    p_unit_barang_id,
    p_komponen_penyewaan_id,
    p_asal_pilihan_unit_id,
    p_alasan_substitusi,
    p_catatan,
    p_idempotency_key,
    p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit_checked(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit_checked(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit_checked(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_assign_rental_unit_checked(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) TO authenticated;
