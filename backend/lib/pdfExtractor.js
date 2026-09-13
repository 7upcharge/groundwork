const PDF_MAGIC_BYTES = Buffer.from('%PDF-');
const MAX_PAGES = 40;
const MIN_TEXT_CHARS = 100;

class InvalidPdfError extends Error {}
class EmptyPdfError extends Error {}

let pdfjsPromise = null;
function loadPdfjs() {
  // pdfjs-dist ships ESM only; load lazily from this CommonJS module.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
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
 * Extracts text from a PDF buffer.
 * - Validates real PDF magic bytes (client mimetype/extension can be spoofed).
 * - Each call opens an independent document and destroys it afterwards, so
 *   no content can leak between students' uploads.
 * - Caps pages processed to bound CPU time on very large uploads.
 * - Rejects text-less (scanned/image-only) PDFs with an actionable message.
 */
async function extractText(buffer) {
  if (!isPdfMagicBytes(buffer)) {
    throw new InvalidPdfError('File is not a valid PDF.');
  }

  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer), // copy: pdf.js takes ownership of the bytes
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy();
    throw new InvalidPdfError('This PDF appears to be corrupted or password-protected and could not be opened.');
  }

  try {
    const pageCount = doc.numPages;
    const pagesToRead = Math.min(pageCount, MAX_PAGES);
    const pages = [];
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items));
      page.cleanup();
    }

    const text = pages.join('\n\n').trim();
    if (text.length < MIN_TEXT_CHARS) {
      throw new EmptyPdfError(
        'No readable text found in this PDF. It may be a scanned or image-only document — try a text-based lecture PDF.'
      );
    }

    return { text, pageCount, pagesRead: pagesToRead, truncated: pageCount > pagesToRead };
  } finally {
    await loadingTask.destroy();
  }
}

module.exports = { extractText, isPdfMagicBytes, InvalidPdfError, EmptyPdfError, MAX_PAGES };
