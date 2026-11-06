DO $migration$
DECLARE
  v_definition text;
  v_old text := 'ORDER BY x.revenue DESC, x.nama_barang)';
  v_new text := 'ORDER BY x.revenue DESC, x.nama_barang_snapshot)';
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef('app_private.finance_retail_analysis(uuid,date,date,integer)'::regprocedure)
  INTO v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Finance retail analysis expected one product sort alias to repair; found %', v_occurrences;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;
