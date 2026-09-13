const fs = require('fs');
const path = require('path');
const { extractPages, isPdfMagicBytes, InvalidPdfError, EmptyPdfError } = require('../lib/pdfExtractor');

const SAMPLES_DIR = path.join(__dirname, '..', '..', 'samples');

async function run({ test, assert }) {
  await test('isPdfMagicBytes: accepts a real PDF header, rejects spoofed content', () => {
    assert.ok(isPdfMagicBytes(Buffer.from('%PDF-1.4\n...')));
    assert.strictEqual(isPdfMagicBytes(Buffer.from('<html>not a pdf</html>')), false);
  });

  await test('extractPages: extracts real text from the sample lecture', async () => {
    const { pages } = await extractPages(fs.readFileSync(path.join(SAMPLES_DIR, 'sample-lecture.pdf')), { maxPages: 60 });
    assert.ok(pages.join('').includes('Cellular respiration is the set of metabolic reactions'));
  });

  await test('extractPages: no content leaks from one document into the next (regression)', async () => {
    // Regression: an earlier PDF library sometimes returned the previous
    // document's text for a small/blank PDF processed right after a real one.
    await extractPages(fs.readFileSync(path.join(SAMPLES_DIR, 'sample-lecture.pdf')), { maxPages: 60 });
    await assert.rejects(
      () => extractPages(fs.readFileSync(path.join(SAMPLES_DIR, 'blank-scan.pdf')), { maxPages: 60 }),
      EmptyPdfError
    );
  });

  await test('extractPages: a text-less (scanned) PDF raises an actionable EmptyPdfError', async () => {
    await assert.rejects(() => extractPages(fs.readFileSync(path.join(SAMPLES_DIR, 'blank-scan.pdf'))), EmptyPdfError);
  });

  await test('extractPages: a corrupted PDF raises InvalidPdfError instead of crashing', async () => {
    const corrupt = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage '.repeat(200))]);
    await assert.rejects(() => extractPages(corrupt), InvalidPdfError);
  });

  await test('extractPages: non-PDF bytes raise InvalidPdfError even with a spoofed header claim', async () => {
    await assert.rejects(() => extractPages(Buffer.from('MZ\x90\x00 not really a pdf')), InvalidPdfError);
  });

  await test('extractPages: caps pages read and reports truncation on a long document', async () => {
    const result = await extractPages(fs.readFileSync(path.join(SAMPLES_DIR, 'large-lecture.pdf')), { maxPages: 5 });
    assert.strictEqual(result.pagesRead, 5);
    assert.ok(result.truncated);
    assert.ok(result.pageCount > 5);
  });
}

module.exports = { run };
