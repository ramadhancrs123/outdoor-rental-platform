import { useCallback, useEffect, useRef, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { retrieveFcmTokenFromAndroid, registerFcmDeviceToken } from "./service";
import type { AdminIdentity } from "@/pages/dashboard";

export function useFcmDeviceRegistration() {
  const { data: identity } = useGetIdentity<AdminIdentity>();
  const { current } = useCurrentUsaha();
  const [status, setStatus] = useState<"idle" | "checking" | "registered" | "failed">("idle");
  const [tokenLength, setTokenLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  const attemptRegistration = useCallback(async () => {
    // 1. Bridge tersedia?
    const tokenResult = retrieveFcmTokenFromAndroid();
    if (!tokenResult.token) {
      setStatus("idle");
      setTokenLength(null);
      // Tidak ada token: tidak melakukan registrasi; ini kondisi normal saat
      // aplikasi tidak berjalan di dalam WebView Android.
      return;
    }

    const tokenStr = tokenResult.token;
    const tokenLen = tokenStr.length;
    setTokenLength(tokenLen);
    setStatus("checking");

    if (!current || !identity) {
      setStatus("idle");
      setError("Tenant atau identitas belum tersedia.");
      return;
    }

    const usahaId = current.usahaId;
    const adminId = current.akunAdminId;

    // 2. Pemetaan identitas admin
    // Kontrak: user_id = akun_admin_id (dari keanggotaan_usaha), bukan auth.uid().
    // Kita menggunakan adminId yang sudah diselesaikan oleh resolveTenantContext.
    const userType = identity.kind === "investor" ? "investor" : "admin";
    const userId = identity.kind === "investor" ? identity.investorId ?? identity.id : adminId ?? identity.id;

    if (!usahaId || !userId) {
      setStatus("failed");
      setError("Identitas admin atau tenant tidak lengkap.");
      return;
    }

    try {
      // 3. Registrasi dengan kontrak upsert yang sesuai indeks aktual
      const result = await registerFcmDeviceToken(
        usahaId,
        userType,
        userId,
        tokenStr,
      );

      if (result.success) {
        setStatus("registered");
        setError(null);
      } else {
        setStatus("failed");
        setError(result.error ?? "Registrasi gagal tanpa pesan error.");
      }
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [current, identity]);

  useEffect(() => {
    // Hindari race condition: tunggu hingga auth dan tenant siap.
    if (current && identity && !attemptedRef.current) {
      attemptedRef.current = true;
      void attemptRegistration();
    }
  }, [current, identity, attemptRegistration]);

  return { status, tokenLength, error, retry: () => { attemptedRef.current = false; void attemptRegistration(); } };
}
