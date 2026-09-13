(function () {
  'use strict';

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, val] of Object.entries(attrs)) {
        if (val === undefined || val === null || val === false) continue;
        if (k === 'text') el.textContent = val;
        else if (k.startsWith('on') && typeof val === 'function') el.addEventListener(k.slice(2).toLowerCase(), val);
        else if (k === 'class') el.className = val;
        else el.setAttribute(k, val === true ? '' : val);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === undefined || child === null || child === false) continue;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
  const mount = (el, children) => {
    clear(el);
    for (const c of [].concat(children || [])) {
      if (c === undefined || c === null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  };
  const fmtDate = (iso) => (iso ? new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

  // ------------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (method !== 'GET') opts.headers['X-Groundwork'] = '1';
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.code);
    return data;
  }
  async function uploadDocument(subjectId, file, title) {
    const form = new FormData();
    form.append('subjectId', subjectId);
    form.append('file', file);
    if (title) form.append('title', title);
    const res = await fetch('/api/documents', { method: 'POST', headers: { 'X-Groundwork': '1' }, credentials: 'same-origin', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || 'Upload failed', res.status, data.code);
    return data;
  }

  // ---------------------------------------------------------------- state
  const state = { user: null };
  const main = document.getElementById('main');
  const topnav = document.getElementById('topnav');
  const navEl = document.getElementById('primary-nav');
  const userBox = document.getElementById('user-box');

  function setActiveNav() {
    const hash = location.hash || '#/';
    navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
  }

  function renderChrome() {
    if (!state.user) { topnav.hidden = true; return; }
    topnav.hidden = false;
    mount(navEl, [
      h('a', { href: '#/', text: 'Dashboard' }),
      h('a', { href: '#/materials', text: 'Materials' }),
    ]);
    setActiveNav();
    mount(userBox, [
      h('span', { text: state.user.isGuest ? 'Guest' : state.user.name }),
      state.user.isGuest ? h('a', { href: '#/register', class: 'btn small secondary', text: 'Save account' }) : null,
      h('button', { class: 'btn small secondary', onClick: onLogout, text: 'Sign out' }),
    ]);
  }

  async function onLogout() {
    await api('POST', '/api/auth/logout');
    state.user = null;
    location.hash = '#/';
    renderChrome();
    route();
  }

  function focusMain() {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: false });
  }

  // -------------------------------------------------------------- routing
  const routes = [
    { pattern: /^#\/$/, view: viewDashboard },
    { pattern: /^#\/login$/, view: viewLogin },
    { pattern: /^#\/register$/, view: viewRegister },
    { pattern: /^#\/materials$/, view: viewMaterials },
    { pattern: /^#\/subjects\/(\d+)$/, view: viewSubject },
    { pattern: /^#\/documents\/(\d+)$/, view: viewDocument },
    { pattern: /^#\/quizzes\/(\d+)$/, view: viewQuiz },
    { pattern: /^#\/concepts\/(\d+)$/, view: viewConcept },
  ];

  async function route() {
    const hash = location.hash || '#/';
    if (!state.user) {
      try { const r = await api('GET', '/api/auth/me'); state.user = r.user; } catch { /* ignore */ }
    }
    renderChrome();

    if (!state.user && hash !== '#/login' && hash !== '#/register') return renderLanding();

    for (const r of routes) {
      const m = hash.match(r.pattern);
      if (m) {
        mount(main, h('div', { class: 'stage-line' }, [h('span', { class: 'spinner' }), 'Loading…']));
        try {
          await r.view(...m.slice(1));
        } catch (err) {
          renderError(err);
        }
        focusMain();
        return;
      }
    }
    mount(main, emptyState('Page not found', "That page doesn't exist.", h('a', { href: '#/', class: 'btn', text: 'Go home' })));
  }
  window.addEventListener('hashchange', route);

  function renderError(err) {
    mount(main, [
      h('div', { class: 'banner error', role: 'alert' }, err.message || 'Something went wrong.'),
      h('a', { href: '#/', class: 'btn secondary', text: 'Back to dashboard' }),
    ]);
  }

  function emptyState(title, body, action) {
    return h('div', { class: 'empty-state' }, [h('h3', { text: title }), h('p', { text: body }), action]);
  }

  // --------------------------------------------------------------- landing
  function renderLanding() {
    topnav.hidden = true;
    const errorEl = h('p', { class: 'error-text hidden' });
    mount(main, [
      h('section', { class: 'hero' }, [
        h('h1', { text: 'Your lecture, organized.' }),
        h('p', { text: 'Upload a lecture PDF. Groundwork turns it into revision notes and a practice quiz, with every claim traceable back to the exact page it came from.' }),
      ]),
      h('div', { class: 'card max-w-sm' }, [
        h('button', { class: 'btn full-btn', onClick: startGuest, text: 'Continue as guest' }),
        h('p', { class: 'auth-switch' }, [h('a', { href: '#/login', text: 'Sign in' }), ' or ', h('a', { href: '#/register', text: 'create an account' })]),
        errorEl,
      ]),
    ]);
    async function startGuest() {
      try {
        const r = await api('POST', '/api/auth/guest');
        state.user = r.user;
        location.hash = '#/';
        renderChrome();
        route();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    }
  }

  // ------------------------------------------------------------ auth views
  function authForm({ title, fields, submitLabel, onSubmit, switchTo }) {
    const errorEl = h('p', { class: 'error-text hidden' });
    const inputs = {};
    const form = h(
      'form',
      { class: 'card auth-card', onSubmit: handleSubmit },
      [
        h('h2', { text: title, class: 'mb-4' }),
        ...fields.map((f) => {
          const input = h('input', { type: f.type, name: f.name, required: true, autocomplete: f.autocomplete });
          inputs[f.name] = input;
          return h('div', { class: 'field' }, [h('label', { text: f.label, for: f.name }), Object.assign(input, { id: f.name })]);
        }),
        h('button', { class: 'btn full-btn', type: 'submit', text: submitLabel }),
        errorEl,
        switchTo,
      ]
    );
    async function handleSubmit(e) {
      e.preventDefault();
      errorEl.classList.add('hidden');
      const values = {};
      for (const [k, el] of Object.entries(inputs)) values[k] = el.value;
      try {
        await onSubmit(values);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    }
    return form;
  }

  async function viewLogin() {
    mount(
      main,
      authForm({
        title: 'Sign in',
        fields: [
          { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
          { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
        ],
        submitLabel: 'Sign in',
        switchTo: h('p', { class: 'auth-switch' }, [h('a', { href: '#/register', text: 'Create an account instead' })]),
        onSubmit: async (v) => {
          const r = await api('POST', '/api/auth/login', v);
          state.user = r.user;
          location.hash = '#/';
          renderChrome();
          route();
        },
      })
    );
  }

  async function viewRegister() {
    const claimingGuest = state.user && state.user.isGuest;
    mount(
      main,
      authForm({
        title: claimingGuest ? 'Save your account' : 'Create an account',
        fields: [
          { name: 'name', label: 'Name', type: 'text', autocomplete: 'name' },
          { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
          { name: 'password', label: 'Password (8+ characters)', type: 'password', autocomplete: 'new-password' },
        ],
        submitLabel: claimingGuest ? 'Save my materials' : 'Create account',
        switchTo: h('p', { class: 'auth-switch' }, [h('a', { href: '#/login', text: 'Sign in instead' })]),
        onSubmit: async (v) => {
          const r = await api('POST', '/api/auth/register', v);
          state.user = r.user;
          location.hash = '#/';
          renderChrome();
          route();
        },
      })
    );
  }

  // -------------------------------------------------------------- dashboard
  async function viewDashboard() {
    const data = await api('GET', '/api/dashboard');
    const blocks = [h('h1', { text: `Welcome back${state.user.isGuest ? '' : ', ' + state.user.name}`, class: 'mb-5' })];

    if (data.nextUp) {
      blocks.push(
        h('div', { class: 'card next-up mb-6' }, [
          h('div', {}, [
            h('div', { class: 'label', text: 'Next up' }),
            h('h2', {}, h('a', { href: `#/concepts/${data.nextUp.conceptId}`, class: 'no-underline', text: data.nextUp.name })),
            h('p', { class: 'reason', text: `${data.nextUp.subjectName} — you missed ${data.nextUp.wrong} of your last ${data.nextUp.total} questions on this.` }),
          ]),
          h('a', { href: `#/concepts/${data.nextUp.conceptId}`, class: 'btn', text: 'Review topic' }),
        ])
      );
    }

    blocks.push(h('h2', { text: 'Subjects', class: 'section-title mb-3' }));
    if (data.subjects.length === 0) {
      blocks.push(emptyState('No materials yet', 'Add a subject and upload your first lecture PDF.', h('a', { href: '#/materials', class: 'btn', text: 'Add material' })));
    } else {
      blocks.push(subjectGrid(data.subjects));
      blocks.push(h('a', { href: '#/materials', class: 'btn ghost', text: '+ Add more material' }));
    }
    mount(main, blocks);
  }

  function subjectGrid(subjects) {
    return h(
      'div',
      { class: 'subject-grid' },
      subjects.map((s) =>
        h('a', { href: `#/subjects/${s.id}`, class: 'subject-tile' }, [
          h('h3', { text: s.name }),
          h('div', { class: 'meta', text: `${s.ready_count || 0} of ${s.document_count} ready` }),
        ])
      )
    );
  }

  // -------------------------------------------------------------- materials
  async function viewMaterials() {
    const { subjects } = await api('GET', '/api/subjects');
    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Computer Networks', required: true });
    const errorEl = h('p', { class: 'error-text hidden' });
    const form = h('form', { class: 'card mb-6', onSubmit: handleCreate }, [
      h('h2', { text: 'Add a subject', class: 'section-title mb-3' }),
      h('div', { class: 'row-gap' }, [nameInput, h('button', { class: 'btn', type: 'submit', text: 'Add' })]),
      errorEl,
    ]);

    mount(main, [h('h1', { text: 'Materials', class: 'mb-5' }), form, subjects.length ? subjectGrid(subjects) : emptyState('No subjects yet', 'Add your first subject above.')]);

    async function handleCreate(e) {
      e.preventDefault();
      if (!nameInput.value.trim()) return;
      try {
        const r = await api('POST', '/api/subjects', { name: nameInput.value.trim() });
        location.hash = `#/subjects/${r.subject.id}`;
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    }
  }

  // -------------------------------------------------------------- subject
  async function viewSubject(idStr) {
    const id = Number(idStr);
    const [{ subjects }, { documents }] = await Promise.all([api('GET', '/api/subjects'), api('GET', `/api/subjects/${id}/documents`)]);
    const subject = subjects.find((s) => s.id === id);
    if (!subject) throw new ApiError('Subject not found.', 404);

    const errorEl = h('p', { class: 'error-text hidden' });
    const statusEl = h('div', { class: 'stage-line hidden' });
    const fileInput = h('input', { type: 'file', accept: 'application/pdf' });
    const dropzone = h('label', { class: 'dropzone' }, [
      fileInput,
      h('strong', { text: 'Drop a lecture PDF here' }),
      h('span', { text: 'or click to browse — max 10MB' }),
    ]);
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleUpload(fileInput.files[0]); });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
    });
    ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
    ['dragleave'].forEach((evt) => dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover')));

    const docList = h('div', { class: 'card divider-list' }, documents.length ? documents.map(docRow) : []);

    mount(main, [
      h('h1', { text: subject.name, class: 'mb-5' }),
      h('div', { class: 'card mb-6' }, [dropzone, statusEl, errorEl]),
      documents.length ? h('h2', { text: 'Lectures', class: 'section-title mb-3' }) : null,
      documents.length ? docList : emptyState('No lectures uploaded yet', 'Drop a PDF above to get started.'),
    ]);

    async function handleUpload(file) {
      errorEl.classList.add('hidden');
      statusEl.classList.remove('hidden');
      mount(statusEl, [h('span', { class: 'spinner' }), `Reading ${file.name}…`]);
      try {
        const r = await uploadDocument(id, file);
        location.hash = `#/documents/${r.document.id}`;
      } catch (err) {
        statusEl.classList.add('hidden');
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    }

    function docRow(doc) {
      return h('div', { class: 'doc-row' }, [
        h('div', { class: 'title' }, [
          h('a', { href: `#/documents/${doc.id}`, text: doc.title }),
          h('div', { class: 'meta', text: doc.processed_at ? `Processed ${fmtDate(doc.processed_at)}` : 'Not processed' }),
        ]),
        h('span', { class: `pill ${doc.status}`, text: doc.status }),
      ]);
    }
  }

  // ------------------------------------------------------------- document
  async function viewDocument(idStr) {
    const id = Number(idStr);
    const doc = await api('GET', `/api/documents/${id}`);

    if (doc.status === 'failed') {
      mount(main, [
        h('h1', { text: doc.title, class: 'mb-3' }),
        h('div', { class: 'banner error' }, `Processing failed: ${doc.error || 'unknown error'}`),
      ]);
      return;
    }

    const notesPanel = h('div', { id: 'panel-notes' });
    const quizPanel = h('div', { id: 'panel-quiz', hidden: true });
    const tabNotes = h('button', { class: 'tab active', type: 'button', text: 'Notes', onClick: () => selectTab('notes') });
    const tabQuiz = h('button', { class: 'tab', type: 'button', text: 'Quiz', onClick: () => selectTab('quiz') });

    function selectTab(name) {
      tabNotes.classList.toggle('active', name === 'notes');
      tabQuiz.classList.toggle('active', name === 'quiz');
      notesPanel.hidden = name !== 'notes';
      quizPanel.hidden = name !== 'quiz';
    }

    renderNotes(notesPanel, doc);
    renderQuizStarter(quizPanel, doc);

    mount(main, [
      h('div', { class: 'doc-header' }, [
        h('h1', { text: doc.title }),
        h('a', { href: `/api/export/documents/${doc.id}/study-pack.md`, class: 'btn secondary small', text: 'Export study pack' }),
      ]),
      h('div', { class: 'engine-note', text: doc.engine === 'offline' ? `Extracted directly from the PDF (offline engine) · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` : `Generated with ${doc.engine}, verified against the PDF · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` }),
      h('div', { class: 'tabs' }, [tabNotes, tabQuiz]),
      notesPanel,
      quizPanel,
    ]);
  }

  function sourceReveal(source, key) {
    const quoteId = `src-${key}`;
    const quote = h('blockquote', { class: 'source-quote hidden', id: quoteId }, [
      h('span', { class: 'loc', text: `${source.document ? source.document + ' — ' : ''}page ${source.page}` }),
      `"${source.quote}"`,
    ]);
    const toggle = h('button', { type: 'button', class: 'source-toggle', 'aria-expanded': 'false', 'aria-controls': quoteId, text: 'Show source' });
    toggle.addEventListener('click', () => {
      const nowHidden = quote.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!nowHidden));
      toggle.textContent = nowHidden ? 'Show source' : 'Hide source';
    });
    return h('div', {}, [toggle, quote]);
  }

  function renderNotes(panel, doc) {
    if (!doc.notes) {
      mount(panel, emptyState('Notes are still processing', 'Refresh in a moment.'));
      return;
    }
    const blocks = [];
    doc.notes.order.forEach((kind) => {
      const items = doc.notes.sections[kind];
      if (!items || items.length === 0) return;
      blocks.push(
        h('section', { class: 'note-section' }, [
          h('h2', { text: doc.notes.labels[kind] }),
          ...items.map((item, i) =>
            h('div', { class: 'note-item' }, [
              h('p', { class: 'text', text: item.text }),
              sourceReveal(item.source, `${kind}-${i}`),
            ])
          ),
        ])
      );
    });
    if (doc.concepts.length) {
      blocks.push(
        h('section', { class: 'note-section' }, [
          h('h2', { text: 'Concepts in this lecture' }),
          h('div', { class: 'concept-chip-row' }, doc.concepts.map((c) => h('a', { href: `#/concepts/${c.id}`, class: 'concept-chip', text: c.name }))),
        ])
      );
    }
    mount(panel, blocks);
  }

  function renderQuizStarter(panel, doc) {
    const difficulty = h('select', {}, [
      h('option', { value: 'mixed', text: 'Mixed difficulty' }),
      h('option', { value: 'easy', text: 'Easy' }),
      h('option', { value: 'medium', text: 'Medium' }),
      h('option', { value: 'hard', text: 'Hard' }),
    ]);
    const count = h('select', {}, [h('option', { value: '5', text: '5 questions' }), h('option', { value: '10', text: '10 questions' }), h('option', { value: '20', text: '20 questions' })]);
    const errorEl = h('p', { class: 'error-text hidden' });
    const btn = h('button', { class: 'btn', text: 'Generate practice quiz', onClick: generate });

    mount(panel, [
      h('div', { class: 'quiz-toolbar' }, [difficulty, count, btn]),
      errorEl,
      h('p', { class: 'text-muted' }, 'Each question is checked against this lecture before you see it — nothing appears unless the material actually supports it.'),
    ]);

    async function generate() {
      btn.disabled = true;
      errorEl.classList.add('hidden');
      try {
        const quiz = await api('POST', '/api/quizzes', {
          subjectId: doc.subjectId,
          documentId: doc.id,
          difficulty: difficulty.value,
          count: Number(count.value),
        });
        location.hash = `#/quizzes/${quiz.id}`;
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    }
  }

  // ---------------------------------------------------------------- quiz
  async function viewQuiz(idStr) {
    const id = Number(idStr);
    const quiz = await api('GET', `/api/quizzes/${id}`);
    const scoreEl = h('p', { class: 'quiz-score' });
    const submitBtn = h('button', { class: 'btn', type: 'submit', text: 'Check my answers' });
    const fieldsets = quiz.questions.map((q, i) => renderQuestion(q, i));

    const form = h('form', { onSubmit: handleSubmit }, [
      ...fieldsets.map((f) => f.el),
      h('div', { class: 'quiz-actions' }, [submitBtn, scoreEl]),
    ]);

    mount(main, [
      h('h1', { text: `Practice quiz`, class: 'mb-1' }),
      h('p', { class: 'engine-note', text: `${quiz.questions.length} question${quiz.questions.length === 1 ? '' : 's'} · ${quiz.engine === 'offline' ? 'offline engine' : quiz.engine}` }),
      form,
    ]);

    async function handleSubmit(e) {
      e.preventDefault();
      const responses = {};
      fieldsets.forEach((f) => { responses[f.question.id] = f.getSelected(); });
      submitBtn.disabled = true;
      try {
        const result = await api('POST', `/api/quizzes/${id}/attempts`, { responses });
        scoreEl.textContent = `Score: ${result.score} / ${result.total}`;
        const byId = new Map(result.quiz.questions.map((q) => [q.id, q]));
        const gradedById = new Map(result.graded.map((g) => [g.questionId, g.correct]));
        fieldsets.forEach((f) => f.applyResult(byId.get(f.question.id), gradedById.get(f.question.id)));
      } finally {
        submitBtn.disabled = false;
      }
    }
  }

  function renderQuestion(q, index) {
    const inputs = [];
    const feedback = h('p', { class: 'q-feedback hidden', role: 'status' });
    let revealBox = null;
    const legend = h('legend', { text: `${index + 1}. ${q.prompt}` });
    const el = h('fieldset', { class: 'quiz-q' }, [
      legend,
      h('div', { class: 'q-meta', text: q.type === 'true_false' ? 'True / False' : q.type === 'multi' ? 'Select all that apply' : 'Choose one' }),
      ...q.choices.map((choice, i) => {
        const input = h('input', { type: q.type === 'multi' ? 'checkbox' : 'radio', name: `q${q.id}`, value: String(i), id: `q${q.id}-${i}` });
        inputs.push(input);
        return h('div', { class: 'choice-row' }, [input, h('label', { for: `q${q.id}-${i}`, text: choice })]);
      }),
      feedback,
    ]);

    return {
      question: q,
      el,
      getSelected: () => inputs.map((inp, i) => (inp.checked ? i : null)).filter((v) => v !== null),
      applyResult(fullQuestion, correct) {
        el.classList.add(correct ? 'correct' : 'incorrect');
        feedback.classList.remove('hidden');
        feedback.classList.add(correct ? 'correct-text' : 'incorrect-text');
        const correctText = fullQuestion.correctIndexes.map((i) => fullQuestion.choices[i]).join(', ');
        feedback.textContent = correct ? 'Correct!' : `Not quite — the answer is "${correctText}".`;
        if (fullQuestion.explanation) el.appendChild(h('p', { class: 'text-muted text-small mt-2', text: fullQuestion.explanation }));
        if (fullQuestion.source) el.appendChild(sourceReveal(fullQuestion.source, `q${fullQuestion.id}`));
        inputs.forEach((inp) => (inp.disabled = true));
      },
    };
  }

  // ------------------------------------------------------------- concept
  async function viewConcept(idStr) {
    const id = Number(idStr);
    const c = await api('GET', `/api/concepts/${id}`);
    const total = c.performance.total;
    const pct = total ? Math.round((c.performance.correct / total) * 100) : null;

    const blocks = [h('h1', { text: c.name, class: 'mb-4' })];

    if (c.definition) {
      blocks.push(h('div', { class: 'card mb-5' }, [h('p', { text: c.definition.text }), sourceReveal({ document: c.definition.document, page: c.definition.page, quote: c.definition.text }, 'def')]));
    }

    if (total > 0) {
      const perfBar = h('div', { class: 'perf-bar' }, h('span', { class: 'perf-fill' }));
      perfBar.firstChild.style.setProperty('--pct', `${pct}%`);
      blocks.push(
        h('div', { class: 'card mb-5' }, [
          h('h2', { text: 'Your performance', class: 'section-title mb-2' }),
          perfBar,
          h('p', { class: 'text-muted text-small', text: `${c.performance.correct} of ${total} correct` }),
          h('button', { class: 'btn secondary small mt-2', text: 'Practice this topic', onClick: startTargeted }),
        ])
      );
    }

    blocks.push(h('h2', { text: 'Where this appears', class: 'section-title mb-2' }));
    blocks.push(h('div', { class: 'card divider-list mb-5' }, c.sources.map((s, i) => h('div', { class: 'pad-sm' }, sourceReveal(s, `s${i}`)))));

    if (c.related.length) {
      blocks.push(h('h2', { text: 'Related concepts', class: 'section-title mb-2' }));
      blocks.push(h('div', { class: 'related-list' }, c.related.map((r) => h('a', { href: `#/concepts/${r.id}`, class: 'concept-chip', text: r.name }))));
    }

    mount(main, blocks);

    async function startTargeted() {
      const quiz = await api('POST', '/api/quizzes/targeted', { subjectId: c.subjectId, conceptIds: [c.id] });
      location.hash = `#/quizzes/${quiz.id}`;
    }
  }

  route();
})();
