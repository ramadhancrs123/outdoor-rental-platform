import { useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import {
  hasAndroidFcmBridge,
  isLikelyAndroidWebView,
  reportFcmDiagnostic,
  retrieveFcmTokenFromAndroid,
  registerFcmDeviceToken,
  type FcmDiagnostic,
  type FcmDiagnosticStage,
} from "./service";
import type { PrincipalIdentity } from "@/app/providers/auth";

export function useFcmDeviceRegistration() {
  const { data: identity } = useGetIdentity<PrincipalIdentity>();
  const { current } = useCurrentUsaha();
  const [status, setStatus] = useState<"idle" | "checking" | "registered" | "failed">("idle");
  const [tokenLength, setTokenLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // The authorized tenant context is a trusted fallback for admins if Refine's
  // identity query has not hydrated yet. It is resolved from the authenticated
  // session and active membership, and provides the domain ID required by RLS.
  const adminId = current?.akunAdminId ?? null;
  const identityKind = identity?.kind ?? (adminId ? "admin" : null);
  const identityId = identity?.id ?? (identityKind === "admin" ? adminId : null);
  const investorId = identity?.investorId ?? null;
  const usahaId = current?.usahaId ?? identity?.usahaId ?? null;
  const userType: "admin" | "investor" = identityKind === "investor" ? "investor" : "admin";
  const userId = userType === "investor" ? investorId : adminId;
  const identityReady = Boolean(identityKind && identityId && userId);
  const tenantReady = Boolean(usahaId);

  useEffect(() => {
    const nativeWebView = isLikelyAndroidWebView();
    const initialBridgeReady = hasAndroidFcmBridge();

    // Keep normal browsers quiet. A WebView UA without the bridge is a distinct
    // failure mode and must be diagnosed/retried instead of silently idling.
    if (!initialBridgeReady && !nativeWebView) {
      setStatus("idle");
      setTokenLength(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let bridgeReported = false;
    let contextReported = false;
    let tokenReported = false;
    const attempts: Record<"bridge" | "context" | "token", number> = {
      bridge: 0,
      context: 0,
      token: 0,
    };
    const maxAttempts = 30;

    const diagnostic = (stage: FcmDiagnosticStage, extras: Partial<FcmDiagnostic> = {}) => {
      void reportFcmDiagnostic({
        stage,
        has_bridge: hasAndroidFcmBridge(),
        identity_ready: identityReady,
        tenant_ready: tenantReady,
        ...(identityKind ? { user_type: identityKind } : {}),
        ...extras,
      });
    };

    const retry = (
      key: "bridge" | "context" | "token",
      timeoutStage: "bridge_timeout" | "context_timeout" | "token_timeout",
      message: string,
    ) => {
      attempts[key] += 1;
      if (attempts[key] >= maxAttempts) {
        setStatus("failed");
        setError(message);
        diagnostic(timeoutStage, { error_code: timeoutStage, token_length: null });
        return;
      }
      retryTimer = setTimeout(() => {
        void attemptRegistration();
      }, 1000);
    };

    const attemptRegistration = async () => {
      if (cancelled) return;

      const bridgeReady = hasAndroidFcmBridge();
      if (!bridgeReady) {
        if (!nativeWebView) {
          setStatus("idle");
          setError(null);
          return;
        }
        setStatus("checking");
        if (!bridgeReported) {
          diagnostic("bridge_missing", { token_length: null });
          bridgeReported = true;
        }
        retry("bridge", "bridge_timeout", "Bridge FCM Android tidak tersedia setelah 30 detik.");
        return;
      }

      if (!identityReady || !identityKind || !identityId || !usahaId || !userId) {
        setStatus("checking");
        setError(null);
        if (!contextReported) {
          diagnostic("waiting_context", { token_length: null });
          contextReported = true;
        }
        retry("context", "context_timeout", "Identitas admin/investor atau konteks usaha belum siap setelah 30 detik.");
        return;
      }

      const tokenResult = retrieveFcmTokenFromAndroid();
      if (!tokenResult.token) {
        setStatus("checking");
        setTokenLength(null);
        setError(null);
        if (!tokenReported) {
          diagnostic("waiting_token", { token_length: null });
          tokenReported = true;
        }
        retry("token", "token_timeout", "Bridge Android tersedia, tetapi token FCM belum siap setelah 30 detik.");
        return;
      }

      const token = tokenResult.token;
      setTokenLength(token.length);
      setStatus("checking");
      setError(null);

      try {
        const result = await registerFcmDeviceToken(usahaId, userType, userId, token);
        if (cancelled) return;
        if (result.success) {
          setStatus("registered");
          setError(null);
          diagnostic("registered", { token_length: token.length });
        } else {
          const message = result.error ?? "Registrasi gagal tanpa pesan error.";
          setStatus("failed");
          setError(message);
          const normalized = message.toLowerCase();
          const errorCode: FcmDiagnostic["error_code"] =
            normalized.includes("permission") || normalized.includes("row-level") || normalized.includes("42501") || normalized.includes("403")
              ? "database_permission"
              : normalized.includes("duplicate") || normalized.includes("unique") || normalized.includes("conflict") || normalized.includes("409")
                ? "duplicate_conflict"
                : "registration_failed";
          diagnostic("registration_failed", { token_length: token.length, error_code: errorCode });
        }
      } catch {
        if (cancelled) return;
        setStatus("failed");
        setError("Registrasi token FCM gagal karena kesalahan tak terduga.");
        diagnostic("registration_failed", { token_length: token.length, error_code: "registration_failed" });
      }
    };

    setStatus("checking");
    setError(null);
    void attemptRegistration();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [identityKind, identityId, investorId, usahaId, adminId, userId, userType, identityReady, tenantReady, retryNonce]);

  return {
    status,
    tokenLength,
    error,
    retry: () => setRetryNonce((value) => value + 1),
  };
}
