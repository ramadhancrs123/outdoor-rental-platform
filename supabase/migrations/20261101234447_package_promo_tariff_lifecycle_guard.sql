-- Keep active package promotions coherent with the package tariff they reference.
-- These trusted tariff commands acquire the same promotion lock and require promo OFF
-- before changing the normal price/effective period or deactivating the package tariff.
-- No triggers or existing RPC signatures are changed.

CREATE OR REPLACE FUNCTION app_private.command_update_tarif_sewa(p_usaha_id uuid, p_tarif_sewa_id uuid, p_nama text, p_durasi_unit text, p_durasi_nilai integer, p_nominal numeric, p_berlaku_mulai timestamp with time zone, p_berlaku_sampai timestamp with time zone, p_metadata jsonb DEFAULT NULL::jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text, p_request_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.tarif_sewa%ROWTYPE; v_hash text; v_target_key text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_durasi_nilai IS NULL OR p_durasi_nilai<=0 OR p_nominal IS NULL OR p_nominal<0 OR p_durasi_unit IS NULL OR btrim(p_durasi_unit)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama, durasi, dan nominal wajib valid' USING ERRCODE='22023';
  END IF;
  IF p_berlaku_sampai IS NOT NULL AND p_berlaku_sampai<=p_berlaku_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tarif tidak valid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':tariff-update:' || p_tarif_sewa_id::text,0));

  SELECT * INTO v_row FROM public.tarif_sewa WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: tarif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_target_key:=p_usaha_id::text || ':tariff:' ||
    CASE WHEN v_row.barang_id IS NOT NULL THEN 'barang:'||v_row.barang_id::text
         WHEN v_row.varian_barang_id IS NOT NULL THEN 'varian:'||v_row.varian_barang_id::text
         ELSE 'paket:'||v_row.paket_sewa_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_target_key,0));

  IF v_row.paket_sewa_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':package-promo:' || p_tarif_sewa_id::text, 0)
    );
    IF EXISTS (
      SELECT 1 FROM public.promosi_paket_sewa p
      WHERE p.usaha_id=p_usaha_id AND p.tarif_sewa_id=p_tarif_sewa_id AND p.status='active'
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: nonaktifkan promo paket sebelum mengubah tarif normal atau periode berlakunya' USING ERRCODE='23514';
    END IF;
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'id',p_tarif_sewa_id,'nama',btrim(p_nama),'durasi_unit',btrim(p_durasi_unit),
    'durasi_nilai',p_durasi_nilai,'nominal',p_nominal,'mulai',p_berlaku_mulai,'sampai',p_berlaku_sampai,
    'metadata',p_metadata,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'update_tarif_sewa',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan tarif belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF v_row.status='active' AND EXISTS(
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id=p_usaha_id AND t.tarif_sewa_id<>p_tarif_sewa_id AND t.status='active'
      AND ((v_row.barang_id IS NOT NULL AND t.barang_id=v_row.barang_id)
        OR (v_row.varian_barang_id IS NOT NULL AND t.varian_barang_id=v_row.varian_barang_id)
        OR (v_row.paket_sewa_id IS NOT NULL AND t.paket_sewa_id=v_row.paket_sewa_id))
      AND t.berlaku_mulai < COALESCE(p_berlaku_sampai,'infinity'::timestamptz)
      AND COALESCE(t.berlaku_sampai,'infinity'::timestamptz) > p_berlaku_mulai
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode tarif active tumpang tindih untuk target yang sama' USING ERRCODE='23505';
  END IF;

  UPDATE public.tarif_sewa
     SET nama=btrim(p_nama),durasi_unit=btrim(p_durasi_unit),durasi_nilai=p_durasi_nilai,nominal=p_nominal,
         berlaku_mulai=p_berlaku_mulai,berlaku_sampai=p_berlaku_sampai,metadata=p_metadata,updated_at=now()
   WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_DATA: tarif sudah berubah, muat data terbaru' USING ERRCODE='40001'; END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'update','tarif_sewa',v_row.tarif_sewa_id,'admin-command',p_request_id,jsonb_build_object('nominal',v_row.nominal,'mulai',v_row.berlaku_mulai,'sampai',v_row.berlaku_sampai));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.command_set_tarif_status(p_usaha_id uuid, p_tarif_sewa_id uuid, p_status text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text, p_request_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.tarif_sewa%ROWTYPE; v_hash text; v_target_key text;
BEGIN
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status tarif tidak valid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.tarif_sewa WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: tarif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_target_key:=p_usaha_id::text || ':tariff:' ||
    CASE WHEN v_row.barang_id IS NOT NULL THEN 'barang:'||v_row.barang_id::text
         WHEN v_row.varian_barang_id IS NOT NULL THEN 'varian:'||v_row.varian_barang_id::text
         ELSE 'paket:'||v_row.paket_sewa_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_target_key,0));

  IF p_status='inactive' AND v_row.paket_sewa_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':package-promo:' || p_tarif_sewa_id::text, 0)
    );
    IF EXISTS (
      SELECT 1 FROM public.promosi_paket_sewa p
      WHERE p.usaha_id=p_usaha_id AND p.tarif_sewa_id=p_tarif_sewa_id AND p.status='active'
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: nonaktifkan promo paket sebelum menonaktifkan tarif paket' USING ERRCODE='23514';
    END IF;
  END IF;

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_tarif_sewa_id,'status',p_status,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_tarif_status',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: status tarif belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF p_status='active' AND EXISTS(
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id=p_usaha_id AND t.tarif_sewa_id<>p_tarif_sewa_id AND t.status='active'
      AND ((v_row.barang_id IS NOT NULL AND t.barang_id=v_row.barang_id)
        OR (v_row.varian_barang_id IS NOT NULL AND t.varian_barang_id=v_row.varian_barang_id)
        OR (v_row.paket_sewa_id IS NOT NULL AND t.paket_sewa_id=v_row.paket_sewa_id))
      AND t.berlaku_mulai < COALESCE(v_row.berlaku_sampai,'infinity'::timestamptz)
      AND COALESCE(t.berlaku_sampai,'infinity'::timestamptz) > v_row.berlaku_mulai
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode tarif active tumpang tindih untuk target yang sama' USING ERRCODE='23505';
  END IF;

  UPDATE public.tarif_sewa
   SET status=p_status,updated_at=now()
   WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_DATA: tarif sudah berubah, muat data terbaru' USING ERRCODE='40001'; END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'status_change','tarif_sewa',v_row.tarif_sewa_id,'admin-command',p_request_id,jsonb_build_object('status',v_row.status));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$
;
