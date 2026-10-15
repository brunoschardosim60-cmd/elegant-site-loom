import { createServerFn } from "@tanstack/react-start";
import { supabaseConfig } from "./supabase-config";

// Publishable key only. Never return a secret/service-role key to the browser.
export const getSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => ({
  url: process.env["SUPABASE_URL"] || supabaseConfig.url,
  key: process.env["SUPABASE_PUBLISHABLE_KEY"] || supabaseConfig.key,
}));
