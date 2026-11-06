CREATE OR REPLACE FUNCTION app_private.sync_checkout_payment_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid;
  v_penyewaan_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    v_usaha_id := OLD.usaha_id;
    v_penyewaan_id := OLD.penyewaan_id;
  ELSE
    v_usaha_id := NEW.usaha_id;
    v_penyewaan_id := NEW.penyewaan_id;
  END IF;

  IF v_penyewaan_id IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  UPDATE public.checkout c
  SET amount_paid = least(
        c.total_amount,
        coalesce((
          SELECT sum(pp.amount)
          FROM public.penjualan_pembayaran pp
          WHERE pp.usaha_id=c.usaha_id
            AND pp.penjualan_id=c.penjualan_id
            AND pp.status='recorded'
        ),0)
        +
        coalesce((
          SELECT sum(p.amount)
          FROM public.pembayaran p
          WHERE p.usaha_id=c.usaha_id
            AND p.penyewaan_id=c.penyewaan_id
            AND p.status='recorded'
        ),0)
      ),
      payment_status = CASE
        WHEN least(
          c.total_amount,
          coalesce((
            SELECT sum(pp.amount)
            FROM public.penjualan_pembayaran pp
            WHERE pp.usaha_id=c.usaha_id
              AND pp.penjualan_id=c.penjualan_id
              AND pp.status='recorded'
          ),0)
          +
          coalesce((
            SELECT sum(p.amount)
            FROM public.pembayaran p
            WHERE p.usaha_id=c.usaha_id
              AND p.penyewaan_id=c.penyewaan_id
              AND p.status='recorded'
          ),0)
        ) >= c.total_amount THEN 'paid'
        WHEN coalesce((
          SELECT sum(pp.amount)
          FROM public.penjualan_pembayaran pp
          WHERE pp.usaha_id=c.usaha_id
            AND pp.penjualan_id=c.penjualan_id
            AND pp.status='recorded'
        ),0)
        +
        coalesce((
          SELECT sum(p.amount)
          FROM public.pembayaran p
          WHERE p.usaha_id=c.usaha_id
            AND p.penyewaan_id=c.penyewaan_id
            AND p.status='recorded'
        ),0) > 0 THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE c.usaha_id=v_usaha_id AND c.penyewaan_id=v_penyewaan_id;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_checkout_payment_totals ON public.pembayaran;
CREATE TRIGGER trg_sync_checkout_payment_totals
AFTER INSERT OR DELETE OR UPDATE
ON public.pembayaran
FOR EACH ROW
EXECUTE FUNCTION app_private.sync_checkout_payment_totals();

REVOKE ALL ON FUNCTION app_private.sync_checkout_payment_totals() FROM PUBLIC,anon,authenticated,service_role;
