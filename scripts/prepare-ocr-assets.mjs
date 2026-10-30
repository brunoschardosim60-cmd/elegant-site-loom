import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copy only installed, lockfile-pinned assets. The browser never downloads OCR
// code or language data from a third-party CDN, which corporate firewalls often block.
const require = createRequire(import.meta.url);
const target = fileURLToPath(new URL("../public/ocr-assets/", import.meta.url));
const worker = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const language = dirname(require.resolve("@tesseract.js-data/por/package.json"));
await mkdir(join(target, "core"), { recursive: true });
await mkdir(join(target, "lang"), { recursive: true });
// Same LSTM "best_int" model tesseract.js would otherwise fetch from jsDelivr.
await copyFile(
  join(language, "4.0.0_best_int/por.traineddata.gz"),
  join(target, "lang/por.traineddata.gz"),
);
await copyFile(join(worker, "dist/worker.min.js"), join(target, "worker.min.js"));
await copyFile(join(worker, "LICENSE.md"), join(target, "LICENSE-tesseract.md"));
await copyFile(join(core, "LICENSE"), join(target, "core/LICENSE"));
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"])
  for (const extension of ["wasm.js", "wasm"])
    await copyFile(
      join(core, `tesseract-core-${variant}.${extension}`),
      join(target, "core", `tesseract-core-${variant}.${extension}`),
    );
console.log("OCR assets and language data prepared from the installed lockfile.");
