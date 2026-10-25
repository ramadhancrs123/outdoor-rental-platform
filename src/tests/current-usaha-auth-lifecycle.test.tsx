import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authListener: null as ((event: string, session: unknown) => void) | null,
  unsubscribe: vi.fn(),
  listAuthorizedUsaha: vi.fn(),
  resolveTenantContext: vi.fn(),
}));

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mocks.authListener = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  },
}));

vi.mock("@/features/penyewa/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/penyewa/service")>();
  return {
    ...actual,
    listAuthorizedUsaha: mocks.listAuthorizedUsaha,
    resolveTenantContext: mocks.resolveTenantContext,
  };
});

import { CurrentUsahaProvider } from "@/app/current-usaha";
import { useCurrentUsaha } from "@/app/current-usaha-context";

function Harness() {
  const { status, current, error } = useCurrentUsaha();
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="usaha-id">{current?.usahaId ?? ""}</output>
      <output data-testid="error">{error?.message ?? ""}</output>
    </div>
  );
}

describe("CurrentUsahaProvider auth lifecycle", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.authListener = null;
    mocks.unsubscribe.mockReset();
    mocks.listAuthorizedUsaha
      .mockReset()
      .mockRejectedValueOnce(new Error("Sesi belum tersedia"))
      .mockResolvedValue([{ usahaId: "usaha-test-id", usahaNama: "Usaha Test" }]);
    mocks.resolveTenantContext.mockReset().mockResolvedValue({
      akunAdminId: "admin-domain-id",
      usahaId: "usaha-test-id",
      usahaNama: "Usaha Test",
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("reloads authorized tenant context after the user signs in", async () => {
    render(
      <CurrentUsahaProvider>
        <Harness />
      </CurrentUsahaProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(mocks.listAuthorizedUsaha).toHaveBeenCalledTimes(1);

    expect(mocks.authListener).not.toBeNull();
    await act(async () => {
      mocks.authListener?.("SIGNED_IN", {});
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listAuthorizedUsaha).toHaveBeenCalledTimes(2);
    expect(mocks.resolveTenantContext).toHaveBeenCalledWith(undefined, "usaha-test-id");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(screen.getByTestId("usaha-id")).toHaveTextContent("usaha-test-id");
  });
});
