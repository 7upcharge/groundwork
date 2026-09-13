const { splitBlocks, summarize, extractKeyTerms } = require('./summarizer');

/**
 * Splits lecture text into sections at heading-shaped lines (slide titles,
 * "Stage 2: The Krebs Cycle", ...). Text before the first heading goes under
 * "Key Points". Paragraph breaks are preserved in `body` so downstream
 * sentence splitting and LLM chunking keep the document's structure.
 */
function splitIntoSections(text) {
  const sections = [];
  let current = { title: 'Key Points', paragraphs: [] };

  for (const block of splitBlocks(text)) {
    if (block.heading) {
      if (current.paragraphs.length > 0) sections.push(current);
      current = { title: block.text, paragraphs: [] };
    } else {
      current.paragraphs.push(block.text);
    }
  }
  if (current.paragraphs.length > 0) sections.push(current);

  return sections.map((s) => ({ title: s.title, body: s.paragraphs.join('\n\n') }));
}

/**
 * Condensed revision notes: TL;DR, per-section bullets and key terms —
 * all extracted verbatim from the source.
 */
function buildNotes(text, options = {}) {
  const { sentencesPerSection = 3, tldrSentences = 3, glossarySize = 10 } = options;

  const sectionNotes = splitIntoSections(text)
    .map((section) => ({ title: section.title, bullets: summarize(section.body, sentencesPerSection) }))
    .filter((section) => section.bullets.length > 0);

  return {
    tldr: summarize(text, tldrSentences),
    sections: sectionNotes,
    glossary: extractKeyTerms(text, glossarySize),
  };
}

module.exports = { buildNotes, splitIntoSections };
