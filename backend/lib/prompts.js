/**
 * All LLM prompts and their forced-tool-use JSON schemas live here, kept
 * separate from the orchestration logic (pipeline.js) so they can be
 * reviewed/tuned independently.
 *
 * Design principles applied throughout:
 *  - Every extracted fact must carry a verbatim `source_quote` copied from
 *    the input chunk. This is what pipeline.js checks in code afterwards
 *    (substring match against the original PDF text) to catch hallucination
 *    before it ever reaches the student — the model is never trusted to
 *    grade its own output.
 *  - The model is explicitly told not to use outside knowledge, only what
 *    is present in the given chunk.
 *  - Structured output (tool_choice forced) instead of free-form prose, so
 *    the app never has to regex-parse an LLM's creative writing.
 */

const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          bullets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Condensed revision bullet, one idea, in the student\'s exam-prep voice.' },
                source_quote: { type: 'string', description: 'Exact sentence or phrase copied verbatim from the source chunk that supports this bullet.' },
              },
              required: ['text', 'source_quote'],
            },
          },
        },
        required: ['title', 'bullets'],
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          definition: { type: 'string', description: 'One-sentence definition, phrased plainly for revision.' },
          source_quote: { type: 'string', description: 'Verbatim quote from the chunk that defines or introduces this term.' },
        },
        required: ['term', 'definition', 'source_quote'],
      },
    },
  },
  required: ['sections', 'glossary'],
};

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correct_index: { type: 'integer', minimum: 0, maximum: 3 },
          source_quote: { type: 'string', description: 'Verbatim quote from the provided notes content that grounds the correct answer.' },
        },
        required: ['question', 'choices', 'correct_index', 'source_quote'],
      },
    },
  },
  required: ['questions'],
};

function notesExtractionPrompt(chunkText, subjectLabel) {
  return {
    system:
      `You are an exam-revision note extractor for a "${subjectLabel}" lecture. ` +
      'Extract ONLY facts explicitly present in the given text chunk — never use outside knowledge, ' +
      'never infer beyond what is written, never invent examples. Every bullet and glossary entry MUST ' +
      'include a source_quote copied verbatim (character-for-character) from the chunk. ' +
      'If the chunk has no clear structure, group content under a single sensible section title. ' +
      'Keep bullets short and revision-friendly (one idea each).',
    prompt: `Extract revision notes from this lecture excerpt:\n\n"""\n${chunkText}\n"""`,
    toolName: 'extract_notes',
    schema: NOTES_SCHEMA,
  };
}

function quizGenerationPrompt(groundedFacts, subjectLabel, count) {
  return {
    system:
      `You are writing a ${count}-question multiple-choice practice quiz for a "${subjectLabel}" student, ` +
      'based ONLY on the verified facts listed below — do not introduce facts absent from them. ' +
      'Each fact has a "quote" field taken verbatim from the source material. For every question you write, ' +
      'set source_quote to the EXACT, unmodified "quote" value of the fact it is testing — copy it ' +
      'character-for-character, do not paraphrase it. Each question needs exactly 4 choices with exactly ' +
      'one correct answer. Distractors should be plausible but clearly wrong to someone who understood the ' +
      'material. Vary question phrasing (avoid starting every question the same way).',
    prompt: `Verified facts (JSON array of {text, quote}):\n${JSON.stringify(groundedFacts)}\n\nGenerate the quiz now.`,
    toolName: 'generate_quiz',
    schema: QUIZ_SCHEMA,
  };
}

module.exports = { notesExtractionPrompt, quizGenerationPrompt, NOTES_SCHEMA, QUIZ_SCHEMA };
