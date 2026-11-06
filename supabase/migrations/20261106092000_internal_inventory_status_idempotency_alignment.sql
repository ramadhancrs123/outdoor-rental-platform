-- Align inventory-unit operational status idempotency writes with the canonical table.
-- Keep response_status/response_body only; idempotency_key has no completed_at column.
DO $migration$
DECLARE
  v_definition text;
  v_fixed text;
BEGIN
  v_definition := pg_get_functiondef(
    'app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamp with time zone,text,uuid)'::regprocedure
  );
  v_fixed := replace(
    v_definition,
    E'response_body = v_response,\n      completed_at = now()',
    'response_body = v_response'
  );
  IF v_fixed = v_definition THEN
    RAISE EXCEPTION 'Expected stale idempotency timestamp write was not found in command_set_inventory_unit_operational_status';
  END IF;
  EXECUTE v_fixed;
END
$migration$;
