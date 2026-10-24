# Rental Outdoor internal notification functions

These Edge Functions are internal service-to-service endpoints. They use
`verify_jwt = false` deliberately and validate the Vault-managed
`x-internal-token` header in the handler through
`public.verify_internal_trigger_token`. Do not expose that token to browser,
mobile, or other public clients.

Required configuration:
- Database Vault secret: `rental_internal_trigger_token`. The hardening migration creates a random value if it is absent.
- Edge Function secret: `FIREBASE_SERVICE_ACCOUNT_JSON` (Firebase service-account JSON) and optionally `FIREBASE_PROJECT_ID`.
- The Google service account must be allowed to send Firebase Cloud Messaging HTTP v1 messages.

The scheduled FCM worker validates Firebase configuration before claiming queue
rows. It uses bounded batches, stale-processing recovery, transient-error retry,
and terminal failure states. The webhook worker validates endpoint URLs, signs
the transmitted JSON body with HMAC-SHA256, records the response and schedules
bounded retries.

Do not invoke `0002_webhook_system.sql` from the old draft: the production path
is implemented through the outbox, delivery log, and the Vault-authenticated
database trigger. The SQL migration should be deployed in order after the
existing schema migrations. Note: the production schema currently contains
migration history that has not all been mirrored in the repository; review
migration drift before bootstrapping a fresh database from this branch.
