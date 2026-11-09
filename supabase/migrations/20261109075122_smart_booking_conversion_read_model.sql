CREATE OR REPLACE FUNCTION app_private.admin_get_akasha_smart_booking_conversion(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_conversion app_private.akasha_smart_booking_conversion%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: sesi admin tidak ditemukan'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id;

  IF NOT FOUND OR NOT app_private.has_usaha_access(v_booking.usaha_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_conversion
  FROM app_private.akasha_smart_booking_conversion c
  WHERE c.usaha_id = v_booking.usaha_id
    AND c.smart_booking_id = v_booking.smart_booking_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'smart_booking_id', v_conversion.smart_booking_id,
    'converted_at', v_conversion.created_at,
    'source_command', v_conversion.source_command,
    'checkout_id', v_conversion.checkout_id,
    'checkout_number', (
      SELECT c.nomor_checkout
      FROM public.checkout c
      WHERE c.checkout_id = v_conversion.checkout_id
    ),
    'rental_id', v_conversion.penyewaan_id,
    'rental_number', (
      SELECT p.nomor_penyewaan
      FROM public.penyewaan p
      WHERE p.usaha_id = v_conversion.usaha_id
        AND p.penyewaan_id = v_conversion.penyewaan_id
    ),
    'sale_id', v_conversion.penjualan_id,
    'sale_number', (
      SELECT p.nomor_penjualan
      FROM public.penjualan p
      WHERE p.usaha_id = v_conversion.usaha_id
        AND p.penjualan_id = v_conversion.penjualan_id
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking_conversion(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_get_akasha_smart_booking_conversion($1);
$function$;

REVOKE ALL ON FUNCTION app_private.admin_get_akasha_smart_booking_conversion(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking_conversion(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking_conversion(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_akasha_smart_booking_conversion(uuid)
  IS 'Tenant-authorized read model for actual rental, sale, and mixed checkout references created from a Smart Booking.';
