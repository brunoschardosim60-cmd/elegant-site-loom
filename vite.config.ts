import path from "node:path";
import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// lightningcss encodes versions as major << 16.
const legacyTargets = { chrome: 109 << 16, edge: 109 << 16, firefox: 115 << 16, safari: 15 << 16 };

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
    // Older warehouse PCs stop at Chrome/Edge 109 (Windows 7/8) or Firefox 115 ESR,
    // which lack oklch()/color-mix(). Compile colours down so they look identical.
    css: {
      transformer: "lightningcss" as const,
      lightningcss: { targets: legacyTargets },
    },
    build: { cssTarget: ["chrome109", "edge109", "firefox115", "safari15"] },
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
