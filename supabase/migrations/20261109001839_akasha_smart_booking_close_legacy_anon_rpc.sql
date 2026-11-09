-- The old website RPC creates only legacy draft reservations and bypasses
-- the Smart Booking aggregate, memorable customer credential, and its abuse
-- controls. Keep it callable only by the trusted server-side command path.
-- The new public ingress is the JWT-protected Edge Function
-- "akasha-smart-booking"; its service-role command wraps this legacy function.
REVOKE ALL ON FUNCTION public.command_create_website_booking(text, jsonb, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.command_create_website_booking(text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.command_create_website_booking(text, jsonb, text) IS
  'Internal trusted legacy rental-draft command. Public website clients must use command_create_akasha_smart_booking through the akasha-smart-booking Edge Function.';
