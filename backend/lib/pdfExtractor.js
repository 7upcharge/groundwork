const PDF_MAGIC_BYTES = Buffer.from('%PDF-');
const MIN_TEXT_CHARS = 100;

class InvalidPdfError extends Error {}
class EmptyPdfError extends Error {}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        return require('pdfjs-dist/legacy/build/pdf.mjs');
      } catch {
        return import('pdfjs-dist/legacy/build/pdf.mjs');
      }
    })();
  }
  return pdfjsPromise;
}

function isPdfMagicBytes(buffer) {
  return buffer.length > 5 && buffer.subarray(0, 5).equals(PDF_MAGIC_BYTES);
}

function pageItemsToText(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text;
}

/**
 * Extracts text page by page.
 * - Validates real PDF magic bytes (client mimetype/extension can be spoofed).
 * - Opens an independent pdf.js document per call and destroys it afterwards,
 *   so no content can leak between uploads.
 * - Disables eval and font loading (CVE-2024-4367 class of issues).
 * - Rejects text-less (scanned/image-only) PDFs with an actionable message.
 */
async function extractPages(buffer, { maxPages = 60 } = {}) {
  if (!isPdfMagicBytes(buffer)) throw new InvalidPdfError('This file is not a valid PDF.');

  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch {
    await loadingTask.destroy();
    throw new InvalidPdfError('This PDF is damaged or password-protected, so it couldn’t be opened.');
  }

  try {
    const pageCount = doc.numPages;
    const pagesRead = Math.min(pageCount, maxPages);
    const pages = [];
    for (let i = 1; i <= pagesRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items));
      page.cleanup();
    }

    if (pages.join('').replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
      throw new EmptyPdfError(
        'There’s no selectable text in this PDF. It may be scanned or made of images — try a text-based copy of the lecture.'
      );
    }
    return { pages, pageCount, pagesRead, truncated: pageCount > pagesRead };
  } finally {
    await loadingTask.destroy();
  }
}

module.exports = { extractPages, isPdfMagicBytes, InvalidPdfError, EmptyPdfError };
