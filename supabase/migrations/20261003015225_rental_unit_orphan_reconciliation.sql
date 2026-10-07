-- Hardens rental/unit history immutability and repairs the two verified orphaned rented units
-- discovered during production-readiness reconciliation on 2026-10-03.

CREATE OR REPLACE FUNCTION app_private.prevent_inventory_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION
    'HISTORY_IMMUTABLE: penetapan unit tidak boleh dihapus; gunakan lifecycle/command yang mempertahankan histori'
    USING ERRCODE = '23514';
END;
$function$;

DROP TRIGGER IF EXISTS trg_penetapan_unit_prevent_delete ON public.penetapan_unit;
CREATE TRIGGER trg_penetapan_unit_prevent_delete
BEFORE DELETE ON public.penetapan_unit
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_inventory_assignment_delete();


CREATE OR REPLACE FUNCTION app_private.prevent_rental_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION
    'HISTORY_IMMUTABLE: penyewaan tidak boleh dihapus; gunakan lifecycle/cancellation yang mempertahankan histori'
    USING ERRCODE = '23514';
END;
$function$;

DROP TRIGGER IF EXISTS trg_penyewaan_prevent_delete ON public.penyewaan;
CREATE TRIGGER trg_penyewaan_prevent_delete
BEFORE DELETE ON public.penyewaan
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_rental_delete();


DO $repair$
DECLARE
  v_unit public.unit_barang%ROWTYPE;
  v_last public.riwayat_unit%ROWTYPE;
  v_reconciled integer := 0;
  v_candidate_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_candidate_count
  FROM public.unit_barang ub
  WHERE ub.kode_unit IN ('Car-40L-001','CARR-E40-BLK-001')
    AND ub.status = 'rented'
    AND NOT EXISTS (
      SELECT 1
      FROM public.penetapan_unit pu
      WHERE pu.usaha_id = ub.usaha_id
        AND pu.unit_barang_id = ub.unit_barang_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.detail_pengembalian dr
      WHERE dr.usaha_id = ub.usaha_id
        AND dr.unit_barang_id = ub.unit_barang_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.pemeriksaan pi
      WHERE pi.usaha_id = ub.usaha_id
        AND pi.unit_barang_id = ub.unit_barang_id
        AND pi.hasil = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.perawatan pm
      WHERE pm.usaha_id = ub.usaha_id
        AND pm.unit_barang_id = ub.unit_barang_id
        AND pm.status IN ('planned','in_progress')
    )
    AND (
      SELECT ru.jenis_kejadian
      FROM public.riwayat_unit ru
      WHERE ru.usaha_id = ub.usaha_id
        AND ru.unit_barang_id = ub.unit_barang_id
      ORDER BY ru.terjadi_at DESC, ru.riwayat_unit_id DESC
      LIMIT 1
    ) = 'rental_pickup';

  IF v_candidate_count <> 2 THEN
    RAISE EXCEPTION
      'REPAIR_BLOCKED: verified orphan candidate count %, expected 2',
      v_candidate_count
      USING ERRCODE = '23514';
  END IF;

  FOR v_unit IN
    SELECT ub.*
    FROM public.unit_barang ub
    WHERE ub.kode_unit IN ('Car-40L-001','CARR-E40-BLK-001')
      AND ub.status = 'rented'
      AND NOT EXISTS (
        SELECT 1
        FROM public.penetapan_unit pu
        WHERE pu.usaha_id = ub.usaha_id
          AND pu.unit_barang_id = ub.unit_barang_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.detail_pengembalian dr
        WHERE dr.usaha_id = ub.usaha_id
          AND dr.unit_barang_id = ub.unit_barang_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.pemeriksaan pi
        WHERE pi.usaha_id = ub.usaha_id
          AND pi.unit_barang_id = ub.unit_barang_id
          AND pi.hasil = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.perawatan pm
        WHERE pm.usaha_id = ub.usaha_id
          AND pm.unit_barang_id = ub.unit_barang_id
          AND pm.status IN ('planned','in_progress')
      )
      AND (
        SELECT ru.jenis_kejadian
        FROM public.riwayat_unit ru
        WHERE ru.usaha_id = ub.usaha_id
          AND ru.unit_barang_id = ub.unit_barang_id
        ORDER BY ru.terjadi_at DESC, ru.riwayat_unit_id DESC
        LIMIT 1
      ) = 'rental_pickup'
    ORDER BY ub.kode_unit
    FOR UPDATE
  LOOP

    SELECT *
    INTO v_last
    FROM public.riwayat_unit
    WHERE usaha_id = v_unit.usaha_id
      AND unit_barang_id = v_unit.unit_barang_id
    ORDER BY terjadi_at DESC, riwayat_unit_id DESC
    LIMIT 1;

    IF v_unit.status <> 'rented'
       OR v_last.jenis_kejadian <> 'rental_pickup'
       OR v_last.status_sesudah <> 'rented'
       OR v_last.sumber_type <> 'penyewaan'
       OR v_last.sumber_id IS NULL
    THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: state unit % tidak sesuai pola orphan rented yang diverifikasi',
        v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.penyewaan p
      WHERE p.usaha_id = v_unit.usaha_id
        AND p.penyewaan_id = v_last.sumber_id
    ) THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: source rental % masih ada untuk unit %',
        v_last.sumber_id, v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.penetapan_unit pu
      WHERE pu.usaha_id = v_unit.usaha_id
        AND pu.unit_barang_id = v_unit.unit_barang_id
    ) THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: assignment masih ada untuk unit %',
        v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.detail_pengembalian dr
      WHERE dr.usaha_id = v_unit.usaha_id
        AND dr.unit_barang_id = v_unit.unit_barang_id
    ) THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: return history sudah ada untuk unit %',
        v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.pemeriksaan pi
      WHERE pi.usaha_id = v_unit.usaha_id
        AND pi.unit_barang_id = v_unit.unit_barang_id
        AND pi.hasil = 'pending'
    ) THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: inspection masih pending untuk unit %',
        v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.perawatan pm
      WHERE pm.usaha_id = v_unit.usaha_id
        AND pm.unit_barang_id = v_unit.unit_barang_id
        AND pm.status IN ('planned', 'in_progress')
    ) THEN
      RAISE EXCEPTION
        'REPAIR_BLOCKED: maintenance masih open untuk unit %',
        v_unit.kode_unit
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.unit_barang
    SET status = 'ready'
    WHERE usaha_id = v_unit.usaha_id
      AND unit_barang_id = v_unit.unit_barang_id;

    INSERT INTO public.riwayat_unit (
      usaha_id,
      unit_barang_id,
      jenis_kejadian,
      terjadi_at,
      status_sebelum,
      status_sesudah,
      lokasi_sebelum_id,
      lokasi_sesudah_id,
      sumber_type,
      sumber_id,
      actor_akun_admin_id,
      catatan,
      metadata
    )
    VALUES (
      v_unit.usaha_id,
      v_unit.unit_barang_id,
      'unit_orphan_reconciled_ready',
      now(),
      'rented',
      'ready',
      v_unit.lokasi_id,
      v_unit.lokasi_id,
      'inventory_reconciliation',
      v_unit.unit_barang_id,
      NULL,
      'Pemulihan orphaned rented unit setelah source rental hilang; tidak membuat return palsu.',
      jsonb_build_object(
        'source_rental_id', v_last.sumber_id,
        'repair_basis', 'last_history_rental_pickup_source_missing',
        'repair_migration', '20261003015148_rental_unit_orphan_reconciliation'
      )
    );

    INSERT INTO public.audit_log (
      usaha_id,
      actor_auth_user_id,
      actor_akun_admin_id,
      action,
      entity_type,
      entity_id,
      source_application,
      request_id,
      change_summary
    )
    VALUES (
      v_unit.usaha_id,
      NULL,
      NULL,
      'reconcile_orphaned_rental_unit',
      'unit_barang',
      v_unit.unit_barang_id,
      'migration-repair',
      gen_random_uuid(),
      jsonb_build_object(
        'status_before', 'rented',
        'status_after', 'ready',
        'source_rental_id', v_last.sumber_id,
        'reason', 'source rental deleted/absent while unit remained rented',
        'assignment_present', false,
        'return_history_present', false
      )
    );

    INSERT INTO public.outbox_event (
      usaha_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload
    )
    VALUES (
      v_unit.usaha_id,
      'inventory.unit_ready_reconciled',
      'unit_barang',
      v_unit.unit_barang_id,
      jsonb_build_object(
        'unit_barang_id', v_unit.unit_barang_id,
        'status_before', 'rented',
        'status_after', 'ready',
        'source_rental_id', v_last.sumber_id,
        'reason', 'orphaned_rental_reconciliation'
      )
    );

    v_reconciled := v_reconciled + 1;
  END LOOP;

  IF v_reconciled <> 2 THEN
    RAISE EXCEPTION 'REPAIR_BLOCKED: jumlah unit yang direkonsiliasi %, expected 2', v_reconciled
      USING ERRCODE = '23514';
  END IF;
END;
$repair$;
