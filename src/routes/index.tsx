import { createFileRoute } from "@tanstack/react-router";
import { ConferenceWorkspace } from "@/components/conference-workspace";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "confere. — Conferência de CTC e pré-manifestos" },
    { name: "description", content: "Controle de retorno de documentos: confira CTCs, acompanhe pendências por motorista e finalize pré-manifestos." },
    { property: "og:title", content: "confere. — Cada documento no seu lugar" },
    { property: "og:description", content: "Conferência rápida de CTCs e acompanhamento de pré-manifestos e documentos pendentes." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ConferenceWorkspace,
});
