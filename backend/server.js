const express = require('express');
const multer = require('multer');
const path = require('path');

const { extractText, InvalidPdfError, EmptyPdfError } = require('./lib/pdfExtractor');
const { runPipeline } = require('./lib/pipeline');
const { SUBJECT_PRESETS } = require('./lib/subjects');
const { isLlmAvailable } = require('./lib/llmClient');
const { createRateLimiter } = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Memory storage only — the uploaded PDF never touches disk, so there is
// nothing to clean up and nothing an attacker could path-traverse into.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  // Cheap early rejection only; the magic-byte check in extractText is authoritative.
  fileFilter: (req, file, cb) => {
    const looksLikePdf =
      file.mimetype === 'application/pdf' ||
      (file.mimetype === 'application/octet-stream' && /\.pdf$/i.test(file.originalname));
    if (!looksLikePdf) {
      return cb(new InvalidPdfError('Only PDF files are supported right now.'));
    }
    cb(null, true);
  },
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/sample-lecture.pdf', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'samples', 'sample-lecture.pdf'));
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', llmEnabled: isLlmAvailable(), subjects: SUBJECT_PRESETS });
});

const processLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

app.post('/api/process', processLimiter, (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return next(uploadErr);

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Please attach a PDF.' });
      }

      const subjectKey = typeof req.body.subject === 'string' ? req.body.subject : 'general';
      const { text, pageCount, pagesRead, truncated } = await extractText(req.file.buffer);
      const result = await runPipeline(text, subjectKey);

      result.meta.pageCount = pageCount;
      result.meta.notices = truncated
        ? [`Long document: notes cover the first ${pagesRead} of ${pageCount} pages.`]
        : [];

      res.json(result);
    } catch (err) {
      next(err);
    }
  });
});

// Centralized error handling: map known error types to clear, safe
// user-facing messages; never leak stack traces or internals to the client.
app.use((err, req, res, next) => {
  if (err instanceof InvalidPdfError) return res.status(400).json({ error: err.message });
  if (err instanceof EmptyPdfError) return res.status(422).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Maximum size is 10MB.' : 'File upload failed.';
    return res.status(400).json({ error: message });
  }

  console.error('Unexpected server error:', err);
  res.status(500).json({ error: 'Something went wrong while processing your file. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Groundwork backend running on http://localhost:${PORT}`);
  console.log(`LLM (Claude) enabled: ${isLlmAvailable()}`);
});

module.exports = app;
