CREATE OR REPLACE FUNCTION app_private.prevent_maintenance_insert_while_verification_pending()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'planned'
     AND EXISTS (
       SELECT 1
       FROM public.perawatan pm
       JOIN public.unit_barang ub
         ON ub.usaha_id = pm.usaha_id
        AND ub.unit_barang_id = pm.unit_barang_id
       WHERE pm.usaha_id = NEW.usaha_id
         AND pm.unit_barang_id = NEW.unit_barang_id
         AND pm.status = 'completed'
         AND ub.status = 'maintenance'
         AND NOT EXISTS (
           SELECT 1
           FROM public.riwayat_unit ru
           WHERE ru.usaha_id = pm.usaha_id
             AND ru.unit_barang_id = pm.unit_barang_id
             AND ru.sumber_type = 'perawatan'
             AND ru.sumber_id = pm.perawatan_id
             AND ru.jenis_kejadian = 'maintenance_verification_passed'
         )
     )
  THEN
    RAISE EXCEPTION
      'BUSINESS_CONFLICT: unit masih memiliki perawatan selesai yang menunggu verification. Selesaikan verification record tersebut terlebih dahulu.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_perawatan_prevent_duplicate_pending_verification ON public.perawatan;
CREATE TRIGGER trg_perawatan_prevent_duplicate_pending_verification
BEFORE INSERT ON public.perawatan
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_maintenance_insert_while_verification_pending();

CREATE OR REPLACE FUNCTION app_private.command_reconcile_maintenance_mutation(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_command_name NOT IN (
       'create_maintenance',
       'start_maintenance',
       'complete_maintenance',
       'verify_maintenance_readiness'
     )
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key)=''
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reconciliation input tidak valid' USING ERRCODE='22023';
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
      AND aa.role='super_admin'
  )
  THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id=p_usaha_id
    AND ik.actor_auth_user_id=v_auth_user_id
    AND ik.command_name=p_command_name
    AND ik.key=btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state','not_found',
      'response',null,
      'command_name',p_command_name
    );
  END IF;

  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body,
    'command_name',p_command_name
  );
END;
$function$;
