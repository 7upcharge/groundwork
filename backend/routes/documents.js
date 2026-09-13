const { Router } = require('express');
const multer = require('multer');
const { handle, v, HttpError } = require('../lib/http');
const lib = require('../services/library');
const { processDocument } = require('../services/pipeline');
const { InvalidPdfError } = require('../lib/pdfExtractor');

function documentRoutes({ db, llm, recorder, storage, maxUploadBytes, maxPages }) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      const looksLikePdf =
        /\.pdf$/i.test(file.originalname) ||
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/x-pdf' ||
        file.mimetype === 'application/acrobat' ||
        file.mimetype === 'application/octet-stream';
      cb(looksLikePdf ? null : new InvalidPdfError('Only PDF files are supported right now.'), looksLikePdf);
    },
  });

  router.post(
    '/',
    (req, res, next) => upload.single('file')(req, res, (err) => next(err)),
    handle(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Attach a PDF to upload.', 'no_file');
      const subjectId = v.id(req.body.subjectId, 'subjectId');
      const subject = lib.requireSubject(db, req.user.id, subjectId);
      const title = v.string(req.body.title || req.file.originalname.replace(/\.pdf$/i, ''), 'Title', { max: 150 });

      const { key, sha256 } = storage.save(req.file.buffer);
      const existing = db.get('SELECT id FROM documents WHERE user_id = ? AND sha256 = ?', [req.user.id, sha256]);
      if (existing) {
        return res.status(200).json({ document: { id: existing.id }, deduped: true });
      }

      const { lastInsertRowid: documentId } = db.run(
        `INSERT INTO documents (user_id, subject_id, title, filename, storage_key, sha256, byte_size, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
        [req.user.id, subject.id, title, req.file.originalname, key, sha256, req.file.size]
      );

      try {
        await processDocument(db, llm, recorder, { documentId, userId: req.user.id, subjectId: subject.id, buffer: req.file.buffer, maxPages });
      } catch (err) {
        return res.status(422).json({ error: `Processing failed: ${err.message}`, document: { id: documentId, status: 'failed' } });
      }
      res.status(201).json({ document: { id: documentId } });
    })
  );

  router.get(
    '/:id',
    handle(async (req, res) => res.json(lib.getDocumentDetail(db, req.user.id, v.id(req.params.id))))
  );

  router.get(
    '/:id/status',
    handle(async (req, res) => {
      const doc = lib.requireDocument(db, req.user.id, v.id(req.params.id));
      res.json({ status: doc.status, stage: doc.stage, error: doc.error });
    })
  );

  router.patch(
    '/:id',
    handle(async (req, res) => {
      lib.renameDocument(db, req.user.id, v.id(req.params.id), v.string(req.body.title, 'Title', { max: 150 }));
      res.status(204).end();
    })
  );

  router.delete(
    '/:id',
    handle(async (req, res) => {
      lib.deleteDocument(db, req.user.id, v.id(req.params.id));
      res.status(204).end();
    })
  );

  return router;
}

module.exports = { documentRoutes };
