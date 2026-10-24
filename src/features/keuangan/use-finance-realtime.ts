import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/app/providers/supabase/client";
import { getKeuanganContext } from "./service";

export type FinanceRealtimeStatus = "CONNECTING" | "LIVE" | "STALE";

type Checkpoint = {
  last_event_seq?: number | string | null;
  last_event_at?: string | null;
};

const FINANCE_EVENTS = [
  "finance.changed",
  "finance.account.changed",
  "finance.account.movement.changed",
  "investor.changed",
  "investor.config.changed",
  "investor.period.changed",
  "investor.allocation.changed",
  "investor.operator_allocation.changed",
] as const;

/**
 * Tenant-scoped real-time invalidation for all Finance read models.
 * Broadcast delivers immediate refreshes. A server-owned event checkpoint
 * catches dropped messages even when the WebSocket still reports SUBSCRIBED.
 */
export function useFinanceRealtime(usahaId?: string | null) {
  const queryClient = useQueryClient();
  const context = useQuery({
    queryKey: ["keuangan", "context"],
    queryFn: getKeuanganContext,
    enabled: !usahaId,
    staleTime: 60_000,
  });
  const resolvedUsahaId = usahaId ?? context.data?.usahaId;
  const [status, setStatus] = useState<FinanceRealtimeStatus>("CONNECTING");
  const lastEventSeqRef = useRef(0);

  useEffect(() => {
    if (!resolvedUsahaId) {
      const nextStatus: FinanceRealtimeStatus = context.isError ? "STALE" : "CONNECTING";
      setStatus(nextStatus);
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        document.documentElement.dataset.financeRealtimeStatus = nextStatus;
        window.dispatchEvent(new CustomEvent<FinanceRealtimeStatus>("finance-realtime-status", { detail: nextStatus }));
      }
      lastEventSeqRef.current = 0;
      return;
    }

    let disposed = false;
    let channelLive = false;
    let checkpointInFlight: Promise<void> | null = null;
    const publishStatus = (nextStatus: FinanceRealtimeStatus) => {
      setStatus(nextStatus);
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        document.documentElement.dataset.financeRealtimeStatus = nextStatus;
        window.dispatchEvent(new CustomEvent<FinanceRealtimeStatus>("finance-realtime-status", { detail: nextStatus }));
      }
    };
    publishStatus("CONNECTING");

    const refreshFinanceReads = async () => {
      if (disposed) return;
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    };

    const reconcileCheckpoint = (refreshOnHealthyCheckpoint = false) => {
      if (disposed) return Promise.resolve();
      if (checkpointInFlight) return checkpointInFlight;
      checkpointInFlight = (async () => {
        const { data, error } = await supabase.rpc("get_investor_realtime_checkpoint", {
          p_usaha_id: resolvedUsahaId,
        });
        if (error) throw error;
        const checkpoint = (data ?? {}) as Checkpoint;
        const remoteSeq = Number(checkpoint.last_event_seq ?? 0);
        if (!Number.isFinite(remoteSeq) || remoteSeq < 0) throw new Error("Checkpoint Realtime tidak valid.");

        if (remoteSeq > lastEventSeqRef.current) {
          // This detects a lost event using durable server state rather than
          // trusting the WebSocket status alone.
          lastEventSeqRef.current = remoteSeq;
          await refreshFinanceReads();
        } else if (remoteSeq < lastEventSeqRef.current) {
          // Recover gracefully if a restore/reset moves the journal cursor back.
          lastEventSeqRef.current = remoteSeq;
          await refreshFinanceReads();
        } else if (refreshOnHealthyCheckpoint) {
          // Re-read canonical RPC data on reconnect to close the gap between the
          // last socket event and the reconnect handshake.
          await refreshFinanceReads();
        }
        if (!disposed && channelLive) publishStatus("LIVE");
      })().catch(() => {
        if (!disposed) publishStatus("STALE");
      }).finally(() => {
        checkpointInFlight = null;
      });
      return checkpointInFlight;
    };

    const channel = supabase.channel("finance:usaha:" + resolvedUsahaId, {
      config: { private: true },
    });
    for (const event of FINANCE_EVENTS) {
      channel.on("broadcast", { event }, (payload) => {
        if (disposed) return;
        const body = (payload.payload ?? {}) as { event_seq?: number; occurred_at?: string };
        const seq = typeof body.event_seq === "number" ? body.event_seq : null;
        const hasGap = seq !== null && lastEventSeqRef.current > 0 && seq > lastEventSeqRef.current + 1;
        if (seq !== null && seq > lastEventSeqRef.current) lastEventSeqRef.current = seq;

        if (hasGap) {
          // The checkpoint refresh will reconcile all current read models even
          // when the missing event cannot be rebroadcast to this socket.
          void reconcileCheckpoint(true).then(refreshFinanceReads).catch(() => {
            if (!disposed) publishStatus("STALE");
          });
        } else {
          void refreshFinanceReads().catch(() => {
            if (!disposed) publishStatus("STALE");
          });
        }
      });
    }

    channel.subscribe((nextStatus) => {
      if (disposed) return;
      if (nextStatus === "SUBSCRIBED") {
        channelLive = true;
        publishStatus("CONNECTING");
        void reconcileCheckpoint(true);
      } else if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT" || nextStatus === "CLOSED") {
        channelLive = false;
        publishStatus("STALE");
      } else {
        channelLive = false;
        publishStatus("CONNECTING");
      }
    });

    const onFocus = () => {
      if (document.visibilityState === "visible") void reconcileCheckpoint(true);
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    // Normal updates refresh immediately via Broadcast. Every 30 seconds we
    // also invalidate current reads even if the journal checkpoint is unchanged:
    // this is a last-resort guard against legacy triggers that accidentally
    // swallow a journal-insert failure while the WebSocket remains connected.
    const checkpointTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reconcileCheckpoint(true);
    }, 30_000);

    return () => {
      disposed = true;
      channelLive = false;
      window.clearInterval(checkpointTimer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [resolvedUsahaId, queryClient, context.isError]);

  return status;
}
