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

  // -------------------------------------------------------- Grounded Tutor Drawer
  function openTutorDrawer(params = {}) {
    const { query = '', conceptId = null, documentId = null, subjectId = null, mode = 'explain', contextText = null } = params;
    let drawer = document.getElementById('tutor-drawer');
    if (!drawer) {
      drawer = h('div', { id: 'tutor-drawer', class: 'tutor-drawer' });
      document.body.appendChild(drawer);
    }
    drawer.classList.add('open');

    const queryInput = h('input', { type: 'text', class: 'tutor-input', value: query || '', placeholder: 'Ask Groundwork about your material...' });
    const responseBox = h('div', { class: 'tutor-response-box' });
    const statusEl = h('div', { class: 'stage-line hidden' }, [h('span', { class: 'spinner' }), 'Searching course material…']);

    const closeBtn = h('button', { class: 'btn secondary small', text: '✕ Close', onClick: () => drawer.classList.remove('open') });
    const sendBtn = h('button', { class: 'btn small', text: 'Ask', onClick: () => runQuery('explain') });

    const explainBtn = h('button', { class: 'btn secondary small', text: 'Explain', onClick: () => runQuery('explain') });
    const simpleBtn = h('button', { class: 'btn secondary small', text: 'Simpler', onClick: () => runQuery('explain_simple') });
    const examBtn = h('button', { class: 'btn secondary small', text: 'Exam Answer', onClick: () => runQuery('exam_answer') });

    mount(drawer, [
      h('div', { class: 'tutor-header' }, [
        h('div', {}, [
          h('h3', { text: 'Groundwork Grounded Tutor' }),
          h('span', { class: 'tutor-badge', text: 'Source Verified' }),
        ]),
        closeBtn,
      ]),
      contextText ? h('div', { class: 'tutor-context-banner' }, [h('strong', { text: 'Context: ' }), contextText.slice(0, 140) + (contextText.length > 140 ? '…' : '')]) : null,
      h('div', { class: 'tutor-body' }, [
        h('div', { class: 'row-gap mb-2' }, [queryInput, sendBtn]),
        h('div', { class: 'tutor-modes mb-3' }, [explainBtn, simpleBtn, examBtn]),
        statusEl,
        responseBox,
      ]),
    ]);

    runQuery(mode);

    async function runQuery(m) {
      statusEl.classList.remove('hidden');
      clear(responseBox);
      try {
        const res = await api('POST', '/api/tutor/ask', {
          subjectId,
          documentId,
          conceptId,
          query: queryInput.value.trim() || query,
          mode: m,
          contextText,
        });
        statusEl.classList.add('hidden');

        const citations = res.sources || [];
        mount(responseBox, [
          h('div', { class: 'tutor-answer' }, res.answer),
          citations.length
            ? h('div', { class: 'tutor-citations mt-4' }, [
                h('h4', { text: 'Grounding Citations', class: 'eyebrow mb-2' }),
                ...citations.map((c, i) => sourceReveal(c, `tutor-src-${i}`)),
              ])
            : null,
        ]);
      } catch (err) {
        statusEl.classList.add('hidden');
        mount(responseBox, h('div', { class: 'banner error' }, err.message || 'Could not fetch explanation.'));
      }
    }
  }

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
  const sidebar = document.getElementById('sidebar');
  const sidebarNav = document.getElementById('sidebar-nav');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  // Sidebar toggle
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
  });

  // Theme Manager (Light / Dark mode)
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('groundwork_theme', theme);
    if (themeIcon && themeLabel) {
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
      themeLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    }
    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      btn.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
    });
  }

  function initTheme() {
    const saved = localStorage.getItem('groundwork_theme');
    if (saved) {
      applyTheme(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }
  }

  function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  initTheme();


  function setActiveNav() {
    const hash = location.hash || '#/';
    navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
    sidebarNav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
  }

  async function renderSidebar() {
    if (!state.user) { sidebar.hidden = true; document.body.classList.remove('has-sidebar'); return; }
    sidebar.hidden = false;
    document.body.classList.add('has-sidebar');

    const navItems = [
      { icon: '⌂', label: 'Dashboard', href: '#/' },
      { icon: '▣', label: 'Materials', href: '#/materials' },
      { icon: '◎', label: 'Mind Map', href: '#/graph' },
      { icon: '✦', label: 'Tutor', action: () => openTutorDrawer({}) },
    ];

    const elements = [];
    for (const item of navItems) {
      if (item.href) {
        elements.push(h('a', { href: item.href }, [
          h('span', { class: 'sb-icon', text: item.icon }),
          h('span', { class: 'sb-label', text: item.label }),
        ]));
      } else {
        elements.push(h('button', { onClick: item.action }, [
          h('span', { class: 'sb-icon', text: item.icon }),
          h('span', { class: 'sb-label', text: item.label }),
        ]));
      }
    }

    elements.push(h('div', { class: 'sb-divider' }));

    // Load subjects for sidebar
    try {
      const { subjects } = await api('GET', '/api/subjects');
      if (subjects && subjects.length > 0) {
        elements.push(h('div', { class: 'sb-section-label', text: 'COURSES' }));
        for (const s of subjects.slice(0, 5)) {
          elements.push(h('a', { href: `#/subjects/${s.id}` }, [
            h('span', { class: 'sb-icon', text: '·' }),
            h('span', { class: 'sb-label', text: s.name }),
          ]));
        }
      }
    } catch { /* ignore */ }

    elements.push(h('div', { class: 'sb-divider' }));
    elements.push(h('a', { href: '#/materials' }, [
      h('span', { class: 'sb-icon', text: '+' }),
      h('span', { class: 'sb-label', text: 'Add material' }),
    ]));

    mount(sidebarNav, elements);
    setActiveNav();
  }

  function renderChrome() {
    if (!state.user) { topnav.hidden = true; sidebar.hidden = true; document.body.classList.remove('has-sidebar'); return; }
    topnav.hidden = false;
    mount(navEl, [
      h('a', { href: '#/', text: 'Dashboard' }),
      h('a', { href: '#/materials', text: 'Materials' }),
      h('a', { href: '#/graph', text: 'Mind Map' }),
    ]);
    setActiveNav();
    const theme = getTheme();
    mount(userBox, [
      h('button', { class: 'theme-toggle-btn', onClick: toggleTheme, title: 'Switch light/dark theme' }, theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'),
      h('span', { text: state.user.isGuest ? 'Guest' : state.user.name }),
      state.user.isGuest ? h('a', { href: '#/register', class: 'btn small secondary', text: 'Save account' }) : null,
      h('button', { class: 'btn small secondary', onClick: onLogout, text: 'Sign out' }),
    ]);
    renderSidebar();
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
    { pattern: /^#\/graph$/, view: viewMindMap },
    { pattern: /^#\/subjects\/(\d+)\/graph$/, view: viewMindMap },
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
        setActiveNav();
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
    sidebar.hidden = true;
    document.body.classList.remove('has-sidebar');
    const errorEl = h('p', { class: 'error-text hidden' });
    const theme = getTheme();
    mount(main, [
      h('div', { class: 'theme-bar' }, [
        h('button', { class: 'theme-toggle-btn', onClick: toggleTheme, title: 'Switch light/dark theme' }, theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'),
      ]),
      h('section', { class: 'hero' }, [
        h('div', { class: 'eyebrow mb-3', text: 'SOURCE-GROUNDED STUDY WORKSPACE' }),
        h('h1', { text: 'Your lecture, organized.' }),
        h('p', { text: 'Upload a lecture PDF. Groundwork extracts revision notes, practice quizzes, and a concept knowledge map — with every claim traceable back to the exact page it came from.' }),
        h('div', { class: 'row-gap mt-4' }, [
          h('span', { class: 'pill ready', text: '📝 Notes' }),
          h('span', { class: 'pill ready', text: '🧠 Quizzes' }),
          h('span', { class: 'pill ready', text: '◎ Mind Map' }),
          h('span', { class: 'pill ready', text: '✦ AI Tutor' }),
          h('span', { class: 'pill ready', text: '🎯 Weakness Detection' }),
        ]),
      ]),
      h('div', { class: 'card max-w-sm' }, [
        h('button', { class: 'btn full-btn', onClick: startGuest, text: 'Start studying →' }),
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

    // Left column: primary content
    const leftCol = [];

    // Greeting
    leftCol.push(h('h1', { text: `Welcome back${state.user.isGuest ? '' : ', ' + state.user.name}`, class: 'mb-5' }));

    // Continue studying section
    if (data.subjects.length > 0) {
      leftCol.push(h('div', { class: 'eyebrow mb-2', text: 'CONTINUE STUDYING' }));
      leftCol.push(subjectGrid(data.subjects));
      leftCol.push(h('a', { href: '#/materials', class: 'btn ghost mt-2', text: '+ Add more material' }));
    } else {
      leftCol.push(
        h('div', { class: 'card mb-6' }, [
          h('div', { class: 'eyebrow mb-2', text: 'GET STARTED' }),
          h('h2', { class: 'mb-2', text: 'Upload your first lecture' }),
          h('p', { class: 'text-muted mb-4', text: 'Drop a lecture PDF and Groundwork will extract verified revision notes, practice quizzes, and a concept knowledge map.' }),
          h('a', { href: '#/materials', class: 'btn', text: 'Add material →' }),
        ])
      );
    }

    // Right column: focus & progress
    const rightCol = [];

    if (data.nextUp) {
      rightCol.push(
        h('div', { class: 'card mb-4' }, [
          h('div', { class: 'eyebrow mb-2', text: 'FOCUS NEXT' }),
          h('h3', { class: 'mb-2' }, h('a', { href: `#/concepts/${data.nextUp.conceptId}`, class: 'no-underline', text: data.nextUp.name })),
          h('p', { class: 'text-muted text-small mb-3', text: `${data.nextUp.subjectName} — missed ${data.nextUp.wrong} of ${data.nextUp.total} questions` }),
          h('div', { class: 'row-gap' }, [
            h('a', { href: `#/concepts/${data.nextUp.conceptId}`, class: 'btn small', text: '⚡ Explain' }),
            h('button', {
              class: 'btn small secondary',
              text: '🎯 Practice',
              onClick: async () => {
                try {
                  const quiz = await api('POST', '/api/quizzes/targeted', { subjectId: data.nextUp.subjectId, conceptIds: [data.nextUp.conceptId] });
                  location.hash = `#/quizzes/${quiz.id}`;
                } catch { /* ignore */ }
              },
            }),
          ]),
        ])
      );
    } else if (data.subjects.length > 0) {
      rightCol.push(
        h('div', { class: 'card mb-4' }, [
          h('div', { class: 'eyebrow mb-2', text: 'YOUR NEXT STEP' }),
          h('p', { class: 'text-muted text-small mb-3', text: 'Take your first practice quiz to discover what needs attention.' }),
          data.subjects[0] ? h('a', { href: `#/subjects/${data.subjects[0].id}`, class: 'btn small', text: 'Open material →' }) : null,
        ])
      );
    }

    // Quick actions card
    rightCol.push(
      h('div', { class: 'card mb-4' }, [
        h('div', { class: 'eyebrow mb-3', text: 'QUICK ACTIONS' }),
        h('div', { class: 'row-gap flex-column' }, [
          h('a', { href: '#/graph', class: 'btn secondary full-btn small', text: '◎ Knowledge Map' }),
          h('button', { class: 'btn secondary full-btn small', text: '✦ Ask Groundwork', onClick: () => openTutorDrawer({}) }),
        ]),
      ])
    );

    if (data.subjects.length > 0) {
      mount(main, [
        h('div', { class: 'dashboard-grid' }, [
          h('div', {}, leftCol),
          h('div', {}, rightCol),
        ]),
      ]);
    } else {
      mount(main, leftCol);
    }
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

    const summaryPanel = h('div', { id: 'panel-summary' });
    const notesPanel = h('div', { id: 'panel-notes', hidden: true });
    const quizPanel = h('div', { id: 'panel-quiz', hidden: true });

    const tabSummary = h('button', { class: 'tab active', type: 'button', text: 'One-Glance Summary', onClick: () => selectTab('summary') });
    const tabNotes = h('button', { class: 'tab', type: 'button', text: 'Revision Notes', onClick: () => selectTab('notes') });
    const tabQuiz = h('button', { class: 'tab', type: 'button', text: 'Practice Quiz', onClick: () => selectTab('quiz') });

    function selectTab(name) {
      tabSummary.classList.toggle('active', name === 'summary');
      tabNotes.classList.toggle('active', name === 'notes');
      tabQuiz.classList.toggle('active', name === 'quiz');
      summaryPanel.hidden = name !== 'summary';
      notesPanel.hidden = name !== 'notes';
      quizPanel.hidden = name !== 'quiz';
    }

    renderSummary(summaryPanel, doc, selectTab);
    renderNotes(notesPanel, doc);
    renderQuizStarter(quizPanel, doc);

    mount(main, [
      h('div', { class: 'doc-header' }, [
        h('h1', { text: doc.title }),
        h('div', { class: 'row-gap' }, [
          h('button', { class: 'btn small', text: '✦ Ask Groundwork', onClick: () => openTutorDrawer({ documentId: doc.id, subjectId: doc.subjectId }) }),
          h('a', { href: `/api/export/documents/${doc.id}/study-pack.md`, class: 'btn secondary small', text: 'Export' }),
        ]),
      ]),
      h('div', { class: 'engine-note', text: `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · ${doc.engine === 'offline' ? 'offline engine' : doc.engine} · verified against source` }),
      h('div', { class: 'tabs' }, [tabSummary, tabNotes, tabQuiz]),
      summaryPanel,
      notesPanel,
      quizPanel,
    ]);

  }

  function renderSummary(panel, doc, selectTab) {
    const tldrItems = doc.notes && doc.notes.sections.overview ? doc.notes.sections.overview : [];
    const totalNoteItems = doc.notes ? Object.values(doc.notes.sections).flat().length : 0;

    mount(panel, [
      h('div', { class: 'summary-card card mb-5' }, [
        h('div', { class: 'eyebrow mb-2', text: 'One-Glance Executive Summary' }),
        h('h2', { class: 'mb-3', text: doc.title }),
        tldrItems.length
          ? h('div', { class: 'tldr-box mb-4' }, tldrItems.map((it) => h('p', { class: 'text-lead', text: `• ${it.text}` })))
          : h('p', { class: 'text-muted', text: 'Summary is preparing...' }),
        h('div', { class: 'ready-stats mb-4' }, [
          stat(doc.pageCount || 0, 'Pages'),
          stat(doc.concepts ? doc.concepts.length : 0, 'Core Topics'),
          stat(totalNoteItems, 'Verified Note Points'),
        ]),
        h('div', { class: 'row-gap' }, [
          h('button', { class: 'btn', text: 'Read Revision Notes →', onClick: () => selectTab('notes') }),
          h('button', { class: 'btn secondary', text: 'Start Practice Quiz →', onClick: () => selectTab('quiz') }),
        ]),
      ]),
      doc.concepts && doc.concepts.length
        ? h('div', { class: 'note-section' }, [
            h('h2', { text: 'Key Concepts At A Glance' }),
            h('div', { class: 'concept-chip-row' }, doc.concepts.map((c) => h('a', { href: `#/concepts/${c.id}`, class: 'concept-chip', text: c.name }))),
          ])
        : null,
    ]);

    function stat(n, label) {
      return h('div', { class: 'stat' }, [h('b', { text: n }), h('span', { text: label })]);
    }
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
              h('div', { class: 'row-gap' }, [
                sourceReveal(item.source, `${kind}-${i}`),
                h('button', {
                  class: 'btn ghost small',
                  text: '⚡ Explain this',
                  onClick: () => openTutorDrawer({ query: item.text, documentId: doc.id, contextText: item.text }),
                }),
              ]),
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
        scoreEl.textContent = `Score: ${result.score || 0} / ${result.total || 0}`;
        const questionsList = (result && result.quiz && result.quiz.questions) || [];
        const gradedList = (result && result.graded) || [];
        const byId = new Map(questionsList.map((q) => [q.id, q]));
        const gradedById = new Map(gradedList.map((g) => [g.questionId, g ? g.correct : false]));
        fieldsets.forEach((f) => {
          const q = byId.get(f.question.id) || f.question;
          const isCorrect = gradedById.get(f.question.id) || false;
          f.applyResult(q, isCorrect);
        });

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
        const qObj = fullQuestion || q;
        const indexes = (qObj && qObj.correctIndexes) || [];
        const choices = (qObj && qObj.choices) || [];
        const correctText = indexes.map((i) => choices[i]).filter(Boolean).join(', ') || 'See explanation below';
        feedback.textContent = correct ? 'Correct!' : `Not quite — the answer is "${correctText}".`;
        if (qObj.explanation) el.appendChild(h('p', { class: 'text-muted text-small mt-2', text: qObj.explanation }));
        if (qObj.source) el.appendChild(sourceReveal(qObj.source, `q${qObj.id}`));

        el.appendChild(
          h('button', {
            class: 'btn secondary small mt-2',
            text: '⚡ Explain why & ask Groundwork',
            onClick: () =>
              openTutorDrawer({
                query: fullQuestion.prompt,
                conceptId: fullQuestion.conceptId,
                contextText: `Question: ${fullQuestion.prompt}. Correct Answer: ${correctText}.`,
              }),
          })
        );
        inputs.forEach((inp) => (inp.disabled = true));
      },
    };
  }


  // ------------------------------------------------------------- concept
  async function viewConcept(idStr) {
    const id = Number(idStr);
    const c = await api('GET', `/api/concepts/${id}`);
    const perf = (c && c.performance) || { total: 0, correct: 0 };
    const total = perf.total || 0;
    const correct = perf.correct || 0;
    const pct = total ? Math.round((correct / total) * 100) : null;

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
          h('p', { class: 'text-muted text-small', text: `${correct} of ${total} correct` }),
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

    blocks.push(
      h('div', { class: 'card mt-4' }, [
        h('div', { class: 'eyebrow mb-3', text: 'STUDY ACTIONS' }),
        h('div', { class: 'row-gap flex-column' }, [
          h('button', {
            class: 'btn full-btn',
            text: '✦ Ask Groundwork about this',
            onClick: () => openTutorDrawer({ conceptId: c.id, query: c.name, subjectId: c.subjectId }),
          }),
          h('button', { class: 'btn secondary full-btn', text: '🎯 Practice this topic', onClick: startTargeted }),
          h('a', { href: `#/subjects/${c.subjectId}/graph`, class: 'btn ghost text-center', text: '◎ View on knowledge map' }),
        ]),
      ])
    );

    mount(main, blocks);

    async function startTargeted() {
      const quiz = await api('POST', '/api/quizzes/targeted', { subjectId: c.subjectId, conceptIds: [c.id] });
      location.hash = `#/quizzes/${quiz.id}`;
    }
  }


  // ------------------------------------------------------------- mindmap
  async function viewMindMap(subjectIdStr) {
    let subjectId = subjectIdStr ? Number(subjectIdStr) : null;
    const { subjects } = await api('GET', '/api/subjects');

    if (!subjects || subjects.length === 0) {
      mount(main, emptyState('No materials yet', 'Upload a lecture PDF first to build your course mind map.', h('a', { href: '#/materials', class: 'btn', text: 'Add material' })));
      return;
    }

    if (!subjectId) subjectId = subjects[0].id;
    const graph = await api('GET', `/api/concepts/subject/${subjectId}/graph`);

    const selector = h(
      'select',
      {
        class: 'subject-select',
        onChange: (e) => {
          location.hash = `#/subjects/${e.target.value}/graph`;
        },
      },
      subjects.map((s) => h('option', { value: String(s.id), selected: s.id === subjectId, text: s.name }))
    );

    const detailPanel = h('div', { class: 'mindmap-detail card' }, [
      h('h3', { text: 'Select a concept node' }),
      h('p', { class: 'text-muted', text: 'Click any node on the map to see definitions, source citations, mastery status, and targeted practice.' }),
    ]);

    const canvasBox = h('div', { class: 'mindmap-canvas-box card' });

    mount(main, [
      h('div', { class: 'doc-header mb-4' }, [
        h('div', {}, [
          h('h1', { text: 'Course Knowledge Map' }),
          h('p', { class: 'engine-note', text: 'Source-grounded concept network & performance map' }),
        ]),
        selector,
      ]),
      h('div', { class: 'mindmap-layout' }, [canvasBox, detailPanel]),
    ]);

    renderMindMapGraph(canvasBox, graph, (node) => renderNodeDetail(detailPanel, node, subjectId));

    if (graph.nodes.length > 0) {
      renderNodeDetail(detailPanel, graph.nodes[0], subjectId);
    }
  }

  function renderMindMapGraph(container, graph, onSelect) {
    const width = 640;
    const height = 440;

    if (!graph.nodes || graph.nodes.length === 0) {
      mount(container, emptyState('No concepts extracted yet', 'Upload a lecture PDF to build your course knowledge graph.'));
      return;
    }

    const numNodes = graph.nodes.length;
    const cx = width / 2;
    const cy = height / 2;
    const rx = Math.min(width, height) * 0.38;

    const nodePos = new Map();
    graph.nodes.forEach((n, i) => {
      const angle = (i / numNodes) * 2 * Math.PI - Math.PI / 2;
      const x = cx + rx * Math.cos(angle);
      const y = cy + rx * Math.sin(angle);
      nodePos.set(n.id, { x, y });
    });

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'mindmap-svg');

    graph.edges.forEach((e) => {
      const p1 = nodePos.get(e.srcId);
      const p2 = nodePos.get(e.dstId);
      if (p1 && p2) {
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', p1.x);
        line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x);
        line.setAttribute('y2', p2.y);
        line.setAttribute('class', 'mindmap-edge');
        svg.appendChild(line);
      }
    });

    // Build adjacency set for neighbor dimming
    const adjacency = new Map();
    graph.nodes.forEach(n => adjacency.set(n.id, new Set()));
    graph.edges.forEach(e => {
      if (adjacency.has(e.srcId)) adjacency.get(e.srcId).add(e.dstId);
      if (adjacency.has(e.dstId)) adjacency.get(e.dstId).add(e.srcId);
    });

    const allNodeGs = [];
    let activeG = null;
    graph.nodes.forEach((n) => {
      const pos = nodePos.get(n.id);
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', `mindmap-node ${n.mastery}`);
      g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      g._nodeId = n.id;

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('r', n.mastery === 'weak' ? '22' : '18');

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('dy', '32');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = n.name;

      g.appendChild(circle);
      g.appendChild(text);

      g.addEventListener('click', () => {
        if (activeG) activeG.classList.remove('selected');
        g.classList.add('selected');
        activeG = g;
        // Dim non-connected nodes
        const neighbors = adjacency.get(n.id) || new Set();
        allNodeGs.forEach(ng => {
          const isConnected = ng._nodeId === n.id || neighbors.has(ng._nodeId);
          ng.classList.toggle('dimmed', !isConnected);
        });
        onSelect(n);
      });

      svg.appendChild(g);
      allNodeGs.push(g);
    });

    mount(container, svg);
  }


  function renderNodeDetail(panel, node, subjectId) {
    const masteryLabel =
      node.mastery === 'weak'
        ? 'NEEDS ANOTHER LOOK'
        : node.mastery === 'mastered'
        ? 'Mastered'
        : node.mastery === 'developing'
        ? 'Developing'
        : 'Untested';

    const masteryClass = `pill ${node.mastery === 'weak' ? 'failed' : node.mastery === 'mastered' ? 'ready' : 'processing'}`;

    mount(panel, [
      h('div', { class: 'eyebrow mb-1', text: 'Concept Detail' }),
      h('h2', { text: node.name, class: 'mb-2' }),
      h('div', { class: 'mb-4' }, [h('span', { class: masteryClass, text: masteryLabel })]),

      node.definition
        ? h('div', { class: 'tldr-box mb-4' }, [
            h('p', { class: 'text-lead', text: node.definition.text }),
            sourceReveal({ document: node.definition.documentTitle, page: node.definition.page, quote: node.definition.text }, `node-def-${node.id}`),
          ])
        : h('p', { class: 'text-muted mb-4', text: 'Mentioned in lecture slides.' }),

      h('div', { class: 'ready-stats mb-4' }, [
        h('div', { class: 'stat' }, [
          h('b', { text: `${(node.performance && node.performance.correct) || 0}/${(node.performance && node.performance.total) || 0}` }),
          h('span', { text: 'Correct Answers' }),
        ]),
      ]),


      h('div', { class: 'row-gap flex-column' }, [
        h('button', {
          class: 'btn full-btn',
          text: '⚡ Ask Groundwork about this concept',
          onClick: () => openTutorDrawer({ conceptId: node.id, query: node.name, subjectId }),
        }),
        h('button', {
          class: 'btn secondary full-btn',
          text: '🎯 Practice this topic',
          onClick: async () => {
            const quiz = await api('POST', '/api/quizzes/targeted', { subjectId, conceptIds: [node.id] });
            location.hash = `#/quizzes/${quiz.id}`;
          },
        }),
        h('a', { href: `#/concepts/${node.id}`, class: 'btn ghost text-center', text: 'View full concept details →' }),
      ]),
    ]);
  }

  route();

})();
