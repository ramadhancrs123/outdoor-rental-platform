-- Unified catalog channels, purchase receiving, inventory costing and finance source split.
-- Existing rental transactions and commands are intentionally not altered.

ALTER TABLE public.detail_pembelian
  ADD COLUMN IF NOT EXISTS inventory_mode_snapshot text,
  ADD COLUMN IF NOT EXISTS received_quantity numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.detail_pembelian
  ADD CONSTRAINT detail_pembelian_inventory_mode_snapshot_check
    CHECK (inventory_mode_snapshot IS NULL OR inventory_mode_snapshot IN ('serialized','quantity','untracked')),
  ADD CONSTRAINT detail_pembelian_received_quantity_check
    CHECK (received_quantity >= 0 AND received_quantity <= jumlah);

ALTER TABLE public.stok_barang
  ADD COLUMN IF NOT EXISTS average_unit_cost numeric(14,2);

ALTER TABLE public.stok_barang
  ADD CONSTRAINT stok_barang_average_unit_cost_check
    CHECK (average_unit_cost IS NULL OR average_unit_cost >= 0);

ALTER TABLE public.unit_barang
  ADD COLUMN IF NOT EXISTS harga_perolehan numeric(14,2);

ALTER TABLE public.unit_barang
  ADD CONSTRAINT unit_barang_harga_perolehan_check
    CHECK (harga_perolehan IS NULL OR harga_perolehan >= 0);

ALTER TABLE public.pergerakan_stok
  DROP CONSTRAINT IF EXISTS pergerakan_stok_jenis_pergerakan_check;

ALTER TABLE public.pergerakan_stok
  ADD CONSTRAINT pergerakan_stok_jenis_pergerakan_check
    CHECK (jenis_pergerakan IN ('opening','adjustment','purchase_receipt','sale','sale_return'));

CREATE TABLE IF NOT EXISTS public.penerimaan_pembelian (
  penerimaan_pembelian_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  pembelian_id uuid NOT NULL,
  nomor_penerimaan text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penerimaan_pembelian_usaha_fk FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT penerimaan_pembelian_purchase_fk FOREIGN KEY (usaha_id,pembelian_id)
    REFERENCES public.pembelian(usaha_id,pembelian_id) ON DELETE RESTRICT,
  CONSTRAINT penerimaan_pembelian_actor_fk FOREIGN KEY (received_by_admin_id)
    REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT penerimaan_pembelian_purchase_unique UNIQUE (usaha_id,pembelian_id),
  CONSTRAINT penerimaan_pembelian_number_unique UNIQUE (usaha_id,nomor_penerimaan),
  CONSTRAINT penerimaan_pembelian_tenant_unique UNIQUE (usaha_id,penerimaan_pembelian_id)
);

CREATE TABLE IF NOT EXISTS public.detail_penerimaan_pembelian (
  detail_penerimaan_pembelian_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penerimaan_pembelian_id uuid NOT NULL,
  detail_pembelian_id uuid NOT NULL,
  barang_id uuid NOT NULL,
  varian_barang_id uuid,
  inventory_mode text NOT NULL CHECK (inventory_mode IN ('serialized','quantity','untracked')),
  quantity_received numeric(14,2) NOT NULL CHECK (quantity_received > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  subtotal_cost numeric(14,2) NOT NULL CHECK (subtotal_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detail_penerimaan_pembelian_header_fk FOREIGN KEY (usaha_id,penerimaan_pembelian_id)
    REFERENCES public.penerimaan_pembelian(usaha_id,penerimaan_pembelian_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penerimaan_pembelian_purchase_line_fk FOREIGN KEY (usaha_id,detail_pembelian_id)
    REFERENCES public.detail_pembelian(usaha_id,detail_pembelian_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penerimaan_pembelian_barang_fk FOREIGN KEY (usaha_id,barang_id)
    REFERENCES public.barang(usaha_id,barang_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penerimaan_pembelian_variant_fk FOREIGN KEY (usaha_id,varian_barang_id)
    REFERENCES public.varian_barang(usaha_id,varian_barang_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penerimaan_pembelian_line_unique UNIQUE (usaha_id,detail_pembelian_id),
  CONSTRAINT detail_penerimaan_pembelian_tenant_unique UNIQUE (usaha_id,detail_penerimaan_pembelian_id)
);

CREATE INDEX IF NOT EXISTS penerimaan_pembelian_purchase_idx
  ON public.penerimaan_pembelian(usaha_id,pembelian_id,received_at DESC);
CREATE INDEX IF NOT EXISTS detail_penerimaan_pembelian_header_idx
  ON public.detail_penerimaan_pembelian(usaha_id,penerimaan_pembelian_id);
CREATE INDEX IF NOT EXISTS detail_penerimaan_pembelian_barang_idx
  ON public.detail_penerimaan_pembelian(usaha_id,barang_id);
CREATE INDEX IF NOT EXISTS detail_penerimaan_pembelian_variant_idx
  ON public.detail_penerimaan_pembelian(usaha_id,varian_barang_id)
  WHERE varian_barang_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unit_barang_purchase_source_idx
  ON public.unit_barang(usaha_id,sumber_pembelian_detail_id)
  WHERE sumber_pembelian_detail_id IS NOT NULL;

ALTER TABLE public.penerimaan_pembelian ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_penerimaan_pembelian ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.penerimaan_pembelian FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.detail_penerimaan_pembelian FROM PUBLIC,anon,authenticated;

COMMENT ON COLUMN public.detail_pembelian.inventory_mode_snapshot IS
  'Inventory mode resolved at receiving time. serialized, quantity or untracked.';
COMMENT ON COLUMN public.detail_pembelian.received_quantity IS
  'Quantity already received; receiving is atomic with purchase payment for completed purchases.';
COMMENT ON COLUMN public.stok_barang.average_unit_cost IS
  'Moving weighted-average acquisition cost for quantity-managed stock.';
COMMENT ON COLUMN public.unit_barang.harga_perolehan IS
  'Snapshot acquisition cost per physical unit; used for traceable serialized stock.';
COMMENT ON TABLE public.penerimaan_pembelian IS
  'Immutable receiving header created automatically when a purchase is financially completed.';
COMMENT ON TABLE public.detail_penerimaan_pembelian IS
  'Per-line receiving snapshot linking purchase cost to physical/quantity/untracked inventory behavior.';

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
    SELECT d.detail_pembelian_id,d.barang_id,d.varian_barang_id,d.jumlah,d.unit_price,d.received_quantity
    FROM public.detail_pembelian d
    WHERE d.usaha_id=p_usaha_id AND d.pembelian_id=p_pembelian_id
    ORDER BY d.created_at,d.detail_pembelian_id
    FOR UPDATE
  LOOP
    IF v_line.received_quantity >= v_line.jumlah THEN
      CONTINUE;
    END IF;
    IF v_line.received_quantity > 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: penerimaan parsial belum didukung untuk line pembelian %',v_line.detail_pembelian_id
        USING ERRCODE='23514';
    END IF;

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

    UPDATE public.detail_pembelian
    SET inventory_mode_snapshot=v_mode,received_quantity=jumlah,updated_at=now()
    WHERE usaha_id=p_usaha_id AND detail_pembelian_id=v_line.detail_pembelian_id;

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

CREATE OR REPLACE FUNCTION app_private.auto_receive_purchase_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status='completed' THEN
    PERFORM app_private.receive_completed_purchase(NEW.usaha_id,NEW.pembelian_id,gen_random_uuid());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_purchase_auto_receive_on_completion ON public.pembelian;
CREATE TRIGGER trg_purchase_auto_receive_on_completion
AFTER UPDATE OF status ON public.pembelian
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='completed')
EXECUTE FUNCTION app_private.auto_receive_purchase_on_completion();

REVOKE ALL ON FUNCTION app_private.receive_completed_purchase(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.auto_receive_purchase_on_completion() FROM PUBLIC,anon,authenticated;

-- Atomic catalog creation: the initial channel configuration is committed with the product.
CREATE OR REPLACE FUNCTION app_private.command_create_barang_with_channels(
  p_usaha_id uuid,p_kategori_barang_id uuid,p_nama text,p_slug text,
  p_deskripsi text,p_ringkasan_publik text,p_status text,p_is_public boolean,p_metadata jsonb,
  p_is_rentable boolean,p_is_sellable boolean,p_harga_jual numeric,p_inventory_mode text,
  p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_product jsonb;
  v_config jsonb;
  v_barang_id uuid;
  v_response jsonb;
BEGIN
  IF p_is_rentable IS NULL OR p_is_sellable IS NULL OR p_inventory_mode NOT IN ('serialized','quantity','untracked') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: channel dan mode inventaris wajib valid' USING ERRCODE='22023';
  END IF;
  IF p_is_rentable AND p_inventory_mode <> 'serialized' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: barang rental harus memakai unit fisik individual' USING ERRCODE='23514';
  END IF;
  IF p_is_sellable AND (p_harga_jual IS NULL OR p_harga_jual<=0) THEN
    RAISE EXCEPTION 'PRICE_REQUIRED: harga jual wajib diisi untuk barang yang dapat dijual' USING ERRCODE='23514';
  END IF;
  IF p_harga_jual IS NOT NULL AND p_harga_jual<=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga jual harus lebih besar dari nol' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'kategori',p_kategori_barang_id,'nama',p_nama,'slug',p_slug,
    'deskripsi',p_deskripsi,'ringkasan',p_ringkasan_publik,'status',p_status,
    'is_public',p_is_public,'metadata',p_metadata,'is_rentable',p_is_rentable,
    'is_sellable',p_is_sellable,'harga_jual',p_harga_jual,'inventory_mode',p_inventory_mode
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'create_barang_with_channels',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan barang dan channel belum dapat dipastikan' USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_product := app_private.command_create_barang(
    p_usaha_id,p_kategori_barang_id,p_nama,p_slug,p_deskripsi,p_ringkasan_publik,
    p_status,p_is_public,p_metadata,left(p_idempotency_key||':product',200),p_request_id
  );
  v_barang_id := (v_product->>'barang_id')::uuid;
  v_config := app_private.command_set_barang_sales_config(
    p_usaha_id,v_barang_id,p_is_rentable,p_is_sellable,p_harga_jual,p_inventory_mode,
    NULL,left(p_idempotency_key||':channels',200),p_request_id
  );

  v_response := v_product || jsonb_build_object(
    'is_rentable',v_config->'is_rentable','is_sellable',v_config->'is_sellable',
    'harga_jual',v_config->'harga_jual','inventory_mode',v_config->'inventory_mode'
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,201,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_create_barang_with_channels(
  p_usaha_id uuid,p_kategori_barang_id uuid,p_nama text,p_slug text,
  p_deskripsi text,p_ringkasan_publik text,p_status text,p_is_public boolean,p_metadata jsonb,
  p_is_rentable boolean,p_is_sellable boolean,p_harga_jual numeric,p_inventory_mode text,
  p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_barang_with_channels($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15);
$function$;

REVOKE ALL ON FUNCTION public.command_create_barang_with_channels(uuid,uuid,text,text,text,text,text,boolean,jsonb,boolean,boolean,numeric,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_create_barang_with_channels(uuid,uuid,text,text,text,text,text,boolean,jsonb,boolean,boolean,numeric,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.command_create_barang_with_channels(uuid,uuid,text,text,text,text,text,boolean,jsonb,boolean,boolean,numeric,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_barang_with_channels(uuid,uuid,text,text,text,text,text,boolean,jsonb,boolean,boolean,numeric,text,text,uuid) TO authenticated;

-- Finance reporting separates revenue streams and stock purchase cash-outs without splitting cash accounts.
CREATE OR REPLACE FUNCTION app_private.finance_summary(p_usaha_id uuid,p_start_date date,p_end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_income numeric:=0;
  v_expense numeric:=0;
  v_rental_income numeric:=0;
  v_retail_income numeric:=0;
  v_purchase_expense numeric:=0;
  v_operational_expense numeric:=0;
  v_payment_amount numeric:=0;
  v_payment_count bigint:=0;
  v_income_count bigint:=0;
  v_expense_count bigint:=0;
  v_reversal_income numeric:=0;
  v_reversal_expense numeric:=0;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode harus valid dan end-exclusive' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT
    coalesce(sum(CASE WHEN t.arah='income' THEN t.amount ELSE 0 END),0),
    coalesce(sum(CASE WHEN t.arah='expense' THEN t.amount ELSE 0 END),0),
    count(*) FILTER (WHERE t.arah='income'),
    count(*) FILTER (WHERE t.arah='expense'),
    coalesce(sum(CASE WHEN t.jenis='finance_reversal' AND t.arah='income' THEN t.amount ELSE 0 END),0),
    coalesce(sum(CASE WHEN t.jenis='finance_reversal' AND t.arah='expense' THEN t.amount ELSE 0 END),0),
    coalesce(sum(t.amount) FILTER (WHERE t.arah='income' AND t.jenis='rental_payment'),0),
    coalesce(sum(t.amount) FILTER (WHERE t.arah='income' AND t.jenis='sales_payment'),0),
    coalesce(sum(t.amount) FILTER (WHERE t.arah='expense' AND t.sumber_type='purchase'),0),
    coalesce(sum(t.amount) FILTER (WHERE t.arah='expense' AND coalesce(t.sumber_type,'')<>'purchase'),0)
  INTO v_income,v_expense,v_income_count,v_expense_count,v_reversal_income,v_reversal_expense,
       v_rental_income,v_retail_income,v_purchase_expense,v_operational_expense
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded'
    AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at;

  SELECT coalesce(sum(p.amount),0),count(*) INTO v_payment_amount,v_payment_count
  FROM (
    SELECT amount,dibayar_at
    FROM public.pembayaran
    WHERE usaha_id=p_usaha_id AND status='recorded'
      AND dibayar_at>=v_start_at AND dibayar_at<v_end_at
    UNION ALL
    SELECT amount,dibayar_at
    FROM public.penjualan_pembayaran
    WHERE usaha_id=p_usaha_id AND status='recorded'
      AND dibayar_at>=v_start_at AND dibayar_at<v_end_at
  ) p;

  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'recorded_income',v_income,'recorded_expense',v_expense,'net_operational_movement',v_income-v_expense,
    'recorded_income_transaction_count',v_income_count,'recorded_expense_transaction_count',v_expense_count,
    'recorded_payment_amount',v_payment_amount,'recorded_payment_count',v_payment_count,
    'reversal_income_in_period',v_reversal_income,'reversal_expense_in_period',v_reversal_expense,
    'rental_income',v_rental_income,'retail_income',v_retail_income,
    'purchase_cash_out',v_purchase_expense,'non_purchase_expense',v_operational_expense,
    'freshness',jsonb_build_object('mode','live_database_query','generated_at',clock_timestamp()),
    'source_note','Saldo akun uang tetap berasal dari mutasi riil. Rental dan retail adalah klasifikasi sumber pemasukan; pembelian dipisahkan dari pengeluaran non-pembelian. HPP penjualan adalah biaya barang terjual dan tidak diduplikasi sebagai cash-out.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.finance_summary(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.finance_summary(uuid,date,date) TO authenticated;


-- Serialized sales use the acquisition cost of the exact physical units consumed.
CREATE OR REPLACE FUNCTION app_private.command_create_sale(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_account public.akun_keuangan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_sale_id uuid := gen_random_uuid();
  v_checkout_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_sale_number text;
  v_checkout_number text;
  v_payment_number text;
  v_payment_number_seq bigint;
  v_transaction_number bigint;
  v_sale_number_seq bigint;
  v_checkout_number_seq bigint;
  v_now timestamptz := now();
  v_year text;
  v_line jsonb;
  v_barang_id uuid;
  v_variant_id uuid;
  v_parent_id uuid;
  v_barang_name text;
  v_variant_name text;
  v_sellable boolean;
  v_price numeric(14,2);
  v_cost numeric(14,2);
  v_line_hpp numeric(14,2);
  v_unit_hpp_total numeric(14,2) := 0;
  v_unit_hpp_complete boolean := true;
  v_total_hpp numeric(14,2) := 0;
  v_hpp_complete boolean := true;
  v_mode text;
  v_qty integer;
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_available integer;
  v_reserved numeric := 0;
  v_reservation record;
  v_unit record;
  v_detail_id uuid;
  v_selected integer;
  v_stock public.stok_barang%ROWTYPE;
  v_response jsonb;
  v_method text := lower(btrim(coalesce(p_metode,'')));
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_source NOT IN ('pos','mixed') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sumber penjualan tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu barang penjualan wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF p_akun_keuangan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun penerima pembayaran wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF v_method NOT IN ('cash','bank_transfer','qris_manual','other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: metode pembayaran tidak didukung' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'source',p_source,'nama_pelanggan',nullif(btrim(p_nama_pelanggan),''),
    'nomor_telepon',nullif(btrim(p_nomor_telepon),''),'catatan',nullif(btrim(p_catatan),''),
    'lines',p_lines,'akun',p_akun_keuangan_id,'metode',v_method
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_sale',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_sale' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status penjualan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  SELECT timezone INTO v_timezone
  FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun penerima tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF v_account.status <> 'active' OR v_account.mata_uang <> 'IDR' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: akun penerima tidak aktif atau bukan akun IDR' USING ERRCODE='23514';
  END IF;

  -- Resolve all prices and validate item eligibility from database truth, never from client-supplied prices.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := coalesce(nullif(v_line->>'jumlah','')::integer,0);
    IF num_nonnulls(v_barang_id,v_variant_id) <> 1 OR v_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap baris harus berisi tepat satu produk/varian dan jumlah bulat positif' USING ERRCODE='22023';
    END IF;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: produk atau varian aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_sellable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: produk/varian ini belum diizinkan untuk dijual' USING ERRCODE='23514'; END IF;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED: harga jual produk/varian belum ditentukan' USING ERRCODE='23514'; END IF;
    IF v_mode NOT IN ('serialized','quantity','untracked') THEN RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid' USING ERRCODE='22023'; END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh negatif' USING ERRCODE='22023'; END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_total := v_total + v_subtotal;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: total penjualan harus lebih dari nol' USING ERRCODE='22023'; END IF;

  v_year := to_char(v_now AT TIME ZONE v_timezone,'YYYY');
  v_sale_number_seq := app_private.next_business_number(p_usaha_id,'POS',v_year);
  v_checkout_number_seq := app_private.next_business_number(p_usaha_id,'CKO',v_year);
  v_payment_number_seq := app_private.next_business_number(p_usaha_id,'SP',v_year);
  v_transaction_number := app_private.next_business_number(p_usaha_id,'TRX',v_year);
  v_sale_number := 'POS-' || v_year || '-' || lpad(v_sale_number_seq::text,4,'0');
  v_checkout_number := 'CK-' || v_year || '-' || lpad(v_checkout_number_seq::text,4,'0');
  v_payment_number := 'SP-' || v_year || '-' || lpad(v_payment_number_seq::text,4,'0');

  INSERT INTO public.penjualan(
    penjualan_id,usaha_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,
    payment_status,total_amount,currency_code,catatan,created_by_admin_id
  ) VALUES (
    v_sale_id,p_usaha_id,v_sale_number,p_source,
    nullif(btrim(coalesce(p_nama_pelanggan,'')),''),
    nullif(btrim(coalesce(p_nomor_telepon,'')),''),
    'completed','paid',v_total,'IDR',
    nullif(btrim(coalesce(p_catatan,'')),''),v_admin_id
  );

  -- Re-read each line under the tenant stock lock, then consume exactly the stock class assigned to that product/variant.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := (v_line->>'jumlah')::integer;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    v_subtotal := round(v_qty * v_price,2);
    v_detail_id := gen_random_uuid();
    v_unit_hpp_total := 0;
    v_unit_hpp_complete := true;
    v_selected := 0;

    INSERT INTO public.detail_penjualan(
      detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,
      nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code,
      harga_beli_satuan,hpp_total
    ) VALUES (
      v_detail_id,p_usaha_id,v_sale_id,v_parent_id,v_variant_id,
      v_barang_name,v_variant_name,v_mode,v_qty,v_price,v_subtotal,'IDR',
      v_cost,CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END
    );

    IF v_mode='untracked' THEN
      NULL; -- Consumables without stock tracking: sale does not mutate stock.
    ELSIF v_mode='quantity' THEN
      SELECT * INTO v_stock
      FROM public.stok_barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_parent_id
        AND varian_barang_id IS NOT DISTINCT FROM v_variant_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_CONFIGURED: saldo stok kuantitas belum diatur untuk %',coalesce(v_variant_name,v_barang_name) USING ERRCODE='23514';
      END IF;
      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      UPDATE public.stok_barang
      SET jumlah=jumlah-v_qty,updated_at=now()
      WHERE stok_barang_id=v_stock.stok_barang_id;

      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      ) VALUES (
        p_usaha_id,v_stock.stok_barang_id,v_parent_id,v_variant_id,'sale',
        -v_qty,'sale',v_sale_id,v_admin_id,p_request_id,
        'Penjualan '||v_sale_number,
        jsonb_build_object('penjualan_id',v_sale_id,'detail_penjualan_id',v_detail_id)
      );
    ELSE
      SELECT count(*) INTO v_available
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id AND u.status='ready'
        AND (
          (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
          OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
        );

      v_reserved := 0;
      FOR v_reservation IN
        SELECT r.mulai_reservasi,r.selesai_reservasi
        FROM public.reservasi r
        WHERE r.usaha_id=p_usaha_id AND r.status='confirmed' AND r.stock_lock_status='locked'
      LOOP
        v_reserved := greatest(v_reserved,app_private.reservation_locked_component_requirement(
          p_usaha_id,v_reservation.mulai_reservasi,v_reservation.selesai_reservasi,
          CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
          v_variant_id,NULL
        ));
      END LOOP;

      IF v_available - v_reserved < v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak dapat dijual karena stok dibutuhkan untuk rental/reservasi; tersedia %, sudah dikomitmen %',
          coalesce(v_variant_name,v_barang_name),v_available,v_reserved USING ERRCODE='23514';
      END IF;

      v_selected := 0;
      FOR v_unit IN
        SELECT u.unit_barang_id,u.kode_unit,u.lokasi_id,u.harga_perolehan
        FROM public.unit_barang u
        WHERE u.usaha_id=p_usaha_id AND u.status='ready'
          AND (
            (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
            OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
          )
        ORDER BY u.created_at,u.unit_barang_id
        LIMIT v_qty
        FOR UPDATE
      LOOP
        UPDATE public.unit_barang
        SET status='sold',updated_at=now()
        WHERE usaha_id=p_usaha_id AND unit_barang_id=v_unit.unit_barang_id AND status='ready';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berubah saat proses penjualan, ulangi setelah memuat stok terbaru' USING ERRCODE='40001';
        END IF;
        INSERT INTO public.detail_penjualan_unit(
          usaha_id,detail_penjualan_id,penjualan_id,unit_barang_id
        ) VALUES (p_usaha_id,v_detail_id,v_sale_id,v_unit.unit_barang_id);
        INSERT INTO public.riwayat_unit(
          usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
          lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
        ) VALUES (
          p_usaha_id,v_unit.unit_barang_id,'unit_sold',v_now,'ready','sold',
          v_unit.lokasi_id,v_unit.lokasi_id,'sale',v_sale_id,v_admin_id,
          'Dijual melalui transaksi '||v_sale_number,
          jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,'kode_unit',v_unit.kode_unit)
        );
        IF v_unit.harga_perolehan IS NULL THEN
          v_unit_hpp_complete := false;
        ELSE
          v_unit_hpp_total := v_unit_hpp_total + v_unit.harga_perolehan;
        END IF;
        v_selected := v_selected + 1;
      END LOOP;

      IF v_selected <> v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah unit siap berubah ketika penjualan diproses' USING ERRCODE='40001';
      END IF;
    END IF;

    IF v_mode='serialized' AND v_selected=v_qty AND v_unit_hpp_complete THEN
      v_line_hpp := v_unit_hpp_total;
      UPDATE public.detail_penjualan
      SET harga_beli_satuan=round(v_line_hpp/v_qty,2),hpp_total=v_line_hpp
      WHERE usaha_id=p_usaha_id AND detail_penjualan_id=v_detail_id;
    ELSE
      v_line_hpp := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END;
    END IF;

    IF v_line_hpp IS NULL THEN
      v_hpp_complete := false;
    ELSE
      v_total_hpp := v_total_hpp + v_line_hpp;
    END IF;
  END LOOP;

  UPDATE public.penjualan
  SET total_hpp=CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      gross_profit=CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
    amount,currency_code,sumber_type,sumber_id,status,catatan
  ) VALUES (
    v_transaction_id,p_usaha_id,v_transaction_number::text,'sales_payment','income',v_now,
    v_total,'IDR','sale',v_sale_id,'recorded',
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.penjualan_pembayaran(
    penjualan_pembayaran_id,usaha_id,penjualan_id,transaksi_keuangan_id,akun_keuangan_id,
    nomor_pembayaran,jenis,metode,amount,currency_code,dibayar_at,dicatat_by_admin_id,
    reference_text,catatan,status
  ) VALUES (
    v_payment_id,p_usaha_id,v_sale_id,v_transaction_id,p_akun_keuangan_id,
    v_payment_number,'pembayaran_penjualan',v_method,v_total,'IDR',v_now,v_admin_id,
    null,nullif(btrim(coalesce(p_catatan,'')),''),'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
    sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
  ) VALUES (
    p_usaha_id,p_akun_keuangan_id,v_transaction_id,'masuk',v_total,'IDR',v_now,
    'payment',v_payment_id,'recorded',v_admin_id,p_request_id,
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.checkout(
    checkout_id,usaha_id,nomor_checkout,source,penyewaan_id,penjualan_id,
    subtotal_rental,subtotal_penjualan,total_amount,amount_paid,payment_status,
    status,created_by_admin_id
  ) VALUES (
    v_checkout_id,p_usaha_id,v_checkout_number,p_source,NULL,v_sale_id,
    0,v_total,v_total,v_total,'paid','completed',v_admin_id
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_sale','penjualan',v_sale_id,
    'admin-command',p_request_id,
    jsonb_build_object('nomor_penjualan',v_sale_number,'checkout_id',v_checkout_id,
      'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
      'line_count',jsonb_array_length(p_lines),'source',p_source)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES (
    p_usaha_id,'sale.completed','penjualan',v_sale_id,
    jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
      'checkout_id',v_checkout_id,'total_amount',v_total)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,'nomor_checkout',v_checkout_number,
    'penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
    'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
    'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
    'amount_paid',v_total,'payment_status','paid',
    'penjualan_pembayaran_id',v_payment_id,'transaksi_keuangan_id',v_transaction_id,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;


-- Read-only receiving summary for authorized procurement screens; raw receiving tables stay private.
CREATE OR REPLACE FUNCTION app_private.get_purchase_receiving_summary(
  p_usaha_id uuid,
  p_pembelian_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.procurement_require_admin(p_usaha_id);
  v_receipt public.penerimaan_pembelian%ROWTYPE;
  v_details jsonb;
BEGIN
  IF p_pembelian_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembelian wajib ditentukan' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_receipt
  FROM public.penerimaan_pembelian
  WHERE usaha_id=p_usaha_id AND pembelian_id=p_pembelian_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_received','pembelian_id',p_pembelian_id);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'detail_penerimaan_pembelian_id',d.detail_penerimaan_pembelian_id,
    'detail_pembelian_id',d.detail_pembelian_id,
    'barang_id',d.barang_id,
    'varian_barang_id',d.varian_barang_id,
    'inventory_mode',d.inventory_mode,
    'quantity_received',d.quantity_received,
    'unit_cost',d.unit_cost,
    'subtotal_cost',d.subtotal_cost
  ) ORDER BY d.created_at,d.detail_penerimaan_pembelian_id),'[]'::jsonb)
  INTO v_details
  FROM public.detail_penerimaan_pembelian d
  WHERE d.usaha_id=p_usaha_id
    AND d.penerimaan_pembelian_id=v_receipt.penerimaan_pembelian_id;

  RETURN jsonb_build_object(
    'state','received',
    'penerimaan_pembelian_id',v_receipt.penerimaan_pembelian_id,
    'nomor_penerimaan',v_receipt.nomor_penerimaan,
    'status',v_receipt.status,
    'received_at',v_receipt.received_at,
    'details',v_details
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_purchase_receiving_summary(
  p_usaha_id uuid,
  p_pembelian_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_purchase_receiving_summary($1,$2);
$function$;

REVOKE ALL ON FUNCTION app_private.get_purchase_receiving_summary(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_purchase_receiving_summary(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_purchase_receiving_summary(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_receiving_summary(uuid,uuid) TO authenticated;
