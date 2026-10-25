import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { supabase } from "@/app/providers/supabase/client";
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
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = loadVersion.current + 1;
    loadVersion.current = version;
    setStatus("loading");
    setError(null);
    setCurrent(null);

    try {
      const authorized = await listAuthorizedUsaha();
      if (version !== loadVersion.current) return;
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
      if (version !== loadVersion.current) return;
      writeSelectedUsahaId(context.usahaId);
      setCurrent(context);
      setStatus("ready");
    } catch (cause) {
      if (version !== loadVersion.current) return;
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

  // The provider mounts on the login route too. If the first load runs before
  // authentication completes, reload the authorized tenant context on sign-in.
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        window.setTimeout(() => {
          if (active) void load();
        }, 0);
      } else if (event === "SIGNED_OUT") {
        loadVersion.current = loadVersion.current + 1;
        setStatus("loading");
        setCurrent(null);
        setAvailable([]);
        setError(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [load]);

  const selectUsaha = useCallback(async (usahaId: string) => {
    const version = loadVersion.current + 1;
    loadVersion.current = version;
    setStatus("loading");
    setError(null);
    setCurrent(null);

    try {
      const context = await resolveTenantContext(undefined, usahaId);
      if (version !== loadVersion.current) return;
      writeSelectedUsahaId(context.usahaId);
      setAvailable((previous) => {
        if (previous.some((usaha) => usaha.usahaId === context.usahaId)) return previous;
        return [...previous, { usahaId: context.usahaId, usahaNama: context.usahaNama }];
      });
      setCurrent(context);
      setStatus("ready");
    } catch (cause) {
      if (version !== loadVersion.current) return;
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
