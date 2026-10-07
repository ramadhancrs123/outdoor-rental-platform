-- Fix operational auto-assignment: never reuse a unit already assigned
-- anywhere in the same rental while resolving the next candidate.

DO $migration$
DECLARE
  v_original text;
  v_definition text;
  v_replacement text := $replacement$
WHERE eligibility
            AND NOT EXISTS (
              SELECT 1
              FROM public.penetapan_unit pu
              JOIN public.detail_penyewaan dp2
                ON dp2.usaha_id = pu.usaha_id
               AND dp2.detail_penyewaan_id = pu.detail_penyewaan_id
              WHERE pu.usaha_id = p_usaha_id
                AND pu.unit_barang_id = v_candidate.unit_barang_id
                AND pu.status = 'assigned'
                AND dp2.penyewaan_id = p_penyewaan_id
            )
          ORDER BY preferred DESC,unit_code$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_original
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='app_private'
    AND p.proname='command_operational_activate_rental'
    AND pg_get_function_identity_arguments(p.oid)=
      'p_usaha_id uuid, p_penyewaan_id uuid, p_catatan text, p_idempotency_key text, p_request_id uuid';

  IF v_original IS NULL THEN
    RAISE EXCEPTION 'OPERATIONAL_ASSIGNMENT_GAP: activation function not found';
  END IF;

  v_definition := replace(
    v_original,
    E'WHERE eligibility\n          ORDER BY preferred DESC,unit_code',
    v_replacement
  );

  IF v_definition = v_original THEN
    RAISE EXCEPTION 'OPERATIONAL_ASSIGNMENT_GAP: candidate filter anchor not found';
  END IF;

  EXECUTE v_definition;
END;
$migration$;
