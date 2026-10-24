REVOKE ALL PRIVILEGES ON TABLE public.user_devices FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO authenticated;
