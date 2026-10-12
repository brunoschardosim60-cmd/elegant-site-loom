import { pathToFileURL } from 'node:url';

/** Build-only metadata probe. Never sends photos or generates content. */
export async function checkGeminiBackup({ env = process.env, fetch = globalThis.fetch, log = console.log } = {}) {
  const emit = outcome => { log(`[gemini_backup_check] ${outcome}`); return outcome; };
  const key = env.GEMINI_API_KEY_FALLBACK?.trim();
  if (!key) return emit('SKIP');
  const model = env.GEMINI_OCR_MODEL?.trim() || 'gemini-3.8-flash';
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve('CHECK_FAILED TIMEOUT'); }, 5000);
  });
  const probe = async () => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      method: 'GET', redirect: 'error', headers: { 'x-goog-api-key': key }, signal: controller.signal,
    });
    if (controller.signal.aborted) return 'CHECK_FAILED TIMEOUT';
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'UNKNOWN';
    if (response.status !== 200) return `CHECK_FAILED HTTP_${status}`;
    let metadata;
    try { metadata = await response.json(); }
    catch { return controller.signal.aborted ? 'CHECK_FAILED TIMEOUT' : 'CHECK_FAILED HTTP_200'; }
    if (controller.signal.aborted) return 'CHECK_FAILED TIMEOUT';
    return metadata?.name === `models/${model}` && Array.isArray(metadata.supportedGenerationMethods) && metadata.supportedGenerationMethods.includes('generateContent')
      ? 'OK HTTP_200' : 'CHECK_FAILED HTTP_200';
  };
  try { return emit(await Promise.race([probe(), timeout])); }
  catch { return emit(controller.signal.aborted ? 'CHECK_FAILED TIMEOUT' : 'CHECK_FAILED HTTP_UNKNOWN'); }
  finally { clearTimeout(timer); }
}

// Importing this module in fixture tests must not make a remote request.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkGeminiBackup();
