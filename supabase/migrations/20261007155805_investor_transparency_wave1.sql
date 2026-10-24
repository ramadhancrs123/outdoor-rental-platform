-- Wave 1 — Investor Financial Transparency
-- Database + backend foundation.
--
-- Business basis:
--   Net Result = recorded income - recorded expense
--   Investor Entitlement = Net Result * percentage / 100
--   Period = recurring monthly window [start_day, end_day]
--   effective_from must land on the configured period start day.
--   Negative results remain mathematically negative in Wave 1; no
--   undocumented floor/carry policy is introduced.

CREATE TABLE IF NOT EXISTS public.investor (
  investor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  nama_tampilan text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_status_chk CHECK (status IN ('active','inactive')),
  CONSTRAINT investor_nama_tampilan_chk CHECK (btrim(nama_tampilan) <> '' AND length(nama_tampilan) <= 200),
  CONSTRAINT investor_tenant_fk FOREIGN KEY (usaha_id)
    REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT investor_auth_user_fk FOREIGN KEY (auth_user_id)
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT investor_usaha_auth_user_unik UNIQUE (usaha_id, auth_user_id),
  CONSTRAINT investor_usaha_investor_unik UNIQUE (usaha_id, investor_id)
);

CREATE TABLE IF NOT EXISTS public.investor_participation (
  participation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  investor_id uuid NOT NULL,
  percentage numeric(7,4) NOT NULL,
  basis_type text NOT NULL DEFAULT 'net_operational_result',
  period_start_day smallint NOT NULL DEFAULT 1,
  period_end_day smallint NOT NULL DEFAULT 30,
  effective_from date NOT NULL,
  effective_until date NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_participation_investor_fk
    FOREIGN KEY (usaha_id, investor_id)
    REFERENCES public.investor(usaha_id, investor_id) ON DELETE RESTRICT,
  CONSTRAINT investor_participation_percentage_chk CHECK (percentage >= 0 AND percentage <= 100),
  CONSTRAINT investor_participation_basis_chk CHECK (basis_type = 'net_operational_result'),
  CONSTRAINT investor_participation_period_start_chk CHECK (period_start_day BETWEEN 1 AND 31),
  CONSTRAINT investor_participation_period_end_chk CHECK (period_end_day BETWEEN 1 AND 31),
  CONSTRAINT investor_participation_period_order_chk CHECK (period_end_day >= period_start_day),
  CONSTRAINT investor_participation_effective_window_chk
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT investor_participation_status_chk CHECK (status IN ('active','inactive')),
  CONSTRAINT investor_participation_version_unik UNIQUE (usaha_id, investor_id, effective_from)
);

CREATE INDEX IF NOT EXISTS investor_auth_usaha_idx
  ON public.investor (auth_user_id, usaha_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS investor_usaha_status_idx
  ON public.investor (usaha_id, status);
CREATE INDEX IF NOT EXISTS investor_participation_usaha_period_idx
  ON public.investor_participation (usaha_id, investor_id, effective_from DESC, effective_until)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS investor_participation_effective_lookup_idx
  ON public.investor_participation (usaha_id, investor_id, effective_from, effective_until)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS investor_updated_at ON public.investor;
CREATE TRIGGER investor_updated_at
BEFORE UPDATE ON public.investor
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DROP TRIGGER IF EXISTS investor_participation_updated_at ON public.investor_participation;
CREATE TRIGGER investor_participation_updated_at
BEFORE UPDATE ON public.investor_participation
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE OR REPLACE FUNCTION app_private.validate_investor_participation_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_overlap boolean;
BEGIN
  IF NEW.effective_from <>
     (date_trunc('month', NEW.effective_from)::date + (NEW.period_start_day - 1)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: effective_from harus tepat pada awal periode konfigurasi'
      USING ERRCODE='22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.investor_participation p
    WHERE p.usaha_id = NEW.usaha_id
      AND p.investor_id = NEW.investor_id
      AND p.participation_id <> NEW.participation_id
      AND p.status = 'active'
      AND daterange(p.effective_from, p.effective_until, '[)')
          && daterange(NEW.effective_from, NEW.effective_until, '[)')
  ) INTO v_overlap;

  IF v_overlap THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode participation investor bertumpang tindih'
      USING ERRCODE='23P01';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS investor_participation_validate_window ON public.investor_participation;
CREATE TRIGGER investor_participation_validate_window
BEFORE INSERT OR UPDATE ON public.investor_participation
FOR EACH ROW EXECUTE FUNCTION app_private.validate_investor_participation_window();

ALTER TABLE public.investor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_participation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investor_select_authorized ON public.investor;
CREATE POLICY investor_select_authorized
ON public.investor
FOR SELECT TO authenticated
USING (
  (
    investor.auth_user_id = (SELECT auth.uid())
    AND investor.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = investor.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = (SELECT auth.uid())
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS investor_participation_select_authorized ON public.investor_participation;
CREATE POLICY investor_participation_select_authorized
ON public.investor_participation
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.investor i
    WHERE i.investor_id = investor_participation.investor_id
      AND i.usaha_id = investor_participation.usaha_id
      AND i.auth_user_id = (SELECT auth.uid())
      AND i.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = investor_participation.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = (SELECT auth.uid())
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
  )
);

REVOKE ALL ON TABLE public.investor FROM anon;
REVOKE ALL ON TABLE public.investor_participation FROM anon;
GRANT SELECT ON TABLE public.investor TO authenticated;
GRANT SELECT ON TABLE public.investor_participation TO authenticated;

CREATE OR REPLACE FUNCTION app_private.assert_investor_admin(p_usaha_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  JOIN public.usaha u
    ON u.usaha_id = p_usaha_id
   AND u.status = 'active'
  WHERE aa.auth_user_id = auth.uid()
    AND aa.status = 'active'
    AND aa.role = 'super_admin';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses investor pada usaha'
      USING ERRCODE='42501';
  END IF;

  RETURN v_admin_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.assert_investor_read_access(p_usaha_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id = p_usaha_id
      AND i.auth_user_id = auth.uid()
      AND i.status = 'active'
  ) THEN
    RETURN 'investor';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = p_usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    JOIN public.usaha u
      ON u.usaha_id = p_usaha_id
     AND u.status = 'active'
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
  ) THEN
    RETURN 'admin';
  END IF;

  RAISE EXCEPTION 'AUTHORIZATION_ERROR: principal tidak memiliki akses investor pada usaha'
    USING ERRCODE='42501';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.investor_period_for_date(
  p_as_of_date date,
  p_period_start_day smallint,
  p_period_end_day smallint
)
RETURNS TABLE(period_start date, period_end_exclusive date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_month_start date;
  v_last_day date;
  v_candidate_start date;
  v_candidate_end_inclusive date;
BEGIN
  IF p_as_of_date IS NULL
     OR p_period_start_day NOT BETWEEN 1 AND 31
     OR p_period_end_day < p_period_start_day
     OR p_period_end_day > 31 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: parameter periode investor tidak valid'
      USING ERRCODE='22023';
  END IF;

  v_month_start := date_trunc('month', p_as_of_date)::date;
  v_last_day := (date_trunc('month', v_month_start + interval '1 month') - interval '1 day')::date;
  v_candidate_start := least(v_month_start + (p_period_start_day - 1), v_last_day);
  v_candidate_end_inclusive := least(v_month_start + (p_period_end_day - 1), v_last_day);

  IF p_as_of_date < v_candidate_start THEN
    v_month_start := (v_month_start - interval '1 month')::date;
    v_last_day := (date_trunc('month', v_month_start + interval '1 month') - interval '1 day')::date;
    v_candidate_start := least(v_month_start + (p_period_start_day - 1), v_last_day);
    v_candidate_end_inclusive := least(v_month_start + (p_period_end_day - 1), v_last_day);
  END IF;

  period_start := v_candidate_start;
  period_end_exclusive := v_candidate_end_inclusive + 1;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.resolve_investor_participation(
  p_usaha_id uuid,
  p_investor_id uuid,
  p_period_start date
)
RETURNS public.investor_participation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.investor_participation;
BEGIN
  SELECT p.* INTO v_row
  FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id
    AND p.investor_id = p_investor_id
    AND p.status = 'active'
    AND p.effective_from <= p_period_start
    AND (p.effective_until IS NULL OR p.effective_until > p_period_start)
  ORDER BY p.effective_from DESC
  LIMIT 1;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.calculate_investor_period(
  p_usaha_id uuid,
  p_investor_id uuid,
  p_period_start date,
  p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_participation public.investor_participation;
  v_timezone text;
  v_income numeric := 0;
  v_expense numeric := 0;
  v_net numeric := 0;
  v_entitlement numeric := 0;
  v_currency_count integer := 0;
  v_currencies jsonb := '[]'::jsonb;
  v_transaction_count integer := 0;
BEGIN
  IF p_period_start IS NULL OR p_period_end_exclusive IS NULL OR p_period_end_exclusive <= p_period_start THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode investor tidak valid' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_participation := app_private.resolve_investor_participation(
    p_usaha_id, p_investor_id, p_period_start
  );

  IF v_participation.participation_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG_REQUIRED: belum ada konfigurasi investor aktif untuk periode tersebut'
      USING ERRCODE='55000';
  END IF;

  SELECT
    count(DISTINCT t.currency_code),
    coalesce(jsonb_agg(DISTINCT t.currency_code), '[]'::jsonb),
    coalesce(sum(CASE WHEN t.arah = 'income' THEN t.amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN t.arah = 'expense' THEN t.amount ELSE 0 END), 0),
    count(*)
  INTO v_currency_count, v_currencies, v_income, v_expense, v_transaction_count
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id = p_usaha_id
    AND t.status = 'recorded'
    AND t.tanggal_transaksi >= (p_period_start::text || ' 00:00:00 ' || v_timezone)::timestamptz
    AND t.tanggal_transaksi < (p_period_end_exclusive::text || ' 00:00:00 ' || v_timezone)::timestamptz
    AND t.arah IN ('income','expense');

  v_net := v_income - v_expense;

  IF v_currency_count <> 1 THEN
    v_entitlement := NULL;
  ELSE
    v_entitlement := round(v_net * (v_participation.percentage / 100.0), 2);
  END IF;

  RETURN jsonb_build_object(
    'usaha_id', p_usaha_id,
    'investor_id', p_investor_id,
    'participation_id', v_participation.participation_id,
    'period', jsonb_build_object(
      'start', p_period_start,
      'end_exclusive', p_period_end_exclusive,
      'timezone', v_timezone
    ),
    'basis_type', v_participation.basis_type,
    'percentage', v_participation.percentage,
    'income_recorded', round(v_income, 2),
    'expense_recorded', round(v_expense, 2),
    'net_operational_result', round(v_net, 2),
    'investor_entitlement', v_entitlement,
    'operator_remainder',
      CASE WHEN v_entitlement IS NULL THEN NULL
           ELSE round(v_net - v_entitlement, 2) END,
    'transaction_count', v_transaction_count,
    'currency_count', v_currency_count,
    'currencies', v_currencies,
    'allocation_status',
      CASE WHEN v_currency_count = 0 THEN 'NO_FINANCIAL_ACTIVITY'
           WHEN v_currency_count = 1 THEN 'CALCULATED'
           ELSE 'MULTI_CURRENCY_REVIEW_REQUIRED' END,
    'calculated_at', clock_timestamp()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_id_for_principal(p_usaha_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_investor_id uuid;
BEGIN
  SELECT i.investor_id INTO v_investor_id
  FROM public.investor i
  WHERE i.usaha_id = p_usaha_id
    AND i.auth_user_id = auth.uid()
    AND i.status = 'active'
  LIMIT 1;

  IF v_investor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: principal tidak memiliki investor aktif pada usaha tersebut'
      USING ERRCODE='P0002';
  END IF;

  RETURN v_investor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_overview(
  p_usaha_id uuid,
  p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_participation public.investor_participation;
  v_period_start date;
  v_period_end_exclusive date;
  v_calc jsonb;
  v_timezone text;
  v_last_finance_event timestamptz;
  v_investor_name text;
BEGIN
  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT i.investor_id, i.nama_tampilan
      INTO v_investor_id, v_investor_name
    FROM public.investor i
    WHERE i.usaha_id = p_usaha_id AND i.status = 'active'
    ORDER BY i.created_at
    LIMIT 1;

    IF v_investor_id IS NULL THEN
      RETURN jsonb_build_object(
        'status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id,
        'principal',v_access,'timezone',v_timezone,
        'calculated_at',clock_timestamp()
      );
    END IF;
  END IF;

  SELECT p.* INTO v_participation
  FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id
    AND p.investor_id = v_investor_id
    AND p.status = 'active'
    AND p.effective_from <= p_as_of_date
    AND (p.effective_until IS NULL OR p.effective_until > p_as_of_date)
  ORDER BY p.effective_from DESC
  LIMIT 1;

  IF v_participation.participation_id IS NULL THEN
    RETURN jsonb_build_object(
      'status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id,
      'investor_id',v_investor_id,'principal',v_access,
      'timezone',v_timezone,'calculated_at',clock_timestamp()
    );
  END IF;

  SELECT period_start, period_end_exclusive INTO v_period_start, v_period_end_exclusive
  FROM app_private.investor_period_for_date(
    p_as_of_date, v_participation.period_start_day, v_participation.period_end_day
  );

  v_calc := app_private.calculate_investor_period(
    p_usaha_id, v_investor_id, v_period_start, v_period_end_exclusive
  );

  SELECT max(t.updated_at) INTO v_last_finance_event
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id = p_usaha_id
    AND t.tanggal_transaksi >= (v_period_start::text || ' 00:00:00 ' || v_timezone)::timestamptz
    AND t.tanggal_transaksi < (v_period_end_exclusive::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  RETURN v_calc
    || jsonb_build_object(
      'status','OK',
      'investor_name',coalesce(
        v_investor_name,
        (SELECT i.nama_tampilan FROM public.investor i WHERE i.investor_id = v_investor_id)
      ),
      'principal',v_access,
      'finance_last_changed_at',v_last_finance_event,
      'freshness','DIRECT_FRESH'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_period_result(
  p_usaha_id uuid,
  p_period_start date,
  p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT i.investor_id INTO v_investor_id
    FROM public.investor i
    WHERE i.usaha_id = p_usaha_id AND i.status = 'active'
    ORDER BY i.created_at
    LIMIT 1;
  END IF;

  IF v_investor_id IS NULL THEN
    RETURN jsonb_build_object(
      'status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id,
      'period',jsonb_build_object('start',p_period_start,'end_exclusive',p_period_end_exclusive)
    );
  END IF;

  RETURN app_private.calculate_investor_period(
    p_usaha_id, v_investor_id, p_period_start, p_period_end_exclusive
  ) || jsonb_build_object('principal',v_access);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_participation_history(
  p_usaha_id uuid,
  p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_target_investor uuid;
  v_items jsonb;
BEGIN
  IF v_access = 'investor' THEN
    v_target_investor := app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    v_target_investor := coalesce(
      p_investor_id,
      (SELECT i.investor_id FROM public.investor i
       WHERE i.usaha_id = p_usaha_id AND i.status = 'active'
       ORDER BY i.created_at LIMIT 1)
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'participation_id',p.participation_id,
        'investor_id',p.investor_id,
        'percentage',p.percentage,
        'basis_type',p.basis_type,
        'period_start_day',p.period_start_day,
        'period_end_day',p.period_end_day,
        'effective_from',p.effective_from,
        'effective_until',p.effective_until,
        'status',p.status,
        'updated_at',p.updated_at
      ) ORDER BY p.effective_from DESC
    ), '[]'::jsonb
  ) INTO v_items
  FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id
    AND (v_target_investor IS NULL OR p.investor_id = v_target_investor);

  RETURN jsonb_build_object(
    'principal',v_access,'investor_id',v_target_investor,'items',v_items
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_activity(
  p_usaha_id uuid,
  p_period_start date,
  p_period_end_exclusive date,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_timezone text;
  v_participation public.investor_participation;
  v_items jsonb;
  v_total integer := 0;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT i.investor_id INTO v_investor_id
    FROM public.investor i
    WHERE i.usaha_id = p_usaha_id AND i.status = 'active'
    ORDER BY i.created_at
    LIMIT 1;
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';

  v_participation := app_private.resolve_investor_participation(
    p_usaha_id, v_investor_id, p_period_start
  );

  IF v_participation.participation_id IS NULL THEN
    RETURN jsonb_build_object('status','NO_INVESTOR_CONFIG','items','[]'::jsonb,'total',0);
  END IF;

  p_limit := least(greatest(coalesce(p_limit,50),1),200);
  p_offset := greatest(coalesce(p_offset,0),0);

  SELECT count(*) INTO v_total
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id = p_usaha_id AND t.status = 'recorded'
    AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi >= (p_period_start::text || ' 00:00:00 ' || v_timezone)::timestamptz
    AND t.tanggal_transaksi < (p_period_end_exclusive::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'transaksi_keuangan_id',t.transaksi_keuangan_id,
        'nomor_transaksi',t.nomor_transaksi,
        'occurred_at',t.tanggal_transaksi,
        'direction',t.arah,
        'amount',round(CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END,2),
        'investor_impact',round(
          (CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END)
          * (v_participation.percentage / 100.0),2
        ),
        'currency_code',t.currency_code,
        'source_type',t.sumber_type,
        'expense_category',e.kategori_biaya,
        'activity_reason',
          CASE WHEN t.arah='income' THEN 'Pemasukan menambah hasil bersih'
               ELSE 'Pengeluaran mengurangi hasil bersih' END
      ) ORDER BY t.tanggal_transaksi DESC, t.transaksi_keuangan_id DESC
    ), '[]'::jsonb
  ) INTO v_items
  FROM (
    SELECT t.*
    FROM public.transaksi_keuangan t
    WHERE t.usaha_id = p_usaha_id AND t.status = 'recorded'
      AND t.arah IN ('income','expense')
      AND t.tanggal_transaksi >= (p_period_start::text || ' 00:00:00 ' || v_timezone)::timestamptz
      AND t.tanggal_transaksi < (p_period_end_exclusive::text || ' 00:00:00 ' || v_timezone)::timestamptz
    ORDER BY t.tanggal_transaksi DESC, t.transaksi_keuangan_id DESC
    LIMIT p_limit OFFSET p_offset
  ) t
  LEFT JOIN public.pengeluaran e
    ON e.usaha_id = t.usaha_id
   AND e.transaksi_keuangan_id = t.transaksi_keuangan_id;

  RETURN jsonb_build_object(
    'status','OK','principal',v_access,'investor_id',v_investor_id,
    'period',jsonb_build_object('start',p_period_start,'end_exclusive',p_period_end_exclusive,'timezone',v_timezone),
    'percentage',v_participation.percentage,'items',v_items,
    'total',v_total,'limit',p_limit,'offset',p_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_overlap_count integer := 0;
  v_investor_without_config integer := 0;
  v_multi_currency_count integer := 0;
BEGIN
  WITH ordered AS (
    SELECT
      p.*,
      lead(p.effective_from) OVER (
        PARTITION BY p.usaha_id,p.investor_id
        ORDER BY p.effective_from
      ) AS next_effective_from
    FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id
  )
  SELECT count(*) INTO v_overlap_count
  FROM ordered
  WHERE effective_until IS NOT NULL
    AND next_effective_from IS NOT NULL
    AND next_effective_from < effective_until;

  SELECT count(*) INTO v_investor_without_config
  FROM public.investor i
  WHERE i.usaha_id = p_usaha_id
    AND i.status='active'
    AND NOT EXISTS (
      SELECT 1 FROM public.investor_participation p
      WHERE p.usaha_id=i.usaha_id AND p.investor_id=i.investor_id AND p.status='active'
    );

  SELECT count(DISTINCT t.currency_code)
    INTO v_multi_currency_count
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id = p_usaha_id
    AND t.status='recorded'
    AND t.arah IN ('income','expense');

  RETURN jsonb_build_object(
    'status',
      CASE WHEN v_overlap_count > 0 OR v_investor_without_config > 0 OR v_multi_currency_count > 1 THEN 'ATTENTION'
           ELSE 'HEALTHY' END,
    'checked_by_admin_id',v_admin_id,
    'overlap_count',v_overlap_count,
    'active_investor_without_config',v_investor_without_config,
    'currency_count',v_multi_currency_count,
    'principles',jsonb_build_array(
      'Finance remains source of truth',
      'Investor result is derived server-side',
      'Historical participation is effective-dated',
      'Cross-tenant access is denied'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_investor(
  p_usaha_id uuid,
  p_auth_user_id uuid,
  p_nama_tampilan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_auth_user_id uuid := auth.uid();
  v_request_hash text;
  v_existing_response jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_investor_id uuid := gen_random_uuid();
  v_response jsonb;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: auth_user_id wajib diisi' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_auth_user_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: auth user investor tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF nullif(btrim(p_nama_tampilan),'') IS NULL OR length(btrim(p_nama_tampilan)) > 200 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama investor wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'auth_user_id',p_auth_user_id,'nama_tampilan',btrim(p_nama_tampilan)
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_investor',v_request_hash
  )
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_investor' AND key=btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id=p_usaha_id AND i.auth_user_id=p_auth_user_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: auth user sudah terhubung dengan investor pada usaha'
      USING ERRCODE='23505';
  END IF;

  INSERT INTO public.investor(investor_id,usaha_id,auth_user_id,nama_tampilan,status)
  VALUES(v_investor_id,p_usaha_id,p_auth_user_id,btrim(p_nama_tampilan),'active');

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'create_investor','investor',v_investor_id,
    'admin-command',p_request_id,
    jsonb_build_object('investor_id',v_investor_id,'auth_user_id',p_auth_user_id)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.created','investor',v_investor_id,
    jsonb_build_object('investor_id',v_investor_id,'auth_user_id',p_auth_user_id)
  );

  v_response:=jsonb_build_object(
    'investor_id',v_investor_id,'usaha_id',p_usaha_id,
    'auth_user_id',p_auth_user_id,'status','active'
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_investor_status(
  p_usaha_id uuid,
  p_investor_id uuid,
  p_status text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_auth_user_id uuid := auth.uid();
  v_request_hash text;
  v_existing_response jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_response jsonb;
BEGIN
  IF v_status NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status investor tidak didukung' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'investor_id',p_investor_id,'status',v_status
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'set_investor_status',v_request_hash
  )
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='set_investor_status' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  UPDATE public.investor
  SET status=v_status
  WHERE usaha_id=p_usaha_id AND investor_id=p_investor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: investor tidak ditemukan pada usaha' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'set_investor_status','investor',p_investor_id,
    'admin-command',p_request_id,jsonb_build_object('status_after',v_status)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.status_changed','investor',p_investor_id,
    jsonb_build_object('status',v_status)
  );

  v_response:=jsonb_build_object('investor_id',p_investor_id,'status',v_status);
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_investor_participation(
  p_usaha_id uuid,
  p_investor_id uuid,
  p_percentage numeric,
  p_period_start_day smallint,
  p_period_end_day smallint,
  p_effective_from date,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_auth_user_id uuid := auth.uid();
  v_request_hash text;
  v_existing_response jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_participation_id uuid := gen_random_uuid();
  v_previous public.investor_participation;
  v_response jsonb;
BEGIN
  IF p_percentage IS NULL OR p_percentage < 0 OR p_percentage > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: persentase investor harus 0-100' USING ERRCODE='22023';
  END IF;
  IF p_period_start_day IS NULL OR p_period_start_day < 1 OR p_period_start_day > 31
     OR p_period_end_day IS NULL OR p_period_end_day < p_period_start_day
     OR p_period_end_day > 31 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rentang periode 1-31 tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: effective_from wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_effective_from <>
     (date_trunc('month',p_effective_from)::date + (p_period_start_day - 1)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: effective_from harus tepat pada hari mulai periode'
      USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id=p_usaha_id AND i.investor_id=p_investor_id AND i.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: investor aktif tidak ditemukan pada usaha' USING ERRCODE='P0002';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'investor_id',p_investor_id,
    'percentage',p_percentage,'period_start_day',p_period_start_day,
    'period_end_day',p_period_end_day,'effective_from',p_effective_from
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'set_investor_participation',v_request_hash
  )
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='set_investor_participation' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':' || p_investor_id::text,0)
  );

  SELECT p.* INTO v_previous
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id AND p.status='active'
  ORDER BY p.effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF v_previous.participation_id IS NOT NULL AND p_effective_from <= v_previous.effective_from THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: konfigurasi baru harus efektif setelah konfigurasi terakhir'
      USING ERRCODE='23505';
  END IF;

  IF v_previous.participation_id IS NOT NULL THEN
    UPDATE public.investor_participation
    SET effective_until=p_effective_from
    WHERE participation_id=v_previous.participation_id;
  END IF;

  INSERT INTO public.investor_participation(
    participation_id,usaha_id,investor_id,percentage,basis_type,
    period_start_day,period_end_day,effective_from,status
  ) VALUES(
    v_participation_id,p_usaha_id,p_investor_id,p_percentage,
    'net_operational_result',p_period_start_day,p_period_end_day,p_effective_from,'active'
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'set_investor_participation',
    'investor_participation',v_participation_id,'admin-command',p_request_id,
    jsonb_build_object(
      'investor_id',p_investor_id,'percentage',p_percentage,
      'period_start_day',p_period_start_day,'period_end_day',p_period_end_day,
      'effective_from',p_effective_from,
      'superseded_participation_id',v_previous.participation_id
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES(
    p_usaha_id,'investor.participation_changed','investor_participation',v_participation_id,
    jsonb_build_object(
      'investor_id',p_investor_id,'participation_id',v_participation_id,
      'percentage',p_percentage,'period_start_day',p_period_start_day,
      'period_end_day',p_period_end_day,'effective_from',p_effective_from,
      'superseded_participation_id',v_previous.participation_id
    )
  );

  v_response:=jsonb_build_object(
    'participation_id',v_participation_id,'investor_id',p_investor_id,
    'percentage',p_percentage,'basis_type','net_operational_result',
    'period_start_day',p_period_start_day,'period_end_day',p_period_end_day,
    'effective_from',p_effective_from,'effective_until',NULL
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_investor_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid := COALESCE(NEW.usaha_id, OLD.usaha_id);
  v_event_type text;
  v_aggregate_id uuid;
BEGIN
  IF v_usaha_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_aggregate_id :=
    CASE TG_TABLE_NAME
      WHEN 'transaksi_keuangan' THEN COALESCE(NEW.transaksi_keuangan_id, OLD.transaksi_keuangan_id)
      WHEN 'investor' THEN COALESCE(NEW.investor_id, OLD.investor_id)
      WHEN 'investor_participation' THEN COALESCE(NEW.participation_id, OLD.participation_id)
      ELSE NULL
    END;

  v_event_type :=
    CASE TG_TABLE_NAME
      WHEN 'transaksi_keuangan' THEN 'finance.changed'
      WHEN 'investor' THEN 'investor.changed'
      WHEN 'investor_participation' THEN 'investor.config.changed'
      ELSE 'investor.changed'
    END;

  PERFORM realtime.send(
    jsonb_build_object(
      'event_id', gen_random_uuid(),
      'aggregate_id', v_aggregate_id,
      'occurred_at', clock_timestamp()
    ),
    v_event_type,
    'finance:usaha:' || v_usaha_id::text,
    true
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS transaksi_keuangan_investor_realtime ON public.transaksi_keuangan;
CREATE TRIGGER transaksi_keuangan_investor_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.transaksi_keuangan
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_realtime_broadcast ON public.investor;
CREATE TRIGGER investor_realtime_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.investor
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_participation_realtime_broadcast ON public.investor_participation;
CREATE TRIGGER investor_participation_realtime_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.investor_participation
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP POLICY IF EXISTS investor_finance_realtime_receive ON realtime.messages;
CREATE POLICY investor_finance_realtime_receive
ON realtime.messages
FOR SELECT TO authenticated
USING (
  (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.investor i
      WHERE i.auth_user_id = (SELECT auth.uid())
        AND i.usaha_id = split_part((SELECT realtime.topic()), ':', 3)::uuid
        AND i.status = 'active'
    )
  )
  OR
  (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.akun_admin aa
      JOIN public.keanggotaan_usaha ku
        ON ku.akun_admin_id = aa.akun_admin_id
       AND ku.usaha_id = split_part((SELECT realtime.topic()), ':', 3)::uuid
       AND ku.status = 'active'
       AND ku.revoked_at IS NULL
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active'
        AND aa.role = 'super_admin'
    )
  )
);

REVOKE ALL ON FUNCTION app_private.assert_investor_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.assert_investor_read_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.investor_period_for_date(date,smallint,smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.resolve_investor_participation(uuid,uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.calculate_investor_period(uuid,uuid,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_id_for_principal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_overview(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_period_result(uuid,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_participation_history(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_activity(uuid,date,date,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.investor_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_create_investor(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_set_investor_status(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_set_investor_participation(uuid,uuid,numeric,smallint,smallint,date,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_investor_overview(
  p_usaha_id uuid, p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_overview($1,$2);
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_period_result(
  p_usaha_id uuid, p_period_start date, p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_period_result($1,$2,$3);
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_participation_history(
  p_usaha_id uuid, p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_participation_history($1,$2);
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_activity(
  p_usaha_id uuid, p_period_start date, p_period_end_exclusive date,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_activity($1,$2,$3,$4,$5);
$function$;

CREATE OR REPLACE FUNCTION public.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.investor_reconciliation($1);
$function$;

CREATE OR REPLACE FUNCTION public.command_create_investor(
  p_usaha_id uuid, p_auth_user_id uuid, p_nama_tampilan text,
  p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_create_investor($1,$2,$3,$4,$5);
$function$;

CREATE OR REPLACE FUNCTION public.command_set_investor_status(
  p_usaha_id uuid, p_investor_id uuid, p_status text,
  p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_set_investor_status($1,$2,$3,$4,$5);
$function$;

CREATE OR REPLACE FUNCTION public.command_set_investor_participation(
  p_usaha_id uuid, p_investor_id uuid, p_percentage numeric,
  p_period_start_day smallint, p_period_end_day smallint, p_effective_from date,
  p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_set_investor_participation($1,$2,$3,$4,$5,$6,$7,$8);
$function$;

REVOKE ALL ON FUNCTION public.get_investor_overview(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_investor_period_result(uuid,date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_investor_participation_history(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_investor_activity(uuid,date,date,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.investor_reconciliation(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_investor_overview(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_period_result(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_participation_history(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_activity(uuid,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.investor_reconciliation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.command_create_investor(uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.command_set_investor_status(uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.command_set_investor_participation(uuid,uuid,numeric,smallint,smallint,date,text,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.command_create_investor(uuid,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_investor_status(uuid,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_investor_participation(uuid,uuid,numeric,smallint,smallint,date,text,uuid) TO authenticated;
