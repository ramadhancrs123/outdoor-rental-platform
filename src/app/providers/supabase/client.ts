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
  },
);
