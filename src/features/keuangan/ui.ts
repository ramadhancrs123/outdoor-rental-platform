import { useMemo, useState } from "react";
import type { FinancePeriodPreset } from "./types";
import { getFinancePeriodSelection } from "./utils";

export function useFinancePeriod(timezone: string) {
  const [preset, setPreset] = useState<FinancePeriodPreset>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const period = useMemo(
    () => getFinancePeriodSelection(timezone, preset, customStart, customEnd),
    [customEnd, customStart, preset, timezone],
  );

  return { period, setPreset, setCustomStart, setCustomEnd };
}
