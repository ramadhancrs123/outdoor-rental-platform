-- Preserve immutable purchase lines; receiving metadata lives in the receiving ledger.

CREATE OR REPLACE FUNCTION app_private.receive_completed_purchase(
  p_usaha_id uuid,
  p_pembelian_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.procurement_require_admin(p_usaha_id);
  v_purchase public.pembelian%ROWTYPE;
  v_receipt public.penerimaan_pembelian%ROWTYPE;
  v_line record;
  v_product public.barang%ROWTYPE;
  v_variant public.varian_barang%ROWTYPE;
  v_mode text;
  v_received_id uuid;
  v_existing_units integer;
  v_registered_units integer;
  v_remaining_units integer;
  v_batch_size integer;
  v_batch_index integer;
  v_old_quantity integer;
  v_old_average numeric(14,2);
  v_new_average numeric(14,2);
  v_old_hpp numeric(14,2);
  v_total_received numeric(14,2) := 0;
  v_line_count integer := 0;
  v_response jsonb;
  v_key text;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: request_id receiving wajib diisi' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  SELECT * INTO v_purchase
  FROM public.pembelian
  WHERE usaha_id=p_usaha_id AND pembelian_id=p_pembelian_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pembelian tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF v_purchase.status <> 'completed' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: penerimaan otomatis hanya berjalan setelah pembelian diselesaikan' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_receipt
  FROM public.penerimaan_pembelian
  WHERE usaha_id=p_usaha_id AND pembelian_id=p_pembelian_id;
  IF FOUND THEN
    SELECT jsonb_build_object(
      'penerimaan_pembelian_id',v_receipt.penerimaan_pembelian_id,
      'nomor_penerimaan',v_receipt.nomor_penerimaan,
      'pembelian_id',p_pembelian_id,
      'state','already_received'
    ) INTO v_response;
    RETURN v_response;
  END IF;

  INSERT INTO public.penerimaan_pembelian(
    usaha_id,pembelian_id,nomor_penerimaan,status,received_by_admin_id,request_id,metadata
  ) VALUES (
    p_usaha_id,p_pembelian_id,
    'RCV-'||to_char(v_purchase.tanggal_pembelian,'YYYY')||'-'||
      lpad(app_private.next_business_number(p_usaha_id,'RCV',to_char(v_purchase.tanggal_pembelian,'YYYY'))::text,4,'0'),
    'completed',v_admin_id,p_request_id,
    jsonb_build_object('source','purchase_completion','atomic_with_finance_cashout',true)
  )
  RETURNING * INTO v_receipt;

  FOR v_line IN
    SELECT d.detail_pembelian_id,d.barang_id,d.varian_barang_id,d.jumlah,d.unit_price
    FROM public.detail_pembelian d
    WHERE d.usaha_id=p_usaha_id AND d.pembelian_id=p_pembelian_id
    ORDER BY d.created_at,d.detail_pembelian_id
    FOR UPDATE
  LOOP
    IF v_line.varian_barang_id IS NOT NULL THEN
      SELECT b.* INTO v_product
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_line.varian_barang_id
        AND v.status='active' AND b.status='active'
      FOR UPDATE OF b;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: produk induk varian tidak aktif saat penerimaan' USING ERRCODE='P0002';
      END IF;
      SELECT * INTO v_variant
      FROM public.varian_barang
      WHERE usaha_id=p_usaha_id AND varian_barang_id=v_line.varian_barang_id
      FOR UPDATE;
      v_mode := coalesce(v_variant.inventory_mode,v_product.inventory_mode);
      v_old_hpp := coalesce(v_variant.harga_beli,v_product.harga_beli);
    ELSE
      SELECT * INTO v_product
      FROM public.barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_line.barang_id AND status='active'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: produk tidak aktif saat penerimaan' USING ERRCODE='P0002';
      END IF;
      v_mode := v_product.inventory_mode;
      v_old_hpp := v_product.harga_beli;
    END IF;

    IF v_mode NOT IN ('serialized','quantity','untracked') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid saat receiving' USING ERRCODE='22023';
    END IF;
    IF v_mode IN ('serialized','quantity') AND v_line.jumlah <> trunc(v_line.jumlah) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah pembelian untuk stok terkelola harus bilangan bulat pada line %',v_line.detail_pembelian_id
        USING ERRCODE='22023';
    END IF;

    INSERT INTO public.detail_penerimaan_pembelian(
      usaha_id,penerimaan_pembelian_id,detail_pembelian_id,barang_id,varian_barang_id,
      inventory_mode,quantity_received,unit_cost,subtotal_cost
    ) VALUES (
      p_usaha_id,v_receipt.penerimaan_pembelian_id,v_line.detail_pembelian_id,
      v_product.barang_id,v_line.varian_barang_id,v_mode,v_line.jumlah,
      v_line.unit_price,round(v_line.jumlah*v_line.unit_price,2)
    ) RETURNING detail_penerimaan_pembelian_id INTO v_received_id;

    IF v_mode='serialized' THEN
      SELECT count(*)::integer INTO v_existing_units
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id
        AND u.status <> 'sold'
        AND (
          (v_line.varian_barang_id IS NOT NULL AND u.varian_barang_id=v_line.varian_barang_id)
          OR (v_line.varian_barang_id IS NULL AND u.barang_id=v_product.barang_id AND u.varian_barang_id IS NULL)
        );

      SELECT count(*)::integer INTO v_registered_units
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id AND u.sumber_pembelian_detail_id=v_line.detail_pembelian_id;

      v_remaining_units := greatest(0, floor(v_line.jumlah)::integer-v_registered_units);
      v_batch_index := 0;
      WHILE v_remaining_units > 0 LOOP
        v_batch_size := least(v_remaining_units,250);
        v_batch_index := v_batch_index+1;
        v_key := left('auto-receive:'||p_pembelian_id::text||':'||v_line.detail_pembelian_id::text||':'||v_batch_index::text,200);
        PERFORM app_private.command_register_inventory_units(
          p_usaha_id,v_product.barang_id,v_line.varian_barang_id,v_batch_size,
          NULL,v_purchase.tanggal_pembelian,v_line.detail_pembelian_id,
          'Diterima otomatis dari pembelian '||v_purchase.nomor_pembelian,
          v_key,p_request_id
        );
        v_remaining_units := v_remaining_units-v_batch_size;
      END LOOP;

      v_new_average := CASE
        WHEN v_existing_units=0 THEN v_line.unit_price
        WHEN v_old_hpp IS NULL THEN NULL
        ELSE round(((v_existing_units*v_old_hpp)+(v_line.jumlah*v_line.unit_price)) /
          nullif(v_existing_units+v_line.jumlah,0),2)
      END;
      UPDATE public.unit_barang
      SET harga_perolehan=coalesce(harga_perolehan,v_line.unit_price),updated_at=now()
      WHERE usaha_id=p_usaha_id AND sumber_pembelian_detail_id=v_line.detail_pembelian_id;

    ELSIF v_mode='quantity' THEN
      INSERT INTO public.stok_barang(usaha_id,barang_id,varian_barang_id,jumlah,average_unit_cost)
      SELECT p_usaha_id,v_product.barang_id,v_line.varian_barang_id,0,NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM public.stok_barang s
        WHERE s.usaha_id=p_usaha_id AND s.barang_id=v_product.barang_id
          AND s.varian_barang_id IS NOT DISTINCT FROM v_line.varian_barang_id
      );

      SELECT s.jumlah,s.average_unit_cost INTO v_old_quantity,v_old_average
      FROM public.stok_barang s
      WHERE s.usaha_id=p_usaha_id AND s.barang_id=v_product.barang_id
        AND s.varian_barang_id IS NOT DISTINCT FROM v_line.varian_barang_id
      FOR UPDATE;

      v_old_average := coalesce(v_old_average,v_old_hpp);
      v_new_average := CASE
        WHEN v_old_quantity=0 THEN v_line.unit_price
        WHEN v_old_average IS NULL THEN NULL
        ELSE round(((v_old_quantity*v_old_average)+(v_line.jumlah*v_line.unit_price)) /
          nullif(v_old_quantity+v_line.jumlah,0),2)
      END;

      UPDATE public.stok_barang
      SET jumlah=jumlah+v_line.jumlah::integer,
          average_unit_cost=v_new_average,updated_at=now()
      WHERE usaha_id=p_usaha_id AND barang_id=v_product.barang_id
        AND varian_barang_id IS NOT DISTINCT FROM v_line.varian_barang_id;

      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      )
      SELECT p_usaha_id,s.stok_barang_id,v_product.barang_id,v_line.varian_barang_id,
        'purchase_receipt',v_line.jumlah::integer,'purchase_receipt',v_received_id,
        v_admin_id,p_request_id,'Penerimaan pembelian '||v_purchase.nomor_pembelian,
        jsonb_build_object('pembelian_id',p_pembelian_id,'detail_pembelian_id',v_line.detail_pembelian_id,
          'unit_cost',v_line.unit_price,'average_unit_cost',v_new_average)
      FROM public.stok_barang s
      WHERE s.usaha_id=p_usaha_id AND s.barang_id=v_product.barang_id
        AND s.varian_barang_id IS NOT DISTINCT FROM v_line.varian_barang_id;

    ELSE
      -- Untracked sale items (for example LPG refill) deliberately do not mutate stock.
      -- The most recent acquisition cost is their HPP reference because there is no stock balance.
      v_new_average := v_line.unit_price;
    END IF;

    IF v_line.varian_barang_id IS NOT NULL THEN
      UPDATE public.varian_barang
      SET harga_beli=v_new_average,updated_at=now()
      WHERE usaha_id=p_usaha_id AND varian_barang_id=v_line.varian_barang_id;
    ELSE
      UPDATE public.barang
      SET harga_beli=v_new_average,updated_at=now()
      WHERE usaha_id=p_usaha_id AND barang_id=v_product.barang_id;
    END IF;

    v_total_received := v_total_received+v_line.jumlah;
    v_line_count := v_line_count+1;
  END LOOP;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,auth.uid(),v_admin_id,'receive_purchase','penerimaan_pembelian',
    v_receipt.penerimaan_pembelian_id,'admin-command',p_request_id,
    jsonb_build_object('pembelian_id',p_pembelian_id,'nomor_pembelian',v_purchase.nomor_pembelian,
      'line_count',v_line_count,'quantity_received',v_total_received,'automatic',true)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES (
    p_usaha_id,'purchase.received','pembelian',p_pembelian_id,
    jsonb_build_object('pembelian_id',p_pembelian_id,'penerimaan_pembelian_id',v_receipt.penerimaan_pembelian_id,
      'nomor_penerimaan',v_receipt.nomor_penerimaan,'line_count',v_line_count,'quantity_received',v_total_received)
  );

  RETURN jsonb_build_object(
    'penerimaan_pembelian_id',v_receipt.penerimaan_pembelian_id,
    'nomor_penerimaan',v_receipt.nomor_penerimaan,'pembelian_id',p_pembelian_id,
    'state','received','line_count',v_line_count,'quantity_received',v_total_received
  );
END;
$function$;


-- Receiving is a separate immutable ledger; completed purchase detail rows remain immutable.
ALTER TABLE public.detail_pembelian
  DROP COLUMN IF EXISTS inventory_mode_snapshot,
  DROP COLUMN IF EXISTS received_quantity;

CREATE OR REPLACE FUNCTION app_private.get_purchase_receiving_progress(
  p_usaha_id uuid,
  p_pembelian_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.procurement_require_admin(p_usaha_id);
  v_rows jsonb;
BEGIN
  IF p_pembelian_ids IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: daftar pembelian wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pembelian_id',h.pembelian_id,
    'detail_pembelian_id',d.detail_pembelian_id,
    'inventory_mode',d.inventory_mode,
    'quantity_received',d.quantity_received
  ) ORDER BY h.pembelian_id,d.created_at,d.detail_penerimaan_pembelian_id),'[]'::jsonb)
  INTO v_rows
  FROM public.penerimaan_pembelian h
  JOIN public.detail_penerimaan_pembelian d
    ON d.usaha_id=h.usaha_id AND d.penerimaan_pembelian_id=h.penerimaan_pembelian_id
  WHERE h.usaha_id=p_usaha_id
    AND h.pembelian_id=ANY(p_pembelian_ids)
    AND h.status='completed';

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_purchase_receiving_progress(
  p_usaha_id uuid,
  p_pembelian_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_purchase_receiving_progress($1,$2);
$function$;

REVOKE ALL ON FUNCTION app_private.get_purchase_receiving_progress(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_purchase_receiving_progress(uuid,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.get_purchase_receiving_progress(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_receiving_progress(uuid,uuid[]) TO authenticated;


-- Expose the current 10-argument sale command contract used by the POS UI.
-- Keep the legacy 9-argument wrapper available for older clients.
CREATE OR REPLACE FUNCTION public.command_create_sale(
  p_usaha_id uuid,
  p_source text,
  p_nama_pelanggan text,
  p_nomor_telepon text,
  p_catatan text,
  p_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$function$;

REVOKE ALL ON FUNCTION public.command_create_sale(uuid,text,text,text,text,jsonb,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_create_sale(uuid,text,text,text,text,jsonb,uuid,text,text,uuid) TO authenticated;
