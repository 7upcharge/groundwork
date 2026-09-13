const { looksLikeInjection, fenceSafe } = require('../lib/injection');
const { locate, supports } = require('./source');


/**
 * RAG passage retrieval for tutor queries
 */
function retrieveContextPassages(db, { userId, subjectId, documentId, conceptId, query, limit = 5 }) {
  let passages = [];

  if (conceptId) {
    passages = db.all(
      `SELECT p.id, p.page, p.text, s.title AS section_title, d.id AS document_id, d.title AS document_title, cp.relation
       FROM concept_passages cp
       JOIN passages p ON p.id = cp.passage_id
       JOIN sections s ON s.id = p.section_id
       JOIN documents d ON d.id = p.document_id
       WHERE cp.concept_id = ? AND d.user_id = ? AND p.flagged = 0
       ORDER BY CASE WHEN cp.relation = 'defines' THEN 0 ELSE 1 END, p.page
       LIMIT ?`,
      [conceptId, userId, limit]
    );
  }

  if (passages.length < limit && documentId) {
    const existingIds = new Set(passages.map((p) => p.id));
    const docPassages = db.all(
      `SELECT p.id, p.page, p.text, s.title AS section_title, d.id AS document_id, d.title AS document_title
       FROM passages p
       JOIN sections s ON s.id = p.section_id
       JOIN documents d ON d.id = p.document_id
       WHERE d.id = ? AND d.user_id = ? AND p.flagged = 0
       ORDER BY p.ord
       LIMIT 20`,
      [documentId, userId]
    );

    if (query && query.trim()) {
      const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const scored = docPassages.map((p) => {
        let score = 0;
        const text = p.text.toLowerCase();
        for (const word of words) {
          if (text.includes(word)) score += 1;
        }
        return { ...p, score };
      });
      scored.sort((a, b) => b.score - a.score);
      for (const p of scored) {
        if (passages.length >= limit) break;
        if (!existingIds.has(p.id) && (words.length === 0 || p.score > 0)) {
          passages.push(p);
          existingIds.add(p.id);
        }
      }
    } else {
      for (const p of docPassages) {
        if (passages.length >= limit) break;
        if (!existingIds.has(p.id)) {
          passages.push(p);
          existingIds.add(p.id);
        }
      }
    }
  }

  if (passages.length < limit && subjectId) {
    const existingIds = new Set(passages.map((p) => p.id));
    const subjPassages = db.all(
      `SELECT p.id, p.page, p.text, s.title AS section_title, d.id AS document_id, d.title AS document_title
       FROM passages p
       JOIN sections s ON s.id = p.section_id
       JOIN documents d ON d.id = p.document_id
       WHERE d.subject_id = ? AND d.user_id = ? AND d.status = 'ready' AND p.flagged = 0
       LIMIT 30`,
      [subjectId, userId]
    );

    if (query && query.trim()) {
      const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const scored = subjPassages.map((p) => {
        let score = 0;
        const text = p.text.toLowerCase();
        for (const word of words) {
          if (text.includes(word)) score += 1;
        }
        return { ...p, score };
      });
      scored.sort((a, b) => b.score - a.score);
      for (const p of scored) {
        if (passages.length >= limit) break;
        if (!existingIds.has(p.id) && p.score > 0) {
          passages.push(p);
          existingIds.add(p.id);
        }
      }
    }
  }

  return passages;
}

/**
 * Offline grounded answer generator when LLM is unavailable or for instant response
 */
function buildOfflineAnswer(query, mode, passages, conceptName) {
  if (!passages || passages.length === 0) {
    return {
      answer: "Your course material does not contain enough information to answer this specific question.",
      grounded: false,
      sources: [],
      mode,
    };
  }

  const primary = passages[0];
  const citations = passages.map((p) => ({
    documentId: p.document_id,
    documentTitle: p.document_title,
    page: p.page,
    section: p.section_title,
    quote: p.text,
  }));

  let text = '';
  if (mode === 'explain_simple') {
    text = `In simple terms: ${conceptName || 'This topic'} revolves around the core idea described in your lecture slides: "${primary.text}".`;
  } else if (mode === 'exam_answer') {
    text = `For an exam answer on ${conceptName || 'this question'}:\n\n1. Definition: "${primary.text}"\n2. Key Details: ${passages.slice(1, 3).map((p) => `"${p.text}"`).join(' ')}`;
  } else if (mode === 'expand') {
    text = `Here is a step-by-step breakdown based directly on your course material:\n\n` +
      passages.map((p, i) => `Step ${i + 1} (${p.document_title}, Page ${p.page}): ${p.text}`).join('\n\n');
  } else {
    text = `Based on your lecture material from "${primary.document_title}" (Page ${primary.page}):\n\n${primary.text}`;
    if (passages.length > 1) {
      text += `\n\nAdditional context from page ${passages[1].page}: ${passages[1].text}`;
    }
  }

  return {
    answer: text,
    grounded: true,
    sources: citations,
    mode,
  };
}

/**
 * Groundwork Tutor core invocation
 */
async function askTutor(db, { userId, subjectId, documentId, conceptId, query, mode = 'explain', contextText = null }) {
  const start = Date.now();

  if (query && looksLikeInjection(query)) {
    return {
      answer: "I cannot fulfill requests that attempt to override system security boundaries.",
      grounded: false,
      sources: [],
      mode,
    };
  }

  let conceptName = null;
  if (conceptId) {
    const c = db.get('SELECT name FROM concepts WHERE id = ? AND user_id = ?', [conceptId, userId]);
    if (c) conceptName = c.name;
  }

  const passages = retrieveContextPassages(db, { userId, subjectId, documentId, conceptId, query, limit: 4 });

  const result = buildOfflineAnswer(query || conceptName || contextText, mode, passages, conceptName);

  try {
    db.run(
      `INSERT INTO agent_runs (user_id, document_id, task, agent, status, latency_ms, rounds, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        documentId || (passages[0] ? passages[0].document_id : null),
        'tutor_ask',
        'groundwork_tutor',
        'ok',
        Date.now() - start,
        1,
        JSON.stringify({ mode, query, grounded: result.grounded }),
      ]
    );
  } catch {
    /* ignore logging failure */
  }

  return result;
}

module.exports = { askTutor, retrieveContextPassages };

