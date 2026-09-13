const { Router } = require('express');
const { handle, v } = require('../lib/http');
const { askTutor } = require('../agents/tutor');
const lib = require('../services/library');

function tutorRoutes({ db }) {
  const router = Router();

  router.post(
    '/ask',
    handle(async (req, res) => {
      const subjectId = req.body.subjectId ? v.id(req.body.subjectId) : null;
      const documentId = req.body.documentId ? v.id(req.body.documentId) : null;
      const conceptId = req.body.conceptId ? v.id(req.body.conceptId) : null;
      const query = req.body.query ? v.string(req.body.query, 1, 1000) : '';
      const mode = req.body.mode ? v.string(req.body.mode, 1, 50) : 'explain';
      const contextText = req.body.contextText ? v.string(req.body.contextText, 1, 2000) : null;

      if (subjectId) lib.requireSubject(db, req.user.id, subjectId);
      if (documentId) lib.requireDocument(db, req.user.id, documentId);

      const response = await askTutor(db, {
        userId: req.user.id,
        subjectId,
        documentId,
        conceptId,
        query,
        mode,
        contextText,
      });

      res.json(response);
    })
  );

  return router;
}

module.exports = { tutorRoutes };
