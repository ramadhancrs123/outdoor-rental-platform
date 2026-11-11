export type AkashaSmartBookingStatus =
  | "received"
  | "reviewing"
  | "acknowledged"
  | "customer_action_required"
  | "change_requested"
  | "cancellation_pending"
  | "ready_for_checkout"
  | "cancelled"
  | "expired"
  | "fulfilled"

export type AkashaSmartBookingLine = {
  line_id: string
  kind: "rental" | "sale"
  barang_id: string | null
  varian_barang_id: string | null
  paket_sewa_id: string | null
  name: string
  variant: string | null
  quantity: number
  inventory_mode_snapshot?: "serialized" | "quantity" | null
  unit_price: number
  normal_price: number
  discount_percent: number
  discount_amount: number
  subtotal: number
  currency_code: string
  tarif_sewa_id?: string | null
  promosi_katalog_id?: string | null
  promosi_paket_id?: string | null
}

export type AkashaSmartBookingListItem = {
  smart_booking_id: string
  reference_code: string
  reservation_id: string | null
  reservation_number: string | null
  customer_name: string
  customer_phone: string
  workflow_status: AkashaSmartBookingStatus
  requested_pickup_date: string | null
  requested_return_date: string | null
  quote_total: number
  currency_code: string
  revision: number
  created_at: string
  line_count: number
  line_summary: Array<{
    kind: "rental" | "sale"
    name: string
    variant: string | null
    quantity: number
  }>
  pending_change_count: number
}

export type AkashaSmartBookingListResult = {
  items: AkashaSmartBookingListItem[]
  total: number
  limit: number
  offset: number
}

export type AkashaSmartBookingDetail = {
  smart_booking_id: string
  usaha_id: string
  reference_code: string
  reservation_id: string | null
  request_id: string | null
  renter_id: string | null
  workflow_status: AkashaSmartBookingStatus
  customer_name: string
  customer_phone: string
  customer_phone_normalized: string
  customer_note: string | null
  requested_pickup_date: string | null
  requested_return_date: string | null
  requested_pickup_at: string | null
  requested_return_at: string | null
  business_timezone: string
  quote_total: number
  dp_amount: number | null
  currency_code: string
  quote_expires_at: string | null
  revision: number
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
  lines: AkashaSmartBookingLine[]
  change_requests: AkashaSmartBookingChangeRequest[]
  timeline: Array<{
    type: string
    actor_type: "customer" | "admin" | "system"
    public_message: string | null
    internal_metadata: Record<string, unknown>
    created_at: string
  }>
}

export type AkashaSmartBookingChangeRequest = {
  id: string
  type: string
  requested_by_type?: "customer" | "admin"
  payload: Record<string, unknown>
  reason: string | null
  status: "pending" | "approved" | "rejected" | "withdrawn" | "applied"
  resolution_note?: string | null
  public_resolution_note?: string | null
  resolved_at?: string | null
  created_at: string
}


export type AkashaSmartBookingAvailabilityComponent = {
  component_name?: string
  requested_variant?: string | null
  required_quantity?: number
  availability?: {
    product_name?: string
    requested_variant?: string | null
    requested_quantity?: number
    total_serialized_units?: number
    ready_now_across_variants?: number
    ready_now_requested_variant?: number
    legacy_capacity_reserved_across_variants?: number
    legacy_capacity_reserved_requested_variant?: number
    potential_returns_before_pickup_across_variants?: number
    potential_returns_before_pickup_requested_variant?: number
    available_now_across_variants?: number
    available_now_requested_variant?: number
    inventory_mode?: "serialized" | "quantity" | null
    status: string
    is_guaranteed?: false
  }
  product_name?: string
  requested_variant_name?: string | null
  requested_quantity?: number
  total_serialized_units?: number
  ready_now_across_variants?: number
  ready_now_requested_variant?: number
  legacy_capacity_reserved_across_variants?: number
  legacy_capacity_reserved_requested_variant?: number
  potential_returns_before_pickup_across_variants?: number
  potential_returns_before_pickup_requested_variant?: number
  available_now_across_variants?: number
  available_now_requested_variant?: number
  inventory_mode?: "serialized" | "quantity" | null
  status: string
  is_guaranteed?: false
}

export type AkashaSmartBookingAvailabilityLine = {
  line_id: string
  kind: "rental" | "sale"
  barang_id: string | null
  varian_barang_id: string | null
  paket_sewa_id: string | null
  item_name: string
  variant_name: string | null
  requested_quantity: number
  inventory_mode: "serialized" | "quantity" | null
  status: string
  components: AkashaSmartBookingAvailabilityComponent[]
}

export type AkashaSmartBookingAvailability = {
  smart_booking_id: string
  reference_code: string
  checked_at: string
  requested_pickup_date: string | null
  requested_pickup_at: string | null
  business_timezone: string
  pickup_forecast_boundary: string | null
  return_tolerance_hours: number
  inventory_is_reserved: false
  availability_is_guaranteed: false
  lines: AkashaSmartBookingAvailabilityLine[]
}


export type AkashaSmartBookingSummary = {
  total: number
  received: number
  reviewing: number
  acknowledged: number
  customer_action_required: number
  change_requested: number
  cancellation_pending: number
  ready_for_checkout: number
  closed: number
  pending_change_requests: number
  pickup_today: number
  pickup_tomorrow: number
  today_business_date: string
  business_timezone: string
  inventory_is_reserved: false
}


export type AkashaSmartBookingCalendarDay = {
  date: string
  booking_count: number
  pickup_count: number
  return_count: number
  in_period_count: number
}

export type AkashaSmartBookingCalendarAgendaItem = {
  smart_booking_id: string
  reference_code: string
  reservation_id: string | null
  reservation_number: string | null
  customer_name: string
  customer_phone: string
  workflow_status: AkashaSmartBookingStatus
  requested_pickup_date: string
  requested_return_date: string | null
  quote_total: number
  currency_code: string
  created_at: string
  line_summary: Array<{
    kind: "rental" | "sale"
    name: string
    variant: string | null
    quantity: number
  }>
  pending_change_count: number
  is_pickup: boolean
  is_return: boolean
  is_in_period: boolean
}

export type AkashaSmartBookingCalendar = {
  business_timezone: string
  date_from: string
  date_until: string
  scheduled_count: number
  pickup_count: number
  return_count: number
  unscheduled_count: number
  agenda_total: number
  days: AkashaSmartBookingCalendarDay[]
  agenda: AkashaSmartBookingCalendarAgendaItem[]
}
