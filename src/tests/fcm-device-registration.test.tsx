import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: null as {
    id: string;
    name: string;
    kind: "admin" | "investor";
    investorId?: string;
    usahaId?: string;
  } | null,
  current: null as {
    akunAdminId: string;
    usahaId: string;
    usahaNama: string;
  } | null,
  hasBridge: vi.fn(),
  retrieveToken: vi.fn(),
  registerToken: vi.fn(),
}));

vi.mock("@refinedev/core", () => ({
  useGetIdentity: () => ({ data: mocks.identity }),
}));

vi.mock("@/app/current-usaha-context", () => ({
  useCurrentUsaha: () => ({ current: mocks.current }),
}));

vi.mock("@/features/fcm/service", () => ({
  hasAndroidFcmBridge: mocks.hasBridge,
  retrieveFcmTokenFromAndroid: mocks.retrieveToken,
  registerFcmDeviceToken: mocks.registerToken,
}));

import { useFcmDeviceRegistration } from "@/features/fcm/use-fcm-device";

function Harness() {
  const { status, error } = useFcmDeviceRegistration();
  return (
    <div>
      <output data-testid="fcm-status">{status}</output>
      {error ? <output data-testid="fcm-error">{error}</output> : null}
    </div>
  );
}

describe("FCM device registration", () => {
  beforeEach(() => {
    mocks.identity = {
      id: "auth-user-id",
      name: "Admin",
      kind: "admin",
    };
    mocks.current = {
      akunAdminId: "admin-domain-id",
      usahaId: "usaha-test-id",
      usahaNama: "Usaha Test",
    };
    mocks.hasBridge.mockReset().mockReturnValue(true);
    mocks.retrieveToken
      .mockReset()
      .mockReturnValue({ token: null, source: null });
    mocks.registerToken
      .mockReset()
      .mockResolvedValue({ success: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("retries when the Android bridge exists before its asynchronous FCM token is ready", async () => {
    mocks.retrieveToken
      .mockReturnValueOnce({ token: null, source: null })
      .mockReturnValue({ token: "test-fcm-token", source: "android_interface" });

    render(<Harness />);

    expect(mocks.registerToken).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mocks.retrieveToken).toHaveBeenCalledTimes(2);
    expect(mocks.registerToken).toHaveBeenCalledOnce();
    expect(mocks.registerToken).toHaveBeenCalledWith(
      "usaha-test-id",
      "admin",
      "admin-domain-id",
      "test-fcm-token",
    );
    expect(screen.getByTestId("fcm-status")).toHaveTextContent("registered");
  });

  test("does not poll in a regular browser without the Android bridge", async () => {
    mocks.hasBridge.mockReturnValue(false);

    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.retrieveToken).toHaveBeenCalledOnce();
    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(screen.getByTestId("fcm-status")).toHaveTextContent("idle");
  });
});
