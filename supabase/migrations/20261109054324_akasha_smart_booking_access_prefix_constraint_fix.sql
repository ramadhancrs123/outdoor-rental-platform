-- Preserve the existing lowercase access-code-prefix database constraint while
-- keeping new customer access-code entropy independent of personal data.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$v_prefix := 'AK';$old$;
  v_new text := $new$v_prefix := 'customer';$new$;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.command_create_akasha_smart_booking(text,jsonb,text)'::regprocedure
  ) INTO v_definition;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking access prefix anchor changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;
