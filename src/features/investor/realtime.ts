import { supabase } from "@/app/providers/supabase/client";
import {
  getInvestorRealtimeCheckpoint,
  replayInvestorRealtimeEvents,
} from "./service";
import type { InvestorConnectionStatus } from "./types";

export type InvestorRealtimeEventType =
  | "finance.changed"
  | "finance.account.changed"
  | "finance.account.movement.changed"
  | "investor.changed"
  | "investor.config.changed"
  | "investor.period.changed"
  | "investor.allocation.changed"
  | "investor.operator_allocation.changed";

export type InvestorRealtimeEvent = {
  type: InvestorRealtimeEventType;
  eventSeq: number | null;
  occurredAt: string | null;
  replayed: boolean;
};

type EventPayload = {
  event_seq?: number;
  occurred_at?: string;
  replayed?: boolean;
};

const storageKey = (usahaId: string) => "investor:realtime:last-seq:" + usahaId;
const RECOVERY_INTERVAL_MS = 30_000;

function readStoredSeq(usahaId: string) {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(storageKey(usahaId));
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredSeq(usahaId: string, seq: number | null) {
  if (typeof window === "undefined" || seq == null || !Number.isFinite(seq)) return;
  try {
    const current = readStoredSeq(usahaId);
    if (seq > current) window.sessionStorage.setItem(storageKey(usahaId), String(seq));
  } catch {
    // Realtime must still work if browser storage is blocked; checkpoint
    // reconciliation will recover from the server-owned event journal.
  }
}

export function subscribeToInvestorFinance(
  usahaId: string,
  onEvent: (event: InvestorRealtimeEvent) => void | Promise<void>,
  onStatus: (status: InvestorConnectionStatus) => void,
) {
  let disposed = false;
  let subscribed = false;
  let recoveryInFlight: Promise<void> | null = null;

  const channel = supabase.channel("finance:usaha:" + usahaId, {
    config: { private: true },
  });

  const eventTypes: InvestorRealtimeEventType[] = [
    "finance.changed",
    "finance.account.changed",
    "finance.account.movement.changed",
    "investor.changed",
    "investor.config.changed",
    "investor.period.changed",
    "investor.allocation.changed",
    "investor.operator_allocation.changed",
  ];

  for (const eventType of eventTypes) {
    channel.on("broadcast", { event: eventType }, (payload) => {
      if (disposed) return;
      const body = (payload.payload ?? {}) as EventPayload;
      const eventSeq = typeof body.event_seq === "number" ? body.event_seq : null;
      const previousSeq = readStoredSeq(usahaId);
      const hasSequenceGap = eventSeq !== null && previousSeq > 0 && eventSeq > previousSeq + 1;
      const deliver = async () => {
        if (disposed) return;
        writeStoredSeq(usahaId, eventSeq);
        await onEvent({
          type: eventType,
          eventSeq,
          occurredAt: typeof body.occurred_at === "string" ? body.occurred_at : null,
          replayed: body.replayed === true,
        });
      };
      if (hasSequenceGap) {
        // Do not advance the cursor past events that may have been dropped.
        // Reconcile/replay first, then invalidate the canonical query models.
        void reconcileJournal().then(deliver).catch(() => {
          if (!disposed) onStatus("STALE");
        });
      } else {
        void deliver().catch(() => {
          if (!disposed) onStatus("STALE");
        });
      }
    });
  }

  const reconcileJournal = async () => {
    if (disposed || !subscribed || recoveryInFlight) return recoveryInFlight ?? undefined;
    recoveryInFlight = (async () => {
      onStatus("CONNECTING");
      const checkpoint = await getInvestorRealtimeCheckpoint(usahaId);
      const storedSeq = readStoredSeq(usahaId);
      const latestSeq = checkpoint.last_event_seq;

      if (latestSeq < storedSeq) {
        // Database restore/reseed: reset a stale browser cursor to server truth.
        try {
          window.sessionStorage.setItem(storageKey(usahaId), String(latestSeq));
        } catch {
          // Storage is optional; current queries still refresh below.
        }
      } else if (storedSeq === 0) {
        // Initial load fetches canonical current state through RPCs; no need to
        // rebroadcast the whole existing journal to a newly opened dashboard.
        writeStoredSeq(usahaId, latestSeq);
      } else if (latestSeq > storedSeq) {
        await replayInvestorRealtimeEvents(usahaId, storedSeq, 100);
        // Replays are an invalidation signal, not the source of financial truth.
        // Reading the canonical RPCs after replay is what makes the UI current.
        writeStoredSeq(usahaId, latestSeq);
        // Always refresh canonical read models after detecting a journal gap,
        // even when every rebroadcast attempt failed transiently.
        await onEvent({
          type: "finance.changed",
          eventSeq: latestSeq,
          occurredAt: checkpoint.last_event_at ?? null,
          replayed: true,
        });
      }
      if (!disposed) onStatus("LIVE");
    })().catch(() => {
      if (!disposed) onStatus("STALE");
    }).finally(() => {
      recoveryInFlight = null;
    });
    return recoveryInFlight;
  };

  channel.subscribe((status) => {
    if (disposed) return;
    if (status === "SUBSCRIBED") {
      subscribed = true;
      void reconcileJournal();
      return;
    }

    subscribed = false;
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      onStatus("STALE");
      return;
    }
    onStatus("CONNECTING");
  });

  // Broadcast is immediate; checkpoint reconciliation provides bounded recovery
  // for a dropped event even if the socket appears connected to the client.
  const recoveryTimer = window.setInterval(() => {
    if (subscribed && !disposed) void reconcileJournal();
  }, RECOVERY_INTERVAL_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible" && subscribed && !disposed) {
      void reconcileJournal();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    disposed = true;
    subscribed = false;
    window.clearInterval(recoveryTimer);
    document.removeEventListener("visibilitychange", onVisible);
    void supabase.removeChannel(channel);
  };
}
