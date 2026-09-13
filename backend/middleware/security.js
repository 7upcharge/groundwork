const { HttpError } = require('../lib/http');

const COOKIE = 'gw_session';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, expires, production) {
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expires).toUTCString()}`,
    production ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

const clearCookie = (production) =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${production ? '; Secure' : ''}`;

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
}

// Cross-site pages can't attach a custom header without a CORS preflight, which
// we never grant, so requiring it on writes blocks CSRF alongside SameSite=Lax.
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Groundwork') !== '1') return next(new HttpError(403, 'Missing request header.', 'csrf'));
  next();
}

function attachUser(auth) {
  return (req, res, next) => {
    req.sessionToken = parseCookies(req.headers.cookie)[COOKIE] || null;
    req.user = auth.userForToken(req.sessionToken);
    next();
  };
}

function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', 'unauthenticated'));
  next();
}

function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests. Please wait a moment and try again.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new HttpError(429, message, 'rate_limited'));
    }
    next();
  };
}

module.exports = { securityHeaders, requireAppHeader, attachUser, requireUser, rateLimit, sessionCookie, clearCookie };
