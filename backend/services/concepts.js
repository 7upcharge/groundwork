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
    performance: { total: (performance && performance.total) || 0, correct: (performance && performance.correct) || 0 },
  };
}


function getSubjectMindMap(db, userId, subjectId) {
  const { weakConcepts } = require('./weakness');

  const subject = db.get('SELECT * FROM subjects WHERE id = ? AND user_id = ?', [subjectId, userId]);
  if (!subject) throw new HttpError(404, 'Subject not found.', 'not_found');

  const concepts = db.all(
    `SELECT c.id, c.name, c.normalized, c.definition_passage_id, p.text AS def_text, p.page AS def_page, d.id AS doc_id, d.title AS doc_title
     FROM concepts c
     LEFT JOIN passages p ON p.id = c.definition_passage_id
     LEFT JOIN documents d ON d.id = p.document_id
     WHERE c.subject_id = ? AND c.user_id = ?
     ORDER BY c.name`,
    [subjectId, userId]
  );

  const conceptIds = concepts.map((c) => c.id);
  if (conceptIds.length === 0) {
    return { subjectId, subjectName: subject.name, nodes: [], edges: [] };
  }

  const weakList = weakConcepts(db, { userId, subjectId, limit: 100 });
  const weakMap = new Map(weakList.map((w) => [w.conceptId, w]));

  const nodes = concepts.map((c) => {
    const perf = db.get(
      `SELECT COUNT(*) AS total, SUM(a.correct) AS correct
       FROM answers a JOIN questions q ON q.id = a.question_id JOIN attempts at ON at.id = a.attempt_id
       WHERE q.concept_id = ? AND at.user_id = ?`,
      [c.id, userId]
    );

    const total = perf ? perf.total || 0 : 0;
    const correct = perf ? perf.correct || 0 : 0;
    const weak = weakMap.get(c.id) || null;

    let mastery = 'untested';
    if (weak) {
      mastery = 'weak';
    } else if (total >= 2 && correct / total >= 0.8) {
      mastery = 'mastered';
    } else if (total > 0) {
      mastery = 'developing';
    }

    return {
      id: c.id,
      name: c.name,
      definition: c.def_text ? { text: c.def_text, page: c.def_page, documentId: c.doc_id, documentTitle: c.doc_title } : null,
      performance: { total, correct },
      mastery,
      weakness: weak ? { confidence: weak.confidence, wrong: weak.wrong, total: weak.total } : null,
    };
  });

  const placeholders = conceptIds.map(() => '?').join(',');
  const edges = db.all(
    `SELECT src_id AS srcId, dst_id AS dstId, relation, weight
     FROM concept_edges
     WHERE src_id IN (${placeholders}) AND dst_id IN (${placeholders})`,
    [...conceptIds, ...conceptIds]
  );

  return {
    subjectId,
    subjectName: subject.name,
    nodes,
    edges,
  };
}

module.exports = { getConceptDetail, getSubjectMindMap };

