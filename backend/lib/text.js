const { STOPWORDS, GENERIC_ACADEMIC_WORDS } = require('./stopwords');

// Slide bullet glyphs as PDF extraction renders them, including Wingdings
// private-use characters and the "o " outline bullet.
const BULLET_PREFIX = /^(?:[•●▪■◦‣∙·*➢➤►▶✓–—-]|o(?=\s+[A-Z(“"]))\s+/;
const PAGE_NOISE = /^(?:\d{1,4}|[ivxlcdm]{1,6}|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\/\s*\d+)$/i;
const MAX_PASSAGE_CHARS = 900;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeadingLine(line) {
  const words = line.split(/\s+/);
  const lastWord = words[words.length - 1].toLowerCase();
  return (
    /^[A-Z0-9]/.test(line) &&
    words.length <= 9 &&
    (line.match(/[A-Za-z]/g) || []).length >= 3 &&
    !/[.!?;,:]$/.test(line) &&
    !STOPWORDS.has(lastWord)
  );
}

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.split(' ').length > 4);
}

// Splits an over-long block at sentence boundaries so each passage stays a
// readable, citable unit.
function splitLongBlock(text) {
  if (text.length <= MAX_PASSAGE_CHARS) return [text];
  const parts = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length + 1 > MAX_PASSAGE_CHARS) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Turns per-page text into sections of passages while keeping the page every
 * passage came from. Handles slide-deck noise: bullet glyphs, page numbers,
 * running headers/footers and titles repeated across slides (only the first
 * copy is kept, so repeated titles merge into one section).
 */
function structurePages(pages) {
  const lines = [];
  pages.forEach((pageText, index) => {
    for (const raw of String(pageText).split(/\r?\n/)) lines.push({ text: raw.trim(), page: index + 1 });
    lines.push({ text: '', page: index + 1 });
  });

  const headingCounts = new Map();
  for (const { text } of lines) {
    if (text && isHeadingLine(text)) headingCounts.set(text, (headingCounts.get(text) || 0) + 1);
  }

  const blocks = [];
  let current = null;
  const flush = () => {
    if (current) blocks.push({ heading: false, text: current.parts.join(' '), page: current.page });
    current = null;
  };
  const seenRepeated = new Set();

  for (const { text, page } of lines) {
    if (!text) {
      flush();
      continue;
    }
    if (PAGE_NOISE.test(text)) continue;
    if ((headingCounts.get(text) || 0) > 1) {
      if (seenRepeated.has(text)) continue;
      seenRepeated.add(text);
    }
    const bullet = BULLET_PREFIX.test(text);
    const content = text.replace(BULLET_PREFIX, '').trim();
    if (!content) continue;

    if (!bullet && isHeadingLine(content)) {
      flush();
      blocks.push({ heading: true, text: content, page });
    } else {
      if (bullet || (current && current.page !== page)) flush();
      if (!current) current = { parts: [], page };
      current.parts.push(content);
    }
  }
  flush();

  const sections = [];
  let section = null;
  for (const block of blocks) {
    if (block.heading) {
      if (section && section.passages.length > 0) sections.push(section);
      section = { title: block.text, pageStart: block.page, pageEnd: block.page, passages: [] };
      continue;
    }
    if (!section) section = { title: 'Introduction', pageStart: block.page, pageEnd: block.page, passages: [] };
    for (const part of splitLongBlock(block.text.replace(/\s+/g, ' '))) {
      if (part.split(' ').length < 3) continue;
      section.passages.push({ page: block.page, text: part });
      section.pageEnd = Math.max(section.pageEnd, block.page);
    }
  }
  if (section && section.passages.length > 0) sections.push(section);
  return sections;
}

const stem = (word) => word.replace(/(?:ies)$/, 'y').replace(/(?:es|s|ed|ing)$/, '');

function tokenize(text) {
  return normalize(text)
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function isContentWord(word) {
  return word.length > 3 && !STOPWORDS.has(word) && !GENERIC_ACADEMIC_WORDS.has(word) && !/^\d+$/.test(word);
}

/** Word-frequency sentence scores (length-normalized). */
function scoreSentences(sentences) {
  const freq = new Map();
  for (const s of sentences) for (const w of tokenize(s.text)) freq.set(w, (freq.get(w) || 0) + 1);
  return sentences.map((s) => {
    const words = tokenize(s.text);
    const total = words.reduce((sum, w) => sum + (freq.get(w) || 0), 0);
    return { ...s, score: words.length ? total / Math.sqrt(words.length) : 0 };
  });
}

// The casing the material itself uses most ("ATP", "Krebs cycle").
function displayForm(term, corpus) {
  const matches = corpus.match(new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi')) || [];
  const counts = new Map();
  for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);
  let best = term;
  let bestCount = 0;
  for (const [form, count] of counts) {
    const sentenceCaseOnly = form[0] !== term[0] && form.slice(1) === term.slice(1);
    const adjusted = sentenceCaseOnly ? count - 0.5 : count;
    if (adjusted > bestCount) {
      best = form;
      bestCount = adjusted;
    }
  }
  return best;
}

/**
 * Candidate key terms: repeated multi-word phrases, acronyms seen at least
 * twice, then frequent content words not already covered by a longer term.
 */
function extractKeyTerms(sentenceTexts, maxTerms = 20) {
  const scores = new Map();
  const phraseCounts = new Map();
  const add = (term, score) => scores.set(term, (scores.get(term) || 0) + score);

  for (const sentence of sentenceTexts) {
    const words = sentence.toLowerCase().replace(/[^a-z0-9\s\/-]/g, ' ').split(/\s+/).filter(Boolean);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (!isContentWord(gram[0]) || !isContentWord(gram[n - 1])) continue;
        if (gram.some((w) => STOPWORDS.has(w))) continue;
        const phrase = gram.join(' ');
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
        add(phrase, n * 1.5);
      }
    }
    for (const word of words) if (isContentWord(word)) add(word, 1);
  }

  const corpus = sentenceTexts.join(' ');
  const acronyms = new Set(
    (corpus.match(/\b[A-Z][A-Z0-9/]{1,8}\b/g) || []).filter((a) => !/^[IVXLCDM]+$/.test(a)).map((a) => a.toLowerCase())
  );
  for (const acronym of acronyms) {
    if ((corpus.match(new RegExp(`\\b${escapeRegex(acronym)}\\b`, 'gi')) || []).length >= 2) add(acronym, 4);
  }

  const candidates = [...scores.entries()]
    .filter(([term, score]) => (term.includes(' ') ? phraseCounts.get(term) >= 2 : score >= 3) || acronyms.has(term))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  const chosen = [];
  for (const [term] of candidates) {
    if (chosen.length >= maxTerms) break;
    if (!chosen.some((c) => c.includes(term) || term.includes(c))) chosen.push(term);
  }
  return chosen.map((term) => displayForm(term, corpus));
}

function termRegex(term) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(term)}(?![A-Za-z0-9])`, 'i');
}

module.exports = {
  normalize,
  escapeRegex,
  isHeadingLine,
  structurePages,
  splitSentences,
  tokenize,
  stem,
  isContentWord,
  scoreSentences,
  extractKeyTerms,
  displayForm,
  termRegex,
};
