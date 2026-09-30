import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  listAuthorizedUsaha,
  resolveTenantContext,
  RenterReadError,
  type AuthorizedUsaha,
} from "@/features/penyewa/service";
import { CurrentUsahaContext, type CurrentUsahaContextValue } from "./current-usaha-context";

const STORAGE_KEY = "rental-admin.current-usaha-id";

function readSelectedUsahaId() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

function writeSelectedUsahaId(usahaId: string) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, usahaId);
}

function clearSelectedUsahaId() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
}

export function CurrentUsahaProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<CurrentUsahaContextValue["status"]>("loading");
  const [current, setCurrent] = useState<CurrentUsahaContextValue["current"]>(null);
  const [available, setAvailable] = useState<AuthorizedUsaha[]>([]);
  const [error, setError] = useState<RenterReadError | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setCurrent(null);

    try {
      const authorized = await listAuthorizedUsaha();
      setAvailable(authorized);

      const stored = readSelectedUsahaId();
      const selected = stored && authorized.some((usaha) => usaha.usahaId === stored)
        ? stored
        : authorized.length === 1
          ? authorized[0].usahaId
          : null;

      if (!selected) {
        if (authorized.length === 0) {
          throw new RenterReadError("Anda tidak memiliki akses ke Usaha aktif.", 403);
        }
        throw new RenterReadError("Pilih Usaha aktif sebelum membuka data operasional.", 409);
      }

      const context = await resolveTenantContext(undefined, selected);
      writeSelectedUsahaId(context.usahaId);
      setCurrent(context);
      setStatus("ready");
    } catch (cause) {
      const normalized = cause instanceof RenterReadError
        ? cause
        : new RenterReadError(cause instanceof Error ? cause.message : "Konteks Usaha gagal dimuat.", 500);
      setError(normalized);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectUsaha = useCallback(async (usahaId: string) => {
    setStatus("loading");
    setError(null);
    setCurrent(null);

    try {
      const context = await resolveTenantContext(undefined, usahaId);
      writeSelectedUsahaId(context.usahaId);
      setAvailable((previous) => {
        if (previous.some((usaha) => usaha.usahaId === context.usahaId)) return previous;
        return [...previous, { usahaId: context.usahaId, usahaNama: context.usahaNama }];
      });
      setCurrent(context);
      setStatus("ready");
    } catch (cause) {
      const normalized = cause instanceof RenterReadError
        ? cause
        : new RenterReadError(cause instanceof Error ? cause.message : "Usaha tidak dapat dipilih.", 500);
      setError(normalized);
      setStatus("error");
      clearSelectedUsahaId();
    }
  }, []);

  const value = useMemo<CurrentUsahaContextValue>(() => ({
    status,
    current,
    available,
    error,
    refresh: load,
    selectUsaha,
  }), [status, current, available, error, load, selectUsaha]);

  return <CurrentUsahaContext.Provider value={value}>{children}</CurrentUsahaContext.Provider>;
}
