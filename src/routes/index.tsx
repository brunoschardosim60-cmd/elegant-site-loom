import { createFileRoute } from "@tanstack/react-router";
import { AccountWorkspace } from "@/components/account-workspace";

// WhatsApp and Facebook need an absolute image URL; set VITE_SITE_URL to the
// public address (e.g. https://confere.example.com) at build time.
const siteUrl = (import.meta.env["VITE_SITE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";
const shareImage = `${siteUrl}/og-image.png`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "confere. — Conferência de CTC e pré-manifestos" },
      {
        name: "description",
        content:
          "Controle de retorno de documentos: confira CTCs, acompanhe pendências por motorista e finalize pré-manifestos.",
      },
      { property: "og:title", content: "confere. — Cada documento no seu lugar" },
      {
        property: "og:description",
        content:
          "Conferência rápida de CTCs e acompanhamento de pré-manifestos e documentos pendentes.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: shareImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "confere. — Conferência de CTCs e pré-manifestos" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: shareImage },
    ],
  }),
  component: AccountWorkspace,
});
