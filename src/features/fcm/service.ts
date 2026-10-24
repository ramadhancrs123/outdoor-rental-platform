import { supabase } from "@/app/providers/supabase/client";
import type { FcmTokenResponse, FcmDeviceInfo } from "./types";

/**
 * Mendapatkan token FCM dari aplikasi Android melalui bridge JavaScript.
 * Kontrak: Android menyimpan token di SWVContext.fcm_token dan mengekspos
 * melalui window.AndroidInterface.getFCMToken() atau window.JSBridge.getFCMToken().
 */
interface AndroidNativeBridge { getFCMToken?: () => string; }
interface JsBridge { getFCMToken?: () => string; }

/** True only when the native JavaScript bridge is exposed by the Android WebView. */
export function hasAndroidFcmBridge(): boolean {
  try {
    if (typeof window === "undefined") return false;

    const bridges = window as unknown as Record<string, AndroidNativeBridge | null>;
    return ["AndroidInterface", "JSBridge"].some((name) => {
      const bridge = bridges[name];
      return bridge !== null && bridge !== undefined && typeof bridge.getFCMToken === "function";
    });
  } catch {
    return false;
  }
}

export function retrieveFcmTokenFromAndroid(): FcmTokenResponse {
  try {
    if (typeof window === "undefined") {
      return { token: null, source: null };
    }

    // Prioritas: interface utama Android (SmartWebView WebAppInterface)
    const nativeInterface = (window as unknown as Record<string, AndroidNativeBridge | null>)["AndroidInterface"] ?? null;
    if (nativeInterface && typeof nativeInterface.getFCMToken === "function") {
      const tokenValue = nativeInterface.getFCMToken?.();
      const token = typeof tokenValue === "string" ? tokenValue : "";
      if (token.length > 0) {
        return { token, source: "android_interface" };
      }
    }

    // Fallback: JS bridge plugin (JSInterfacePlugin)
    const jsBridge = (window as unknown as Record<string, JsBridge | null>)["JSBridge"] ?? null;
    if (jsBridge && typeof jsBridge.getFCMToken === "function") {
      const tokenValue = jsBridge.getFCMToken?.();
      const token = typeof tokenValue === "string" ? tokenValue : "";
      if (token.length > 0) {
        return { token, source: "js_bridge" };
      }
    }

    return { token: null, source: null };
  } catch {
    return { token: null, source: null };
  }
}

export function buildDeviceInfo(): FcmDeviceInfo {
  try {
    if (typeof window === "undefined") return {};
    return {
      user_agent: window.navigator?.userAgent || "",
      app_version: "1.0.0",
    };
  } catch {
    return {};
  }
}

/**
 * Menyimpan atau memperbarui token FCM ke tabel user_devices sesuai kontrak
 * database (public.user_devices) dengan RLS multi-tenant.
 *
 * Parameter:
 * - usahaId: UUID tenant (dari CurrentUsahaContext atau investor context)
 * - userType: 'admin' | 'investor'
 * - userId: akun_admin_id atau investor_id
 * - token: token FCM dari Android
 */
export async function registerFcmDeviceToken(
  usahaId: string,
  userType: "admin" | "investor",
  userId: string,
  token: string,
  deviceInfo?: FcmDeviceInfo,
): Promise<{ success: boolean; error?: string }> {
  if (!usahaId || !userType || !userId || !token) {
    return { success: false, error: "Parameter wajib lengkap: usahaId, userType, userId, token." };
  }

  try {
    const payload = {
      usaha_id: usahaId,
      user_type: userType,
      user_id: userId,
      fcm_token: token,
      platform: "android",
      device_info: deviceInfo ?? buildDeviceInfo(),
      is_active: true,
      last_used_at: new Date().toISOString(),
    };

    // Kontrak database memiliki unique index:
    // user_devices_usaha_id_user_type_user_id_fcm_token_key (usaha_id, user_type, user_id, fcm_token)
    // Kita menggunakan onConflict sesuai indeks aktual agar operasi upsert sah.
    const { error } = await supabase
      .from("user_devices")
      .upsert(payload, {
        onConflict: "usaha_id,user_type,user_id,fcm_token",
        ignoreDuplicates: false,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (cause) {
    return { success: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
