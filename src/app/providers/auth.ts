import type { AuthProvider } from "@refinedev/core";
import { supabase } from "./supabase/client";

type OAuthProvider = "google" | "github";

export type PrincipalIdentity = {
  id: string;
  name: string;
  email?: string;
  kind: "admin" | "investor";
  role?: string | null;
  status?: string | null;
  investorId?: string | null;
  usahaId?: string | null;
};

export const getPrincipalIdentity = async (): Promise<PrincipalIdentity | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: admin } = await supabase
    .from("akun_admin")
    .select("akun_admin_id,nama_tampilan,role,status")
    .eq("auth_user_id", data.user.id)
    .eq("status", "active")
    .eq("role", "super_admin")
    .maybeSingle();

  if (admin) {
    return {
      id: data.user.id,
      name: admin.nama_tampilan ?? data.user.email ?? "Admin",
      email: data.user.email,
      kind: "admin",
      role: admin.role ?? null,
      status: admin.status ?? null,
    };
  }

  const { data: investor } = await supabase
    .from("investor")
    .select("investor_id,usaha_id,nama_tampilan,status")
    .eq("auth_user_id", data.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (investor) {
    return {
      id: data.user.id,
      name: investor.nama_tampilan ?? data.user.email ?? "Investor",
      email: data.user.email,
      kind: "investor",
      role: "investor",
      status: investor.status,
      investorId: investor.investor_id,
      usahaId: investor.usaha_id,
    };
  }

  // Authentication alone is not an application principal. Fail closed when
  // neither an active admin identity nor an active Investor exists.
  return null;
};

export const authProvider: AuthProvider = {
  login: async ({ email, password, providerName }) => {
    if (providerName === "google" || providerName === "github") {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: providerName as OAuthProvider,
        options: { redirectTo: window.location.origin },
      });

      if (error) {
        return {
          success: false,
          error: { name: "OAuthLoginError", message: error.message },
        };
      }

      return { success: true };
    }

    if (typeof email !== "string" || typeof password !== "string") {
      return {
        success: false,
        error: { name: "ValidationError", message: "Email dan password wajib diisi." },
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return {
        success: false,
        error: { name: "LoginError", message: error.message },
      };
    }

    const identity = data.user ? await getPrincipalIdentity() : null;
    if (!identity) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: {
          name: "AuthorizationError",
          message: "Akun ini belum memiliki akses aktif ke Usaha. Hubungi administrator.",
        },
      };
    }

    return {
      success: true,
      redirectTo: identity.kind === "investor" ? "/investor" : "/dashboard",
    };
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return {
        success: false,
        error: { name: "LogoutError", message: error.message },
      };
    }

    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data.session) {
      return { authenticated: false, logout: true, redirectTo: "/login" };
    }

    return { authenticated: true };
  },

  getIdentity: getPrincipalIdentity,

  getPermissions: async () => {
    const identity = await getPrincipalIdentity();
    return identity?.role ?? identity?.kind ?? null;
  },

  onError: async (error) => {
    if (error?.statusCode === 401 || error?.status === 401) {
      return { logout: true, redirectTo: "/login" };
    }

    return { error };
  },
};
