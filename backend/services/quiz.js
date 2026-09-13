const { offlineQuiz, llmQuiz } = require('../agents/quiz');
const { createSourceIndex } = require('../agents/source');
const { loadGraph } = require('./graph');
const { HttpError } = require('../lib/http');

function saveQuiz(db, { userId, subjectId, documentId, kind, difficulty, focusConceptIds, engine, review, questions, passages }) {
  return db.transaction(() => {
    const { lastInsertRowid: quizId } = db.run(
      `INSERT INTO quizzes (user_id, subject_id, document_id, kind, difficulty, focus, engine, review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, subjectId, documentId, kind, difficulty, focusConceptIds ? JSON.stringify(focusConceptIds) : null, engine, review ? JSON.stringify(review) : null]
    );
    questions.forEach((q, ord) => {
      const passageId = q.passageId ?? passages[q.passageIndex]?.id;
      const conceptId = typeof q.concept === 'number' ? q.concept : null;
      db.run(
        `INSERT INTO questions (quiz_id, ord, type, prompt, options, answer, explanation, difficulty, concept_id, passage_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quizId,
          ord,
          q.type,
          q.prompt,
          JSON.stringify(q.choices),
          JSON.stringify(q.correctIndexes ?? [q.correctIndex]),
          q.explanation,
          q.difficulty,
          conceptId,
          passageId,
        ]
      );
    });
    return quizId;
  });
}

async function generateQuiz(db, llm, recorder, { userId, subjectId, documentId, difficulty = 'mixed', count = 5, focusConceptIds = null }) {
  const documentIds = documentId ? [documentId] : null;
  const graph = loadGraph(db, documentIds ? { documentIds } : { subjectId });
  if (graph.passages.length === 0) throw new HttpError(422, 'No processed material to build a quiz from yet.', 'no_material');

  const focusNames = focusConceptIds
    ? graph.concepts.filter((c) => focusConceptIds.includes(c.id)).map((c) => c.normalized)
    : null;
  if (focusConceptIds && (!focusNames || focusNames.length === 0)) {
    throw new HttpError(422, "Those concepts don't have enough material to build targeted practice yet.", 'no_focus_material');
  }

  const context = { task: focusConceptIds ? 'targeted_quiz' : 'practice_quiz', userId, documentId: documentId || null };
  let questions = [];
  let engine = 'offline';
  let review = null;

  if (llm) {
    const passages = focusNames
      ? graph.passages.filter((p, i) => graph.concepts.some((c) => focusNames.includes(c.normalized) && c.passageIds.has(i)))
      : graph.passages;
    const sourceIndex = createSourceIndex(graph.passages);
    try {
      const outcome = await recorder(context, 'quiz', async () => {
        const { items, rounds, repaired, dropped } = await llmQuiz({ llm, passages, difficulty, count, sourceIndex });
        if (items.length === 0) throw new Error('LLM produced no source-grounded questions');
        return { result: { items, rounds, repaired, dropped }, status: dropped.length > 0 ? 'repaired' : 'ok', rounds, detail: { repaired, dropped: dropped.length } };
      });
      questions = outcome.items.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        choices: q.choices,
        correctIndexes: q.correctIndexes,
        explanation: q.explanation,
        difficulty: q.difficulty,
        passageId: q.passageId,
        concept: graph.concepts.find((c) => c.normalized === (q.concept || '').toLowerCase())?.id ?? null,
      }));
      engine = llm.model;
      review = { dropped: outcome.dropped.length, repaired: outcome.repaired, rounds: outcome.rounds };
    } catch {
      questions = [];
    }
  }

  if (questions.length === 0) {
    const raw = offlineQuiz({ passages: graph.passages, concepts: graph.concepts, count, focusConceptNames: focusNames });
    if (raw.length === 0) throw new HttpError(422, 'Not enough distinct concepts in this material yet to build a quiz.', 'insufficient_material');
    questions = raw.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      choices: q.choices,
      correctIndexes: [q.correctIndex],
      explanation: q.explanation,
      difficulty: q.difficulty,
      passageIndex: q.passageIndex,
      concept: graph.concepts.find((c) => c.normalized === q.conceptNormalized)?.id ?? null,
    }));
    engine = 'offline';
  }

  const quizId = saveQuiz(db, {
    userId,
    subjectId,
    documentId: documentId || null,
    kind: focusConceptIds ? 'targeted' : 'practice',
    difficulty,
    focusConceptIds,
    engine,
    review,
    questions,
    passages: graph.passages,
  });
  return quizId;
}

function serializeQuiz(db, quizId, { includeAnswers }) {
  const quiz = db.get('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  if (!quiz) throw new HttpError(404, 'Quiz not found.', 'not_found');
  const rows = db.all(
    `SELECT q.*, p.text AS passage_text, p.page AS passage_page, d.title AS document_title
     FROM questions q JOIN passages p ON p.id = q.passage_id JOIN documents d ON d.id = p.document_id
     WHERE q.quiz_id = ? ORDER BY q.ord`,
    [quizId]
  );
  return {
    id: quiz.id,
    kind: quiz.kind,
    difficulty: quiz.difficulty,
    engine: quiz.engine,
    review: quiz.review ? JSON.parse(quiz.review) : null,
    createdAt: quiz.created_at,
    questions: rows.map((r) => ({
      id: r.id,
      type: r.type,
      prompt: r.prompt,
      choices: JSON.parse(r.options),
      ...(includeAnswers ? { correctIndexes: JSON.parse(r.answer), explanation: r.explanation } : {}),
      difficulty: r.difficulty,
      source: { document: r.document_title, page: r.passage_page, quote: r.passage_text },
    })),
  };
}

function submitAttempt(db, { quizId, userId, responses }) {
  const questions = db.all('SELECT id, answer FROM questions WHERE quiz_id = ?', [quizId]);
  if (questions.length === 0) throw new HttpError(404, 'Quiz not found.', 'not_found');

  return db.transaction(() => {
    let score = 0;
    const graded = [];
    const { lastInsertRowid: attemptId } = db.run('INSERT INTO attempts (quiz_id, user_id, score, total) VALUES (?, ?, 0, ?)', [
      quizId,
      userId,
      questions.length,
    ]);

    for (const q of questions) {
      const correct = JSON.parse(q.answer).slice().sort();
      const given = (responses[q.id] || []).slice().sort();
      const isCorrect = correct.length === given.length && correct.every((v, i) => v === given[i]);
      if (isCorrect) score += 1;
      db.run('INSERT INTO answers (attempt_id, question_id, response, correct) VALUES (?, ?, ?, ?)', [
        attemptId,
        q.id,
        JSON.stringify(given),
        isCorrect ? 1 : 0,
      ]);
      graded.push({ questionId: q.id, correct: isCorrect });
    }
    db.run('UPDATE attempts SET score = ? WHERE id = ?', [score, attemptId]);
    return { attemptId, score, total: questions.length, graded };
  });
}

module.exports = { generateQuiz, serializeQuiz, submitAttempt };
