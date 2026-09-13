const { termRegex } = require('../lib/text');

// Rebuilds the in-memory shape the quiz/notes agents expect (passages array +
// concepts with .pattern and .passageIds as indexes into that array) from
// persisted rows, so quiz generation can run without re-parsing the PDF.
function loadGraph(db, { documentIds = null, subjectId = null }) {
  const passageRows = documentIds
    ? db.all(
        `SELECT p.id, p.page, p.text, s.title AS section_title, p.document_id
         FROM passages p JOIN sections s ON s.id = p.section_id
         WHERE p.document_id IN (${documentIds.map(() => '?').join(',')}) AND p.flagged = 0
         ORDER BY p.document_id, s.ord, p.ord`,
        documentIds
      )
    : db.all(
        `SELECT p.id, p.page, p.text, s.title AS section_title, p.document_id
         FROM passages p JOIN sections s ON s.id = p.section_id JOIN documents d ON d.id = p.document_id
         WHERE d.subject_id = ? AND d.status = 'ready' AND p.flagged = 0
         ORDER BY p.document_id, s.ord, p.ord`,
        [subjectId]
      );

  const passages = passageRows.map((r) => ({ id: r.id, page: r.page, text: r.text, sectionTitle: r.section_title, documentId: r.document_id }));
  const indexById = new Map(passages.map((p, i) => [p.id, i]));

  const conceptRows = documentIds
    ? db.all(
        `SELECT DISTINCT c.* FROM concepts c JOIN concept_passages cp ON cp.concept_id = c.id
         WHERE cp.passage_id IN (${passages.map(() => '?').join(',')})`,
        passages.map((p) => p.id)
      )
    : db.all('SELECT * FROM concepts WHERE subject_id = ?', [subjectId]);

  const concepts = conceptRows.map((row) => {
    const links = db.all('SELECT passage_id, relation FROM concept_passages WHERE concept_id = ?', [row.id]);
    const passageIds = new Set();
    let definitionIndex = null;
    for (const link of links) {
      const idx = indexById.get(link.passage_id);
      if (idx === undefined) continue;
      passageIds.add(idx);
      if (link.relation === 'defines') definitionIndex = idx;
    }
    return { id: row.id, name: row.name, normalized: row.normalized, pattern: termRegex(row.name), passageIds, definitionIndex };
  });

  return { passages, concepts: concepts.filter((c) => c.passageIds.size > 0) };
}

function relatedConcepts(db, conceptId, limit = 8) {
  return db.all(
    `SELECT c.id, c.name, e.weight FROM concept_edges e
     JOIN concepts c ON c.id = (CASE WHEN e.src_id = ? THEN e.dst_id ELSE e.src_id END)
     WHERE e.src_id = ? OR e.dst_id = ?
     ORDER BY e.weight DESC LIMIT ?`,
    [conceptId, conceptId, conceptId, limit]
  );
}

module.exports = { loadGraph, relatedConcepts };
