-- Repair the product-name sort alias in the read-only retail finance analysis.
-- The CTE exposes nama_barang_snapshot; the aggregate ORDER BY must use that alias.
-- This migration changes no transaction, payment, inventory, or ledger data.

DO $migration$
DECLARE
  v_definition text;
  v_old text := 'ORDER BY x.revenue DESC, x.nama_barang)';
  v_new text := 'ORDER BY x.revenue DESC, x.nama_barang_snapshot)';
  v_old_occurrences integer;
  v_new_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.finance_retail_analysis(uuid,date,date,integer)'::regprocedure
  )
  INTO v_definition;

  v_old_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);

  v_new_occurrences := (
    length(v_definition) - length(replace(v_definition, v_new, ''))
  ) / length(v_new);

  IF v_old_occurrences = 0 AND v_new_occurrences = 1 THEN
    RETURN;
  END IF;

  IF v_old_occurrences <> 1 OR v_new_occurrences <> 0 THEN
    RAISE EXCEPTION
      'Finance retail analysis sort alias repair expected exactly one stale alias and no fixed alias; stale %, fixed %',
      v_old_occurrences, v_new_occurrences;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;
