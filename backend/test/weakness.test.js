const { openDatabase } = require('../db');
const { weakConcepts, nextUp } = require('../services/weakness');

function seed(db) {
  db.run('INSERT INTO users (id, name, is_guest) VALUES (1, \'Guest\', 1)');
  db.run('INSERT INTO subjects (id, user_id, name) VALUES (1, 1, \'Biology\')');
  db.run('INSERT INTO documents (id, user_id, subject_id, title, filename, storage_key, sha256, byte_size, status) VALUES (1,1,1,\'d\',\'d.pdf\',\'x\',\'x\',1,\'ready\')');
  db.run('INSERT INTO sections (id, document_id, ord, title, page_start, page_end) VALUES (1,1,0,\'S\',1,1)');
  db.run("INSERT INTO passages (id, document_id, section_id, ord, page, text) VALUES (1,1,1,0,1,'Some passage text that is long enough to be real.')");
  db.run("INSERT INTO concepts (id, user_id, subject_id, name, normalized) VALUES (1,1,1,'Krebs cycle','krebs cycle')");
  db.run("INSERT INTO concepts (id, user_id, subject_id, name, normalized) VALUES (2,1,1,'Glycolysis','glycolysis')");
  db.run("INSERT INTO quizzes (id, user_id, subject_id, kind, difficulty, engine) VALUES (1,1,1,'practice','mixed','offline')");

  let qid = 1;
  const mkQuestion = (conceptId) => {
    db.run(
      `INSERT INTO questions (id, quiz_id, ord, type, prompt, options, answer, explanation, difficulty, concept_id, passage_id)
       VALUES (?,1,?,'mcq','p','[]','[0]','e','medium',?,1)`,
      [qid, qid, conceptId]
    );
    return qid++;
  };

  const answer = (attemptId, questionId, correct) =>
    db.run('INSERT INTO answers (attempt_id, question_id, response, correct) VALUES (?,?,\'[]\',?)', [attemptId, questionId, correct ? 1 : 0]);

  const attempt = (submittedAt) => {
    const { lastInsertRowid } = db.run('INSERT INTO attempts (quiz_id, user_id, score, total, submitted_at) VALUES (1,1,0,1,?)', [submittedAt]);
    return lastInsertRowid;
  };

  return { mkQuestion, answer, attempt };
}

async function run({ test, assert }) {
  await test('weakConcepts: a single wrong answer never counts as a weakness', () => {
    const db = openDatabase(':memory:');
    const { mkQuestion, answer, attempt } = seed(db);
    const q1 = mkQuestion(1);
    answer(attempt('2026-01-01 10:00:00'), q1, false);
    const weak = weakConcepts(db, { userId: 1, subjectId: 1 });
    assert.strictEqual(weak.length, 0);
  });

  await test('weakConcepts: two wrong answers in a row -> high confidence', () => {
    const db = openDatabase(':memory:');
    const { mkQuestion, answer, attempt } = seed(db);
    const q1 = mkQuestion(1);
    answer(attempt('2026-01-01 10:00:00'), q1, false);
    const q2 = mkQuestion(1);
    answer(attempt('2026-01-01 10:05:00'), q2, false);
    const weak = weakConcepts(db, { userId: 1, subjectId: 1 });
    assert.strictEqual(weak.length, 1);
    assert.strictEqual(weak[0].confidence, 'high');
    assert.strictEqual(weak[0].name, 'Krebs cycle');
  });

  await test('weakConcepts: getting it right afterwards clears the weakness', () => {
    const db = openDatabase(':memory:');
    const { mkQuestion, answer, attempt } = seed(db);
    answer(attempt('2026-01-01 10:00:00'), mkQuestion(1), false);
    answer(attempt('2026-01-01 10:05:00'), mkQuestion(1), false);
    answer(attempt('2026-01-01 10:10:00'), mkQuestion(1), true);
    answer(attempt('2026-01-01 10:15:00'), mkQuestion(1), true);
    const weak = weakConcepts(db, { userId: 1, subjectId: 1 });
    assert.strictEqual(weak.length, 0);
  });

  await test('weakConcepts: distinct concepts are tracked independently', () => {
    const db = openDatabase(':memory:');
    const { mkQuestion, answer, attempt } = seed(db);
    answer(attempt('2026-01-01 10:00:00'), mkQuestion(1), false);
    answer(attempt('2026-01-01 10:05:00'), mkQuestion(1), false);
    answer(attempt('2026-01-01 10:10:00'), mkQuestion(2), true);
    answer(attempt('2026-01-01 10:15:00'), mkQuestion(2), true);
    const weak = weakConcepts(db, { userId: 1, subjectId: 1 });
    assert.strictEqual(weak.length, 1);
    assert.strictEqual(weak[0].name, 'Krebs cycle');
  });

  await test('nextUp: surfaces the highest-confidence weak concept across subjects', () => {
    const db = openDatabase(':memory:');
    const { mkQuestion, answer, attempt } = seed(db);
    answer(attempt('2026-01-01 10:00:00'), mkQuestion(1), false);
    answer(attempt('2026-01-01 10:05:00'), mkQuestion(1), false);
    const next = nextUp(db, 1);
    assert.ok(next);
    assert.strictEqual(next.name, 'Krebs cycle');
    assert.strictEqual(next.confidence, 'high');
  });

  await test('nextUp: returns null when the student has no weak concepts', () => {
    const db = openDatabase(':memory:');
    seed(db);
    assert.strictEqual(nextUp(db, 1), null);
  });
}

module.exports = { run };
