import type { DataProvider } from "@refinedev/core";
import { createSimpleRestDataProvider } from "@refinedev/rest/simple-rest";
import { appConfig } from "@/app/config";
import { supabaseDataProvider } from "./supabase/data-provider";

function resolveDataProvider(): DataProvider {
  if (appConfig.supabase.isConfigured) return supabaseDataProvider;

  console.warn(
    "[providers] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum terisi. " +
      "Isi file .env untuk tersambung ke Supabase — sementara memakai REST demo.",
  );
  return createSimpleRestDataProvider({ apiURL: appConfig.apiUrl }).dataProvider;
}

export const dataProvider = resolveDataProvider();
