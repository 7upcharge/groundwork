const { createSourceIndex } = require('../agents/source');

const PASSAGES = [
  { id: 1, page: 1, text: 'Photosynthesis is the process by which green plants convert light energy into chemical energy.' },
  { id: 2, page: 1, text: 'Chlorophyll absorbs sunlight and uses it to convert carbon dioxide and water into glucose and oxygen.' },
  { id: 3, page: 2, text: 'A single molecule of glucose can yield up to 38 molecules of ATP under ideal conditions.' },
];

async function run({ test, assert }) {
  await test('locate: finds the exact passage for a verbatim quote', () => {
    const index = createSourceIndex(PASSAGES);
    const p = index.locate('Chlorophyll absorbs sunlight and uses it to convert carbon dioxide');
    assert.strictEqual(p.id, 2);
  });

  await test('locate: returns null for a quote that does not appear anywhere', () => {
    const index = createSourceIndex(PASSAGES);
    assert.strictEqual(index.locate('Photosynthesis was invented in a laboratory in 1990'), null);
  });

  await test('locate: restricts the search to allowed passage ids when given', () => {
    const index = createSourceIndex(PASSAGES);
    const p = index.locate('Chlorophyll absorbs sunlight and uses it to convert carbon dioxide', [1, 3]);
    assert.strictEqual(p, null);
  });

  await test('locate: rejects too-short strings even if they technically appear', () => {
    const index = createSourceIndex(PASSAGES);
    assert.strictEqual(index.locate('the'), null);
  });

  await test('supports: accepts a paraphrase that shares the source\'s content words', () => {
    const index = createSourceIndex(PASSAGES);
    const result = index.supports('Green plants convert light energy into chemical energy through photosynthesis.', [1]);
    assert.ok(result.ok, JSON.stringify(result));
  });

  await test('supports: rejects a claim with a number not present in the source (e.g. altered ATP yield)', () => {
    const index = createSourceIndex(PASSAGES);
    const result = index.supports('A single glucose molecule can yield up to 36 molecules of ATP.', [3]);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missingNumbers.includes('36'));
  });

  await test('supports: rejects a claim mostly unrelated to the cited passage', () => {
    const index = createSourceIndex(PASSAGES);
    const result = index.supports('The mitochondria is the powerhouse of the cell and generates ATP via respiration.', [1]);
    assert.strictEqual(result.ok, false);
  });
}

module.exports = { run };
