/**
 * The generate -> verify -> repair loop used by every model-backed agent.
 *
 *   generate()          produce candidate items (model call)
 *   verify(items)       deterministic checks -> { passed, failed: [{ item, reasons }] }
 *   repair(failed)      ask the model to fix only what failed, with the reasons
 *
 * Items that still fail after the last repair round are dropped, never shown.
 */
async function generateVerifyRepair({ generate, verify, repair, maxRepairRounds = 1 }) {
  let rounds = 1;
  let { passed, failed } = verify(await generate());
  const accepted = [...passed];
  let repaired = 0;

  while (failed.length > 0 && repair && rounds <= maxRepairRounds) {
    rounds += 1;
    let candidates;
    try {
      candidates = await repair(failed);
    } catch {
      break; // a failed repair call keeps what already passed
    }
    const result = verify(candidates);
    accepted.push(...result.passed);
    repaired += result.passed.length;
    failed = result.failed;
  }

  return { items: accepted, rounds, repaired, dropped: failed };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { generateVerifyRepair, mapLimit };
