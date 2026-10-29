import { createClient } from "@supabase/supabase-js";
import { appConfig } from "@/app/config";

export const supabase = createClient(
  appConfig.supabase.url,
  appConfig.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    // Resolve fetch at request time so tests and host wrappers can safely stub
    // network traffic even when this client module was imported earlier.
    // In production this remains the native browser fetch unless deliberately wrapped.
    global: {
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  },
);
