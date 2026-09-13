const fs = require('fs');
const path = require('path');
const assert = require('assert');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed += 1;
      process.stdout.write(`  ok - ${name}\n`);
    } catch (err) {
      failed += 1;
      failures.push({ name, err });
      process.stdout.write(`  FAIL - ${name}\n         ${err.message}\n`);
    }
  })();
}

async function main() {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
  for (const file of files) {
    process.stdout.write(`\n${file}\n`);
    const mod = require(path.join(dir, file));
    await mod.run({ test, assert });
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
