const { rankSentences, escapeRegex } = require('./summarizer');

// Deterministic PRNG so quiz generation (and its tests) are reproducible.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function termPattern(term) {
  return new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
}

// Prefer the longest (most specific) key term present in the sentence.
function findTermInSentence(sentence, keyTerms, usedTerms) {
  return [...keyTerms]
    .sort((a, b) => b.length - a.length)
    .find((term) => !usedTerms.has(term) && termPattern(term).test(sentence));
}

/**
 * Builds up to `count` fill-in-the-blank multiple-choice questions from the
 * lecture's highest-ranked sentences. Each question keeps the original
 * sentence as its source quote. Rule-based and seeded, so output is
 * reproducible and unit-testable.
 */
function generateQuiz(text, keyTerms, count = 5, seed = 42) {
  const rng = mulberry32(seed);
  const ranked = rankSentences(text);
  const picked = [];
  const usedTerms = new Set();

  for (const { sentence, index } of ranked) {
    if (picked.length >= count) break;
    const term = findTermInSentence(sentence, keyTerms, usedTerms);
    if (!term) continue;

    const distractors = shuffle(
      keyTerms.filter((t) => t !== term && !termPattern(t).test(sentence)),
      rng
    ).slice(0, 3);
    if (distractors.length < 3) continue;

    picked.push({
      index,
      prompt: sentence.replace(termPattern(term), '_____'),
      choices: shuffle([term, ...distractors], rng),
      answer: term,
      sourceQuote: sentence,
    });
    usedTerms.add(term);
  }

  return picked
    .sort((a, b) => a.index - b.index)
    .map(({ index, ...q }, i) => ({ id: `q${i + 1}`, type: 'mcq', ...q }));
}

module.exports = { generateQuiz, mulberry32, shuffle };
