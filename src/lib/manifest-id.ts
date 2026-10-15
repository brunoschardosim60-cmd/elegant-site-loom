/** Exported manifests use their literal numeric identifier; photo prés keep DI. */
export const manifestIdPattern = /^(?:DI\d{8,12}|\d{8,12})$/;
export const isExportManifest = (id: string) => /^\d{8,12}$/.test(id);
export const manifestNoun = (id: string) => isExportManifest(id) ? 'manifesto' : 'pré';
