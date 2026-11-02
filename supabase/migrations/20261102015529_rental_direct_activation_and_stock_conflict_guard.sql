-- Make direct walk-in creation + assignment + handover atomic.
-- A stock conflict must roll back the newly-created rental instead of leaving a draft.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_count integer;
BEGIN
  -- Inventory candidates: active rentals occupy their assigned units until the
  -- rental is returned/completed, even when the planned date range has elapsed.
  -- Draft and ready-for-pickup rentals reserve units only during overlapping periods.
  v_definition := pg_get_functiondef(
    'app_private.find_inventory_unit_candidates(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,integer)'::regprocedure
  );
  v_old := $old$
          AND p.status NOT IN ('draft', 'cancelled', 'completed')
          AND tstzrange(p.jadwal_mulai, p.jadwal_kembali, '[)')
              && tstzrange(p_start_at, p_end_at, '[)')
$old$;
  v_new := $new$
          AND p.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
          AND (
            p.status IN ('active', 'return_in_progress')
            OR (
              p.status IN ('draft', 'ready_for_pickup')
              AND tstzrange(p.jadwal_mulai, p.jadwal_kembali, '[)')
                  && tstzrange(p_start_at, p_end_at, '[)')
            )
          )
$new$;
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration guard mismatch: find_inventory_unit_candidates expected one candidate-conflict predicate, found %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);

  -- Direct capacity check must use the same operational occupancy rule as the
  -- unit-candidate query, otherwise a ready-but-still-assigned unit is counted
  -- as free stock for a new direct rental.
  v_definition := pg_get_functiondef(
    'app_private.validate_direct_rental_capacity(uuid,timestamp with time zone,timestamp with time zone,jsonb)'::regprocedure
  );
  v_old := $old$
          AND r.status NOT IN ('completed', 'cancelled')
          AND r.jadwal_mulai < p_jadwal_kembali
          AND r.jadwal_kembali > p_jadwal_mulai
$old$;
  v_new := $new$
          AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
          AND (
            r.status IN ('active', 'return_in_progress')
            OR (
              r.status IN ('draft', 'ready_for_pickup')
              AND r.jadwal_mulai < p_jadwal_kembali
              AND r.jadwal_kembali > p_jadwal_mulai
            )
          )
$new$;
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration guard mismatch: validate_direct_rental_capacity expected one assignment-conflict predicate, found %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);

  -- Manual assignment final guard: align with the candidate query. Active /
  -- return-in-progress assignments occupy the physical unit regardless of
  -- planned dates; prepared drafts conflict only when their periods overlap.
  v_definition := pg_get_functiondef(
    'app_private.command_assign_rental_unit_checked(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure
  );
  v_old := $old$
      AND r.penyewaan_id <> p_penyewaan_id
      AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
$old$;
  v_new := $new$
      AND r.penyewaan_id <> p_penyewaan_id
      AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
      AND (
        r.status IN ('active', 'return_in_progress')
        OR (
          r.status IN ('draft', 'ready_for_pickup')
          AND r.jadwal_mulai < v_rental.jadwal_kembali
          AND r.jadwal_kembali > v_rental.jadwal_mulai
        )
      )
$new$;
  v_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration guard mismatch: command_assign_rental_unit_checked expected one competing-rental predicate, found %', v_count;
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

CREATE OR REPLACE FUNCTION app_private.command_create_and_activate_direct_rental(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
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
  v_created jsonb;
  v_activated jsonb;
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  IF v_idempotency_key IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  -- Both commands execute inside this RPC transaction. Any capacity, assignment,
  -- handover, or state-transition failure rolls back the rental and all nested
  -- idempotency/audit/outbox writes.
  v_created := app_private.command_create_direct_rental(
    p_usaha_id,
    p_penyewa_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_lines,
    p_catatan,
    v_idempotency_key || ':create',
    p_request_id
  );

  v_activated := app_private.command_operational_activate_rental(
    p_usaha_id,
    (v_created->>'penyewaan_id')::uuid,
    p_catatan,
    v_idempotency_key || ':activate',
    p_request_id
  );

  RETURN v_created || v_activated;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_and_activate_direct_rental(
  uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_and_activate_direct_rental(
  uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_and_activate_direct_rental(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_and_activate_direct_rental(
    p_usaha_id,
    p_penyewa_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_lines,
    p_catatan,
    p_idempotency_key,
    p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_and_activate_direct_rental(
  uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_and_activate_direct_rental(
  uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_direct_rental_activation(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_create_response jsonb;
  v_activate_response jsonb;
  v_create_found boolean := false;
  v_activate_found boolean := false;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT ik.response_body
  INTO v_create_response
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'create_direct_rental'
    AND ik.key = v_key || ':create';
  v_create_found := FOUND;

  SELECT ik.response_body
  INTO v_activate_response
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'operational_activate_rental'
    AND ik.key = v_key || ':activate';
  v_activate_found := FOUND;

  IF NOT v_create_found AND NOT v_activate_found THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', NULL);
  END IF;

  IF v_create_response IS NOT NULL AND v_activate_response IS NOT NULL THEN
    RETURN jsonb_build_object(
      'state', 'committed',
      'response', v_create_response || v_activate_response
    );
  END IF;

  RETURN jsonb_build_object('state', 'unknown', 'response', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_reconcile_direct_rental_activation(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_direct_rental_activation(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_reconcile_direct_rental_activation(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_direct_rental_activation(p_usaha_id, p_idempotency_key);
$function$;

REVOKE ALL ON FUNCTION public.command_reconcile_direct_rental_activation(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_reconcile_direct_rental_activation(uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
