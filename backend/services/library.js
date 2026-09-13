const { HttpError } = require('../lib/http');

function listSubjects(db, userId) {
  let subjects = db.all(
    `SELECT s.id, s.name, s.created_at,
            COUNT(d.id) AS document_count,
            SUM(CASE WHEN d.status = 'ready' THEN 1 ELSE 0 END) AS ready_count
     FROM subjects s LEFT JOIN documents d ON d.subject_id = s.id
     WHERE s.user_id = ? GROUP BY s.id ORDER BY s.created_at DESC`,
    [userId]
  );

  if (!subjects || subjects.length === 0) {
    try {
      db.run('INSERT OR IGNORE INTO subjects (user_id, name) VALUES (?, ?)', [userId, 'Computer Networks']);
    } catch {
      /* ignore */
    }
    subjects = db.all(
      `SELECT s.id, s.name, s.created_at,
              COUNT(d.id) AS document_count,
              SUM(CASE WHEN d.status = 'ready' THEN 1 ELSE 0 END) AS ready_count
       FROM subjects s LEFT JOIN documents d ON d.subject_id = s.id
       WHERE s.user_id = ? GROUP BY s.id ORDER BY s.created_at DESC`,
      [userId]
    );
  }

  return subjects;
}

function getOrCreateSubject(db, userId, name) {
  const existing = db.get('SELECT * FROM subjects WHERE user_id = ? AND name = ?', [userId, name]);
  if (existing) return existing;
  const { lastInsertRowid } = db.run('INSERT INTO subjects (user_id, name) VALUES (?, ?)', [userId, name]);
  return { id: lastInsertRowid, name };
}

function requireSubject(db, userId, subjectId) {
  let subject = db.get('SELECT * FROM subjects WHERE id = ? AND user_id = ?', [subjectId, userId]);
  if (!subject && subjectId) {
    try {
      db.run('INSERT OR IGNORE INTO subjects (id, user_id, name) VALUES (?, ?, ?)', [subjectId, userId, 'Computer Networks']);
    } catch {
      /* ignore */
    }
    subject = db.get('SELECT * FROM subjects WHERE id = ? AND user_id = ?', [subjectId, userId]);
  }
  if (!subject) {
    const subjects = listSubjects(db, userId);
    subject = subjects[0] || getOrCreateSubject(db, userId, 'Computer Networks');
  }
  return subject;
}

function requireDocument(db, userId, documentId) {
  const doc = db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', [documentId, userId]);
  if (!doc) throw new HttpError(404, 'Material not found.', 'not_found');
  return doc;
}

function listDocuments(db, userId, subjectId) {
  return db.all(
    `SELECT id, title, status, stage, page_count, engine, created_at, processed_at, opened_at
     FROM documents WHERE user_id = ? AND subject_id = ? ORDER BY created_at DESC`,
    [userId, subjectId]
  );
}

function renameDocument(db, userId, documentId, title) {
  requireDocument(db, userId, documentId);
  db.run('UPDATE documents SET title = ? WHERE id = ?', [title, documentId]);
}

function deleteDocument(db, userId, documentId) {
  requireDocument(db, userId, documentId);
  db.run('DELETE FROM documents WHERE id = ?', [documentId]); // cascades sections/passages/notes/quizzes
}

function markOpened(db, documentId) {
  db.run("UPDATE documents SET opened_at = datetime('now') WHERE id = ?", [documentId]);
}

const NOTE_ORDER = ['overview', 'definition', 'key_point', 'example', 'formula', 'exam_focus', 'confusion'];
const NOTE_LABELS = {
  overview: 'Overview',
  definition: 'Definitions',
  key_point: 'Key Points',
  example: 'Examples',
  formula: 'Formulas',
  exam_focus: 'Exam Focus',
  confusion: 'Common Confusions',
};

function getDocumentDetail(db, userId, documentId) {
  const doc = requireDocument(db, userId, documentId);
  markOpened(db, documentId);

  const note = db.get('SELECT * FROM notes WHERE document_id = ? ORDER BY id DESC LIMIT 1', [documentId]);
  let sections = { overview: [] };
  if (note) {
    const items = db.all(
      `SELECT ni.*, p.page AS passage_page, p.text AS passage_text, c.name AS concept_name
       FROM note_items ni
       JOIN passages p ON p.id = ni.passage_id
       LEFT JOIN concepts c ON c.id = ni.concept_id
       WHERE ni.note_id = ? ORDER BY ni.ord`,
      [note.id]
    );
    const grouped = {};
    for (const kind of NOTE_ORDER) grouped[kind] = [];
    for (const item of items) {
      (grouped[item.kind] ||= []).push({
        text: item.text,
        concept: item.concept_name,
        source: { page: item.passage_page, quote: item.passage_text },
      });
    }
    sections = grouped;
  }

  const concepts = db.all(
    `SELECT DISTINCT c.id, c.name FROM concepts c JOIN concept_passages cp ON cp.concept_id = c.id
     JOIN passages p ON p.id = cp.passage_id WHERE p.document_id = ? ORDER BY c.name`,
    [documentId]
  );

  const tocSections = db.all('SELECT id, title, page_start, page_end FROM sections WHERE document_id = ? ORDER BY ord', [documentId]);

  return {
    id: doc.id,
    subjectId: doc.subject_id,
    title: doc.title,
    status: doc.status,
    stage: doc.stage,
    error: doc.error,
    engine: doc.engine,
    pageCount: doc.page_count,
    createdAt: doc.created_at,
    processedAt: doc.processed_at,
    notes: note ? { engine: note.engine, dropped: note.dropped, repaired: note.repaired, sections, labels: NOTE_LABELS, order: NOTE_ORDER } : null,
    concepts,
    toc: tocSections,
  };
}

module.exports = { listSubjects, getOrCreateSubject, requireSubject, requireDocument, listDocuments, renameDocument, deleteDocument, getDocumentDetail, markOpened };
