const { HttpError } = require('../lib/http');
const { relatedConcepts } = require('./graph');

function getConceptDetail(db, userId, conceptId) {
  const concept = db.get('SELECT * FROM concepts WHERE id = ? AND user_id = ?', [conceptId, userId]);
  if (!concept) throw new HttpError(404, 'Concept not found.', 'not_found');

  const definition = concept.definition_passage_id
    ? db.get(
        `SELECT p.text, p.page, d.id AS document_id, d.title AS document_title
         FROM passages p JOIN documents d ON d.id = p.document_id WHERE p.id = ?`,
        [concept.definition_passage_id]
      )
    : null;

  const sources = db.all(
    `SELECT DISTINCT d.id AS document_id, d.title AS document_title, p.page, p.text, cp.relation
     FROM concept_passages cp JOIN passages p ON p.id = cp.passage_id JOIN documents d ON d.id = p.document_id
     WHERE cp.concept_id = ? ORDER BY d.title, p.page LIMIT 12`,
    [conceptId]
  );

  const related = relatedConcepts(db, conceptId);

  const performance = db.get(
    `SELECT COUNT(*) AS total, SUM(a.correct) AS correct
     FROM answers a JOIN questions q ON q.id = a.question_id JOIN attempts at ON at.id = a.attempt_id
     WHERE q.concept_id = ? AND at.user_id = ?`,
    [conceptId, userId]
  );

  return {
    id: concept.id,
    name: concept.name,
    subjectId: concept.subject_id,
    definition: definition ? { text: definition.text, page: definition.page, document: definition.document_title } : null,
    sources: sources.map((s) => ({ documentId: s.document_id, document: s.document_title, page: s.page, quote: s.text, relation: s.relation })),
    related: related.map((r) => ({ id: r.id, name: r.name, weight: r.weight })),
    performance: { total: performance.total || 0, correct: performance.correct || 0 },
  };
}

module.exports = { getConceptDetail };
