/**
 * Facts only the contracting company can provide. Fill these in, and have the
 * privacy policy and terms reviewed by the company's legal team, before use.
 * Any value still starting with "[PREENCHER" is shown highlighted on the pages.
 */
export const legalConfig = {
  /** Company that decides how the data is used (controladora, LGPD art. 5º, VI). */
  controller: "[PREENCHER: razão social da empresa]",
  controllerCnpj: "[PREENCHER: CNPJ]",
  /** Encarregado (DPO) or privacy channel (LGPD art. 41). */
  privacyContact: "[PREENCHER: e-mail do encarregado de dados]",
  /** Supplier that develops and runs the system for the company (operador). */
  operator: "[PREENCHER: nome do fornecedor do sistema]",
  /** Region of the Supabase project, shown in the Supabase dashboard. */
  databaseRegion: "[PREENCHER: região do banco Supabase]",
  /** How long records are kept after the contract ends or the record closes. */
  retention: "[PREENCHER: prazo de guarda definido pela empresa]",
  updatedAt: "31/10/2026",
};

export const isPlaceholder = (value: string) => value.startsWith("[PREENCHER");
