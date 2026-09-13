PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  is_guest      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS subjects (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

-- ---------- Source material ----------

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  filename      TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  page_count    INTEGER,
  pages_read    INTEGER,
  status        TEXT NOT NULL DEFAULT 'queued',   -- queued | processing | ready | failed
  stage         TEXT,                             -- current pipeline stage while processing
  error         TEXT,
  engine        TEXT,                             -- model name or 'offline'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at     TEXT,
  processed_at  TEXT,
  UNIQUE (user_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents(subject_id);

CREATE TABLE IF NOT EXISTS sections (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  title       TEXT NOT NULL,
  page_start  INTEGER NOT NULL,
  page_end    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id);

-- A passage is the unit of source grounding: every generated claim points at one.
CREATE TABLE IF NOT EXISTS passages (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id  INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  page        INTEGER NOT NULL,
  text        TEXT NOT NULL,
  flagged     INTEGER NOT NULL DEFAULT 0          -- looks like instructions aimed at a model; never sent to one
);
CREATE INDEX IF NOT EXISTS idx_passages_document ON passages(document_id);
CREATE INDEX IF NOT EXISTS idx_passages_section ON passages(section_id);

-- ---------- Knowledge graph ----------

-- Concepts are shared across a subject's documents, which is what links
-- "CSMA/CD" in Lecture 2 to "CSMA/CD" in Lecture 3.
CREATE TABLE IF NOT EXISTS concepts (
  id                   INTEGER PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id           INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  normalized           TEXT NOT NULL,
  definition           TEXT,
  definition_passage_id INTEGER REFERENCES passages(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_id, normalized)
);

-- MENTIONS / DEFINES: concept -> passage (and therefore section, page, document)
CREATE TABLE IF NOT EXISTS concept_passages (
  concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  passage_id INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL CHECK (relation IN ('mentions', 'defines')),
  PRIMARY KEY (concept_id, passage_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_concept_passages_passage ON concept_passages(passage_id);

-- RELATED_TO (symmetric, stored once with src < dst) / PREREQUISITE_OF (src is prerequisite of dst)
CREATE TABLE IF NOT EXISTS concept_edges (
  src_id    INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  dst_id    INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relation  TEXT NOT NULL CHECK (relation IN ('related', 'prerequisite')),
  weight    REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (src_id, dst_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_concept_edges_dst ON concept_edges(dst_id);

-- ---------- Generated study material ----------

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  engine      TEXT NOT NULL,
  dropped     INTEGER NOT NULL DEFAULT 0,        -- claims removed by source verification
  repaired    INTEGER NOT NULL DEFAULT 0,        -- claims fixed by the repair loop
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_document ON notes(document_id);

CREATE TABLE IF NOT EXISTS note_items (
  id          INTEGER PRIMARY KEY,
  note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('overview','definition','key_point','example','formula','exam_focus','confusion')),
  section_id  INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  concept_id  INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
  passage_id  INTEGER REFERENCES passages(id) ON DELETE SET NULL,
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_items_note ON note_items(note_id);

CREATE TABLE IF NOT EXISTS quizzes (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  document_id  INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('practice', 'targeted')),
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard','mixed')),
  focus        TEXT,                              -- JSON array of concept ids for targeted practice
  engine       TEXT NOT NULL,
  review       TEXT,                              -- JSON summary of the review loop
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quizzes_user ON quizzes(user_id);

CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('mcq','true_false','multi')),
  prompt       TEXT NOT NULL,
  options      TEXT NOT NULL,                     -- JSON array of strings
  answer       TEXT NOT NULL,                     -- JSON array of correct option indexes
  explanation  TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  concept_id   INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
  passage_id   INTEGER NOT NULL REFERENCES passages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_questions_concept ON questions(concept_id);

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);

CREATE TABLE IF NOT EXISTS answers (
  id           INTEGER PRIMARY KEY,
  attempt_id   INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  response     TEXT NOT NULL,                     -- JSON array of chosen option indexes
  correct      INTEGER NOT NULL,
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);

-- Cached, source-verified explanations (tutor output), reused until regenerated.
CREATE TABLE IF NOT EXISTS explanations (
  id          INTEGER PRIMARY KEY,
  concept_id  INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  engine      TEXT NOT NULL,
  body        TEXT NOT NULL,                      -- JSON: paragraphs with passage citations
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (concept_id, mode)
);

-- ---------- Observability ----------

CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER,
  document_id INTEGER,
  task        TEXT NOT NULL,
  agent       TEXT NOT NULL,
  status      TEXT NOT NULL,                      -- ok | repaired | fallback | failed
  latency_ms  INTEGER NOT NULL,
  rounds      INTEGER NOT NULL DEFAULT 1,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_document ON agent_runs(document_id);
