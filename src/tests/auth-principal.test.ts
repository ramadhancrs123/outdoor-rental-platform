import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  user: { id: "auth-user-1", email: "user@rentaloutdoor.test" } as { id: string; email: string } | null,
  session: { user: { id: "auth-user-1" } } as { user: { id: string } } | null,
  admin: null as Record<string, unknown> | null,
  investor: null as Record<string, unknown> | null,
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockState.user }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: mockState.session }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: mockState.user }, error: null })),
      signOut: mockState.signOut,
    },
    from: vi.fn((table: string) => {
      const builder: {
        select: ReturnType<typeof vi.fn>;
        eq: ReturnType<typeof vi.fn>;
        maybeSingle: ReturnType<typeof vi.fn>;
      } = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      builder.select.mockReturnValue(builder);
      builder.eq.mockReturnValue(builder);
      builder.maybeSingle.mockImplementation(async () => ({
        data: table === "akun_admin" ? mockState.admin : mockState.investor,
        error: null,
      }));
      return builder;
    }),
  },
}));

import { authProvider, getPrincipalIdentity } from "@/app/providers/auth";

describe("authenticated application principal", () => {
  beforeEach(() => {
    mockState.user = { id: "auth-user-1", email: "user@rentaloutdoor.test" };
    mockState.session = { user: { id: "auth-user-1" } };
    mockState.admin = null;
    mockState.investor = null;
    mockState.signOut.mockClear();
  });

  test("active admin identity takes precedence when an Investor row also exists", async () => {
    mockState.admin = {
      akun_admin_id: "admin-1",
      nama_tampilan: "Admin",
      role: "super_admin",
      status: "active",
    };
    mockState.investor = {
      investor_id: "investor-1",
      usaha_id: "usaha-1",
      nama_tampilan: "Investor",
      status: "active",
    };

    await expect(getPrincipalIdentity()).resolves.toMatchObject({
      kind: "admin",
      role: "super_admin",
    });
  });

  test("active Investor identity is resolved when no active admin identity exists", async () => {
    mockState.investor = {
      investor_id: "investor-1",
      usaha_id: "usaha-1",
      nama_tampilan: "Investor",
      status: "active",
    };

    await expect(getPrincipalIdentity()).resolves.toMatchObject({
      kind: "investor",
      investorId: "investor-1",
      usahaId: "usaha-1",
    });
  });

  test("authenticated users without an active application principal fail closed", async () => {
    await expect(getPrincipalIdentity()).resolves.toBeNull();
  });

  test("password login refuses an authenticated user without an active application principal", async () => {
    const result = await authProvider.login?.({
      email: "user@rentaloutdoor.test",
      password: "not-a-real-password",
    });

    expect(result?.success).toBe(false);
    expect(result?.error?.name).toBe("AuthorizationError");
    expect(mockState.signOut).toHaveBeenCalledOnce();
  });
});
