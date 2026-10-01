-- ADR-008 reconciliation:
-- new Inventory registrations start ready after admin pre-check;
-- Inspection returns to a return-only contract; experimental ADR-007 acquisition data/commands are removed.

DO $$
DECLARE
  v_acquisition_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(p.pemeriksaan_id), ARRAY[]::uuid[])
  INTO v_acquisition_ids
  FROM public.pemeriksaan p
  WHERE p.jenis_pemeriksaan = 'acquisition';

  IF cardinality(v_acquisition_ids) > 0 THEN
    DELETE FROM public.bukti_foto_kondisi WHERE pemeriksaan_id = ANY(v_acquisition_ids);
    DELETE FROM public.temuan_pemeriksaan WHERE pemeriksaan_id = ANY(v_acquisition_ids);

    UPDATE public.riwayat_unit
    SET jenis_kejadian = 'unit_registered_ready',
        sumber_type = 'inventory',
        sumber_id = unit_barang_id,
        catatan = 'ADR-008 reconciliation: experimental acquisition inspection removed; readiness belongs to registration confirmation.',
        metadata = jsonb_build_object('reconciled_from','acquisition_inspection','adr','ADR-008','reason','registration_is_admin_readiness_acknowledgement')
    WHERE sumber_id = ANY(v_acquisition_ids)
      AND jenis_kejadian = 'unit_marked_ready';

    DELETE FROM public.pemeriksaan WHERE pemeriksaan_id = ANY(v_acquisition_ids);
  END IF;
END $$;

DELETE FROM public.audit_log
WHERE action IN ('start_acquisition_inspection','complete_acquisition_inspection');

DELETE FROM public.outbox_event
WHERE event_type IN ('inspection.acquisition.started','inspection.acquisition.completed','inspection.acquisition.maintenance_required');

DELETE FROM public.idempotency_key
WHERE command_name IN ('start_acquisition_inspection','complete_acquisition_inspection');

CREATE OR REPLACE FUNCTION app_private.validate_inspection_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  IF NEW.detail_pengembalian_id IS NULL THEN
    RAISE EXCEPTION 'Return inspection requires a return detail' USING ERRCODE='23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.detail_pengembalian dr
    WHERE dr.usaha_id = NEW.usaha_id
      AND dr.detail_pengembalian_id = NEW.detail_pengembalian_id
      AND dr.unit_barang_id = NEW.unit_barang_id
  ) THEN
    RAISE EXCEPTION 'Inspection unit must match the returned unit';
  END IF;

  RETURN NEW;
END;
$function$;

DROP INDEX IF EXISTS public.pemeriksaan_one_pending_acquisition_unit_idx;
DROP INDEX IF EXISTS public.pemeriksaan_usaha_kind_unit_idx;
DROP INDEX IF EXISTS public.pemeriksaan_usaha_kind_detail_idx;

ALTER TABLE public.pemeriksaan
  DROP CONSTRAINT IF EXISTS pemeriksaan_kind_allowed_chk,
  DROP CONSTRAINT IF EXISTS pemeriksaan_kind_detail_consistency_chk;

ALTER TABLE public.pemeriksaan
  ALTER COLUMN detail_pengembalian_id SET NOT NULL;

DROP FUNCTION IF EXISTS public.command_start_acquisition_inspection(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.command_complete_acquisition_inspection(uuid, uuid, text, text, text, text, jsonb, text, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS app_private.command_start_acquisition_inspection(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS app_private.command_complete_acquisition_inspection(uuid, uuid, text, text, text, text, jsonb, text, uuid, timestamptz, timestamptz);

ALTER TABLE public.pemeriksaan
  DROP COLUMN IF EXISTS jenis_pemeriksaan;
