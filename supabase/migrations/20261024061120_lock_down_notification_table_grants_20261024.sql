-- Explicit table grants for notification infrastructure. RLS policies remain the row-level boundary.
-- Remove broad default/client grants first, including TRUNCATE/TRIGGER/REFERENCES.
REVOKE ALL PRIVILEGES ON TABLE public.webhook_endpoint FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.webhook_delivery_log FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.outbox_event FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.fcm_notification_queue FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.user_devices FROM anon;

-- Endpoint management remains available to signed-in super-admins, constrained by existing RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_endpoint TO authenticated;

-- Delivery logs and FCM queue are readable by authorized admins only; all writes stay internal.
GRANT SELECT ON TABLE public.webhook_delivery_log TO authenticated;
GRANT SELECT ON TABLE public.fcm_notification_queue TO authenticated;

-- Device registration/rotation remains available to signed-in owners under the existing RLS policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO authenticated;

-- The outbox is strictly internal; business events flow through SECURITY DEFINER triggers/functions.
REVOKE ALL PRIVILEGES ON TABLE public.outbox_event FROM anon, authenticated;

-- Ensure the internal service role retains the permissions required by workers and trusted RPCs.
GRANT ALL PRIVILEGES ON TABLE public.webhook_endpoint TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.webhook_delivery_log TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.outbox_event TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.fcm_notification_queue TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.user_devices TO service_role;
