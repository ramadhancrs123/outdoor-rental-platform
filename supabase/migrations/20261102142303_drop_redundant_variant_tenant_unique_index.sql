-- The catalog variant composite key is already backed by an equivalent
-- unique index from the existing W002 schema hardening migration.
-- Remove only the duplicate index introduced by the initial media migration.
DROP INDEX IF EXISTS public.varian_barang_usaha_variant_unique;
