BEGIN;
ALTER TABLE public.hiking_route_imports
  ADD COLUMN IF NOT EXISTS source_reference_url text;
ALTER TABLE public.hiking_route_imports
  DROP CONSTRAINT IF EXISTS hiking_route_import_source_reference_https;
ALTER TABLE public.hiking_route_imports
  ADD CONSTRAINT hiking_route_import_source_reference_https
  CHECK (source_reference_url IS NULL OR source_reference_url ~* '^https://');
COMMENT ON COLUMN public.hiking_route_imports.source_reference_url IS
  'Specific source/asset URL reviewed for this GPX import; distinct from the general data-source catalog URL.';
COMMIT;