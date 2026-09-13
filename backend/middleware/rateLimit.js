// Minimal in-memory rate limiter (no extra dependency) to blunt naive abuse
// of the processing endpoint, which is the most expensive/costly route
// (PDF parsing + LLM calls). Not a substitute for infra-level protection,
// but a reasonable safeguard for a small single-instance app.
function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();

  return function rateLimit(req, res, next) {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    }
    next();
  };
}

module.exports = { createRateLimiter };
