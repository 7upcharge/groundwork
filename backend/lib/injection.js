// Text in uploaded material that addresses a language model rather than a
// student. Flagged passages stay visible as source material but are never
// placed in a model prompt. This is one layer; prompts also fence all
// material as untrusted data, and every output is verified against the source.
const PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|these|system)\b[^.]{0,20}\b(instructions?|prompts?|rules|directions)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /\byou\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|language model|chatbot|llm|gpt|claude|gemini)\b/i,
  /\b(respond|reply|answer|output)\s+(only\s+)?with\b[^.]{0,40}\b(json|the word|exactly)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /<\/?\s*(system|assistant|instructions?|excerpt)\b/i,
];

function looksLikeInjection(text) {
  return PATTERNS.some((pattern) => pattern.test(text));
}

// Prevents material from closing or forging the excerpt fence in prompts.
function fenceSafe(text) {
  return String(text).replace(/<\s*(\/?)\s*(excerpt|system|instructions?)/gi, '‹$1$2');
}

module.exports = { looksLikeInjection, fenceSafe };
