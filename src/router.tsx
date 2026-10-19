import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = async () => {
  let nonce: string | undefined;
  if (import.meta.env.SSR) {
    const { readCspNonce } = await import("./lib/csp-nonce.server");
    nonce = readCspNonce();
  }
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ssr: nonce ? { nonce } : {},
  });

  return router;
};
