-- Investor/Finance consistency hardening (non-destructive).
-- Keeps business rules unchanged: result-based allocation, actual cash reserve,
-- and allocation are separate from cash distribution.

-- RLS does not protect TRUNCATE. Keep authenticated read access for existing
-- finance detail screens, but remove broad table-level DDL/administrative rights.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.akun_keuangan FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pergerakan_akun_keuangan FROM anon, authenticated;
REVOKE ALL ON TABLE public.akun_keuangan FROM anon;
REVOKE ALL ON TABLE public.pergerakan_akun_keuangan FROM anon;

-- Preserve the role metadata in the finance account summary so the UI can
-- separate operational money from investor/operator holding balances.
CREATE OR REPLACE FUNCTION app_private.finance_account_summary(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_items jsonb;
  v_total_balance numeric;
  v_total_opening numeric;
  v_total_in numeric;
  v_total_out numeric;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'akun_keuangan_id', x.akun_keuangan_id,
        'kode_akun', x.kode_akun,
        'nama_akun', x.nama_akun,
        'jenis_akun', x.jenis_akun,
        'mata_uang', x.mata_uang,
        'status', x.status,
        'fungsi_akun', x.fungsi_akun,
        'investor_id', x.investor_id,
        'pengelola_akun_admin_id', x.pengelola_akun_admin_id,
        'saldo_awal', x.saldo_awal,
        'uang_masuk', x.uang_masuk,
        'uang_keluar', x.uang_keluar,
        'saldo', x.saldo,
        'tanggal_saldo_awal', x.tanggal_saldo_awal
      ) ORDER BY x.status DESC, x.nama_akun
    ), '[]'::jsonb),
    coalesce(sum(x.saldo) FILTER (WHERE x.fungsi_akun='operasional'), 0),
    coalesce(sum(x.saldo_awal) FILTER (WHERE x.fungsi_akun='operasional'), 0),
    coalesce(sum(x.uang_masuk) FILTER (WHERE x.fungsi_akun='operasional'), 0),
    coalesce(sum(x.uang_keluar) FILTER (WHERE x.fungsi_akun='operasional'), 0)
  INTO v_items, v_total_balance, v_total_opening, v_total_in, v_total_out
  FROM (
    SELECT
      a.akun_keuangan_id, a.kode_akun, a.nama_akun, a.jenis_akun,
      a.mata_uang, a.status, a.fungsi_akun, a.investor_id,
      a.pengelola_akun_admin_id,
      coalesce(max(o.nominal), 0) AS saldo_awal,
      coalesce(sum(m.amount) FILTER (WHERE m.status='recorded' AND m.arah='masuk'), 0) AS uang_masuk,
      coalesce(sum(m.amount) FILTER (WHERE m.status='recorded' AND m.arah='keluar'), 0) AS uang_keluar,
      coalesce(max(o.nominal), 0)
        + coalesce(sum(m.amount) FILTER (WHERE m.status='recorded' AND m.arah='masuk'), 0)
        - coalesce(sum(m.amount) FILTER (WHERE m.status='recorded' AND m.arah='keluar'), 0) AS saldo,
      max(o.tanggal_saldo_awal) AS tanggal_saldo_awal
    FROM public.akun_keuangan a
    LEFT JOIN public.saldo_awal_akun_keuangan o
      ON o.usaha_id=a.usaha_id AND o.akun_keuangan_id=a.akun_keuangan_id
    LEFT JOIN public.pergerakan_akun_keuangan m
      ON m.usaha_id=a.usaha_id AND m.akun_keuangan_id=a.akun_keuangan_id
    WHERE a.usaha_id=p_usaha_id
    GROUP BY a.akun_keuangan_id, a.kode_akun, a.nama_akun, a.jenis_akun,
      a.mata_uang, a.status, a.fungsi_akun, a.investor_id, a.pengelola_akun_admin_id
  ) x;

  RETURN jsonb_build_object(
    'accounts', v_items,
    'totals', jsonb_build_object(
      'saldo', v_total_balance,
      'saldo_awal', v_total_opening,
      'uang_masuk', v_total_in,
      'uang_keluar', v_total_out
    )
  );
END;
$function$;

-- First-time configuration must offer an explicit pengelola principal instead
-- of disabling Save forever when no participation configuration exists yet.
CREATE OR REPLACE FUNCTION app_private.get_investor_admin_operators(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_items jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'akun_admin_id', aa.akun_admin_id,
    'nama_tampilan', aa.nama_tampilan,
    'role', aa.role
  ) ORDER BY aa.nama_tampilan, aa.akun_admin_id), '[]'::jsonb)
  INTO v_items
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.status='active';

  RETURN jsonb_build_object('status','OK','operators',v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_admin_operators(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_admin_operators($1);
$function$;

REVOKE ALL ON FUNCTION app_private.get_investor_admin_operators(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_admin_operators(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_investor_admin_operators(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_admin_operators(uuid) TO authenticated;

-- Authorized settlement view. Admins see all stakeholder ledgers; an investor
-- sees only their own investor account and allocations. All balances are derived
-- from opening balance + recorded movement truth, not cached display data.
CREATE OR REPLACE FUNCTION app_private.get_investor_stakeholder_accounts(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_items jsonb;
  v_investor_allocations jsonb;
  v_operator_allocations jsonb;
BEGIN
  IF v_access='investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'akun_keuangan_id', a.akun_keuangan_id,
    'nama_akun', a.nama_akun,
    'fungsi_akun', a.fungsi_akun,
    'investor_id', a.investor_id,
    'pengelola_akun_admin_id', a.pengelola_akun_admin_id,
    'mata_uang', a.mata_uang,
    'saldo', round(
      coalesce((
        SELECT max(o.nominal)
        FROM public.saldo_awal_akun_keuangan o
        WHERE o.usaha_id=a.usaha_id AND o.akun_keuangan_id=a.akun_keuangan_id
      ),0)
      + coalesce((
        SELECT sum(CASE WHEN m.arah='masuk' THEN m.amount ELSE -m.amount END)
        FROM public.pergerakan_akun_keuangan m
        WHERE m.usaha_id=a.usaha_id
          AND m.akun_keuangan_id=a.akun_keuangan_id
          AND m.status='recorded'
      ),0),2)
  ) ORDER BY a.fungsi_akun, a.nama_akun), '[]'::jsonb)
  INTO v_items
  FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id
    AND a.status='active'
    AND a.fungsi_akun IN ('investor','pengelola')
    AND (
      v_access='admin'
      OR (v_access='investor' AND a.fungsi_akun='investor' AND a.investor_id=v_investor_id)
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', a.allocation_id,
    'investor_id', a.investor_id,
    'period_start', p.period_start,
    'period_end_exclusive', p.period_end_exclusive,
    'currency_code', a.currency_code,
    'allocation_amount', a.allocation_amount,
    'distributed_amount', a.distributed_amount,
    'remaining_amount', round(a.allocation_amount-a.distributed_amount,2),
    'status', a.status
  ) ORDER BY p.period_start DESC), '[]'::jsonb)
  INTO v_investor_allocations
  FROM public.investor_period_allocation a
  JOIN public.investor_finance_period p
    ON p.period_id=a.period_id AND p.usaha_id=a.usaha_id
  WHERE a.usaha_id=p_usaha_id
    AND a.allocation_amount>a.distributed_amount
    AND (v_access='admin' OR (v_access='investor' AND a.investor_id=v_investor_id));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', a.allocation_id,
    'pengelola_akun_admin_id', a.pengelola_akun_admin_id,
    'period_start', p.period_start,
    'period_end_exclusive', p.period_end_exclusive,
    'currency_code', a.currency_code,
    'allocation_amount', a.allocation_amount,
    'distributed_amount', a.distributed_amount,
    'remaining_amount', round(a.allocation_amount-a.distributed_amount,2),
    'status', a.status
  ) ORDER BY p.period_start DESC), '[]'::jsonb)
  INTO v_operator_allocations
  FROM public.operator_period_allocation a
  JOIN public.investor_finance_period p
    ON p.period_id=a.period_id AND p.usaha_id=a.usaha_id
  WHERE a.usaha_id=p_usaha_id
    AND a.allocation_amount>a.distributed_amount
    AND v_access='admin';

  RETURN jsonb_build_object(
    'status','OK',
    'accounts',v_items,
    'investor_allocations',v_investor_allocations,
    'operator_allocations',v_operator_allocations
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_stakeholder_accounts(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_stakeholder_accounts($1);
$function$;

REVOKE ALL ON FUNCTION app_private.get_investor_stakeholder_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_stakeholder_accounts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_investor_stakeholder_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_stakeholder_accounts(uuid) TO authenticated;

-- Prevent reclassification of an account with balance/history. Keep the
-- public RPC wrapper SECURITY INVOKER; the authorization and locking boundary
-- lives in this private SECURITY DEFINER command, consistent with Finance RPCs.
CREATE OR REPLACE FUNCTION app_private.command_set_finance_account_role_guarded(
  p_usaha_id uuid,
  p_akun_keuangan_id uuid,
  p_fungsi_akun text,
  p_investor_id uuid,
  p_pengelola_akun_admin_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_account public.akun_keuangan%rowtype;
BEGIN
  PERFORM app_private.assert_finance_admin(p_usaha_id);

  SELECT *
  INTO v_account
  FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id
    AND a.akun_keuangan_id=p_akun_keuangan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: akun keuangan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_account.fungsi_akun IS DISTINCT FROM p_fungsi_akun
     OR v_account.investor_id IS DISTINCT FROM p_investor_id
     OR v_account.pengelola_akun_admin_id IS DISTINCT FROM p_pengelola_akun_admin_id
  THEN
    IF EXISTS (
      SELECT 1
      FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id=p_usaha_id
        AND m.akun_keuangan_id=p_akun_keuangan_id
    ) OR EXISTS (
      SELECT 1
      FROM public.saldo_awal_akun_keuangan o
      WHERE o.usaha_id=p_usaha_id
        AND o.akun_keuangan_id=p_akun_keuangan_id
        AND o.nominal<>0
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun dengan saldo awal atau mutasi tercatat tidak dapat dialihfungsikan. Buat akun baru untuk pool tujuan.'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN app_private.command_set_finance_account_role(
    p_usaha_id,p_akun_keuangan_id,p_fungsi_akun,p_investor_id,
    p_pengelola_akun_admin_id,p_idempotency_key,p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_finance_account_role_guarded(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_set_finance_account_role_guarded(uuid,uuid,text,uuid,uuid,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.command_set_finance_account_role(
  p_usaha_id uuid,
  p_akun_keuangan_id uuid,
  p_fungsi_akun text,
  p_investor_id uuid,
  p_pengelola_akun_admin_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_finance_account_role_guarded($1,$2,$3,$4,$5,$6,$7);
$function$;

REVOKE ALL ON FUNCTION public.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) TO authenticated;

-- Repair overlapping effective windows independently per Investor. Do not
-- truncate another Investor's history: the choice between single- and multi-
-- Investor allocation per period remains a separate business decision.
DO $migration$
DECLARE
  v_window record;
BEGIN
  FOR v_window IN
    SELECT p.participation_id,
           p.effective_from,
           lead(p.effective_from) OVER (
             PARTITION BY p.usaha_id, p.investor_id
             ORDER BY p.effective_from, p.created_at, p.participation_id
           ) AS next_effective_from
    FROM public.investor_participation p
    WHERE p.status='active'
    ORDER BY p.usaha_id, p.effective_from, p.created_at, p.participation_id
  LOOP
    IF v_window.next_effective_from IS NOT NULL THEN
      UPDATE public.investor_participation p
      SET effective_until=v_window.next_effective_from
      WHERE p.participation_id=v_window.participation_id
        AND (
          p.effective_until IS NULL
          OR p.effective_until>v_window.next_effective_from
        );
    END IF;
  END LOOP;
END;
$migration$;

-- Preserve effective-dated history independently for each Investor. The
-- current close/read resolver has a separate cross-layer multi-Investor decision
-- gap; this migration does not silently impose a single-Investor business policy.

CREATE OR REPLACE FUNCTION app_private.close_investor_participation_windows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_next_effective date;
BEGIN
  -- Inactive rows are historical/admin records, not boundaries for the active
  -- period-close resolver. They must not truncate a current active window.
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  -- Serialize effective-window edits for this Investor, matching the config
  -- command's existing usaha+investor advisory-lock boundary.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.usaha_id::text || ':' || NEW.investor_id::text, 0)
  );

  UPDATE public.investor_participation p
  SET effective_until=NEW.effective_from
  WHERE p.usaha_id=NEW.usaha_id
    AND p.investor_id=NEW.investor_id
    AND p.participation_id<>NEW.participation_id
    AND p.status='active'
    AND p.effective_from<NEW.effective_from
    AND (p.effective_until IS NULL OR p.effective_until>NEW.effective_from);

  SELECT min(p.effective_from)
  INTO v_next_effective
  FROM public.investor_participation p
  WHERE p.usaha_id=NEW.usaha_id
    AND p.investor_id=NEW.investor_id
    AND p.participation_id<>NEW.participation_id
    AND p.status='active'
    AND p.effective_from>NEW.effective_from;

  UPDATE public.investor_participation p
  SET effective_until=v_next_effective
  WHERE p.participation_id=NEW.participation_id
    AND p.effective_until IS DISTINCT FROM v_next_effective;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS investor_participation_close_effective_windows ON public.investor_participation;
CREATE TRIGGER investor_participation_close_effective_windows
AFTER INSERT ON public.investor_participation
FOR EACH ROW
EXECUTE FUNCTION app_private.close_investor_participation_windows();

REVOKE ALL ON FUNCTION app_private.close_investor_participation_windows() FROM PUBLIC, anon, authenticated;


-- Prevent bypassing the guarded public role command through the exposed
-- app_private schema. Only the public SECURITY INVOKER wrapper is executable.
REVOKE ALL ON FUNCTION app_private.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;

-- Explicit investor selection is mandatory when multiple active principals exist.
-- Returning the earliest row silently misattributes the configuration screen.
CREATE OR REPLACE FUNCTION app_private.get_investor_admin_finance_config(
  p_usaha_id uuid,
  p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_investor_id uuid;
  v_active_count integer := 0;
  v_current jsonb;
  v_history jsonb;
BEGIN
  IF p_investor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.investor i
      WHERE i.usaha_id=p_usaha_id
        AND i.investor_id=p_investor_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: investor tidak ditemukan pada usaha'
        USING ERRCODE='P0002';
    END IF;
    v_investor_id := p_investor_id;
  ELSE
    SELECT count(*), (array_agg(i.investor_id ORDER BY i.created_at, i.investor_id))[1]
    INTO v_active_count, v_investor_id
    FROM public.investor i
    WHERE i.usaha_id=p_usaha_id
      AND i.status='active';

    IF v_active_count>1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: investor_id wajib dipilih secara eksplisit karena terdapat lebih dari satu Investor aktif'
        USING ERRCODE='22023';
    END IF;
    IF v_active_count=0 THEN
      v_investor_id := NULL;
    END IF;
  END IF;

  SELECT to_jsonb(row) INTO v_current
  FROM (
    SELECT
      p.participation_id,
      p.investor_id,
      p.percentage AS investor_percentage,
      p.operational_reserve_amount,
      p.pengelola_akun_admin_id,
      p.period_start_day,
      p.period_end_day,
      p.basis_type,
      p.effective_from,
      p.effective_until,
      p.status,
      p.updated_at
    FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id
      AND p.investor_id=v_investor_id
      AND p.status='active'
      AND p.effective_from<=CURRENT_DATE
      AND (p.effective_until IS NULL OR p.effective_until>CURRENT_DATE)
    ORDER BY p.effective_from DESC
    LIMIT 1
  ) row;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'participation_id', p.participation_id,
      'investor_id', p.investor_id,
      'investor_percentage', p.percentage,
      'operational_reserve_amount', p.operational_reserve_amount,
      'pengelola_akun_admin_id', p.pengelola_akun_admin_id,
      'period_start_day', p.period_start_day,
      'period_end_day', p.period_end_day,
      'basis_type', p.basis_type,
      'effective_from', p.effective_from,
      'effective_until', p.effective_until,
      'status', p.status,
      'updated_at', p.updated_at
    ) ORDER BY p.effective_from DESC),
    '[]'::jsonb
  ) INTO v_history
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id
    AND (v_investor_id IS NULL OR p.investor_id=v_investor_id);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_current IS NULL THEN 'NO_INVESTOR_CONFIG' ELSE 'OK' END,
    'principal', 'admin',
    'investor_id', v_investor_id,
    'current', v_current,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.get_investor_admin_finance_config(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_admin_finance_config(uuid,uuid) TO authenticated;
