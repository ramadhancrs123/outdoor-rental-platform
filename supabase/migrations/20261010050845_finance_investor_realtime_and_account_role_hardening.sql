-- Harden account-role reassignment at the trusted database boundary.
-- A role/owner change is allowed only for an account with no opening balance
-- and no cash-movement history. UI checks are only a convenience, not a guard.
-- The public command wrapper delegates through this guarded boundary. Harden
-- that actual path rather than the legacy internal command function directly.
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
  v_role text := lower(btrim(coalesce(p_fungsi_akun, '')));
BEGIN
  PERFORM app_private.assert_finance_admin(p_usaha_id);

  IF v_role NOT IN ('operasional', 'investor', 'pengelola') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: fungsi akun tidak didukung' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id
    AND a.akun_keuangan_id = p_akun_keuangan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: akun keuangan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_account.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya akun uang aktif yang dapat dikonfigurasi' USING ERRCODE = '23514';
  END IF;

  IF v_account.fungsi_akun IS DISTINCT FROM v_role
     OR v_account.investor_id IS DISTINCT FROM p_investor_id
     OR v_account.pengelola_akun_admin_id IS DISTINCT FROM p_pengelola_akun_admin_id
  THEN
    IF EXISTS (
      SELECT 1
      FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id = p_usaha_id
        AND m.akun_keuangan_id = p_akun_keuangan_id
    ) OR EXISTS (
      SELECT 1
      FROM public.saldo_awal_akun_keuangan o
      WHERE o.usaha_id = p_usaha_id
        AND o.akun_keuangan_id = p_akun_keuangan_id
        AND o.nominal <> 0
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun yang memiliki saldo awal atau mutasi tercatat tidak dapat dialihfungsikan. Buat akun baru untuk pool tujuan.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN app_private.command_set_finance_account_role(
    p_usaha_id, p_akun_keuangan_id, p_fungsi_akun, p_investor_id,
    p_pengelola_akun_admin_id, p_idempotency_key, p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_finance_account_role_guarded(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_set_finance_account_role_guarded(uuid,uuid,text,uuid,uuid,text,uuid) TO authenticated;

-- Trigger functions must not be callable as RPCs by application roles.
-- They run only through trusted table triggers inside the owning transaction.
-- Keep event journaling atomic with durable financial changes. Broadcast
-- delivery can fail transiently, but failure to persist the journal must not
-- be silently swallowed; otherwise financial truth changes with no replayable event.
CREATE OR REPLACE FUNCTION app_private.broadcast_investor_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_row_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_usaha_id uuid;
  v_event_id uuid := gen_random_uuid();
  v_event_seq bigint;
  v_type text;
  v_key text;
  v_aggregate_id uuid;
  v_payload jsonb;
BEGIN
  v_usaha_id := nullif(v_row ->> 'usaha_id', '')::uuid;

  v_type := CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN 'finance.changed'
    WHEN 'investor' THEN 'investor.changed'
    WHEN 'investor_participation' THEN 'investor.config.changed'
    WHEN 'akun_keuangan' THEN 'finance.account.changed'
    WHEN 'pergerakan_akun_keuangan' THEN 'finance.account.movement.changed'
    WHEN 'investor_finance_period' THEN 'investor.period.changed'
    WHEN 'investor_period_allocation' THEN 'investor.allocation.changed'
    WHEN 'operator_period_allocation' THEN 'investor.operator_allocation.changed'
    WHEN 'operator_period_withdrawal' THEN 'investor.operator_allocation.changed'
    WHEN 'investor_entitlement_transfer' THEN 'investor.allocation.changed'
    WHEN 'investor_stakeholder_payout' THEN 'investor.allocation.changed'
    ELSE 'investor.changed'
  END;

  v_key := CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN 'transaksi_keuangan_id'
    WHEN 'investor' THEN 'investor_id'
    WHEN 'investor_participation' THEN 'participation_id'
    WHEN 'akun_keuangan' THEN 'akun_keuangan_id'
    WHEN 'pergerakan_akun_keuangan' THEN 'pergerakan_akun_keuangan_id'
    WHEN 'investor_finance_period' THEN 'period_id'
    WHEN 'investor_period_allocation' THEN 'allocation_id'
    WHEN 'operator_period_allocation' THEN 'allocation_id'
    WHEN 'operator_period_withdrawal' THEN 'withdrawal_id'
    WHEN 'investor_entitlement_transfer' THEN 'transfer_id'
    WHEN 'investor_stakeholder_payout' THEN 'payout_id'
    ELSE NULL
  END;

  v_aggregate_id := nullif(coalesce(v_row_new ->> v_key, v_row_old ->> v_key), '')::uuid;

  IF v_usaha_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_payload := jsonb_build_object(
    'event_id', v_event_id,
    'aggregate_id', v_aggregate_id,
    'occurred_at', clock_timestamp()
  );

  INSERT INTO public.investor_realtime_event(
    event_id, usaha_id, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    v_event_id, v_usaha_id, v_type, TG_TABLE_NAME, v_aggregate_id, v_payload
  ) RETURNING event_seq INTO v_event_seq;

  BEGIN
    PERFORM realtime.send(
      v_payload || jsonb_build_object('event_seq', v_event_seq),
      v_type,
      'finance:usaha:' || v_usaha_id::text,
      true
    );

    UPDATE public.investor_realtime_event
    SET delivered_at = clock_timestamp(), attempt_count = attempt_count + 1, last_error = NULL
    WHERE event_seq = v_event_seq;
  EXCEPTION WHEN OTHERS THEN
    -- The journal record remains committed with the parent transaction and
    -- is available for replay even when live Broadcast delivery is unavailable.
    UPDATE public.investor_realtime_event
    SET attempt_count = attempt_count + 1, last_error = SQLERRM
    WHERE event_seq = v_event_seq;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.broadcast_investor_event() FROM PUBLIC, anon, authenticated;

-- These ledgers affect the investor/operator entitlement and cash views. They
-- were not all covered by triggers, so queries could stay stale until polling.
DROP TRIGGER IF EXISTS operator_period_allocation_realtime ON public.operator_period_allocation;
CREATE TRIGGER operator_period_allocation_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.operator_period_allocation
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS operator_period_withdrawal_investor_realtime ON public.operator_period_withdrawal;
CREATE TRIGGER operator_period_withdrawal_investor_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.operator_period_withdrawal
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_entitlement_transfer_realtime ON public.investor_entitlement_transfer;
CREATE TRIGGER investor_entitlement_transfer_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.investor_entitlement_transfer
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();
