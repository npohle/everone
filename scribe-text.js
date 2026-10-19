// PDF text extraction via scribe.js (https://github.com/scribeocr/scribe.js).
//
// scribe.js spawns its module workers with
// `new Worker(new URL("./worker/…", import.meta.url))`, and its workers spawn
// further workers (e.g. the Tesseract engine) the same way. Browsers refuse a
// cross-origin worker script, so loading scribe.js from a CDN breaks as soon
// as it starts a worker. The package is therefore vendored under
// vendor/scribe.js-ocr/ (see vendor/README.md) and served from this site's
// own origin, where every relative worker, wasm and font URL just works.

export const SCRIBE_VERSION = "0.16.1";
export const SCRIBE_BASE = new URL("./vendor/scribe.js-ocr/", import.meta.url);

let scribeReady = null;

// Loads scribe.js once per session. A failed load (e.g. a network hiccup) is
// not cached, so the next extraction retries.
function loadScribe() {
  if (!scribeReady) {
    scribeReady = import(new URL("scribe.js", SCRIBE_BASE).href)
      .then((mod) => mod.default)
      .catch((err) => {
        scribeReady = null;
        throw err;
      });
  }
  return scribeReady;
}

// Extracts the text of a PDF. Text-native PDFs have their embedded text read
// directly; image-only PDFs fall back to OCR.
export async function extractPdfText(blob, name) {
  const scribe = await loadScribe();
  const file = new File([blob], name, { type: "application/pdf" });
  return scribe.extractText([file]);
}
