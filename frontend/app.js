(function () {
  'use strict';

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const STEP_INTERVAL_MS = 700;

  const $ = (id) => document.getElementById(id);
  const stages = { landing: $('landing'), processing: $('processing'), results: $('results') };

  const form = $('upload-form');
  const fileInput = $('file-input');
  const dropzone = $('dropzone');
  const fileNameEl = $('file-name');
  const submitBtn = $('submit-btn');
  const sampleBtn = $('sample-btn');
  const formError = $('form-error');
  const subjectSelect = $('subject-select');
  const pipelineSteps = document.querySelectorAll('#pipeline-steps li');

  let lastResult = null;
  let progressTimer = null;

  // ---------- helpers ----------
  function el(tag, { className, text, attrs } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    children.forEach((child) => node.appendChild(child));
    return node;
  }

  function showStage(name) {
    Object.entries(stages).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
    const heading = stages[name].querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: false });
    }
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  // ---------- file selection ----------
  fileInput.addEventListener('change', () => {
    fileNameEl.textContent = fileInput.files[0] ? fileInput.files[0].name : '';
    formError.hidden = true;
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  sampleBtn.addEventListener('click', async () => {
    sampleBtn.disabled = true;
    try {
      const response = await fetch('/sample-lecture.pdf');
      if (!response.ok) throw new Error('Sample lecture is unavailable.');
      const blob = await response.blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'sample-lecture.pdf', { type: 'application/pdf' }));
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change'));
      subjectSelect.value = 'stem';
      form.requestSubmit();
    } catch (err) {
      showError(err.message);
    } finally {
      sampleBtn.disabled = false;
    }
  });

  // ---------- submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    formError.hidden = true;

    const file = fileInput.files[0];
    if (!file) return showError('Please choose a PDF file first.');
    if (!isPdfFile(file)) return showError("That file doesn't look like a PDF. Please choose a .pdf file.");
    if (file.size > MAX_FILE_SIZE) return showError('That file is larger than 10MB. Please choose a smaller PDF.');

    submitBtn.disabled = true;
    showStage('processing');
    startProgress();

    try {
      const body = new FormData();
      body.append('file', file);
      body.append('subject', subjectSelect.value);

      const response = await fetch('/api/process', { method: 'POST', body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

      await finishProgress();
      lastResult = data;
      renderResults(data);
      showStage('results');
    } catch (err) {
      stopProgress();
      showStage('landing');
      showError(err.message || 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- processing steps ----------
  function stopProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  function startProgress() {
    stopProgress();
    pipelineSteps.forEach((step) => step.classList.remove('active', 'done'));
    let current = 0;
    pipelineSteps[0].classList.add('active');
    progressTimer = setInterval(() => {
      // Hold on the last step until the server actually responds.
      if (current >= pipelineSteps.length - 1) return;
      pipelineSteps[current].classList.replace('active', 'done');
      current += 1;
      pipelineSteps[current].classList.add('active');
    }, STEP_INTERVAL_MS);
  }

  function finishProgress() {
    stopProgress();
    pipelineSteps.forEach((step) => {
      step.classList.remove('active');
      step.classList.add('done');
    });
    return new Promise((resolve) => setTimeout(resolve, 350));
  }

  // ---------- results ----------
  function renderResults({ notes, quiz, meta }) {
    $('engine-note').textContent = meta.usedLlm
      ? `Generated by Claude and verified against your PDF · ${meta.subject}`
      : `Extracted directly from your PDF (offline mode) · ${meta.subject}`;

    const notices = $('notices');
    notices.replaceChildren(...(meta.notices || []).map((n) => el('li', { text: n })));
    notices.hidden = !meta.notices || meta.notices.length === 0;

    $('tldr-list').replaceChildren(...notes.tldr.map((s) => el('li', { text: s })));
    renderSections(notes.sections);
    $('glossary-list').replaceChildren(
      ...notes.glossary.map((g) =>
        el('li', {}, [el('strong', { text: g.term }), ...(g.definition ? [document.createTextNode(`: ${g.definition}`)] : [])])
      )
    );
    renderQuiz(quiz);
    activateTab('notes');
  }

  function sourceToggle(quoteText, idSuffix) {
    const quoteId = `source-${idSuffix}`;
    const quote = el('blockquote', { className: 'source-quote hidden', text: `“${quoteText}”`, attrs: { id: quoteId } });
    const toggle = el('button', {
      className: 'source-toggle',
      text: 'Show source',
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': quoteId },
    });
    toggle.addEventListener('click', () => {
      const nowHidden = quote.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!nowHidden));
      toggle.textContent = nowHidden ? 'Show source' : 'Hide source';
    });
    return [toggle, quote];
  }

  function renderSections(sections) {
    $('sections-container').replaceChildren(
      ...sections.map((section, sIndex) =>
        el('section', { className: 'card section-block', attrs: { 'aria-label': section.title } }, [
          el('h3', { text: section.title }),
          ...section.bullets.map((bullet, bIndex) =>
            el('div', { className: 'bullet-item' }, [
              el('p', { className: 'bullet-text', text: bullet.text }),
              ...(bullet.sourceQuote && bullet.sourceQuote !== bullet.text
                ? sourceToggle(bullet.sourceQuote, `n${sIndex}-${bIndex}`)
                : []),
            ])
          ),
        ])
      )
    );
  }

  function renderQuiz(quiz) {
    $('quiz-score').textContent = '';
    $('quiz-form').replaceChildren(
      ...quiz.map((q, qIndex) => {
        const fieldset = el('fieldset', { className: 'quiz-question' }, [
          el('legend', { text: `${qIndex + 1}. ${q.question}` }),
          ...q.choices.map((choice, cIndex) => {
            const inputId = `${q.id}-${cIndex}`;
            return el('div', { className: 'choice-row' }, [
              el('input', { attrs: { type: 'radio', name: q.id, value: String(cIndex), id: inputId } }),
              el('label', { text: choice, attrs: { for: inputId } }),
            ]);
          }),
          el('p', { className: 'question-feedback hidden', attrs: { role: 'status' } }),
        ]);
        fieldset.dataset.correctIndex = String(q.correctIndex);

        // Source quotes contain the answer, so reveal them only after checking.
        if (q.sourceQuote) {
          const reveal = el('div', { className: 'quiz-source hidden' }, sourceToggle(q.sourceQuote, `q${qIndex}`));
          fieldset.appendChild(reveal);
        }
        return fieldset;
      })
    );
  }

  $('quiz-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fieldsets = document.querySelectorAll('#quiz-form fieldset');
    let correct = 0;

    fieldsets.forEach((fieldset) => {
      const selected = fieldset.querySelector('input:checked');
      const feedback = fieldset.querySelector('.question-feedback');
      const correctIndex = fieldset.dataset.correctIndex;
      const correctLabel = fieldset.querySelector(`label[for$="-${correctIndex}"]`).textContent;

      fieldset.classList.remove('correct', 'incorrect');
      feedback.classList.remove('hidden', 'correct-text', 'incorrect-text');

      if (selected && selected.value === correctIndex) {
        correct += 1;
        fieldset.classList.add('correct');
        feedback.textContent = 'Correct!';
        feedback.classList.add('correct-text');
      } else {
        fieldset.classList.add('incorrect');
        feedback.textContent = selected
          ? `Not quite — the answer is “${correctLabel}”.`
          : `No answer selected — the answer is “${correctLabel}”.`;
        feedback.classList.add('incorrect-text');
      }

      const reveal = fieldset.querySelector('.quiz-source');
      if (reveal) reveal.classList.remove('hidden');
    });

    $('quiz-score').textContent = `Score: ${correct} / ${fieldsets.length}`;
  });

  // ---------- tabs (WAI-ARIA tabs pattern, arrow-key navigation) ----------
  const tabs = { notes: $('tab-notes'), quiz: $('tab-quiz') };
  const panels = { notes: $('panel-notes'), quiz: $('panel-quiz') };

  function activateTab(name, focus = false) {
    Object.keys(tabs).forEach((key) => {
      const active = key === name;
      tabs[key].classList.toggle('active', active);
      tabs[key].setAttribute('aria-selected', String(active));
      tabs[key].tabIndex = active ? 0 : -1;
      panels[key].hidden = !active;
    });
    if (focus) tabs[name].focus();
  }

  Object.entries(tabs).forEach(([name, tab]) => {
    tab.addEventListener('click', () => activateTab(name));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        activateTab(name === 'notes' ? 'quiz' : 'notes', true);
      }
    });
  });

  // ---------- exports ----------
  $('export-md').addEventListener('click', () => {
    if (lastResult) downloadFile('revision-notes.md', notesToMarkdown(lastResult.notes), 'text/markdown');
  });
  $('export-csv').addEventListener('click', () => {
    if (lastResult) downloadFile('quiz-flashcards.csv', quizToAnkiCsv(lastResult.quiz), 'text/csv');
  });

  function notesToMarkdown(notes) {
    const lines = ['# Revision Notes', ''];
    if (notes.tldr.length) lines.push('## TL;DR', ...notes.tldr.map((s) => `- ${s}`), '');
    notes.sections.forEach((s) => lines.push(`## ${s.title}`, ...s.bullets.map((b) => `- ${b.text}`), ''));
    if (notes.glossary.length) {
      lines.push('## Key Terms', ...notes.glossary.map((g) => `- **${g.term}**${g.definition ? `: ${g.definition}` : ''}`), '');
    }
    return lines.join('\n');
  }

  // Anki "Basic" import: Front,Back. Cells starting with = + - @ are prefixed
  // so spreadsheet apps don't execute them as formulas (CSV injection).
  function quizToAnkiCsv(quiz) {
    const cell = (v) => {
      const s = String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    return quiz.map((q) => `${cell(q.question)},${cell(q.choices[q.correctIndex])}`).join('\n');
  }

  function downloadFile(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = el('a', { attrs: { href: url, download: filename } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- start over ----------
  $('start-over').addEventListener('click', () => {
    form.reset();
    fileNameEl.textContent = '';
    formError.hidden = true;
    lastResult = null;
    showStage('landing');
  });
})();
