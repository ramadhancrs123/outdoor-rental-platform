-- Runtime fix for trusted rental command.
-- The function body uses make_interval while its SECURITY DEFINER search_path was empty.
-- Keeping pg_catalog available resolves the built-in function without changing business semantics.

ALTER FUNCTION app_private.command_create_direct_rental(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid
) SET search_path = pg_catalog;
