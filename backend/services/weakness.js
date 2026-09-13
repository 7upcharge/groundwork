// Confidence is evidence-based, never from a single wrong answer (per product
// rule: don't flag a weakness on one mistake). It looks at overall accuracy
// on a concept AND whether recent attempts are still wrong, since a student
// who missed a concept once weeks ago and has since gotten it right isn't
// "weak" on it anymore.
function leadingStreak(rows, wantCorrect) {
  let streak = 0;
  for (const r of rows) {
    if (!!r.correct !== wantCorrect) break;
    streak += 1;
  }
  return streak;
}

function classify(rows) {
  const total = rows.length;
  if (total < 2) return null;

  // Two correct answers in a row, most recently, means the student has
  // since demonstrated they know it — don't keep flagging it on lifetime
  // average alone.
  if (leadingStreak(rows, true) >= 2) return null;

  const recentWrongStreak = leadingStreak(rows, false);
  const wrong = rows.filter((r) => !r.correct).length;
  const rate = wrong / total;

  if (recentWrongStreak >= 2 || (total >= 3 && rate >= 0.66)) return 'high';
  if (rate >= 0.5) return 'medium';
  return null;
}

function weakConcepts(db, { userId, subjectId, limit = 10 }) {
  const rows = db.all(
    `SELECT c.id, c.name, a.correct, at.submitted_at
     FROM answers a
     JOIN attempts at ON at.id = a.attempt_id
     JOIN questions q ON q.id = a.question_id
     JOIN concepts c ON c.id = q.concept_id
     WHERE at.user_id = ? AND c.subject_id = ?
     ORDER BY c.id, at.submitted_at DESC`,
    [userId, subjectId]
  );

  const byConcept = new Map();
  for (const row of rows) {
    if (!byConcept.has(row.id)) byConcept.set(row.id, { id: row.id, name: row.name, rows: [] });
    byConcept.get(row.id).rows.push(row);
  }

  const results = [];
  for (const { id, name, rows: conceptRows } of byConcept.values()) {
    const confidence = classify(conceptRows);
    if (!confidence) continue;
    const total = conceptRows.length;
    const wrong = conceptRows.filter((r) => !r.correct).length;
    results.push({
      conceptId: id,
      name,
      confidence,
      wrong,
      total,
      lastAttemptAt: conceptRows[0].submitted_at,
    });
  }

  const order = { high: 0, medium: 1 };
  return results.sort((a, b) => order[a.confidence] - order[b.confidence] || b.wrong / b.total - a.wrong / a.total).slice(0, limit);
}

function nextUp(db, userId) {
  const rows = db.all(
    `SELECT c.id AS concept_id, c.name, c.subject_id, s.name AS subject_name, a.correct, at.submitted_at
     FROM answers a
     JOIN attempts at ON at.id = a.attempt_id
     JOIN questions q ON q.id = a.question_id
     JOIN concepts c ON c.id = q.concept_id
     JOIN subjects s ON s.id = c.subject_id
     WHERE at.user_id = ?
     ORDER BY c.id, at.submitted_at DESC`,
    [userId]
  );
  const byConcept = new Map();
  for (const row of rows) {
    if (!byConcept.has(row.concept_id)) byConcept.set(row.concept_id, { ...row, rows: [] });
    byConcept.get(row.concept_id).rows.push(row);
  }
  let best = null;
  for (const entry of byConcept.values()) {
    const confidence = classify(entry.rows);
    if (!confidence) continue;
    const wrong = entry.rows.filter((r) => !r.correct).length;
    const rank = confidence === 'high' ? 0 : 1;
    if (!best || rank < best.rank || (rank === best.rank && wrong > best.wrong)) {
      best = { rank, conceptId: entry.concept_id, name: entry.name, subjectId: entry.subject_id, subjectName: entry.subject_name, confidence, wrong, total: entry.rows.length };
    }
  }
  return best;
}

module.exports = { weakConcepts, nextUp };
