import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Code under server/ and "server-only" imports must never reach the browser bundle.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Bundle the server from src/server.ts (security headers and SSR error wrapper).
      server: { entry: "server" },
    }),
  ];
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    // Nitro detects the hosting platform (e.g. Vercel) from the build environment;
    // the default preset only applies to local builds.
    plugins.push(nitro({ defaultPreset: "cloudflare-module" }));
  }
  plugins.push(viteReact());
  return {
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    plugins,
  };
});
