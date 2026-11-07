-- Finding rows do not store unit_barang_id directly.
-- Resolve the physical unit through the parent inspection before publishing
-- damage.found; referencing NEW.unit_barang_id aborts the inspection transaction.

CREATE OR REPLACE FUNCTION public.emit_damage_found_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_dedupe_key text;
    v_payload jsonb;
    v_jenis_temuan text;
    v_unit_barang_id uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_jenis_temuan := NEW.jenis_temuan;

        IF v_jenis_temuan IN ('damage', 'loss', 'missing', 'breakage', 'wear_tear') THEN
            SELECT i.unit_barang_id
            INTO v_unit_barang_id
            FROM public.pemeriksaan i
            WHERE i.usaha_id = NEW.usaha_id
              AND i.pemeriksaan_id = NEW.pemeriksaan_id;

            IF v_unit_barang_id IS NULL THEN
                RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak ditemukan dari pemeriksaan temuan %', NEW.temuan_pemeriksaan_id
                    USING ERRCODE = '23514';
            END IF;

            v_dedupe_key := 'damage_found:' || NEW.temuan_pemeriksaan_id::text;
            v_payload := jsonb_build_object(
                'finding_id', NEW.temuan_pemeriksaan_id,
                'inspection_id', NEW.pemeriksaan_id,
                'unit_id', v_unit_barang_id,
                'jenis_temuan', v_jenis_temuan,
                'deskripsi', NEW.deskripsi,
                'tingkat', NEW.tingkat,
                'nominal_potensi_biaya', NEW.nominal_potensi_biaya,
                'currency_code', NEW.currency_code,
                'status_tindak_lanjut', NEW.status_tindak_lanjut,
                'dedupe_key', v_dedupe_key
            );

            INSERT INTO public.outbox_event (
                usaha_id, event_type, aggregate_type, aggregate_id, payload
            ) VALUES (
                NEW.usaha_id, 'damage.found', 'temuan_pemeriksaan', NEW.temuan_pemeriksaan_id, v_payload
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- Keep the existing insert hook explicit in the checked-in migration history.
DROP TRIGGER IF EXISTS trg_temuan_pemeriksaan_damage_event ON public.temuan_pemeriksaan;
CREATE TRIGGER trg_temuan_pemeriksaan_damage_event
AFTER INSERT ON public.temuan_pemeriksaan
FOR EACH ROW
EXECUTE FUNCTION public.emit_damage_found_event();
