const quiet = process.env.LOG_LEVEL === 'silent';

function log(entry) {
  if (!quiet) console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}

/**
 * Wraps one agent step: times it, persists the run to agent_runs, and emits a
 * structured developer log line. Never surfaced to students.
 */
function createRecorder(db) {
  return async function step(context, agent, fn) {
    const started = Date.now();
    try {
      const outcome = (await fn()) || {};
      const entry = {
        task: context.task,
        agent,
        status: outcome.status || 'ok',
        latency_ms: Date.now() - started,
        rounds: outcome.rounds || 1,
        detail: outcome.detail ? JSON.stringify(outcome.detail) : null,
      };
      db.run(
        `INSERT INTO agent_runs (user_id, document_id, task, agent, status, latency_ms, rounds, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [context.userId, context.documentId, entry.task, agent, entry.status, entry.latency_ms, entry.rounds, entry.detail]
      );
      log({ level: 'info', ...entry, user: context.userId, document: context.documentId });
      return outcome.result;
    } catch (err) {
      const latency = Date.now() - started;
      db.run(
        `INSERT INTO agent_runs (user_id, document_id, task, agent, status, latency_ms, detail) VALUES (?, ?, ?, ?, 'failed', ?, ?)`,
        [context.userId, context.documentId, context.task, agent, latency, JSON.stringify({ error: err.message })]
      );
      log({ level: 'error', task: context.task, agent, latency_ms: latency, error: err.message });
      throw err;
    }
  };
}

module.exports = { createRecorder, log };
