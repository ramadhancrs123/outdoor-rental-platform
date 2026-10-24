import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFinanceRealtime } from "@/features/keuangan/use-finance-realtime";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (message: { payload?: Record<string, unknown> }) => void>();
  const control: { status?: (status: string) => void } = {};
  const channel = {
    on: vi.fn((_type: string, filter: { event: string }, callback: (message: { payload?: Record<string, unknown> }) => void) => {
      handlers.set(filter.event, callback);
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      control.status = callback;
      queueMicrotask(() => callback("SUBSCRIBED"));
      return channel;
    }),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    rpc: vi.fn().mockResolvedValue({
      data: { principal: "admin", last_event_seq: 10, last_event_at: "2026-10-10T05:00:00Z" },
      error: null,
    }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  return { channel, control, handlers, supabase };
});

vi.mock("@/app/providers/supabase/client", () => ({ supabase: mocks.supabase }));
vi.mock("@/features/keuangan/service", () => ({
  getKeuanganContext: vi.fn().mockResolvedValue({ usahaId: "tenant-1", timezone: "Asia/Jakarta" }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("Finance realtime contract", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.control.status = undefined;
    mocks.supabase.rpc.mockResolvedValue({
      data: { principal: "admin", last_event_seq: 10, last_event_at: "2026-10-10T05:00:00Z" },
      error: null,
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
        mutations: { retry: false },
      },
    });
  });

  it("connects to the tenant-private channel and verifies the server checkpoint before reporting LIVE", async () => {
    const { result } = renderHook(() => useFinanceRealtime(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(result.current).toBe("LIVE"));
    expect(mocks.supabase.channel).toHaveBeenCalledWith("finance:usaha:tenant-1", { config: { private: true } });
    expect(mocks.supabase.rpc).toHaveBeenCalledWith("get_investor_realtime_checkpoint", { p_usaha_id: "tenant-1" });
    expect(mocks.handlers.has("finance.changed")).toBe(true);
    expect(mocks.handlers.has("investor.operator_allocation.changed")).toBe(true);
  });

  it("invalidates Finance read models on an event and reconciles a missed event from the durable checkpoint", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useFinanceRealtime("tenant-1"), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current).toBe("LIVE"));
    invalidate.mockClear();

    act(() => {
      mocks.handlers.get("finance.changed")?.({ payload: { event_seq: 11, occurred_at: "2026-10-10T05:01:00Z" } });
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["keuangan"] }));

    invalidate.mockClear();
    mocks.supabase.rpc.mockResolvedValueOnce({
      data: { principal: "admin", last_event_seq: 12, last_event_at: "2026-10-10T05:02:00Z" },
      error: null,
    });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["keuangan"] }));
    expect(result.current).toBe("LIVE");
  });
});
