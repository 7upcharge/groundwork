const { Router } = require('express');
const { handle, v } = require('../lib/http');
const lib = require('../services/library');

function subjectRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    handle(async (req, res) => res.json({ subjects: lib.listSubjects(db, req.user.id) }))
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const name = v.string(req.body.name, 'Subject name', { max: 80 });
      const subject = lib.getOrCreateSubject(db, req.user.id, name);
      res.status(201).json({ subject });
    })
  );

  router.get(
    '/:id/documents',
    handle(async (req, res) => {
      const id = v.id(req.params.id);
      lib.requireSubject(db, req.user.id, id);
      res.json({ documents: lib.listDocuments(db, req.user.id, id) });
    })
  );

  return router;
}

module.exports = { subjectRoutes };
