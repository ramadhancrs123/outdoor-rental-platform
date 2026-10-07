DO $do$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'command_create_direct_rental'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_usaha_id uuid, p_penyewa_id uuid, p_jadwal_mulai timestamp with time zone, p_jadwal_kembali timestamp with time zone, p_lines jsonb, p_catatan text, p_idempotency_key text, p_request_id uuid';

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: app_private.command_create_direct_rental signature not found';
  END IF;

  v_sql := replace(
    v_sql,
    '  v_barang_id uuid;
  v_varian_id uuid;',
    '  v_barang_id uuid;
  v_parent_barang_id uuid;
  v_varian_id uuid;'
  );

  v_sql := replace(
    v_sql,
    '    v_barang_id := nullif(v_line->>''barang_id'', '''')::uuid;
    v_varian_id := nullif(v_line->>''varian_barang_id'', '''')::uuid;',
    '    v_barang_id := nullif(v_line->>''barang_id'', '''')::uuid;
    v_parent_barang_id := null;
    v_varian_id := nullif(v_line->>''varian_barang_id'', '''')::uuid;'
  );

  v_sql := replace(
    v_sql,
    '    IF v_qty <= 0 OR v_unit_price < 0 OR v_subtotal < 0 THEN',
    '    IF v_varian_id IS NOT NULL THEN
      SELECT vb.barang_id
      INTO v_parent_barang_id
      FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id
        AND vb.varian_barang_id = v_varian_id
        AND vb.status = ''active'';

      IF NOT FOUND THEN
        RAISE EXCEPTION ''NOT_FOUND: varian tidak ditemukan atau tidak aktif dalam usaha ini'' USING ERRCODE = ''P0002'';
      END IF;
    END IF;

    IF v_qty <= 0 OR v_unit_price < 0 OR v_subtotal < 0 THEN'
  );

  v_sql := replace(
    v_sql,
    '          v_paket_id IS NULL
          AND v_barang_id IS NOT NULL
          AND (
            (v_varian_id IS NOT NULL AND (
              t.varian_barang_id = v_varian_id
              OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
            ))
            OR (v_varian_id IS NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
          )',
    '          v_paket_id IS NULL
          AND (
            (v_varian_id IS NOT NULL AND (
              t.varian_barang_id = v_varian_id
              OR (t.varian_barang_id IS NULL AND t.barang_id = v_parent_barang_id)
            ))
            OR (v_varian_id IS NULL AND v_barang_id IS NOT NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
          )'
  );

  EXECUTE v_sql;
END
$do$;