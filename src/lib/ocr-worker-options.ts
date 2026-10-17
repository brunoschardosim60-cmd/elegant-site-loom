/** Keep executable OCR resources on our origin; only trained data comes from CDN. */
export const ocrWorkerOptions = {
  workerPath: "/ocr-assets/worker.min.js",
  corePath: "/ocr-assets/core",
  workerBlobURL: false,
};
