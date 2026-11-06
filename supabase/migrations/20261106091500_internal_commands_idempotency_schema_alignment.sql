-- Keep internal trusted commands aligned with the live idempotency_key schema.
-- The canonical table stores response_status/response_body and has no completed_at.
-- Preserve the existing function bodies, security attributes and grants; only remove
-- the obsolete completed_at assignment from the two affected internal commands.

DO $migration$
DECLARE
  v_definition text;
  v_fixed text;
BEGIN
  v_definition := pg_get_functiondef(
    'app_private.command_create_mixed_checkout(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,uuid,text,numeric,timestamp with time zone,text,text,uuid)'::regprocedure
  );
  v_fixed := replace(
    v_definition,
    'response_status=200,response_body=v_response,completed_at=now()',
    'response_status=200,response_body=v_response'
  );
  IF v_fixed = v_definition THEN
    RAISE EXCEPTION 'Expected stale idempotency timestamp write was not found in command_create_mixed_checkout';
  END IF;
  EXECUTE v_fixed;

  v_definition := pg_get_functiondef(
    'app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamp with time zone,text,uuid)'::regprocedure
  );
  v_fixed := regexp_replace(
    v_definition,
    'response_body[[:space:]]*=[[:space:]]*v_response[[:space:]]*,[[:space:]]*completed_at[[:space:]]*=[[:space:]]*now[(][)]',
    'response_body = v_response'
  );
  IF v_fixed = v_definition THEN
    RAISE EXCEPTION 'Expected stale idempotency timestamp write was not found in command_set_inventory_unit_operational_status';
  END IF;
  EXECUTE v_fixed;
END
$migration$;
