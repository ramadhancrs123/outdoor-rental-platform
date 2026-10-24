-- Wave 1 ACL correction.
-- Public wrappers are SECURITY INVOKER, matching the project's trusted-command
-- boundary. Their app_private implementations therefore require EXECUTE for
-- authenticated callers; SECURITY DEFINER still owns the authorization logic.

GRANT EXECUTE ON FUNCTION app_private.get_investor_overview(uuid,date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_period_result(uuid,date,date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_participation_history(uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_activity(uuid,date,date,integer,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.investor_reconciliation(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION app_private.command_create_investor(uuid,uuid,text,text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_investor_status(uuid,uuid,text,text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_investor_participation(uuid,uuid,numeric,smallint,smallint,date,text,uuid)
  TO authenticated;
