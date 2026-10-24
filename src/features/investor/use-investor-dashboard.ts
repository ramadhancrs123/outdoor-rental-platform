import { useEffect, useMemo, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInvestorActivity,
  getInvestorOverview,
  getInvestorParticipationHistory,
  getInvestorPrincipal,
  getInvestorReconciliation,
  getInvestorStakeholderAccounts,
  getOperationalAccountSummary,
  subscribeToInvestorFinance,
} from "./index";
import { buildInvestorUiContract } from "./contract";
import type { InvestorConnectionStatus, InvestorPrincipal } from "./types";

export function useInvestorDashboard(overrideUsahaId?: string | null) {
  const queryClient = useQueryClient();
  const { data: identity } = useGetIdentity<{ kind?: "admin" | "investor"; usahaId?: string | null }>();
  const [connectionStatus, setConnectionStatus] = useState<InvestorConnectionStatus>("CONNECTING");
  const [lastRealtimeEventAt, setLastRealtimeEventAt] = useState<string | null>(null);
  const [lastRealtimeEventSeq, setLastRealtimeEventSeq] = useState<number | null>(null);
  const [lastRealtimeEventType, setLastRealtimeEventType] = useState<string | null>(null);

  const resolvedUsahaId = overrideUsahaId ?? identity?.usahaId ?? null;
  const usahaId = resolvedUsahaId;

  const overview = useQuery({
    queryKey: ["investor", "overview", usahaId],
    queryFn: () => getInvestorOverview(usahaId as string),
    enabled: Boolean(usahaId),
    staleTime: 15_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  const principal = useQuery<InvestorPrincipal | null>({
    queryKey: ["investor", "principal", usahaId, overview.data?.investor_id],
    queryFn: () => getInvestorPrincipal(usahaId ?? undefined, overview.data?.investor_id ?? null),
    enabled: Boolean(usahaId),
    staleTime: 5 * 60_000,
  });

  const period = overview.data?.period ?? null;

  const activity = useQuery({
    queryKey: ["investor", "activity", usahaId, period?.start, period?.end_exclusive],
    queryFn: () =>
      getInvestorActivity(
        usahaId as string,
        period?.start as string,
        period?.end_exclusive as string,
        200,
        0,
      ),
    enabled: Boolean(usahaId && period),
    staleTime: 15_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  const participation = useQuery({
    queryKey: ["investor", "participation", usahaId, principal.data?.investorId],
    queryFn: () =>
      getInvestorParticipationHistory(
        usahaId as string,
        principal.data?.investorId,
      ),
    enabled: Boolean(usahaId && principal.data?.investorId),
    staleTime: 30_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  const operationalAccounts = useQuery({
    queryKey: ["investor", "operational-account-summary", usahaId],
    queryFn: () => getOperationalAccountSummary(usahaId as string),
    enabled: Boolean(usahaId),
    staleTime: 15_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  const stakeholderAccounts = useQuery({
    queryKey: ["investor", "stakeholder-accounts", usahaId],
    queryFn: () => getInvestorStakeholderAccounts(usahaId as string),
    enabled: Boolean(usahaId),
    staleTime: 15_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  const reconciliation = useQuery({
    queryKey: ["investor", "reconciliation", usahaId],
    queryFn: () => getInvestorReconciliation(usahaId as string),
    enabled: Boolean(usahaId && identity?.kind === "admin"),
    staleTime: 30_000,
    refetchOnReconnect: true,
    refetchInterval: connectionStatus === "STALE" ? 15_000 : 60_000,
  });

  useEffect(() => {
    if (!usahaId) {
      setConnectionStatus("CONNECTING");
      setLastRealtimeEventAt(null);
      setLastRealtimeEventSeq(null);
      setLastRealtimeEventType(null);
      return;
    }

    return subscribeToInvestorFinance(
      usahaId,
      async (event) => {
        setLastRealtimeEventAt(event.occurredAt ?? new Date().toISOString());
        setLastRealtimeEventSeq(event.eventSeq);
        setLastRealtimeEventType(event.type);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["investor", "overview", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "activity", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "participation", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "operational-account-summary", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "stakeholder-accounts", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "stakeholder-history", usahaId] }),
          queryClient.invalidateQueries({ queryKey: ["investor", "reconciliation", usahaId] }),
        ]);
        setConnectionStatus("LIVE");
      },
      setConnectionStatus,
    );
  }, [usahaId, queryClient]);

  const contract = useMemo(
    () => buildInvestorUiContract(overview.data ?? null, connectionStatus),
    [overview.data, connectionStatus],
  );

  return {
    principal,
    overview,
    activity,
    participation,
    operationalAccounts,
    stakeholderAccounts,
    reconciliation,
    connectionStatus,
    lastRealtimeEventAt,
    lastRealtimeEventSeq,
    lastRealtimeEventType,
    contract,
    viewState:
      contract?.state === "CONFIG_REQUIRED"
        ? "CONFIG_REQUIRED"
        : contract?.state === "REVIEW_REQUIRED"
          ? "REVIEW_REQUIRED"
          : contract?.state === "STALE"
            ? "STALE"
            : contract?.state === "CLOSED"
              ? "CLOSED"
              : contract
                ? "VALUE"
                : "LOADING",
    refetch: async () => {
      await Promise.all([
        overview.refetch(),
        activity.refetch(),
        participation.refetch(),
        operationalAccounts.refetch(),
        reconciliation.refetch(),
        stakeholderAccounts.refetch(),
      ]);
    },
  };
}
