import type { AuthProvider } from "@refinedev/core";
import { supabase } from "./supabase/client";

type OAuthProvider = "google" | "github";

type AdminIdentity = {
  id: string;
  name: string;
  email?: string;
  role?: string | null;
  status?: string | null;
};

const getAdminIdentity = async (): Promise<AdminIdentity | null> => {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const { data: admin } = await supabase
    .from("akun_admin")
    .select("akun_admin_id,nama_tampilan,role,status")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    name: admin?.nama_tampilan ?? data.user.email ?? "Admin",
    email: data.user.email,
    role: admin?.role ?? null,
    status: admin?.status ?? null,
  };
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
        error: {
          name: "ValidationError",
          message: "Email dan password wajib diisi.",
        },
      };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        success: false,
        error: { name: "LoginError", message: error.message },
      };
    }

    return { success: true, redirectTo: "/dashboard" };
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
      return {
        authenticated: false,
        logout: true,
        redirectTo: "/login",
      };
    }

    return { authenticated: true };
  },

  getIdentity: getAdminIdentity,

  getPermissions: async () => {
    const identity = await getAdminIdentity();
    return identity?.role ?? null;
  },

  onError: async (error) => {
    if (error?.statusCode === 401 || error?.status === 401) {
      return { logout: true, redirectTo: "/login" };
    }

    return { error };
  },
};
