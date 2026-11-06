-- Restrict POS receipts to active operational IDR accounts.
-- The original stock/HPP/sale transaction remains unchanged behind a private entrypoint.
ALTER FUNCTION app_private.command_create_sale(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) RENAME TO command_create_sale_unchecked_20261105;

REVOKE ALL ON FUNCTION app_private.command_create_sale_unchecked_20261105(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) FROM PUBLIC,anon,authenticated;

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
  v_account public.akun_keuangan%ROWTYPE;
BEGIN
  PERFORM app_private.assert_finance_admin(p_usaha_id);

  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id
    AND akun_keuangan_id=p_akun_keuangan_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: akun Kas Operasional tidak ditemukan pada Usaha aktif'
      USING ERRCODE='P0002';
  END IF;

  IF v_account.status IS DISTINCT FROM 'active'
    OR v_account.mata_uang IS DISTINCT FROM 'IDR'
    OR v_account.fungsi_akun IS DISTINCT FROM 'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran POS wajib diterima pada akun operasional IDR yang aktif'
      USING ERRCODE='23514';
  END IF;

  RETURN app_private.command_create_sale_unchecked_20261105(
    p_usaha_id,p_source,p_nama_pelanggan,p_nomor_telepon,p_catatan,
    p_lines,p_akun_keuangan_id,p_metode,p_idempotency_key,p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_sale(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_sale(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) TO authenticated;


-- Rebind the public POS RPC to the guarded private command after its implementation is renamed.
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
  SELECT app_private.command_create_sale(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_sale(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_create_sale(
  uuid,text,text,text,text,jsonb,uuid,text,text,uuid
) TO authenticated;
