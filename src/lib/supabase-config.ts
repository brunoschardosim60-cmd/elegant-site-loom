// Public project coordinates. Access is enforced by Supabase Auth and RLS.
// This is a publishable key, never a secret or service-role key.
export const supabaseConfig = {
  url: "https://wjrzhftbixcwaazbscoq.supabase.co",
  key: "sb_publishable_c8D0-i2VOwh-Dy4l-F6yMQ_XhfAWoQe",
};

/** Misconfigured server secrets must never become browser configuration. */
export function publicSupabaseConfig(env: Record<string, string | undefined>) {
  const url = env["SUPABASE_URL"] || supabaseConfig.url;
  const key = env["SUPABASE_PUBLISHABLE_KEY"] || supabaseConfig.key;
  const parsed = new URL(url);
  let publishable = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publishable && key.split(".").length === 3) {
    try {
      publishable =
        JSON.parse(atob(key.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/"))).role ===
        "anon";
    } catch {
      /* Not a legacy anon key. */
    }
  }
  if (
    !publishable ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Configuração pública de autenticação inválida.");
  return { url: parsed.origin, key };
}
