const { structurePages, splitSentences, extractKeyTerms, termRegex, isHeadingLine } = require('../lib/text');

const SLIDE_PAGES = [
  `UNIT II
Routing Algorithms
o Routing is the process of selecting a path for traffic in a network.
o A routing table stores the best known route to each destination network.
o Distance vector routing shares the entire routing table with neighbouring routers.
4`,
  `UNIT II
Routing Algorithms
o Link state routing floods information about directly connected links to all routers.
o Each router then runs Dijkstra's algorithm to compute the shortest path tree.
o Link state routing converges faster than distance vector routing in large networks.
5`,
  `UNIT II
Count to Infinity
o The count to infinity problem occurs when routers keep increasing the distance to an unreachable network.
o Split horizon prevents a router from advertising a route back to the router it learned the route from. The poison reverse technique advertises such routes with an infinite metric instead of
omitting them entirely.
6`,
];

async function run({ test, assert }) {
  await test('structurePages: bullet glyphs are stripped and each bullet becomes its own passage', () => {
    const sections = structurePages(SLIDE_PAGES);
    const texts = sections.flatMap((s) => s.passages.map((p) => p.text));
    texts.forEach((t) => assert.ok(!/^o\s/.test(t), `bullet glyph leaked: ${t}`));
    assert.ok(texts.some((t) => t.includes('Routing is the process of selecting a path')));
  });

  await test('structurePages: page numbers and running headers never become sections', () => {
    const titles = structurePages(SLIDE_PAGES).map((s) => s.title);
    ['4', '5', '6', 'UNIT II'].forEach((noise) => assert.ok(!titles.includes(noise), `noise heading: ${noise} in ${JSON.stringify(titles)}`));
  });

  await test('structurePages: a title repeated across pages merges into one section', () => {
    const titles = structurePages(SLIDE_PAGES).map((s) => s.title);
    assert.strictEqual(titles.filter((t) => t === 'Routing Algorithms').length, 1);
    assert.ok(titles.includes('Count to Infinity'));
  });

  await test('structurePages: every passage carries the correct source page', () => {
    const sections = structurePages(SLIDE_PAGES);
    const infinity = sections.find((s) => s.title === 'Count to Infinity');
    infinity.passages.forEach((p) => assert.strictEqual(p.page, 3));
    const first = sections.find((s) => s.title === 'Routing Algorithms');
    assert.ok(first.passages.every((p) => p.page === 1 || p.page === 2));
  });

  await test('structurePages: a line wrapped across a PDF line-break is joined, not split', () => {
    const sections = structurePages(SLIDE_PAGES);
    const all = sections.flatMap((s) => s.passages.map((p) => p.text));
    assert.ok(all.some((t) => t.includes('instead of omitting them entirely')), JSON.stringify(all));
  });

  await test('extractKeyTerms: one-off word sequences are not promoted; repeated concepts are', () => {
    const sentences = structurePages(SLIDE_PAGES).flatMap((s) => s.passages.flatMap((p) => splitSentences(p.text)));
    const terms = extractKeyTerms(sentences, 15).map((t) => t.toLowerCase());
    ['routing floods information', 'unit', 'ii'].forEach((junk) => assert.ok(!terms.includes(junk), `leaked: ${junk}`));
    assert.ok(terms.includes('link state routing') && terms.includes('distance vector routing'), JSON.stringify(terms));
  });

  await test('isHeadingLine: rejects a sentence that merely happens to be short', () => {
    assert.strictEqual(isHeadingLine('It works well.'), false); // ends in punctuation
    assert.strictEqual(isHeadingLine('the network'), false); // ends on a stopword
    assert.strictEqual(isHeadingLine('Distance Vector Routing'), true);
  });

  await test('termRegex: matches whole words only, case-insensitively', () => {
    const re = termRegex('ATP');
    assert.ok(re.test('The role of ATP in metabolism.'));
    assert.ok(re.test('atp synthase'));
    assert.ok(!re.test('ATPase enzyme')); // not a standalone word
  });
}

module.exports = { run };
