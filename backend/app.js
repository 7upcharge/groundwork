const express = require('express');
const path = require('path');

const config = require('./config');
const { openDatabase } = require('./db');
const { createStorage } = require('./services/storage');
const { createAuthService } = require('./services/auth');
const { createLlm } = require('./lib/llm');
const { createRecorder } = require('./agents/recorder');
const { securityHeaders, requireAppHeader, attachUser, requireUser, rateLimit } = require('./middleware/security');
const { HttpError } = require('./lib/http');
const { InvalidPdfError, EmptyPdfError } = require('./lib/pdfExtractor');
const { LlmError } = require('./lib/llm');

const { authRoutes } = require('./routes/auth');
const { subjectRoutes } = require('./routes/subjects');
const { documentRoutes } = require('./routes/documents');
const { quizRoutes } = require('./routes/quizzes');
const { conceptRoutes } = require('./routes/concepts');
const { tutorRoutes } = require('./routes/tutor');
const { dashboardRoutes, exportRoutes } = require('./routes/dashboard');

function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides.config };
  const db = overrides.db || openDatabase(path.join(cfg.dataDir, 'groundwork.db'));
  const storage = overrides.storage || createStorage(cfg.dataDir);
  const auth = overrides.auth || createAuthService(db, { sessionDays: cfg.sessionDays });
  const llm = overrides.llm !== undefined ? overrides.llm : createLlm(cfg.llm);
  const recorder = overrides.recorder || createRecorder(db);

  auth.purgeExpiredSessions();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));
  app.use(attachUser(auth));
  app.use('/api', requireAppHeader);

  const writeLimiter = rateLimit({ windowMs: 60_000, max: 60 });
  const authLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Too many attempts. Please wait a minute.' });
  const uploadLimiter = rateLimit({ windowMs: 60_000, max: 8, message: 'Too many uploads. Please wait a minute.' });

  app.use('/api', writeLimiter);
  app.use('/api/auth', authLimiter);

  app.use('/api/auth', authRoutes({ auth, production: cfg.production, googleConfig: cfg.google }));
  app.use('/api/subjects', requireUser, subjectRoutes({ db }));
  app.use('/api/documents', requireUser, uploadLimiter, documentRoutes({ db, llm, recorder, storage, maxUploadBytes: cfg.maxUploadBytes, maxPages: cfg.maxPages }));
  app.use('/api/quizzes', requireUser, quizRoutes({ db, llm, recorder }));
  app.use('/api/concepts', requireUser, conceptRoutes({ db }));
  app.use('/api/tutor', requireUser, tutorRoutes({ db }));
  app.use('/api/dashboard', requireUser, dashboardRoutes({ db }));
  app.use('/api/export', requireUser, exportRoutes({ db }));


  app.get('/api/status', (req, res) => res.json({ status: 'ok', llmEnabled: !!llm, model: llm?.model || null }));
  app.get('/sample-lecture.pdf', (req, res) => res.sendFile(path.join(__dirname, '..', 'samples', 'sample-lecture.pdf')));

  app.use(express.static(path.join(__dirname, '..', 'frontend')));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof InvalidPdfError) return res.status(400).json({ error: err.message, code: 'invalid_pdf' });
    if (err instanceof EmptyPdfError) return res.status(422).json({ error: err.message, code: 'empty_pdf' });
    if (err instanceof LlmError) return res.status(502).json({ error: 'The AI model is unavailable right now.', code: 'llm_' + err.kind });
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large (max 10MB).', code: 'too_large' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.', code: 'bad_json' });
    console.error('Unexpected server error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
  });

  return { app, db, auth, llm };
}

module.exports = { createApp };
