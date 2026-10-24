import { useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import {
  hasAndroidFcmBridge,
  retrieveFcmTokenFromAndroid,
  registerFcmDeviceToken,
} from "./service";
import type { PrincipalIdentity } from "@/app/providers/auth";

export function useFcmDeviceRegistration() {
  const { data: identity } = useGetIdentity<PrincipalIdentity>();
  const { current } = useCurrentUsaha();
  const [status, setStatus] = useState<"idle" | "checking" | "registered" | "failed">("idle");
  const [tokenLength, setTokenLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const identityKind = identity?.kind ?? null;
  const identityId = identity?.id ?? null;
  const investorId = identity?.investorId ?? null;
  const usahaId = current?.usahaId ?? identity?.usahaId ?? null;
  const adminId = current?.akunAdminId ?? null;
  const userType: "admin" | "investor" = identityKind === "investor" ? "investor" : "admin";
  // Use the domain IDs required by user_devices RLS, never auth.uid() as a fallback.
  const userId = identityKind === "investor" ? investorId : adminId;

  useEffect(() => {
    // Wait until authentication and tenant resolution have completed.
    if (!identityKind || !identityId || !usahaId) return;
    if (!userId) {
      setStatus("failed");
      setError(identityKind === "investor"
        ? "ID investor tidak tersedia."
        : "ID akun admin tidak tersedia.");
      return;
    }

    let cancelled = false;
    let tokenRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let tokenAttempts = 0;
    const maxTokenAttempts = 30;

    const attemptRegistration = async () => {
      if (cancelled) return;

      const tokenResult = retrieveFcmTokenFromAndroid();
      if (!tokenResult.token) {
        setTokenLength(null);

        // In a regular browser there is no native bridge, so don't poll.
        // In Android WebView the bridge can be ready before Firebase finishes
        // its asynchronous getToken() call; retry briefly to close that race.
        if (!hasAndroidFcmBridge()) {
          setStatus("idle");
          setError(null);
          return;
        }

        setStatus("checking");
        tokenAttempts += 1;
        if (tokenAttempts >= maxTokenAttempts) {
          setStatus("failed");
          setError("Bridge Android tersedia, tetapi token FCM belum siap setelah 30 detik.");
          return;
        }

        tokenRetryTimer = setTimeout(() => {
          void attemptRegistration();
        }, 1000);
        return;
      }

      const token = tokenResult.token;
      setTokenLength(token.length);
      setStatus("checking");
      setError(null);

      try {
        const result = await registerFcmDeviceToken(
          usahaId,
          userType,
          userId,
          token,
        );

        if (cancelled) return;
        if (result.success) {
          setStatus("registered");
          setError(null);
        } else {
          setStatus("failed");
          setError(result.error ?? "Registrasi gagal tanpa pesan error.");
        }
      } catch (cause) {
        if (cancelled) return;
        setStatus("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void attemptRegistration();

    return () => {
      cancelled = true;
      if (tokenRetryTimer !== null) clearTimeout(tokenRetryTimer);
    };
  }, [identityKind, identityId, investorId, usahaId, adminId, userId, userType, retryNonce]);

  return {
    status,
    tokenLength,
    error,
    retry: () => setRetryNonce((value) => value + 1),
  };
}
