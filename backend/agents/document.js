const { extractPages } = require('../lib/pdfExtractor');
const { structurePages } = require('../lib/text');
const { looksLikeInjection } = require('../lib/injection');

/**
 * Document Agent: bytes -> pages -> sections of page-tagged passages.
 * Pure computation; the orchestrator persists the result.
 */
async function readDocument(buffer, { maxPages }) {
  const { pages, pageCount, pagesRead, truncated } = await extractPages(buffer, { maxPages });
  const sections = structurePages(pages).map((section) => ({
    ...section,
    passages: section.passages.map((p) => ({ ...p, flagged: looksLikeInjection(p.text) })),
  }));
  const passageCount = sections.reduce((n, s) => n + s.passages.length, 0);
  const flagged = sections.reduce((n, s) => n + s.passages.filter((p) => p.flagged).length, 0);
  return { sections, pageCount, pagesRead, truncated, passageCount, flagged };
}

module.exports = { readDocument };
