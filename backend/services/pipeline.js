const { readDocument } = require('../agents/document');
const { buildConceptGraph } = require('../agents/knowledge');
const { offlineNotes, llmNotesForSection } = require('../agents/notes');
const { createSourceIndex } = require('../agents/source');
const { mapLimit } = require('../agents/loop');

const CHUNK_CHARS = 5000;
const MAX_LLM_CONCURRENCY = 3;

function setStage(db, documentId, stage) {
  db.run('UPDATE documents SET stage = ? WHERE id = ?', [stage, documentId]);
}

function persistSectionsAndPassages(db, documentId, sections) {
  const sectionIds = [];
  const passages = []; // flat, in document order, carrying real db ids
  sections.forEach((section, ord) => {
    const { lastInsertRowid: sectionId } = db.run(
      'INSERT INTO sections (document_id, ord, title, page_start, page_end) VALUES (?, ?, ?, ?, ?)',
      [documentId, ord, section.title, section.pageStart, section.pageEnd]
    );
    sectionIds.push(sectionId);
    section.passages.forEach((p, pOrd) => {
      const { lastInsertRowid: passageId } = db.run(
        'INSERT INTO passages (document_id, section_id, ord, page, text, flagged) VALUES (?, ?, ?, ?, ?, ?)',
        [documentId, sectionId, pOrd, p.page, p.text, p.flagged ? 1 : 0]
      );
      passages.push({ id: passageId, sectionId, page: p.page, text: p.text, sectionTitle: section.title });
    });
  });
  return passages;
}

function persistConcepts(db, { userId, subjectId, concepts, edges, passages }) {
  const idByNormalized = new Map();
  for (const concept of concepts) {
    const existing = db.get('SELECT id FROM concepts WHERE subject_id = ? AND normalized = ?', [subjectId, concept.normalized]);
    let conceptId = existing?.id;
    if (!conceptId) {
      const defPassageId = concept.definitionIndex !== null ? passages[concept.definitionIndex]?.id : null;
      const { lastInsertRowid } = db.run(
        'INSERT INTO concepts (user_id, subject_id, name, normalized, definition_passage_id) VALUES (?, ?, ?, ?, ?)',
        [userId, subjectId, concept.name, concept.normalized, defPassageId || null]
      );
      conceptId = lastInsertRowid;
    }
    idByNormalized.set(concept.normalized, conceptId);

    for (const index of concept.passageIds) {
      const passageId = passages[index]?.id;
      if (!passageId) continue;
      const relation = index === concept.definitionIndex ? 'defines' : 'mentions';
      db.run('INSERT OR IGNORE INTO concept_passages (concept_id, passage_id, relation) VALUES (?, ?, ?)', [conceptId, passageId, relation]);
    }
  }

  for (const edge of edges) {
    const srcId = idByNormalized.get(edge.a);
    const dstId = idByNormalized.get(edge.b);
    if (!srcId || !dstId) continue;
    const existing = db.get('SELECT weight FROM concept_edges WHERE src_id = ? AND dst_id = ? AND relation = ?', [srcId, dstId, 'related']);
    if (existing) db.run('UPDATE concept_edges SET weight = weight + ? WHERE src_id = ? AND dst_id = ? AND relation = ?', [edge.weight, srcId, dstId, 'related']);
    else db.run('INSERT INTO concept_edges (src_id, dst_id, relation, weight) VALUES (?, ?, ?, ?)', [srcId, dstId, 'related', edge.weight]);
  }

  return idByNormalized;
}

function chunkPassageSections(passages) {
  const bySection = new Map();
  for (const p of passages) {
    if (!bySection.has(p.sectionId)) bySection.set(p.sectionId, { title: p.sectionTitle, passages: [] });
    bySection.get(p.sectionId).passages.push(p);
  }
  const chunks = [];
  for (const section of bySection.values()) {
    let current = { title: section.title, passages: [] };
    let chars = 0;
    for (const p of section.passages) {
      if (chars > 0 && chars + p.text.length > CHUNK_CHARS) {
        chunks.push(current);
        current = { title: section.title, passages: [] };
        chars = 0;
      }
      current.passages.push(p);
      chars += p.text.length;
    }
    if (current.passages.length) chunks.push(current);
  }
  return chunks;
}

async function generateNotes({ db, llm, recorder, context, passages, concepts, sourceIndex, documentId }) {
  if (llm) {
    const chunks = chunkPassageSections(passages);
    const results = await recorder(context, 'notes', async () => {
      const perChunk = await mapLimit(chunks, MAX_LLM_CONCURRENCY, (chunk) => llmNotesForSection(llm, chunk, sourceIndex));
      const items = perChunk.flatMap((r) => r.items);
      const rounds = Math.max(1, ...perChunk.map((r) => r.rounds));
      const dropped = perChunk.reduce((n, r) => n + r.dropped.length, 0);
      const repaired = perChunk.reduce((n, r) => n + r.repaired, 0);
      if (items.length === 0) throw new Error('LLM produced no source-grounded notes');
      return { result: { items, dropped, repaired, engine: llm.model }, status: dropped > 0 ? 'repaired' : 'ok', rounds, detail: { dropped, repaired } };
    }).catch(() => null);
    if (results) return results;
  }

  const items = offlineNotes({ passages, concepts }).map((it) => ({
    kind: it.kind,
    text: it.text,
    passageId: passages[it.passageIndex]?.id,
    concept: it.conceptNormalized,
  }));
  return { items, dropped: 0, repaired: 0, engine: 'offline' };
}

function saveNotes(db, documentId, { items, dropped, repaired, engine }, conceptIdByNormalized) {
  const { lastInsertRowid: noteId } = db.run('INSERT INTO notes (document_id, engine, dropped, repaired) VALUES (?, ?, ?, ?)', [
    documentId,
    engine,
    dropped,
    repaired,
  ]);
  items.forEach((item, ord) => {
    db.run(
      'INSERT INTO note_items (note_id, ord, kind, section_id, concept_id, passage_id, text) VALUES (?, ?, ?, NULL, ?, ?, ?)',
      [noteId, ord, item.kind, item.concept ? conceptIdByNormalized.get(item.concept) || null : null, item.passageId, item.text]
    );
  });
  return noteId;
}

/**
 * Full document pipeline: extract -> structure -> concept graph -> notes.
 * Runs synchronously within the request (offline extraction is fast; an LLM
 * call, when configured, is the only real latency) and records progress via
 * `document.stage`, which the status endpoint reports honestly.
 */
async function processDocument(db, llm, recorder, { documentId, userId, subjectId, buffer, maxPages }) {
  const context = { task: 'ingest', userId, documentId };
  db.run("UPDATE documents SET status = 'processing' WHERE id = ?", [documentId]);

  try {
    setStage(db, documentId, 'extracting');
    const { sections, pageCount, pagesRead, truncated, flagged } = await recorder(context, 'document', async () => ({
      result: await readDocument(buffer, { maxPages }),
    }));

    setStage(db, documentId, 'structuring');
    const passages = db.transaction(() => persistSectionsAndPassages(db, documentId, sections));

    setStage(db, documentId, 'mapping concepts');
    const graph = await recorder(context, 'knowledge', async () => ({ result: buildConceptGraph({ sections }) }));
    const conceptIdByNormalized = db.transaction(() =>
      persistConcepts(db, { userId, subjectId, concepts: graph.concepts, edges: graph.edges, passages })
    );

    setStage(db, documentId, 'writing notes');
    const sourceIndex = createSourceIndex(passages);
    const notesResult = await generateNotes({ db, llm, recorder, context, passages, concepts: graph.concepts, sourceIndex, documentId });
    db.transaction(() => saveNotes(db, documentId, notesResult, conceptIdByNormalized));

    db.run(
      `UPDATE documents SET status = 'ready', stage = NULL, page_count = ?, pages_read = ?, engine = ?, processed_at = datetime('now') WHERE id = ?`,
      [pageCount, pagesRead, notesResult.engine, documentId]
    );
    return { truncated, flagged, engine: notesResult.engine };
  } catch (err) {
    db.run("UPDATE documents SET status = 'failed', stage = NULL, error = ? WHERE id = ?", [err.message.slice(0, 500), documentId]);
    throw err;
  }
}

module.exports = { processDocument };
