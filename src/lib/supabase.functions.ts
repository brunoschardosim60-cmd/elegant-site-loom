import { createServerFn } from "@tanstack/react-start";
import { publicSupabaseConfig } from "./supabase-config";

// Publishable key only. Never return a secret/service-role key to the browser.
export const getSupabaseConfig = createServerFn({ method: "GET" }).handler(async () =>
  publicSupabaseConfig(process.env),
);
