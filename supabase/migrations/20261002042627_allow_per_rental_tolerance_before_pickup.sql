-- Operational flexibility: a rental-specific tolerance can be adjusted
-- while the rental is still being prepared or already active.
-- The scheduled return time remains unchanged.
DO $migration$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'command_extend_rental_tolerance'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_usaha_id uuid, p_penyewaan_id uuid, p_additional_minutes integer, p_reason text, p_idempotency_key text, p_request_id uuid'
  LIMIT 1;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'command_extend_rental_tolerance definition not found';
  END IF;

  v_updated_definition := replace(
    v_definition,
    'IF v_rental.status NOT IN (''active'', ''return_in_progress'') THEN',
    'IF v_rental.status NOT IN (''draft'', ''ready_for_pickup'', ''active'', ''return_in_progress'') THEN'
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'expected rental tolerance status guard not found';
  END IF;

  v_updated_definition := replace(
    v_updated_definition,
    'BUSINESS_CONFLICT: tambahan toleransi hanya dapat diberikan pada rental yang masih berjalan',
    'BUSINESS_CONFLICT: tambahan toleransi hanya dapat diberikan pada rental yang belum selesai'
  );

  EXECUTE v_updated_definition;
END
$migration$;
