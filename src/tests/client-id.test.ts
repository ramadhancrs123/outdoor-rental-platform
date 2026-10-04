import { afterEach, describe, expect, test } from "vitest";
import { createClientId } from "@/lib/client-id";

const originalRandomUUID = globalThis.crypto?.randomUUID;

afterEach(() => {
  if (globalThis.crypto && originalRandomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: originalRandomUUID,
      configurable: true,
    });
  }
});

describe("createClientId", () => {
  test("falls back when crypto.randomUUID is unavailable", () => {
    if (!globalThis.crypto) throw new Error("Web Crypto tidak tersedia pada test runtime.");

    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    const id = createClientId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
