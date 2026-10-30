/** Every OCR resource, including the language model, is served from our origin. */
export const ocrWorkerOptions = {
  workerPath: "/ocr-assets/worker.min.js",
  corePath: "/ocr-assets/core",
  langPath: "/ocr-assets/lang",
  workerBlobURL: false,
};
