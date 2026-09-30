-- Public PostgREST RPC boundary for frontend trusted commands/queries.
-- Existing public wrappers are preserved; only app_private functions that the
-- browser explicitly calls are exposed through invoker wrappers.
-- app_private helper functions remain internal.

DO $do$
DECLARE
  f record;
  v_arg_defs text;
  v_arg_types text;
  v_arg_names text;
  v_stmt text;
  v_wrapper_names constant text[] := ARRAY[
    'command_add_barang_media',
    'command_add_komponen_paket',
    'command_create_barang',
    'command_create_kategori_barang',
    'command_create_paket_sewa',
    'command_create_tarif_sewa',
    'command_create_varian_barang',
    'command_reconcile_catalog_mutation',
    'command_remove_barang_media',
    'command_remove_komponen_paket',
    'command_reorder_barang_media',
    'command_set_barang_media_cover',
    'command_set_barang_status',
    'command_set_barang_visibility',
    'command_set_paket_state',
    'command_set_tarif_status',
    'command_set_varian_status',
    'command_update_barang',
    'command_update_kategori_barang',
    'command_update_paket_sewa',
    'command_update_tarif_sewa',
    'command_update_varian_barang',
    'command_mark_inventory_unit_inspection_pending',
    'command_mark_inventory_unit_ready',
    'command_move_inventory_unit',
    'command_reconcile_inventory_unit_mutation',
    'command_register_inventory_unit',
    'command_attach_inspection_evidence',
    'command_complete_inspection',
    'command_reconcile_inspection_mutation',
    'command_start_inspection',
    'command_process_unit_return',
    'command_reconcile_return_mutation',
    'command_assign_rental_unit_checked',
    'command_complete_rental_handover',
    'command_create_direct_rental',
    'command_create_rental_from_reservation',
    'command_reconcile_direct_rental_creation',
    'command_reconcile_rental_assignment',
    'command_reconcile_rental_creation',
    'command_reconcile_rental_handover',
    'command_add_renter_identity_evidence',
    'command_add_renter_photo',
    'command_create_renter',
    'command_reconcile_renter_creation',
    'command_reconcile_renter_mutation',
    'command_update_renter_profile',
    'command_verify_renter_identity_evidence',
    'command_complete_maintenance',
    'command_create_maintenance',
    'command_reconcile_maintenance_mutation',
    'command_start_maintenance',
    'command_verify_maintenance_readiness',
    'find_inventory_unit_candidates'
  ];
BEGIN
  FOR f IN
    SELECT
      p.oid,
      p.proname,
      p.proargnames,
      p.pronargs,
      pg_get_function_arguments(p.oid) AS arg_defs,
      pg_get_function_identity_arguments(p.oid) AS arg_types,
      pg_get_function_result(p.oid) AS result_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.prokind = 'f'
      AND p.proname = ANY(v_wrapper_names)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc existing
      JOIN pg_namespace existing_ns ON existing_ns.oid = existing.pronamespace
      WHERE existing_ns.nspname = 'public'
        AND existing.proname = f.proname
        AND pg_get_function_identity_arguments(existing.oid) = f.arg_types
    ) THEN
      CONTINUE;
    END IF;

    IF f.pronargs = 0 THEN
      v_arg_names := '';
    ELSE
      SELECT string_agg(format('$%s', gs), ', ')
      INTO v_arg_names
      FROM generate_series(1, f.pronargs) gs;
    END IF;

    v_arg_defs := f.arg_defs;
    v_arg_types := f.arg_types;

    v_stmt := format(
      'CREATE FUNCTION public.%I(%s)
       RETURNS %s
       LANGUAGE sql
       SECURITY INVOKER
       SET search_path TO ''''
       AS $fn$
         SELECT * FROM app_private.%I(%s);
       $fn$;',
      f.proname,
      v_arg_defs,
      f.result_def,
      f.proname,
      v_arg_names
    );

    EXECUTE v_stmt;

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role;',
      f.proname,
      v_arg_types
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated;',
      f.proname,
      v_arg_types
    );
  END LOOP;
END
$do$;