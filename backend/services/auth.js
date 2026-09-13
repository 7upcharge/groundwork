const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError } = require('../lib/http');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;
const SESSION_SECRET = process.env.SESSION_SECRET || 'groundwork-stateless-session-secret-key-3d751fc8';


async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function signToken(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${hmac}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig !== expectedHmac) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function createAuthService(db, { sessionDays }) {
  function createSession(userId) {
    const user = getUser(userId);
    const expiresMs = Date.now() + sessionDays * 86400_000;
    const expires = new Date(expiresMs).toISOString();

    const tokenData = {
      id: userId,
      email: user ? user.email : null,
      name: user ? user.name : 'User',
      isGuest: user ? !!user.isGuest : false,
      exp: expiresMs,
    };
    const token = signToken(tokenData);

    try {
      db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expires]);
    } catch {
      /* ignore db insert errors in serverless */
    }
    return { token, expires };
  }

  function userForToken(token) {
    if (!token) return null;
    const verified = verifyToken(token);
    if (!verified) return null;

    try {
      const revoked = db.get("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at = 'REVOKED'", [hashToken(token)]);
      if (revoked) return null;
    } catch {
      /* ignore */
    }

    // Check local database instance
    const dbUser = db.get('SELECT id, email, name, is_guest FROM users WHERE id = ?', [verified.id]);
    if (dbUser) {
      return { id: dbUser.id, email: dbUser.email, name: dbUser.name, isGuest: !!dbUser.is_guest };
    }

    // Serverless fallback: ensure user row exists in current local DB instance
    try {
      if (verified.email) {
        db.run('INSERT OR IGNORE INTO users (id, email, name, is_guest) VALUES (?, ?, ?, ?)', [
          verified.id,
          verified.email,
          verified.name,
          verified.isGuest ? 1 : 0,
        ]);
      } else {
        db.run('INSERT OR IGNORE INTO users (id, name, is_guest) VALUES (?, ?, ?)', [
          verified.id,
          verified.name || 'Guest',
          verified.isGuest ? 1 : 0,
        ]);
      }
    } catch {
      /* ignore */
    }

    return {
      id: verified.id,
      email: verified.email || null,
      name: verified.name || 'User',
      isGuest: !!verified.isGuest,
    };
  }

  function destroySession(token) {
    if (token) {
      try {
        const verified = verifyToken(token);
        const userId = (verified && verified.id) || 1;
        db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
        db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
          hashToken(token),
          userId,
          'REVOKED',
        ]);
      } catch {
        /* ignore */
      }
    }
  }

  async function register({ email, password, name }) {
    if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.', 'weak_password');
    if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'An account with that email already exists.', 'email_taken');
    }
    const passwordHash = await hashPassword(password);
    const { lastInsertRowid } = db.run('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [
      email,
      name,
      passwordHash,
    ]);
    return lastInsertRowid;
  }

  // Upgrades a guest in place so their materials and progress are kept.
  async function claimGuest(userId, { email, password, name }) {
    if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.', 'weak_password');
    if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'An account with that email already exists.', 'email_taken');
    }
    const passwordHash = await hashPassword(password);
    db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, is_guest = 0 WHERE id = ? AND is_guest = 1', [
      email,
      name,
      passwordHash,
      userId,
    ]);
  }

  async function login({ email, password }) {
    const user = db.get('SELECT id, password_hash FROM users WHERE email = ?', [email]);
    // Hash even when the user doesn't exist so response time doesn't reveal registered emails.
    const ok = await verifyPassword(password, user ? user.password_hash : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86));
    if (!user || !ok) throw new HttpError(401, 'Email or password is incorrect.', 'bad_credentials');
    return user.id;
  }

  function getUser(userId) {
    const row = db.get('SELECT id, email, name, is_guest FROM users WHERE id = ?', [userId]);
    return row ? { id: row.id, email: row.email, name: row.name, isGuest: !!row.is_guest } : null;
  }

  function createGuest() {
    const { lastInsertRowid } = db.run('INSERT INTO users (name, is_guest) VALUES (?, 1)', ['Guest']);
    return lastInsertRowid;
  }

  function purgeExpiredSessions() {
    db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
  }

  async function loginOrRegisterGoogle({ email, name }) {
    if (!email) throw new HttpError(400, 'Google account email is missing.', 'invalid_google_user');
    let user = db.get('SELECT id, is_guest FROM users WHERE email = ?', [email]);
    if (user) {
      if (user.is_guest) {
        db.run('UPDATE users SET is_guest = 0, name = ? WHERE id = ?', [name || 'Google User', user.id]);
      }
      return user.id;
    }
    const { lastInsertRowid } = db.run('INSERT INTO users (email, name, is_guest) VALUES (?, ?, 0)', [
      email,
      name || 'Google User',
    ]);
    return lastInsertRowid;
  }

  return { createSession, userForToken, destroySession, register, claimGuest, login, createGuest, getUser, purgeExpiredSessions, loginOrRegisterGoogle };
}


module.exports = { createAuthService, hashPassword, verifyPassword };
