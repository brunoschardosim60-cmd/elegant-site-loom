import type { ReactNode } from "react";
import { isPlaceholder, legalConfig } from "@/lib/legal-config";

/** A configured fact, highlighted while it still needs to be filled in. */
export function Fact({ value }: { value: string }) {
  return isPlaceholder(value) ? <mark className="legal-placeholder">{value}</mark> : <>{value}</>;
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <article>
        <a className="legal-brand" href="/">
          confere.
        </a>
        <h1>{title}</h1>
        <p className="legal-updated">Última atualização: {legalConfig.updatedAt}</p>
        {children}
        <nav className="legal-links" aria-label="Documentos">
          <a href="/privacidade">Política de privacidade</a>
          <a href="/termos">Termos de uso</a>
          <a href="/">Voltar ao sistema</a>
        </nav>
      </article>
    </main>
  );
}

export function LegalFooter() {
  return (
    <nav className="legal-footer" aria-label="Documentos legais">
      <a href="/privacidade">Privacidade</a>
      <span aria-hidden="true">·</span>
      <a href="/termos">Termos de uso</a>
    </nav>
  );
}
