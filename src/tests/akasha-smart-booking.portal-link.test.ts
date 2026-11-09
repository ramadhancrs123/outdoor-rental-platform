import { describe, expect, test } from "vitest";
import { createAkashaPortalLink } from "@/features/akasha-smart-booking/portal-link";

const TOKEN = "A".repeat(64);

describe("AKASHA customer portal private link", () => {
  test("uses the configured public web origin, not the admin app origin", () => {
    expect(createAkashaPortalLink("https://akashaoutdoor.vercel.app/", TOKEN)).toBe(
      "https://akashaoutdoor.vercel.app/booking/portal#access=" + TOKEN.toLowerCase(),
    );
  });

  test("keeps localhost available for local development", () => {
    expect(createAkashaPortalLink("http://localhost:3000", TOKEN)).toBe(
      "http://localhost:3000/booking/portal#access=" + TOKEN.toLowerCase(),
    );
  });

  test("rejects malformed token and insecure non-local origins", () => {
    expect(createAkashaPortalLink("https://akashaoutdoor.vercel.app", "not-a-token")).toBeNull();
    expect(createAkashaPortalLink("http://akashaoutdoor.vercel.app", TOKEN)).toBeNull();
    expect(createAkashaPortalLink("https://akashaoutdoor.vercel.app", "f".repeat(63))).toBeNull();
  });
});
