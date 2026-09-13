const { getDocumentDetail } = require('./library');
const { weakConcepts } = require('./weakness');

/** Assembles the exportable study pack: notes + weak areas for one document's subject. */
function buildStudyPack(db, userId, documentId) {
  const detail = getDocumentDetail(db, userId, documentId);
  const doc = db.get('SELECT subject_id FROM documents WHERE id = ?', [documentId]);
  const weak = doc ? weakConcepts(db, { userId, subjectId: doc.subject_id, limit: 5 }) : [];
  return { detail, weak };
}

function studyPackToMarkdown({ detail, weak }) {
  const lines = [`# ${detail.title}`, ''];
  if (!detail.notes) {
    lines.push('_Notes are still processing._');
    return lines.join('\n');
  }
  for (const kind of detail.notes.order) {
    const items = detail.notes.sections[kind];
    if (!items || items.length === 0) continue;
    lines.push(`## ${detail.notes.labels[kind]}`, '');
    for (const item of items) {
      lines.push(`- ${item.text}  _(p. ${item.source.page})_`);
    }
    lines.push('');
  }
  if (weak.length) {
    lines.push('## Weak Areas', '');
    for (const w of weak) lines.push(`- **${w.name}** — ${w.confidence} priority (${w.wrong}/${w.total} recent misses)`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { buildStudyPack, studyPackToMarkdown };
