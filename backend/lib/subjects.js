// Light personalisation: tweaks note/quiz density by subject without
// needing any external data or per-subject training.
const SUBJECT_PRESETS = {
  general: { label: 'General', glossarySize: 10, quizCount: 5 },
  stem: { label: 'STEM / Technical', glossarySize: 14, quizCount: 6 },
  humanities: { label: 'Humanities / History', glossarySize: 8, quizCount: 4 },
  language: { label: 'Language / Literature', glossarySize: 8, quizCount: 4 },
};

function resolveSubject(subjectKey) {
  return SUBJECT_PRESETS[subjectKey] || SUBJECT_PRESETS.general;
}

module.exports = { SUBJECT_PRESETS, resolveSubject };
