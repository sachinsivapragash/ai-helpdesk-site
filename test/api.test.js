// Run with: npm test  (uses the embedded PGlite database and the in-memory chat log store)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.ANTHROPIC_API_KEY = '';
process.env.MONGODB_URI = '';
process.env.GITHUB_TIMEOUT_MS = '1';

const { app, start } = require('../server');
let server;
let base;

before(async () => {
  await start();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  server.close();
  await require('../src/db/sql').close();
});

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('serves at least three pages, each with the chat widget script', async () => {
  for (const path of ['/', '/about', '/projects', '/faq', '/error-codes', '/support', '/health']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /\/js\/chat\.js/, path);
  }
});

test('unknown address returns the custom 404 page with an Ask-the-assistant button', async () => {
  const res = await fetch(`${base}/no-such-page`, { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Ask the assistant about this error/);
});

test('server errors return the custom 500 page', async () => {
  const res = await fetch(`${base}/demo/500`, { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 500);
  assert.match(await res.text(), /Ask the assistant about this error/);
});

test('at least 10 FAQs and the 8 required error codes come from SQL', async () => {
  const faqs = await (await fetch(`${base}/api/faqs`)).json();
  assert.ok(faqs.count >= 10);
  const codes = await (await fetch(`${base}/api/error-codes`)).json();
  const list = codes.codes.map((c) => c.code);
  for (const c of ['400', '401', '403', '404', '429', '500', '503']) assert.ok(list.includes(c), c);
  assert.ok(codes.codes.some((c) => c.site_specific));
});

test('assistant explains an error code', async () => {
  const body = await (await post('/api/chat', { message: 'What does error 429 mean?' })).json();
  assert.equal(body.source, 'error_code');
  assert.match(body.answer, /Too Many Requests/);
});

test('assistant answers from the FAQ', async () => {
  const body = await (await post('/api/chat', { message: 'Are you available for an internship?' })).json();
  assert.equal(body.source, 'faq');
  assert.equal(body.ticket, null);
});

test('assistant creates a ticket when it cannot answer', async () => {
  const body = await (await post('/api/chat', { message: 'What is the airspeed velocity of a swallow?' })).json();
  assert.match(body.ticket, /^TCK-/);
  const ticket = await (await fetch(`${base}/api/tickets/${body.ticket}`)).json();
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.source, 'assistant');
});

test('chat validation: empty -> 400, too long -> SITE-460', async () => {
  const empty = await post('/api/chat', { message: '' });
  assert.equal(empty.status, 400);
  const long = await post('/api/chat', { message: 'x'.repeat(501) });
  assert.equal(long.status, 413);
  assert.equal((await long.json()).error.code, 'SITE-460');
});

test('feedback is stored', async () => {
  const res = await post('/api/feedback', { messageId: 'abc123', rating: 'down' });
  assert.equal(res.status, 201);
});

test('ticket CRUD with admin auth (401 / 403 / 200 / 204)', async () => {
  const created = await (await post('/api/tickets', { subject: 'Test', message: 'This is a test ticket', email: 'a@b.co' })).json();
  assert.equal((await fetch(`${base}/api/admin/tickets`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/tickets`, { headers: { Authorization: 'Bearer nope' } })).status, 403);
  const auth = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' };
  const patched = await fetch(`${base}/api/admin/tickets/${created.reference}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'resolved' }) });
  assert.equal((await patched.json()).status, 'resolved');
  const del = await fetch(`${base}/api/admin/tickets/${created.reference}`, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 204);
});

test('third-party call falls back when it exceeds the time limit', async () => {
  const body = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(body.source, 'fallback');
  assert.ok(body.projects.length > 0);
});

test('health check reports dependencies', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.checks.sql.ok);
  assert.ok('mongo' in body.checks && 'ai' in body.checks && 'github' in body.checks);
});
