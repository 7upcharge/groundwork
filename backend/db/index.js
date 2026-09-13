const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return wrap(db);
}

// Thin helpers over node:sqlite: statement caching, undefined -> null, and
// transactions that roll back on any thrown error.
function wrap(db) {
  const cache = new Map();
  const prepare = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };
  const clean = (params) => {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map((v) => (v === undefined ? null : v));
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = v === undefined ? null : v;
    return [out];
  };
  const toPlain = (row) => (row ? { ...row } : row);

  let depth = 0;
  return {
    raw: db,
    run: (sql, params) => prepare(sql).run(...clean(params)),
    get: (sql, params) => toPlain(prepare(sql).get(...clean(params))),
    all: (sql, params) => prepare(sql).all(...clean(params)).map(toPlain),
    exec: (sql) => db.exec(sql),
    transaction(fn) {
      if (depth > 0) return fn();
      depth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => db.close(),
  };
}

module.exports = { openDatabase };
