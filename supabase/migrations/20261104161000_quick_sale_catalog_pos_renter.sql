-- Quick Item now handles sale-only products, and POS can preserve an optional tenant-scoped renter relation.
-- Existing rental Quick Item command and rental transaction commands are unchanged.

CREATE OR REPLACE FUNCTION app_private.command_quick_sale_item_onboarding(
  p_usaha_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_auth_user_id uuid := auth.uid();
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
  v_category_id uuid;
  v_category_name text;
  v_category_created boolean := false;
  v_product_id uuid;
  v_product_name text;
  v_description text;
  v_slug_base text;
  v_slug text;
  v_slug_suffix integer := 1;
  v_mode text;
  v_variant_mode boolean := false;
  v_variants jsonb := '[]'::jsonb;
  v_variant jsonb;
  v_attributes jsonb;
  v_variant_id uuid;
  v_variant_name text;
  v_variant_price numeric(14,2);
  v_variant_quantity integer;
  v_price numeric(14,2);
  v_quantity integer := 0;
  v_location_id uuid;
  v_location_count integer := 0;
  v_stock public.stok_barang%ROWTYPE;
  v_total_stock integer := 0;
  v_variant_count integer := 0;
  v_index integer := 0;
  v_batch integer := 0;
  v_chunk integer := 0;
  v_stock_result jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: data barang jual tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_product_name := nullif(btrim(p_payload->>'nama_barang'),'');
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama barang wajib diisi' USING ERRCODE='22023';
  END IF;
  v_description := nullif(btrim(p_payload->>'deskripsi'),'');
  v_category_id := nullif(p_payload->>'kategori_barang_id','')::uuid;
  v_category_name := nullif(btrim(p_payload->>'kategori_nama'),'');
  IF (v_category_id IS NULL)=(v_category_name IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilih kategori yang tersedia atau isi kategori baru' USING ERRCODE='22023';
  END IF;

  v_mode := coalesce(nullif(p_payload->>'inventory_mode',''),'serialized');
  IF v_mode NOT IN ('serialized','quantity','untracked') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilihan stok tidak valid' USING ERRCODE='22023';
  END IF;
  v_variant_mode := coalesce((p_payload->>'varian_mode')::boolean,false);
  v_variants := coalesce(p_payload->'variants','[]'::jsonb);
  IF jsonb_typeof(v_variants)<>'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: variasi barang tidak valid' USING ERRCODE='22023';
  END IF;
  IF v_variant_mode AND jsonb_array_length(v_variants)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tambahkan minimal satu pilihan barang' USING ERRCODE='22023';
  END IF;
  IF NOT v_variant_mode AND jsonb_array_length(v_variants)<>0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilihan varian tidak sesuai' USING ERRCODE='22023';
  END IF;

  v_price := nullif(p_payload->>'harga_jual','')::numeric;
  IF NOT v_variant_mode AND (v_price IS NULL OR v_price<=0) THEN
    RAISE EXCEPTION 'PRICE_REQUIRED: harga jual wajib lebih dari nol' USING ERRCODE='23514';
  END IF;
  IF v_variant_mode AND v_price IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga jual varian diatur pada setiap pilihan' USING ERRCODE='22023';
  END IF;

  IF v_mode='untracked' THEN
    v_quantity := 0;
  ELSE
    v_quantity := coalesce(nullif(p_payload->>'jumlah','')::integer,0);
    IF v_quantity<0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: stok awal tidak boleh negatif' USING ERRCODE='22023';
    END IF;
  END IF;

  v_hash := md5(p_payload::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'quick_item_onboarding',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil penambahan barang belum dapat dipastikan' USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  IF v_category_id IS NOT NULL THEN
    PERFORM 1 FROM public.kategori_barang
    WHERE usaha_id=p_usaha_id AND kategori_barang_id=v_category_id AND status='active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: kategori aktif tidak ditemukan pada Usaha ini' USING ERRCODE='P0002';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':quick-item-category:'||lower(v_category_name),0));
    SELECT kategori_barang_id INTO v_category_id
    FROM public.kategori_barang
    WHERE usaha_id=p_usaha_id AND lower(nama)=lower(v_category_name)
    FOR UPDATE;
    IF FOUND THEN
      IF NOT EXISTS(SELECT 1 FROM public.kategori_barang WHERE usaha_id=p_usaha_id AND kategori_barang_id=v_category_id AND status='active') THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: nama kategori sudah ada tetapi tidak aktif' USING ERRCODE='23514';
      END IF;
    ELSE
      INSERT INTO public.kategori_barang(usaha_id,nama,status)
      VALUES(p_usaha_id,v_category_name,'active')
      RETURNING kategori_barang_id INTO v_category_id;
      v_category_created := true;
      INSERT INTO public.audit_log(
        usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
        source_application,request_id,change_summary
      ) VALUES(
        p_usaha_id,v_auth_user_id,v_admin_id,'create','kategori_barang',v_category_id,
        'quick-item-onboarding',p_request_id,
        jsonb_build_object('nama',v_category_name,'created_via','quick_sale_item_onboarding')
      );
    END IF;
  END IF;
  SELECT nama INTO v_category_name FROM public.kategori_barang
  WHERE usaha_id=p_usaha_id AND kategori_barang_id=v_category_id;

  IF v_mode='serialized' THEN
    SELECT count(*) INTO v_location_count FROM public.lokasi
    WHERE usaha_id=p_usaha_id AND status='active';
    v_location_id := nullif(p_payload->>'lokasi_id','')::uuid;
    IF v_location_id IS NULL THEN
      IF v_location_count>1 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: pilih lokasi awal barang' USING ERRCODE='22023';
      ELSIF v_location_count=1 THEN
        SELECT lokasi_id INTO v_location_id FROM public.lokasi
        WHERE usaha_id=p_usaha_id AND status='active' ORDER BY nama,lokasi_id LIMIT 1;
      END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM public.lokasi WHERE usaha_id=p_usaha_id AND lokasi_id=v_location_id AND status='active') THEN
      RAISE EXCEPTION 'NOT_FOUND: lokasi aktif tidak ditemukan' USING ERRCODE='P0002';
    END IF;
  END IF;

  v_slug_base := lower(trim(both '-' from regexp_replace(v_product_name,'[^a-zA-Z0-9]+','-','g')));
  IF v_slug_base='' THEN v_slug_base := 'barang-'||substr(replace(p_request_id::text,'-',''),1,8); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':quick-item-slug:'||v_slug_base,0));
  v_slug := v_slug_base;
  WHILE EXISTS(SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND slug=v_slug) LOOP
    v_slug_suffix := v_slug_suffix+1;
    v_slug := v_slug_base||'-'||v_slug_suffix::text;
  END LOOP;

  -- Variant parents are structural only; sale eligibility and price live on their variants.
  v_stock_result := app_private.command_create_barang_with_channels(
    p_usaha_id,v_category_id,v_product_name,v_slug,v_description,NULL,
    'active',false,jsonb_build_object('created_via','quick_item','channel','sale'),
    false,NOT v_variant_mode,CASE WHEN v_variant_mode THEN NULL ELSE v_price END,
    CASE WHEN v_variant_mode THEN 'serialized' ELSE v_mode END,
    left(p_idempotency_key||':product',200),p_request_id
  );
  v_product_id := (v_stock_result->>'barang_id')::uuid;

  IF v_variant_mode THEN
    FOR v_variant IN SELECT value FROM jsonb_array_elements(v_variants)
    LOOP
      v_index := v_index+1;
      v_attributes := coalesce(v_variant->'attributes','{}'::jsonb);
      IF jsonb_typeof(v_attributes)<>'object' OR v_attributes='{}'::jsonb
        OR EXISTS(SELECT 1 FROM jsonb_each_text(v_attributes) e WHERE nullif(btrim(e.value),'') IS NULL) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: setiap pilihan membutuhkan atribut pembeda lengkap' USING ERRCODE='22023';
      END IF;
      SELECT string_agg(btrim(value),' / ' ORDER BY key) INTO v_variant_name FROM jsonb_each_text(v_attributes);
      v_variant_name := left(coalesce(v_variant_name,'Pilihan '||v_index::text),120);
      v_variant_price := nullif(v_variant->>'harga_jual','')::numeric;
      IF v_variant_price IS NULL OR v_variant_price<=0 THEN
        RAISE EXCEPTION 'PRICE_REQUIRED: setiap varian harus memiliki harga jual' USING ERRCODE='23514';
      END IF;
      v_variant_quantity := CASE WHEN v_mode='untracked' THEN 0 ELSE coalesce(nullif(v_variant->>'jumlah','')::integer,0) END;
      IF v_variant_quantity<0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: stok awal varian tidak boleh negatif' USING ERRCODE='22023';
      END IF;

      v_stock_result := app_private.command_create_varian_barang(
        p_usaha_id,v_product_id,v_variant_name,
        nullif(btrim(v_variant->>'kode_internal'),''),
        nullif(btrim(v_variant->>'deskripsi'),''),
        v_attributes,'active',
        left(p_idempotency_key||':variant:'||v_index::text,200),p_request_id
      );
      v_variant_id := (v_stock_result->>'varian_barang_id')::uuid;
      PERFORM app_private.command_set_varian_sales_config(
        p_usaha_id,v_variant_id,false,true,v_variant_price,v_mode,NULL,
        left(p_idempotency_key||':variant-config:'||v_index::text,200),p_request_id
      );

      IF v_mode='serialized' AND v_variant_quantity>0 THEN
        v_batch := 0;
        v_total_stock := v_total_stock+v_variant_quantity;
        WHILE v_variant_quantity>0 LOOP
          v_chunk := least(v_variant_quantity,250);
          v_batch := v_batch+1;
          PERFORM app_private.command_register_inventory_units(
            p_usaha_id,v_product_id,v_variant_id,v_chunk,v_location_id,current_date,
            NULL,'Stok awal dari katalog cepat',
            left(p_idempotency_key||':variant-units:'||v_index::text||':'||v_batch::text,200),p_request_id
          );
          v_variant_quantity := v_variant_quantity-v_chunk;
        END LOOP;
      ELSIF v_mode='quantity' AND v_variant_quantity>0 THEN
        SELECT * INTO v_stock FROM public.stok_barang
        WHERE usaha_id=p_usaha_id AND barang_id=v_product_id AND varian_barang_id=v_variant_id
        FOR UPDATE;
        UPDATE public.stok_barang SET jumlah=jumlah+v_variant_quantity,updated_at=now()
        WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;
        INSERT INTO public.pergerakan_stok(
          usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
          quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
        ) VALUES(
          p_usaha_id,v_stock.stok_barang_id,v_product_id,v_variant_id,'opening',
          v_variant_quantity,'quick_item_onboarding',p_request_id,v_admin_id,p_request_id,
          'Stok awal dari katalog cepat',jsonb_build_object('initial_stock',v_variant_quantity)
        );
        v_total_stock := v_total_stock+v_variant_quantity;
      END IF;

      v_variant_count := v_variant_count+1;
    END LOOP;
  ELSE
    IF v_mode='serialized' AND v_quantity>0 THEN
      v_total_stock := v_quantity;
      v_batch := 0;
      WHILE v_quantity>0 LOOP
        v_chunk := least(v_quantity,250);
        v_batch := v_batch+1;
        PERFORM app_private.command_register_inventory_units(
          p_usaha_id,v_product_id,NULL,v_chunk,v_location_id,current_date,NULL,
          'Stok awal dari katalog cepat',
          left(p_idempotency_key||':product-units:'||v_batch::text,200),p_request_id
        );
        v_quantity := v_quantity-v_chunk;
      END LOOP;
    ELSIF v_mode='quantity' AND v_quantity>0 THEN
      SELECT * INTO v_stock FROM public.stok_barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_product_id AND varian_barang_id IS NULL
      FOR UPDATE;
      UPDATE public.stok_barang SET jumlah=jumlah+v_quantity,updated_at=now()
      WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;
      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      ) VALUES(
        p_usaha_id,v_stock.stok_barang_id,v_product_id,NULL,'opening',
        v_quantity,'quick_item_onboarding',p_request_id,v_admin_id,p_request_id,
        'Stok awal dari katalog cepat',jsonb_build_object('initial_stock',v_quantity)
      );
      v_total_stock := v_quantity;
    END IF;
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'quick_sale_item_onboarding','barang',v_product_id,
    'quick-item-onboarding',p_request_id,
    jsonb_build_object('inventory_mode',v_mode,'varian_mode',v_variant_mode,
      'variant_count',v_variant_count,'initial_stock',v_total_stock,'channel','sale')
  );
  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'catalog.sale_item_created','barang',v_product_id,
    jsonb_build_object('barang_id',v_product_id,'inventory_mode',v_mode,
      'varian_mode',v_variant_mode,'variant_count',v_variant_count,'initial_stock',v_total_stock)
  );

  v_response := jsonb_build_object(
    'state','committed','channel','sale','usaha_id',p_usaha_id,'barang_id',v_product_id,
    'barang_nama',v_product_name,'slug',v_slug,'kategori_barang_id',v_category_id,
    'kategori_dibuat',v_category_created,'inventory_mode',v_mode,'varian_mode',v_variant_mode,
    'variant_count',v_variant_count,
    'unit_count',CASE WHEN v_mode='serialized' THEN v_total_stock ELSE 0 END,
    'stock_quantity',CASE WHEN v_mode='quantity' THEN v_total_stock ELSE NULL END,
    'min_price',CASE WHEN v_variant_mode THEN (SELECT min((value->>'harga_jual')::numeric) FROM jsonb_array_elements(v_variants)) ELSE v_price END,
    'max_price',CASE WHEN v_variant_mode THEN (SELECT max((value->>'harga_jual')::numeric) FROM jsonb_array_elements(v_variants)) ELSE v_price END,
    'currency_code','IDR','variants',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'varian_barang_id',v.varian_barang_id,'nama',v.nama,'harga_jual',v.harga_jual
    ) ORDER BY v.created_at) FROM public.varian_barang v WHERE v.usaha_id=p_usaha_id AND v.barang_id=v_product_id),'[]'::jsonb),
    'readiness','ready'
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_quick_sale_item_onboarding(
  p_usaha_id uuid,p_payload jsonb,p_idempotency_key text,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_quick_sale_item_onboarding($1,$2,$3,$4);
$function$;

-- Keep the old POS command unchanged for all existing non-renter and mixed-checkout clients.
CREATE OR REPLACE FUNCTION app_private.command_create_sale_with_renter(
  p_usaha_id uuid,p_penyewa_id uuid,p_nama_pelanggan text,p_nomor_telepon text,p_catatan text,
  p_lines jsonb,p_akun_keuangan_id uuid,p_metode text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_finance_admin(p_usaha_id);
  v_renter public.penyewa%ROWTYPE;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_result jsonb;
  v_response jsonb;
  v_inner_key text;
BEGIN
  IF p_penyewa_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilih penyewa atau gunakan Pelanggan Umum' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_renter FROM public.penyewa
  WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id AND status='active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewa aktif tidak ditemukan pada Usaha ini' USING ERRCODE='P0002';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'nama_pelanggan',v_renter.nama_lengkap,
    'nomor_telepon',v_renter.nomor_telepon,'catatan',p_catatan,'lines',p_lines,
    'akun',p_akun_keuangan_id,'metode',lower(btrim(coalesce(p_metode,'')))
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'create_sale_with_renter',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil penjualan dengan penyewa belum dapat dipastikan' USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_inner_key := left(p_idempotency_key||':registered-renter-sale',200);
  v_result := app_private.command_create_sale(
    p_usaha_id,'pos',v_renter.nama_lengkap,v_renter.nomor_telepon,p_catatan,
    p_lines,p_akun_keuangan_id,p_metode,v_inner_key,p_request_id
  );
  UPDATE public.penjualan
  SET penyewa_id=p_penyewa_id,updated_at=now()
  WHERE usaha_id=p_usaha_id AND penjualan_id=(v_result->>'penjualan_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: relasi penyewa pada transaksi penjualan gagal disimpan' USING ERRCODE='P0001';
  END IF;

  v_response := v_result||jsonb_build_object('penyewa_id',p_penyewa_id,'nama_pelanggan',v_renter.nama_lengkap);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_create_sale_with_renter(
  p_usaha_id uuid,p_penyewa_id uuid,p_nama_pelanggan text,p_nomor_telepon text,p_catatan text,
  p_lines jsonb,p_akun_keuangan_id uuid,p_metode text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_sale_with_renter(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
  );
$function$;

-- Add a tenant-scoped relation so a sale cannot point at a renter from another business.
DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='penyewa_usaha_penyewa_unique' AND conrelid='public.penyewa'::regclass
  ) THEN
    ALTER TABLE public.penyewa ADD CONSTRAINT penyewa_usaha_penyewa_unique UNIQUE(usaha_id,penyewa_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='penjualan_penyewa_tenant_fk' AND conrelid='public.penjualan'::regclass
  ) THEN
    ALTER TABLE public.penjualan ADD COLUMN IF NOT EXISTS penyewa_id uuid;
    ALTER TABLE public.penjualan ADD CONSTRAINT penjualan_penyewa_tenant_fk
      FOREIGN KEY(usaha_id,penyewa_id) REFERENCES public.penyewa(usaha_id,penyewa_id) ON DELETE RESTRICT;
  END IF;
END;
$block$;
ALTER TABLE public.penjualan ADD COLUMN IF NOT EXISTS penyewa_id uuid;
CREATE INDEX IF NOT EXISTS penjualan_renter_idx
  ON public.penjualan(usaha_id,penyewa_id,created_at DESC) WHERE penyewa_id IS NOT NULL;

-- Reconciliation supports optional registered-renter POS sales.
CREATE OR REPLACE FUNCTION app_private.command_reconcile_retail_command(
  p_usaha_id uuid,p_command_name text,p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_command_name NOT IN (
    'create_sale','create_sale_with_renter','create_mixed_checkout','adjust_sale_stock',
    'set_barang_sales_config','set_varian_sales_config'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command penjualan tidak dikenal' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
    AND command_name=p_command_name AND key=btrim(p_idempotency_key);
  IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found','response',NULL); END IF;
  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_sale_with_renter(uuid,uuid,text,text,text,jsonb,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_sale_with_renter(uuid,uuid,text,text,text,jsonb,uuid,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_create_sale_with_renter(uuid,uuid,text,text,text,jsonb,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_create_sale_with_renter(uuid,uuid,text,text,text,jsonb,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_retail_command(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_retail_command(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.command_reconcile_retail_command(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_reconcile_retail_command(uuid,text,text) TO authenticated;
