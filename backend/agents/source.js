const { normalize, tokenize, stem, splitSentences } = require('../lib/text');

const MIN_QUOTE_CHARS = 12;
const NUMBER = /\b\d+(?:[.,]\d+)?%?/g;

const contentStems = (text) => tokenize(text).filter((w) => w.length > 3).map(stem);

/**
 * Source Agent: deterministic grounding over a set of passages.
 * - locate(quote): which passage a claimed quote actually comes from
 * - supports(claim, passages): whether a (paraphrased) claim is backed by the
 *   passage — content-word coverage, plus every number in the claim must
 *   appear in the source ("38 ATP" vs "36 ATP" is caught).
 */
function createSourceIndex(passages) {
  const entries = passages.map((p) => ({ passage: p, norm: normalize(p.text), stems: new Set(contentStems(p.text)) }));
  const byId = new Map(entries.map((e) => [e.passage.id, e]));

  function locate(quote, allowedIds) {
    if (!quote || typeof quote !== 'string') return null;
    const q = normalize(quote).replace(/^["'“]|["'”]$/g, '');
    if (q.length < MIN_QUOTE_CHARS) return null;
    const pool = allowedIds ? allowedIds.map((id) => byId.get(id)).filter(Boolean) : entries;

    const exact = pool.find((e) => e.norm.includes(q));
    if (exact) return exact.passage;

    // Tolerate punctuation or ellipsis differences in otherwise verbatim quotes.
    const qStems = contentStems(q);
    if (qStems.length < 5) return null;
    let best = null;
    let bestScore = 0;
    for (const e of pool) {
      const hit = qStems.filter((s) => e.stems.has(s)).length / qStems.length;
      if (hit > bestScore) {
        best = e;
        bestScore = hit;
      }
    }
    return bestScore >= 0.9 ? best.passage : null;
  }

  function supports(claim, passageIds, { minCoverage = 0.5 } = {}) {
    const sources = passageIds.map((id) => byId.get(id)).filter(Boolean);
    if (!sources.length) return { ok: false, coverage: 0, missingNumbers: [], reason: 'no source passage' };
    const union = new Set(sources.flatMap((e) => [...e.stems]));
    const sourceText = sources.map((e) => e.norm).join(' ');

    const stems = contentStems(claim);
    const coverage = stems.length ? stems.filter((s) => union.has(s)).length / stems.length : 0;
    const missingNumbers = (String(claim).match(NUMBER) || []).filter((n) => !sourceText.includes(n.toLowerCase()));

    const ok = coverage >= minCoverage && missingNumbers.length === 0;
    let reason = null;
    if (missingNumbers.length) reason = `numbers not in source: ${missingNumbers.join(', ')}`;
    else if (!ok) reason = `only ${Math.round(coverage * 100)}% of the claim's key words appear in the source`;
    return { ok, coverage, missingNumbers, reason };
  }

  function sentenceContaining(passageId, pattern) {
    const entry = byId.get(passageId);
    if (!entry) return null;
    return splitSentences(entry.passage.text).find((s) => pattern.test(s)) || null;
  }

  return { locate, supports, sentenceContaining, get: (id) => byId.get(id)?.passage || null };
}

module.exports = { createSourceIndex };
