const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SAMPLES_DIR = path.join(__dirname, '..', '..', 'samples');

// Ensure the LLM path is off for this run, regardless of the developer's
// shell environment, so these tests exercise the deterministic offline
// engine and stay reproducible in CI.
delete process.env.ANTHROPIC_API_KEY;

const { summarize, extractKeyTerms, splitSentences } = require('../lib/summarizer');
const { generateQuiz } = require('../lib/quizGenerator');
const { isGrounded, filterGroundedNotes, filterGroundedQuiz } = require('../lib/grounding');
const { isPdfMagicBytes, extractText, EmptyPdfError, InvalidPdfError } = require('../lib/pdfExtractor');
const { buildChunks, mergeChunkNotes, dedupeGlossary, runPipeline } = require('../lib/pipeline');
const { buildNotes, splitIntoSections } = require('../lib/notesBuilder');

const SAMPLE_TEXT = `
Introduction to Photosynthesis
Photosynthesis is the process by which green plants convert light energy into chemical energy.
This process occurs mainly in the chloroplasts of plant cells, which contain a pigment called chlorophyll.
Chlorophyll absorbs sunlight and uses it to convert carbon dioxide and water into glucose and oxygen.
The overall reaction can be summarized as carbon dioxide plus water yielding glucose and oxygen in the presence of light.

Light Dependent Reactions
The light dependent reactions take place in the thylakoid membrane of the chloroplast.
During these reactions, light energy is captured and converted into chemical energy in the form of ATP and NADPH.
Water molecules are split during this stage, releasing oxygen as a byproduct.

The Calvin Cycle
The Calvin cycle uses the ATP and NADPH produced earlier to convert carbon dioxide into glucose.
This cycle takes place in the stroma of the chloroplast and does not directly require light.
Enzymes called rubisco play a critical role in fixing carbon dioxide during the Calvin cycle.
`.trim();

// Mimics text extracted from a converted slide deck: outline "o" bullets,
// page numbers, a running footer on every slide, a title repeated across
// slides, and a wrapped line that ends mid-phrase.
const SLIDE_TEXT = `
UNIT II
Routing Algorithms
o Routing is the process of selecting a path for traffic in a network.
o A routing table stores the best known route to each destination network.
o Distance vector routing shares the entire routing table with neighbouring routers.
4
UNIT II
Routing Algorithms
o Link state routing floods information about directly connected links to all routers.
o Each router then runs Dijkstra's algorithm to compute the shortest path tree.
o Link state routing converges faster than distance vector routing in large networks.
5
UNIT II
Count to Infinity
o The count to infinity problem occurs when routers keep increasing the distance to an unreachable network.
o Split horizon prevents a router from advertising a route back to the router it learned the route from. The poison reverse technique advertises such routes with an infinite metric instead of
omitting them entirely.
6
`.trim();

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(`         ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

test('summarizer: splitSentences returns multiple real sentences', () => {
  const sentences = splitSentences(SAMPLE_TEXT);
  assert.ok(sentences.length >= 5);
  sentences.forEach((s) => assert.ok(s.split(' ').length > 4));
});

test('summarizer: summarize respects maxSentences and returns verbatim (grounded) text', () => {
  const summary = summarize(SAMPLE_TEXT, 3);
  assert.strictEqual(summary.length, 3);
  summary.forEach((s) => assert.ok(isGrounded(s, SAMPLE_TEXT), `not grounded: ${s}`));
});

test('summarizer: headings are never glued onto the following sentence', () => {
  const sentences = splitSentences(SAMPLE_TEXT);
  ['Introduction to Photosynthesis', 'Light Dependent Reactions', 'The Calvin Cycle The'].forEach((heading) => {
    sentences.forEach((s) => assert.ok(!s.startsWith(heading + ' '), `heading leaked into: ${s}`));
  });
});

test('summarizer: PDF line-wraps inside a sentence are joined, not split', () => {
  const wrapped = 'Mitochondria are membrane bound organelles that generate most of the\nchemical energy needed to power the biochemical reactions of the cell.';
  const sentences = splitSentences(wrapped);
  assert.strictEqual(sentences.length, 1);
});

test('slides: bullet glyphs are stripped and each bullet is its own sentence', () => {
  const sentences = splitSentences(SLIDE_TEXT);
  sentences.forEach((s) => assert.ok(!/^o\s/.test(s) && !/\so\s[A-Z]/.test(s), `bullet glyph leaked: ${s}`));
  assert.ok(sentences.includes('Routing is the process of selecting a path for traffic in a network.'));
});

test('slides: page numbers and running footers never become sections', () => {
  const titles = splitIntoSections(SLIDE_TEXT).map((s) => s.title);
  ['4', '5', '6', 'UNIT II'].forEach((noise) => assert.ok(!titles.includes(noise), `noise heading: ${noise} in ${titles}`));
});

test('slides: a title repeated across slides merges into one section', () => {
  const titles = splitIntoSections(SLIDE_TEXT).map((s) => s.title);
  assert.strictEqual(titles.filter((t) => t === 'Routing Algorithms').length, 1);
  assert.ok(titles.includes('Count to Infinity'));
});

test('slides: a wrapped line ending mid-phrase is joined, not treated as a heading', () => {
  const titles = splitIntoSections(SLIDE_TEXT).map((s) => s.title);
  assert.ok(!titles.some((t) => t.startsWith('omitting')));
  assert.ok(splitSentences(SLIDE_TEXT).some((s) => s.endsWith('instead of omitting them entirely.')));
});

test('summarizer: one-off word sequences are not promoted to key terms', () => {
  const terms = extractKeyTerms(SLIDE_TEXT, 15).map((t) => t.toLowerCase());
  ['routing floods information', 'routing converges faster', 'reverse technique advertises', 'unit', 'ii'].forEach((junk) =>
    assert.ok(!terms.includes(junk), `one-off phrase promoted: ${junk}`)
  );
  assert.ok(terms.includes('link state routing') && terms.includes('distance vector routing'), `repeated concepts missing: ${terms}`);
});

test('slides: quiz questions come from real bullet sentences only', () => {
  const quiz = generateQuiz(SLIDE_TEXT, extractKeyTerms(SLIDE_TEXT, 15), 4, 42);
  assert.ok(quiz.length >= 3, `only ${quiz.length} questions`);
  quiz.forEach((q) => {
    assert.ok(q.prompt.split(' ').length < 40, `run-on question: ${q.prompt}`);
    assert.ok(isGrounded(q.sourceQuote, SLIDE_TEXT));
  });
});

test('summarizer: extractKeyTerms excludes stopwords and generic lecture words', () => {
  const terms = extractKeyTerms(SAMPLE_TEXT, 12).map((t) => t.toLowerCase());
  assert.ok(terms.length > 0);
  ['the', 'process', 'stage', 'molecules', 'called'].forEach((w) => assert.ok(!terms.includes(w), `generic term leaked: ${w}`));
});

test('summarizer: extractKeyTerms surfaces repeated multi-word concepts and acronyms with source casing', () => {
  const terms = extractKeyTerms(SAMPLE_TEXT, 12);
  assert.ok(terms.some((t) => t.toLowerCase() === 'carbon dioxide'), `missing phrase in: ${terms}`);
  assert.ok(terms.includes('ATP') || terms.includes('NADPH'), `acronym missing or lowercased in: ${terms}`);
});

test('quizGenerator: never builds a question out of a heading line', () => {
  const quiz = generateQuiz(SAMPLE_TEXT, extractKeyTerms(SAMPLE_TEXT, 15), 5, 42);
  ['Introduction to Photosynthesis', 'Light Dependent Reactions', 'The Calvin Cycle'].forEach((heading) =>
    quiz.forEach((q) => assert.notStrictEqual(q.sourceQuote, heading))
  );
});

test('quizGenerator: generateQuiz is deterministic for a fixed seed', () => {
  const terms = extractKeyTerms(SAMPLE_TEXT, 12);
  const a = generateQuiz(SAMPLE_TEXT, terms, 4, 42);
  const b = generateQuiz(SAMPLE_TEXT, terms, 4, 42);
  assert.deepStrictEqual(a, b);
});

test('quizGenerator: every question has 4 unique choices including the answer, grounded in source', () => {
  const terms = extractKeyTerms(SAMPLE_TEXT, 12);
  const quiz = generateQuiz(SAMPLE_TEXT, terms, 4, 7);
  assert.ok(quiz.length > 0);
  quiz.forEach((q) => {
    assert.strictEqual(new Set(q.choices).size, 4);
    assert.ok(q.choices.includes(q.answer));
    assert.ok(isGrounded(q.sourceQuote, SAMPLE_TEXT), `quiz source not grounded: ${q.sourceQuote}`);
  });
});

test('grounding: isGrounded matches verbatim substrings case-insensitively', () => {
  assert.ok(isGrounded('Photosynthesis is the process', SAMPLE_TEXT));
  assert.ok(isGrounded('PHOTOSYNTHESIS IS THE PROCESS', SAMPLE_TEXT));
});

test('grounding: isGrounded rejects fabricated claims', () => {
  assert.strictEqual(isGrounded('Photosynthesis was invented in 1990', SAMPLE_TEXT), false);
});

test('grounding: isGrounded rejects too-short quotes (weak grounding)', () => {
  assert.strictEqual(isGrounded('the', SAMPLE_TEXT), false);
});

test('grounding: filterGroundedNotes drops ungrounded bullets and keeps grounded ones', () => {
  const notes = {
    sections: [
      {
        title: 'Test Section',
        bullets: [
          { text: 'Real fact', source_quote: 'Photosynthesis is the process by which green plants convert light energy' },
          { text: 'Fabricated fact', source_quote: 'This never appears anywhere in the source text at all' },
        ],
      },
    ],
    glossary: [{ term: 'chlorophyll', definition: 'a pigment', source_quote: 'a pigment called chlorophyll' }],
  };
  const result = filterGroundedNotes(notes, SAMPLE_TEXT);
  assert.strictEqual(result.sections[0].bullets.length, 1);
  assert.strictEqual(result.sections[0].bullets[0].text, 'Real fact');
  assert.strictEqual(result.glossary.length, 1);
});

test('grounding: filterGroundedQuiz rejects malformed or ungrounded questions', () => {
  const raw = {
    questions: [
      { question: 'Q1', choices: ['a', 'b', 'c', 'd'], correct_index: 0, source_quote: 'Photosynthesis is the process' },
      { question: 'Q2', choices: ['a', 'b', 'c'], correct_index: 0, source_quote: 'Photosynthesis is the process' },
      { question: 'Q3', choices: ['a', 'b', 'c', 'd'], correct_index: 0, source_quote: 'totally made up nonsense' },
    ],
  };
  const filtered = filterGroundedQuiz(raw, SAMPLE_TEXT);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].question, 'Q1');
});

test('pdfExtractor: isPdfMagicBytes accepts real PDF header', () => {
  assert.ok(isPdfMagicBytes(Buffer.from('%PDF-1.4\n...')));
});

test('pdfExtractor: isPdfMagicBytes rejects spoofed non-PDF content', () => {
  assert.strictEqual(isPdfMagicBytes(Buffer.from('<html><body>not a pdf</body></html>')), false);
});

test('pdfExtractor: extracts real text consistently across repeated calls', async () => {
  const file = path.join(SAMPLES_DIR, 'sample-lecture.pdf');
  const texts = [];
  for (let i = 0; i < 3; i++) {
    Buffer.from('shift the shared allocation pool offset');
    texts.push((await extractText(fs.readFileSync(file))).text);
  }
  assert.ok(texts[0].includes('Cellular respiration is the set of metabolic reactions'));
  assert.ok(texts.every((t) => t === texts[0]), 'extraction differed between calls');
});

test('pdfExtractor: no content leaks from a previous document into the next one', async () => {
  await extractText(fs.readFileSync(path.join(SAMPLES_DIR, 'sample-lecture.pdf')));
  await assert.rejects(() => extractText(fs.readFileSync(path.join(SAMPLES_DIR, 'blank-scan.pdf'))), EmptyPdfError);
});

test('pdfExtractor: corrupted PDF raises InvalidPdfError instead of crashing', async () => {
  const corrupt = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage '.repeat(200))]);
  await assert.rejects(() => extractText(corrupt), InvalidPdfError);
});

test('pdfExtractor: text-less PDF raises EmptyPdfError with an actionable message', async () => {
  await assert.rejects(
    () => extractText(fs.readFileSync(path.join(SAMPLES_DIR, 'blank-scan.pdf'))),
    (err) => err instanceof EmptyPdfError && /scanned/.test(err.message)
  );
});

test('pdfExtractor: non-PDF bytes raise InvalidPdfError even with a .pdf name', async () => {
  await assert.rejects(() => extractText(Buffer.from('MZ\x90\x00 fake executable renamed to .pdf')), InvalidPdfError);
});

test('pipeline: buildChunks groups sections without exceeding chunk count', () => {
  const chunks = buildChunks(SAMPLE_TEXT);
  assert.ok(chunks.length >= 1 && chunks.length <= 4);
});

test('pipeline: mergeChunkNotes concatenates sections and glossaries from all chunks', () => {
  const merged = mergeChunkNotes([
    { sections: [{ title: 'A', bullets: [] }], glossary: [{ term: 'x' }] },
    { sections: [{ title: 'B', bullets: [] }], glossary: [{ term: 'y' }] },
  ]);
  assert.strictEqual(merged.sections.length, 2);
  assert.strictEqual(merged.glossary.length, 2);
});

test('pipeline: dedupeGlossary removes case-insensitive duplicate terms, keeping first', () => {
  const result = dedupeGlossary([{ term: 'Chlorophyll' }, { term: 'chlorophyll' }, { term: 'ATP' }]);
  assert.strictEqual(result.length, 2);
});

test('pipeline: runPipeline falls back to the offline engine when no LLM key is configured', async () => {
  const result = await runPipeline(SAMPLE_TEXT, 'general');
  assert.strictEqual(result.meta.usedLlm, false);
  assert.ok(result.notes.tldr.length > 0);
  assert.ok(result.quiz.length > 0);
  result.quiz.forEach((q) => assert.strictEqual(new Set(q.choices).size, 4));
});

test('notesBuilder: buildNotes produces at least one non-empty section from structured text', () => {
  const notes = buildNotes(SAMPLE_TEXT);
  assert.ok(notes.sections.length > 0);
  assert.ok(notes.glossary.length > 0);
});

run();
