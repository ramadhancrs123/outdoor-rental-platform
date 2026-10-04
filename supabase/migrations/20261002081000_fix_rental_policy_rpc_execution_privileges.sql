-- Fix trusted rental-policy RPC execution boundary.
-- The public PostgREST wrappers are SECURITY INVOKER, so the authenticated
-- role must be allowed to execute the app_private command they delegate to.
-- Authorization and tenant checks remain owned by the SECURITY DEFINER command.

REVOKE ALL ON FUNCTION app_private.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid)
  TO authenticated;
