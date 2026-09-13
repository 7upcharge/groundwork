const PDF_MAGIC_BYTES = Buffer.from('%PDF-');
const MIN_TEXT_CHARS = 100;

class InvalidPdfError extends Error {}
class EmptyPdfError extends Error {}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        require('pdfjs-dist/legacy/build/pdf.worker.mjs');
      } catch {
        /* ignore */
      }

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
  if (!buffer || buffer.length < 5) return false;
  const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  return header.includes('%PDF-');
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
  const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const loadingTask = pdfjs.getDocument({
    data: uint8Data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    if (err && (err.name === 'PasswordException' || (err.message && err.message.toLowerCase().includes('password')))) {
      throw new InvalidPdfError('This PDF is password-protected. Please upload an unprotected PDF.');
    }
    console.error('PDF.js parsing error details:', err);
    throw new InvalidPdfError(err && err.message ? err.message : 'This PDF could not be opened.');
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
