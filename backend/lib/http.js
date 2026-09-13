class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

const badRequest = (message) => new HttpError(400, message, 'invalid_request');
const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');

// Express 4 does not forward rejected promises to error middleware.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const v = {
  id(value, name = 'id') {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} must be a positive integer.`);
    return n;
  },
  string(value, name, { min = 1, max = 200, optional = false } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return null;
      throw badRequest(`${name} is required.`);
    }
    if (typeof value !== 'string') throw badRequest(`${name} must be text.`);
    const trimmed = value.trim();
    if (trimmed.length < min) throw badRequest(`${name} is too short.`);
    if (trimmed.length > max) throw badRequest(`${name} is too long (max ${max} characters).`);
    return trimmed;
  },
  oneOf(value, name, allowed, fallback) {
    if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
    if (!allowed.includes(value)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}.`);
    return value;
  },
  intIn(value, name, allowed, fallback) {
    if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
    const n = Number(value);
    if (!allowed.includes(n)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}.`);
    return n;
  },
  email(value) {
    const email = v.string(value, 'Email', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address.');
    return email;
  },
};

module.exports = { HttpError, badRequest, notFound, handle, v };
