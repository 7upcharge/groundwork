/**
 * Deterministic hallucination check: verifies an LLM-claimed `source_quote`
 * actually appears in the original source text. This runs in plain code,
 * not as a second LLM call — the model is never trusted to grade its own
 * output, and there's nothing non-deterministic left for a judge to distrust.
 */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim();
}

function isGrounded(sourceQuote, originalText) {
  if (!sourceQuote || sourceQuote.length < 8) return false;
  return normalize(originalText).includes(normalize(sourceQuote));
}

function filterGroundedNotes(notes, originalText) {
  const sections = notes.sections
    .map((section) => ({
      title: section.title,
      bullets: section.bullets.filter((b) => isGrounded(b.source_quote, originalText)),
    }))
    .filter((section) => section.bullets.length > 0);

  const glossary = notes.glossary.filter((g) => isGrounded(g.source_quote, originalText));

  return { sections, glossary };
}

function filterGroundedQuiz(quiz, groundingText) {
  return quiz.questions.filter((q) => {
    if (!isGrounded(q.source_quote, groundingText)) return false;
    if (!Array.isArray(q.choices) || q.choices.length !== 4) return false;
    if (typeof q.correct_index !== 'number' || q.correct_index < 0 || q.correct_index > 3) return false;
    return true;
  });
}

module.exports = { isGrounded, filterGroundedNotes, filterGroundedQuiz, normalize };
