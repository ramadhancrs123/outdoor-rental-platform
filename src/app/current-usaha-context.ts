import { createContext, useContext } from "react";
import type { RenterReadError, AuthorizedUsaha, TenantContext } from "@/features/penyewa/service";

export type CurrentUsahaContextValue = {
  status: "loading" | "ready" | "error";
  current: TenantContext | null;
  available: AuthorizedUsaha[];
  error: RenterReadError | null;
  refresh: () => Promise<void>;
  selectUsaha: (usahaId: string) => Promise<void>;
};

export const CurrentUsahaContext = createContext<CurrentUsahaContextValue | null>(null);

export function useCurrentUsaha() {
  const context = useContext(CurrentUsahaContext);
  if (!context) throw new Error("useCurrentUsaha must be used within CurrentUsahaProvider");
  return context;
}
