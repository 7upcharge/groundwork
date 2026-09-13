const { STOPWORDS, GENERIC_ACADEMIC_WORDS } = require('./stopwords');

// Slide bullet glyphs as PDF text extraction renders them: "•", "▪", Wingdings
// private-use characters, and the classic "o " outline bullet.
const BULLET_PREFIX = /^(?:[•●▪■◦‣∙·*➢➤►▶✓–—-]|o(?=\s+[A-Z(“"]))\s+/;
const PAGE_NOISE = /^(?:\d{1,4}|[ivxlcdm]{1,6}|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\/\s*\d+)$/i;

function isHeadingLine(line) {
  const words = line.split(/\s+/);
  const lastWord = words[words.length - 1].toLowerCase();
  return (
    /^[A-Z0-9]/.test(line) &&
    words.length <= 8 &&
    (line.match(/[A-Za-z]/g) || []).length >= 3 &&
    !/[.!?;,:]$/.test(line) &&
    !STOPWORDS.has(lastWord)
  );
}

/**
 * Normalizes raw PDF lines: strips bullet glyphs (marking those lines as
 * bullets), drops page numbers, and keeps only the first occurrence of a
 * repeated heading-like line (running footers, titles repeated across slides).
 */
function cleanLines(text) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim());
  const headingCounts = new Map();
  for (const line of rawLines) {
    if (line && isHeadingLine(line)) headingCounts.set(line, (headingCounts.get(line) || 0) + 1);
  }

  const seenRepeated = new Set();
  const lines = [];
  for (const raw of rawLines) {
    if (!raw) {
      lines.push({ text: '', bullet: false });
      continue;
    }
    if (PAGE_NOISE.test(raw)) continue;
    if ((headingCounts.get(raw) || 0) > 1) {
      if (seenRepeated.has(raw)) continue;
      seenRepeated.add(raw);
    }
    const bullet = BULLET_PREFIX.test(raw);
    const textOnly = raw.replace(BULLET_PREFIX, '').trim();
    if (textOnly) lines.push({ text: textOnly, bullet });
  }
  return lines;
}

// Headings/slide titles become their own blocks; each bullet starts a new
// block; long unpunctuated lines are PDF line-wraps joined to the next line.
function splitBlocks(text) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) blocks.push({ text: current.join(' '), heading: false });
    current = [];
  };

  for (const { text: line, bullet } of cleanLines(text)) {
    if (!line) {
      flush();
    } else if (!bullet && isHeadingLine(line)) {
      flush();
      blocks.push({ text: line, heading: true });
    } else {
      if (bullet) flush();
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function splitSentences(text) {
  return splitBlocks(text)
    .filter((block) => !block.heading)
    .flatMap((block) => block.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.split(' ').length > 4);
}

function tokenize(sentence) {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function buildWordFrequencies(sentences) {
  const freq = {};
  for (const sentence of sentences) {
    for (const word of tokenize(sentence)) {
      freq[word] = (freq[word] || 0) + 1;
    }
  }
  return freq;
}

function scoreSentence(sentence, freq) {
  const words = tokenize(sentence);
  if (words.length === 0) return 0;
  const total = words.reduce((sum, w) => sum + (freq[w] || 0), 0);
  return total / Math.sqrt(words.length);
}

function rankSentences(text) {
  const sentences = splitSentences(text);
  const freq = buildWordFrequencies(sentences);
  return sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence, freq) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Extractive summary: top-N sentences by word-frequency score, restored to
 * document order. Output is verbatim source text, so it is grounded by
 * construction.
 */
function summarize(text, maxSentences = 8) {
  return rankSentences(text)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((r) => r.sentence);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the casing the lecture itself uses most often ("ATP", "Krebs cycle").
function displayForm(term, text) {
  const matches = text.match(new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi')) || [];
  const counts = new Map();
  for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);
  let best = term;
  let bestCount = 0;
  for (const [form, count] of counts) {
    const isSentenceCaseOnly = form[0] !== term[0] && form.slice(1) === term.slice(1);
    const adjusted = isSentenceCaseOnly ? count - 0.5 : count;
    if (adjusted > bestCount) {
      best = form;
      bestCount = adjusted;
    }
  }
  return best;
}

function isContentWord(word) {
  return word.length > 3 && !STOPWORDS.has(word) && !GENERIC_ACADEMIC_WORDS.has(word) && !/^\d+$/.test(word);
}

/**
 * Key terms for the glossary and quiz. Prefers what students actually get
 * examined on: repeated multi-word phrases ("electron transport chain"),
 * acronyms ("ATP", "NADH"), then frequent content words not already covered
 * by a phrase.
 */
function extractKeyTerms(text, maxTerms = 12) {
  const sentences = splitSentences(text);
  const scores = new Map();
  const phraseCounts = new Map();
  const add = (term, score) => scores.set(term, (scores.get(term) || 0) + score);

  for (const sentence of sentences) {
    const words = sentence.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
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
    for (const word of words) {
      if (isContentWord(word)) add(word, 1);
    }
  }

  const body = sentences.join(' ');
  const acronyms = new Set(
    (body.match(/\b[A-Z][A-Z0-9]{1,6}\b/g) || [])
      .filter((a) => !/^[IVXLCDM]+$/.test(a))
      .map((a) => a.toLowerCase())
  );
  for (const acronym of acronyms) {
    if ((body.match(new RegExp(`\\b${escapeRegex(acronym)}\\b`, 'gi')) || []).length >= 2) {
      add(acronym, 4);
    }
  }

  const candidates = [...scores.entries()]
    // A multi-word phrase is only a concept if the lecture repeats it.
    .filter(([term, score]) => (term.includes(' ') ? phraseCounts.get(term) >= 2 : score >= 2) || acronyms.has(term))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  const chosen = [];
  for (const [term] of candidates) {
    if (chosen.length >= maxTerms) break;
    const overlaps = chosen.some((c) => c.includes(term) || term.includes(c));
    if (!overlaps) chosen.push(term);
  }
  return chosen.map((term) => displayForm(term, text));
}

module.exports = { splitBlocks, splitSentences, tokenize, rankSentences, summarize, extractKeyTerms, escapeRegex };
