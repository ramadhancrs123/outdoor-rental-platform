-- Fix nested authorization execution privilege for Investor operational account summary.
-- The public wrapper calls this SECURITY DEFINER assertion helper.
GRANT EXECUTE ON FUNCTION app_private.assert_investor_read_access(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION app_private.assert_investor_read_access(uuid) FROM anon;
