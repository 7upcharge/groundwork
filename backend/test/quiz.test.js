const { offlineQuiz } = require('../agents/quiz');
const { buildConceptGraph } = require('../agents/knowledge');
const { structurePages } = require('../lib/text');
const { createSourceIndex } = require('../agents/source');

const PAGES = [
  `Cellular Respiration
Cellular respiration is the set of metabolic reactions that cells use to convert glucose into ATP.
Aerobic respiration requires oxygen and occurs in three main stages: glycolysis, the Krebs cycle and the electron transport chain.
During glycolysis one molecule of glucose is split into two molecules of pyruvate.
Glycolysis takes place in the cytoplasm and produces a net gain of two ATP molecules.
The Krebs cycle, also known as the citric acid cycle, takes place in the mitochondrial matrix.
Each turn of the Krebs cycle produces one ATP and releases carbon dioxide.
Before the Krebs cycle begins, pyruvate is converted into acetyl coenzyme A, releasing carbon dioxide.
The electron transport chain is located in the inner mitochondrial membrane.
Oxygen acts as the final electron acceptor in the electron transport chain and combines with hydrogen ions to form water.
Without oxygen, cells rely on fermentation to regenerate NAD+ so that glycolysis can continue.`,
];

function buildGraph() {
  const sections = structurePages(PAGES);
  const { passages, concepts } = buildConceptGraph({ sections });
  return { passages, concepts };
}

async function run({ test, assert }) {
  await test('offlineQuiz: deterministic for a fixed seed', () => {
    const { passages, concepts } = buildGraph();
    const a = offlineQuiz({ passages, concepts, count: 4, seed: 42 });
    const b = offlineQuiz({ passages, concepts, count: 4, seed: 42 });
    assert.deepStrictEqual(a, b);
  });

  await test('offlineQuiz: every question has 4 unique choices and a valid correctIndex', () => {
    const { passages, concepts } = buildGraph();
    const quiz = offlineQuiz({ passages, concepts, count: 4, seed: 7 });
    assert.ok(quiz.length > 0);
    quiz.forEach((q) => {
      assert.strictEqual(new Set(q.choices).size, q.choices.length);
      assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.choices.length);
    });
  });

  await test('offlineQuiz: every question is grounded in the cited passage, including its explanation', () => {
    const { passages, concepts } = buildGraph();
    const quiz = offlineQuiz({ passages, concepts, count: 4, seed: 7 });
    const indexed = passages.map((p, i) => ({ ...p, id: i }));
    const sourceIndex = createSourceIndex(indexed);
    quiz.forEach((q) => {
      const passage = indexed[q.passageIndex];
      assert.ok(passage, `no passage at index ${q.passageIndex}`);
      // The explanation quotes a real sentence in quotes; that sentence must
      // actually appear in the cited passage.
      const quoted = q.explanation.match(/"([^"]+)"/);
      assert.ok(quoted, `explanation has no quoted sentence: ${q.explanation}`);
      assert.ok(sourceIndex.locate(quoted[1], [q.passageIndex]), `explanation quote not grounded: ${quoted[1]}`);
    });
  });

  await test('offlineQuiz: never turns a section heading into a question prompt', () => {
    const { passages, concepts } = buildGraph();
    const quiz = offlineQuiz({ passages, concepts, count: 4, seed: 3 });
    quiz.forEach((q) => assert.notStrictEqual(q.prompt.trim(), 'Cellular Respiration'));
  });

  await test('offlineQuiz: targeted practice on a 2-concept weak set still produces real questions (regression)', () => {
    // Regression: distractors must be drawn from the whole graph, not just
    // the (too-small) focus set, or targeted practice silently returns nothing.
    const { passages, concepts } = buildGraph();
    const focusConceptNames = concepts.slice(0, 2).map((c) => c.normalized);
    const quiz = offlineQuiz({ passages, concepts, count: 5, seed: 42, focusConceptNames });
    assert.ok(quiz.length > 0, 'targeted quiz produced zero questions');
    quiz.forEach((q) => assert.ok(focusConceptNames.includes(q.conceptNormalized)));
  });
}

module.exports = { run };
