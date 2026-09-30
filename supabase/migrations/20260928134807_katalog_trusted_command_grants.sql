-- Katalog trusted command privilege boundary.
-- Domain commands are callable by authenticated clients; internal helpers remain server-only.

REVOKE ALL ON FUNCTION app_private.command_add_barang_media(uuid, uuid, text, text, text, integer, boolean, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_add_barang_media(uuid, uuid, text, text, text, integer, boolean, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_add_barang_media(uuid, uuid, text, text, text, integer, boolean, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_barang_media(uuid, uuid, text, text, text, integer, boolean, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_add_komponen_paket(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_add_komponen_paket(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_add_komponen_paket(uuid, uuid, uuid, uuid, numeric, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_komponen_paket(uuid, uuid, uuid, uuid, numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_barang(uuid, uuid, text, text, text, text, text, boolean, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_barang(uuid, uuid, text, text, text, text, text, boolean, jsonb, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_barang(uuid, uuid, text, text, text, text, text, boolean, jsonb, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_barang(uuid, uuid, text, text, text, text, text, boolean, jsonb, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_kategori_barang(uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_kategori_barang(uuid, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_kategori_barang(uuid, text, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_kategori_barang(uuid, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_paket_sewa(uuid, text, text, text, numeric, text, text, boolean, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_paket_sewa(uuid, text, text, text, numeric, text, text, boolean, jsonb, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_paket_sewa(uuid, text, text, text, numeric, text, text, boolean, jsonb, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_paket_sewa(uuid, text, text, text, numeric, text, text, boolean, jsonb, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_tarif_sewa(uuid, uuid, uuid, uuid, text, text, integer, numeric, text, timestamp with time zone, timestamp with time zone, text, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_tarif_sewa(uuid, uuid, uuid, uuid, text, text, integer, numeric, text, timestamp with time zone, timestamp with time zone, text, jsonb, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_tarif_sewa(uuid, uuid, uuid, uuid, text, text, integer, numeric, text, timestamp with time zone, timestamp with time zone, text, jsonb, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_tarif_sewa(uuid, uuid, uuid, uuid, text, text, integer, numeric, text, timestamp with time zone, timestamp with time zone, text, jsonb, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_varian_barang(uuid, uuid, text, text, text, jsonb, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_varian_barang(uuid, uuid, text, text, text, jsonb, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_varian_barang(uuid, uuid, text, text, text, jsonb, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_varian_barang(uuid, uuid, text, text, text, jsonb, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_catalog_mutation(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_catalog_mutation(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_catalog_mutation(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_catalog_mutation(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_remove_barang_media(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_remove_barang_media(uuid, uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_remove_barang_media(uuid, uuid, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_remove_barang_media(uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_remove_komponen_paket(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_remove_komponen_paket(uuid, uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_remove_komponen_paket(uuid, uuid, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_remove_komponen_paket(uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reorder_barang_media(uuid, uuid, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reorder_barang_media(uuid, uuid, jsonb, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reorder_barang_media(uuid, uuid, jsonb, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reorder_barang_media(uuid, uuid, jsonb, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_barang_media_cover(uuid, uuid, boolean, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_barang_media_cover(uuid, uuid, boolean, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_barang_media_cover(uuid, uuid, boolean, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_barang_media_cover(uuid, uuid, boolean, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_barang_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_barang_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_barang_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_barang_status(uuid, uuid, text, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_barang_visibility(uuid, uuid, boolean, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_barang_visibility(uuid, uuid, boolean, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_barang_visibility(uuid, uuid, boolean, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_barang_visibility(uuid, uuid, boolean, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_paket_state(uuid, uuid, text, boolean, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_paket_state(uuid, uuid, text, boolean, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_paket_state(uuid, uuid, text, boolean, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_paket_state(uuid, uuid, text, boolean, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_tarif_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_tarif_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_tarif_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_tarif_status(uuid, uuid, text, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_varian_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_varian_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_varian_status(uuid, uuid, text, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_varian_status(uuid, uuid, text, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_update_barang(uuid, uuid, uuid, text, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_barang(uuid, uuid, uuid, text, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_barang(uuid, uuid, uuid, text, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_barang(uuid, uuid, uuid, text, text, text, text, jsonb, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_update_kategori_barang(uuid, uuid, text, text, text, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_kategori_barang(uuid, uuid, text, text, text, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_kategori_barang(uuid, uuid, text, text, text, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_kategori_barang(uuid, uuid, text, text, text, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_update_paket_sewa(uuid, uuid, text, text, text, numeric, text, jsonb, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_paket_sewa(uuid, uuid, text, text, text, numeric, text, jsonb, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_paket_sewa(uuid, uuid, text, text, text, numeric, text, jsonb, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_paket_sewa(uuid, uuid, text, text, text, numeric, text, jsonb, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_update_tarif_sewa(uuid, uuid, text, text, integer, numeric, timestamp with time zone, timestamp with time zone, jsonb, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_tarif_sewa(uuid, uuid, text, text, integer, numeric, timestamp with time zone, timestamp with time zone, jsonb, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_tarif_sewa(uuid, uuid, text, text, integer, numeric, timestamp with time zone, timestamp with time zone, jsonb, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_tarif_sewa(uuid, uuid, text, text, integer, numeric, timestamp with time zone, timestamp with time zone, jsonb, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_update_varian_barang(uuid, uuid, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_varian_barang(uuid, uuid, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_varian_barang(uuid, uuid, text, text, text, jsonb, timestamp with time zone, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_varian_barang(uuid, uuid, text, text, text, jsonb, timestamp with time zone, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.catalog_require_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.catalog_require_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.catalog_require_admin(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION app_private.catalog_require_admin(uuid) FROM service_role;

REVOKE ALL ON FUNCTION app_private.catalog_idempotency_claim(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_claim(uuid,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_claim(uuid,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_claim(uuid,text,text,text) FROM service_role;

REVOKE ALL ON FUNCTION app_private.catalog_idempotency_finish(uuid,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_finish(uuid,integer,jsonb) FROM anon;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_finish(uuid,integer,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION app_private.catalog_idempotency_finish(uuid,integer,jsonb) FROM service_role;
