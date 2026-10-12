// PDF text extraction via scribe.js (https://github.com/scribeocr/scribe.js).
//
// scribe.js has no build-free CDN distribution: it spawns its own module
// workers with `new Worker(new URL("./worker/…", import.meta.url))`, which the
// browser refuses when import.meta.url is a cross-origin CDN URL. Rather than
// vendoring the ~45 MB package into this static site, we load it from
// jsDelivr and wrap just its worker URLs in a same-origin blob worker that
// imports the real script. Inside the worker, import.meta.url is the CDN URL
// again, so scribe.js resolves its wasm, fonts and nested modules as usual.

const SCRIBE_VERSION = "0.16.1";
export const SCRIBE_BASE = `https://cdn.jsdelivr.net/npm/scribe.js-ocr@${SCRIBE_VERSION}/`;

// Returns the source of a same-origin blob worker that loads `url`, or null
// if `url` isn't a scribe.js worker and should be constructed unchanged.
export function workerShimSource(url, options) {
  const href = String(url instanceof URL ? url.href : url);
  if (!href.startsWith(SCRIBE_BASE)) return null;
  return options && options.type === "module"
    ? `import ${JSON.stringify(href)};`
    : `importScripts(${JSON.stringify(href)});`;
}

let shimInstalled = false;

function installWorkerShim() {
  if (shimInstalled) return;
  shimInstalled = true;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const src = workerShimSource(url, options);
      if (src) {
        const blobUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        super(blobUrl, options);
        // The worker fetches the blob as soon as it starts; revoking right
        // away would race that, so give it a moment.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      } else {
        super(url, options);
      }
    }
  };
}

let scribeReady = null;

// Loads scribe.js once per session. A failed load (e.g. a CDN hiccup) is not
// cached, so the next extraction retries.
function loadScribe() {
  if (!scribeReady) {
    installWorkerShim();
    scribeReady = import(`${SCRIBE_BASE}scribe.js`)
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
