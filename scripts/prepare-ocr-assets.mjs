import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copy only installed, lockfile-pinned code. Never download executable code
// at runtime from a CDN. The language training file remains non-executable data.
const require = createRequire(import.meta.url);
const target = fileURLToPath(new URL("../public/ocr-assets/", import.meta.url));
const worker = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
await mkdir(join(target, "core"), { recursive: true });
await copyFile(join(worker, "dist/worker.min.js"), join(target, "worker.min.js"));
await copyFile(join(worker, "LICENSE.md"), join(target, "LICENSE-tesseract.md"));
await copyFile(join(core, "LICENSE"), join(target, "core/LICENSE"));
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"])
  for (const extension of ["wasm.js", "wasm"])
    await copyFile(
      join(core, `tesseract-core-${variant}.${extension}`),
      join(target, "core", `tesseract-core-${variant}.${extension}`),
    );
console.log("OCR executable assets prepared from the installed lockfile.");
