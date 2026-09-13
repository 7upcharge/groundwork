const { summarize, extractKeyTerms } = require('./summarizer');
const { splitIntoSections, buildNotes } = require('./notesBuilder');
const { generateQuiz } = require('./quizGenerator');
const { resolveSubject } = require('./subjects');
const { isLlmAvailable, callStructured } = require('./llmClient');
const { notesExtractionPrompt, quizGenerationPrompt } = require('./prompts');
const { filterGroundedNotes, filterGroundedQuiz } = require('./grounding');

const MAX_CHARS_PER_CHUNK = 6000;
const MAX_CHUNKS = 4;

/**
 * Groups detected sections into a small number of LLM-call-sized chunks,
 * preserving section boundaries so each call sees coherent content rather
 * than an arbitrary character cut mid-sentence.
 */
function buildChunks(text) {
  const sections = splitIntoSections(text);
  const chunks = [];
  let current = '';

  for (const section of sections) {
    const sectionText = `${section.title}\n${section.body}`.trim();
    if (current.length > 0 && current.length + sectionText.length > MAX_CHARS_PER_CHUNK) {
      chunks.push(current);
      current = sectionText;
    } else {
      current = current ? `${current}\n\n${sectionText}` : sectionText;
    }
  }
  if (current) chunks.push(current);

  return chunks.slice(0, MAX_CHUNKS);
}

function dedupeGlossary(glossary) {
  const seen = new Set();
  return glossary.filter((entry) => {
    const key = entry.term.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeChunkNotes(chunkResults) {
  const sections = [];
  let glossary = [];
  for (const result of chunkResults) {
    sections.push(...(result.sections || []));
    glossary.push(...(result.glossary || []));
  }
  return { sections, glossary };
}

function flattenFacts(notes) {
  const facts = [];
  for (const section of notes.sections) {
    for (const bullet of section.bullets) facts.push({ text: bullet.text, quote: bullet.sourceQuote });
  }
  for (const entry of notes.glossary) facts.push({ text: `${entry.term}: ${entry.definition}`, quote: entry.sourceQuote });
  return facts;
}

function offlineNotes(text, subject) {
  const raw = buildNotes(text, { glossarySize: subject.glossarySize });
  return {
    tldr: raw.tldr,
    sections: raw.sections.map((s) => ({
      title: s.title,
      bullets: s.bullets.map((b) => ({ text: b, sourceQuote: b })),
    })),
    glossary: raw.glossary.map((term) => ({ term, definition: '', sourceQuote: null })),
  };
}

function offlineQuiz(text, count) {
  const keyTerms = extractKeyTerms(text, Math.max(count * 3, 12));
  return generateQuiz(text, keyTerms, count).map((q) => ({
    id: q.id,
    question: q.prompt,
    choices: q.choices,
    correctIndex: q.choices.indexOf(q.answer),
    sourceQuote: q.sourceQuote,
    grounded: true,
  }));
}

function topUpQuiz(existingQuiz, text, targetCount) {
  if (existingQuiz.length >= targetCount) return existingQuiz.slice(0, targetCount);
  const needed = targetCount - existingQuiz.length;
  const filler = offlineQuiz(text, needed);
  return [...existingQuiz, ...filler].slice(0, targetCount);
}

/**
 * Full pipeline: extract -> chunk -> LLM notes (grounded) -> LLM quiz
 * (grounded against the already-verified notes) -> code-level grounding
 * validation -> deterministic offline fallback for anything that fails.
 *
 * Never throws for an LLM-side problem: any failure degrades to the
 * offline engine so the student always gets a usable result.
 */
async function runPipeline(text, subjectKey) {
  const subject = resolveSubject(subjectKey);
  const tldr = summarize(text, 3); // extractive -> verbatim -> trivially grounded
  const warnings = [];

  if (!isLlmAvailable()) {
    return {
      notes: { ...offlineNotes(text, subject), tldr },
      quiz: offlineQuiz(text, subject.quizCount),
      meta: { usedLlm: false, subject: subject.label, warnings: ['LLM not configured — using offline engine.'] },
    };
  }

  try {
    const chunks = buildChunks(text);
    const chunkResults = await Promise.all(
      chunks.map((chunk) => {
        const { system, prompt, toolName, schema } = notesExtractionPrompt(chunk, subject.label);
        return callStructured({ system, prompt, toolName, schema, maxTokens: 1500 });
      })
    );

    const merged = mergeChunkNotes(chunkResults);
    const grounded = filterGroundedNotes(merged, text);

    if (grounded.sections.length === 0) {
      throw new Error('All LLM-generated notes failed the grounding check.');
    }

    const notes = {
      tldr,
      sections: grounded.sections,
      glossary: dedupeGlossary(grounded.glossary).slice(0, subject.glossarySize),
    };

    let quiz = [];
    try {
      const facts = flattenFacts(notes);
      const { system, prompt, toolName, schema } = quizGenerationPrompt(facts, subject.label, subject.quizCount);
      const quizRaw = await callStructured({ system, prompt, toolName, schema, maxTokens: 1500 });

      const groundingBlob = facts.map((f) => f.quote).join('\n');
      quiz = filterGroundedQuiz(quizRaw, groundingBlob).map((q, i) => ({
        id: `q${i + 1}`,
        question: q.question,
        choices: q.choices,
        correctIndex: q.correct_index,
        sourceQuote: q.source_quote,
        grounded: true,
      }));

      if (quiz.length < subject.quizCount) {
        warnings.push('Some quiz questions failed grounding and were replaced with offline-generated ones.');
      }
    } catch (quizError) {
      warnings.push(`LLM quiz generation failed (${quizError.message}); using offline quiz.`);
    }

    quiz = topUpQuiz(quiz, text, subject.quizCount);

    return { notes, quiz, meta: { usedLlm: true, subject: subject.label, warnings } };
  } catch (error) {
    return {
      notes: { ...offlineNotes(text, subject), tldr },
      quiz: offlineQuiz(text, subject.quizCount),
      meta: {
        usedLlm: false,
        subject: subject.label,
        warnings: [`LLM pipeline failed (${error.message}); fell back to offline engine.`],
      },
    };
  }
}

module.exports = { runPipeline, buildChunks, mergeChunkNotes, dedupeGlossary, flattenFacts };
