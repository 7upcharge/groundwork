const { Router } = require('express');
const { handle, v } = require('../lib/http');
const { getConceptDetail } = require('../services/concepts');
const { weakConcepts } = require('../services/weakness');
const lib = require('../services/library');

function conceptRoutes({ db }) {
  const router = Router();

  router.get(
    '/:id',
    handle(async (req, res) => res.json(getConceptDetail(db, req.user.id, v.id(req.params.id))))
  );

  router.get(
    '/subject/:subjectId/weak',
    handle(async (req, res) => {
      const subjectId = v.id(req.params.subjectId);
      lib.requireSubject(db, req.user.id, subjectId);
      res.json({ weak: weakConcepts(db, { userId: req.user.id, subjectId }) });
    })
  );

  return router;
}

module.exports = { conceptRoutes };
