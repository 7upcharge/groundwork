const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../app');
const { openDatabase } = require('../db');
const { createStorage } = require('../services/storage');

const SAMPLE_PDF = path.join(__dirname, '..', '..', 'samples', 'sample-lecture.pdf');

function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-test-'));
  const { app, db } = createApp({
    db: openDatabase(':memory:'),
    storage: createStorage(dataDir),
    llm: null, // force the offline engine so the golden path needs no API key
    config: { production: false, maxUploadBytes: 10 * 1024 * 1024, maxPages: 60 },
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, db, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

// A tiny client that keeps cookies across requests, like a browser session.
function makeClient(base) {
  let cookie = null;
  async function call(method, path, body, { multipart } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') headers['X-Groundwork'] = '1';
    let payload = body;
    if (body && !multipart) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json (e.g. markdown export) */ }
    return { status: res.status, json, text };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, body, opts) => call('POST', p, body, opts),
    patch: (p, body) => call('PATCH', p, body),
    del: (p) => call('DELETE', p),
    cookieHeader: () => cookie,
    async uploadPdf(path_, subjectId, filename = 'lecture.pdf') {
      const buffer = fs.readFileSync(SAMPLE_PDF);
      const form = new FormData();
      form.append('subjectId', String(subjectId));
      form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
      const headers = { 'X-Groundwork': '1' };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(base + path_, { method: 'POST', headers, body: form });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
  };
}

async function run({ test, assert }) {
  await test('golden path: guest -> subject -> upload -> notes -> quiz -> weakness -> targeted practice -> export', async () => {
    const { server, base } = await startServer();
    try {
      const client = makeClient(base);

      // no CSRF header -> rejected
      const blocked = await fetch(base + '/api/auth/guest', { method: 'POST' });
      assert.strictEqual(blocked.status, 403);

      const guest = await client.post('/api/auth/guest');
      assert.strictEqual(guest.status, 201);
      assert.strictEqual(guest.json.user.isGuest, true);

      const subject = await client.post('/api/subjects', { name: 'Biology' });
      assert.strictEqual(subject.status, 201);
      const subjectId = subject.json.subject.id;

      const upload = await client.uploadPdf('/api/documents', subjectId);
      assert.strictEqual(upload.status, 201, JSON.stringify(upload.json));
      const documentId = upload.json.document.id;

      const doc = await client.get(`/api/documents/${documentId}`);
      assert.strictEqual(doc.json.status, 'ready');
      assert.strictEqual(doc.json.engine, 'offline');
      assert.ok(doc.json.notes.sections.overview.length > 0);
      assert.ok(doc.json.concepts.length > 0);
      doc.json.notes.sections.key_point.forEach((item) => assert.ok(item.source.page >= 1));

      // duplicate upload of the same bytes is deduped, not reprocessed
      const dupe = await client.uploadPdf('/api/documents', subjectId);
      assert.strictEqual(dupe.status, 200);
      assert.strictEqual(dupe.json.deduped, true);

      const quiz = await client.post('/api/quizzes', { subjectId, documentId, count: 5 });
      assert.strictEqual(quiz.status, 201, JSON.stringify(quiz.json));
      assert.strictEqual(quiz.json.questions.length, 5);
      quiz.json.questions.forEach((q) => assert.strictEqual(q.correctIndexes, undefined)); // answers hidden before submission

      const responses = {};
      quiz.json.questions.forEach((q) => { responses[q.id] = [0]; }); // deliberately get most wrong
      const attempt1 = await client.post(`/api/quizzes/${quiz.json.id}/attempts`, { responses });
      assert.strictEqual(attempt1.status, 201);
      assert.ok(attempt1.json.quiz.questions[0].correctIndexes); // answers revealed after submission
      const attempt2 = await client.post(`/api/quizzes/${quiz.json.id}/attempts`, { responses });
      assert.strictEqual(attempt2.status, 201);

      const weak = await client.get(`/api/concepts/subject/${subjectId}/weak`);
      assert.strictEqual(weak.status, 200);
      assert.ok(weak.json.weak.length > 0, 'expected at least one weak concept after two wrong attempts');
      weak.json.weak.forEach((w) => assert.ok(['high', 'medium'].includes(w.confidence)));

      const dashboard = await client.get('/api/dashboard');
      assert.ok(dashboard.json.nextUp, 'dashboard should surface a next-up recommendation');

      const conceptId = weak.json.weak[0].conceptId;
      const conceptDetail = await client.get(`/api/concepts/${conceptId}`);
      assert.strictEqual(conceptDetail.status, 200);
      assert.ok(conceptDetail.json.sources.length > 0);
      assert.ok(Array.isArray(conceptDetail.json.related));

      const targeted = await client.post('/api/quizzes/targeted', { subjectId, conceptIds: [conceptId] });
      assert.strictEqual(targeted.status, 201, JSON.stringify(targeted.json));
      assert.ok(targeted.json.questions.length > 0, 'targeted practice produced zero questions (regression)');
      targeted.json.questions.forEach((q) => assert.strictEqual(new Set(q.choices).size, q.choices.length));

      const exported = await client.get(`/api/export/documents/${documentId}/study-pack.md`);
      assert.strictEqual(exported.status, 200);
      assert.ok(exported.text.startsWith('# '));
      assert.ok(exported.text.includes('Weak Areas'));
    } finally {
      server.close();
    }
  });

  await test('failure paths: no file, wrong type, oversized, scanned, corrupted, nonexistent, unauthenticated', async () => {
    const { server, base } = await startServer();
    try {
      const client = makeClient(base);
      await client.post('/api/auth/guest');
      const subject = await client.post('/api/subjects', { name: 'X' });
      const subjectId = subject.json.subject.id;

      const noFile = await client.post('/api/documents', {});
      assert.strictEqual(noFile.status, 400);

      const notPdf = await (async () => {
        const form = new FormData();
        form.append('subjectId', String(subjectId));
        form.append('file', new Blob([Buffer.from('<html>not a pdf</html>')], { type: 'text/html' }), 'x.html');
        const res = await fetch(base + '/api/documents', {
          method: 'POST',
          headers: { 'X-Groundwork': '1', Cookie: client.cookieHeader() },
          body: form,
        });
        return res.status;
      })();
      assert.strictEqual(notPdf, 400);

      const scanned = await (async () => {
        const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'samples', 'blank-scan.pdf'));
        const form = new FormData();
        form.append('subjectId', String(subjectId));
        form.append('file', new Blob([buf], { type: 'application/pdf' }), 'blank-scan.pdf');
        const res = await fetch(base + '/api/documents', {
          method: 'POST',
          headers: { 'X-Groundwork': '1', Cookie: client.cookieHeader() },
          body: form,
        });
        return { status: res.status, json: await res.json() };
      })();
      assert.strictEqual(scanned.status, 422);

      const corrupted = await (async () => {
        const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage '.repeat(200))]);
        const form = new FormData();
        form.append('subjectId', String(subjectId));
        form.append('file', new Blob([buf], { type: 'application/pdf' }), 'corrupt.pdf');
        const res = await fetch(base + '/api/documents', {
          method: 'POST',
          headers: { 'X-Groundwork': '1', Cookie: client.cookieHeader() },
          body: form,
        });
        return res.status;
      })();
      // pdf.js's own leniency decides whether this reads as "not a PDF" (400)
      // or "opened but has no usable content" (422) — both are a graceful,
      // non-crashing rejection, which is what actually matters here.
      assert.ok([400, 422].includes(corrupted), `unexpected status ${corrupted}`);

      const oversized = await (async () => {
        const buf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 'a')]);
        const form = new FormData();
        form.append('subjectId', String(subjectId));
        form.append('file', new Blob([buf], { type: 'application/pdf' }), 'huge.pdf');
        const res = await fetch(base + '/api/documents', {
          method: 'POST',
          headers: { 'X-Groundwork': '1', Cookie: client.cookieHeader() },
          body: form,
        });
        return res.status;
      })();
      assert.strictEqual(oversized, 413);

      const missing = await client.get('/api/documents/999999');
      assert.strictEqual(missing.status, 404);

      // fresh, unauthenticated client
      const anon = await fetch(base + '/api/dashboard');
      assert.strictEqual(anon.status, 401);
    } finally {
      server.close();
    }
  });
}

module.exports = { run };
