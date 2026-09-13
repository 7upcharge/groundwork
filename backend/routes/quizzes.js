const { Router } = require('express');
const { handle, v, HttpError } = require('../lib/http');
const { generateQuiz, serializeQuiz, submitAttempt } = require('../services/quiz');
const lib = require('../services/library');

function quizRoutes({ db, llm, recorder }) {
  const router = Router();

  router.post(
    '/',
    handle(async (req, res) => {
      const subjectId = v.id(req.body.subjectId, 'subjectId');
      lib.requireSubject(db, req.user.id, subjectId);
      const documentId = req.body.documentId ? v.id(req.body.documentId, 'documentId') : null;
      if (documentId) lib.requireDocument(db, req.user.id, documentId);
      const difficulty = v.oneOf(req.body.difficulty, 'difficulty', ['easy', 'medium', 'hard', 'mixed'], 'mixed');
      const count = v.intIn(req.body.count, 'count', [5, 10, 20], 5);

      const quizId = await generateQuiz(db, llm, recorder, { userId: req.user.id, subjectId, documentId, difficulty, count });
      res.status(201).json(serializeQuiz(db, quizId, { includeAnswers: false }));
    })
  );

  router.post(
    '/targeted',
    handle(async (req, res) => {
      const subjectId = v.id(req.body.subjectId, 'subjectId');
      lib.requireSubject(db, req.user.id, subjectId);
      const conceptIds = Array.isArray(req.body.conceptIds) ? req.body.conceptIds.map((id) => v.id(id, 'conceptId')) : null;
      if (!conceptIds || conceptIds.length === 0) throw new HttpError(400, 'conceptIds is required.', 'invalid_request');
      const count = v.intIn(req.body.count, 'count', [5, 10, 20], 5);

      const quizId = await generateQuiz(db, llm, recorder, { userId: req.user.id, subjectId, difficulty: 'mixed', count, focusConceptIds: conceptIds });
      res.status(201).json(serializeQuiz(db, quizId, { includeAnswers: false }));
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => res.json(serializeQuiz(db, v.id(req.params.id), { includeAnswers: false })))
  );

  router.post(
    '/:id/attempts',
    handle(async (req, res) => {
      const quizId = v.id(req.params.id);
      const responses = req.body.responses && typeof req.body.responses === 'object' ? req.body.responses : {};
      const clean = {};
      for (const [qid, value] of Object.entries(responses)) {
        clean[Number(qid)] = Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : [];
      }
      const result = submitAttempt(db, { quizId, userId: req.user.id, responses: clean });
      const withAnswers = serializeQuiz(db, quizId, { includeAnswers: true });
      res.status(201).json({ ...result, quiz: withAnswers });
    })
  );

  return router;
}

module.exports = { quizRoutes };
