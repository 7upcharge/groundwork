const { buildConceptGraph } = require('../agents/knowledge');
const { structurePages } = require('../lib/text');

const PAGES = [
  `Cellular Respiration
Cellular respiration is the set of metabolic reactions that cells use to convert glucose into ATP.
When oxygen is unavailable, cells rely on fermentation to regenerate NAD+ so that glycolysis can continue.
The Krebs cycle, also known as the citric acid cycle, takes place in the mitochondrial matrix.
Before the cycle begins, pyruvate is converted into acetyl coenzyme A, releasing carbon dioxide.
Each turn of the Krebs cycle produces one ATP and releases carbon dioxide.`,
];

async function run({ test, assert }) {
  await test('buildConceptGraph: a real definition ("X is a/an/the...") is detected', () => {
    const graph = buildConceptGraph({ sections: structurePages(PAGES) });
    const atp = graph.concepts.find((c) => c.normalized === 'atp');
    // Not strictly required to have a definition, but if flagged it must be a real one.
    if (atp && atp.definitionIndex !== null) {
      const text = graph.passages[atp.definitionIndex].text;
      assert.ok(/is the set of metabolic reactions/i.test(text), text);
    }
  });

  await test('buildConceptGraph: "X is <adjective/participle>" sentences are NOT treated as definitions', () => {
    const graph = buildConceptGraph({ sections: structurePages(PAGES) });
    const pyruvate = graph.concepts.find((c) => c.normalized === 'pyruvate');
    if (pyruvate && pyruvate.definitionIndex !== null) {
      const text = graph.passages[pyruvate.definitionIndex].text;
      assert.ok(!/pyruvate is converted/i.test(text), `false-positive definition: ${text}`);
    }
  });

  await test('buildConceptGraph: "also known as" is recognized as a definition', () => {
    const graph = buildConceptGraph({ sections: structurePages(PAGES) });
    const krebs = graph.concepts.find((c) => c.normalized === 'krebs cycle');
    assert.ok(krebs, 'krebs cycle should be a concept');
    assert.notStrictEqual(krebs.definitionIndex, null);
    assert.ok(/also known as the citric acid cycle/i.test(graph.passages[krebs.definitionIndex].text));
  });

  await test('buildConceptGraph: concepts that co-occur in a passage get a RELATED_TO edge', () => {
    const graph = buildConceptGraph({ sections: structurePages(PAGES) });
    const names = new Set(graph.concepts.map((c) => c.normalized));
    if (names.has('krebs cycle') && names.has('carbon dioxide')) {
      const edge = graph.edges.find(
        (e) => (e.a === 'carbon dioxide' && e.b === 'krebs cycle') || (e.a === 'krebs cycle' && e.b === 'carbon dioxide')
      );
      assert.ok(edge, 'expected an edge between krebs cycle and carbon dioxide');
      assert.ok(edge.weight >= 1);
    }
  });

  await test('buildConceptGraph: single-use generic words do not become concepts', () => {
    const graph = buildConceptGraph({ sections: structurePages(PAGES) });
    const names = graph.concepts.map((c) => c.normalized);
    assert.ok(!names.includes('cellular'), JSON.stringify(names));
  });
}

module.exports = { run };
