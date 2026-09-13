const { Router } = require('express');
const { handle, v } = require('../lib/http');
const { nextUp } = require('../services/weakness');
const { buildStudyPack, studyPackToMarkdown } = require('../services/studyPack');
const lib = require('../services/library');

function dashboardRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    handle(async (req, res) => {
      const subjects = lib.listSubjects(db, req.user.id);
      const recent = db.all(
        `SELECT id, title, subject_id, status, opened_at, processed_at FROM documents
         WHERE user_id = ? AND opened_at IS NOT NULL ORDER BY opened_at DESC LIMIT 5`,
        [req.user.id]
      );
      res.json({ subjects, recent, nextUp: nextUp(db, req.user.id) });
    })
  );

  return router;
}

function exportRoutes({ db }) {
  const router = Router();
  router.get(
    '/documents/:id/study-pack.md',
    handle(async (req, res) => {
      const pack = buildStudyPack(db, req.user.id, v.id(req.params.id));
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${pack.detail.title.replace(/[^\w.-]+/g, '_')}-study-pack.md"`);
      res.send(studyPackToMarkdown(pack));
    })
  );
  return router;
}

module.exports = { dashboardRoutes, exportRoutes };
