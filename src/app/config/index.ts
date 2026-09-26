const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_REF ?? "").trim();
const supabaseUrl = stripTrailingSlash(
  import.meta.env.VITE_SUPABASE_URL ||
    (projectRef ? `https://${projectRef}.supabase.co` : ""),
);
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

const projectRefOf = (value: string) => {
  if (!value) return projectRef;
  try {
    return new URL(value).hostname.split(".")[0] ?? projectRef;
  } catch {
    return projectRef;
  }
};

export const appConfig = {
  name: "Rental Admin",
  title: "Panel Admin — Rental Outdoor",
  refineProjectId: "Q6Z7J5-LupTFw-JtaUXB",
  apiUrl: import.meta.env.VITE_API_URL || "https://api.fake-rest.refine.dev",
  supabase: {
    url: supabaseUrl,
    projectRef: projectRefOf(supabaseUrl),
    anonKey: supabaseKey,
    restUrl: supabaseUrl ? `${supabaseUrl}/rest/v1` : "",
    isConfigured: Boolean(supabaseUrl && supabaseKey),
  },
} as const;
