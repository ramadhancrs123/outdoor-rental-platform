-- Scope operational RLS policies to the roles they were written for.
-- This preserves each policy's USING/WITH CHECK expressions while avoiding
-- accidental application of service-role policies to browser roles.
ALTER POLICY user_devices_admin_own ON public.user_devices TO authenticated;
ALTER POLICY user_devices_investor_own ON public.user_devices TO authenticated;
ALTER POLICY user_devices_super_admin_view ON public.user_devices TO authenticated;
ALTER POLICY user_devices_service_role ON public.user_devices TO service_role;

ALTER POLICY fcm_queue_admin_view ON public.fcm_notification_queue TO authenticated;
ALTER POLICY fcm_queue_service_role ON public.fcm_notification_queue TO service_role;

ALTER POLICY webhook_delivery_admin_view ON public.webhook_delivery_log TO authenticated;
ALTER POLICY webhook_delivery_service_role ON public.webhook_delivery_log TO service_role;

ALTER POLICY webhook_endpoint_admin_manage ON public.webhook_endpoint TO authenticated;
ALTER POLICY webhook_endpoint_service_role ON public.webhook_endpoint TO service_role;
