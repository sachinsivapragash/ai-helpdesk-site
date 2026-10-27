// Run with: npm test  (uses the embedded PGlite database and the in-memory chat log store)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.ANTHROPIC_API_KEY = '';
process.env.MONGODB_URI = '';
process.env.WEATHER_TIMEOUT_MS = '1';

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
  for (const path of ['/', '/events', '/about', '/faq', '/error-codes', '/support', '/health']) {
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
  const body = await (await post('/api/chat', { message: 'Do I get a participation certificate?' })).json();
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

test('chat validation: empty -> 400, too long -> EVT-460', async () => {
  const empty = await post('/api/chat', { message: '' });
  assert.equal(empty.status, 400);
  const long = await post('/api/chat', { message: 'x'.repeat(501) });
  assert.equal(long.status, 413);
  assert.equal((await long.json()).error.code, 'EVT-460');
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

test('third-party weather call falls back when it exceeds the time limit', async () => {
  const body = await (await fetch(`${base}/api/weather`)).json();
  assert.equal(body.source, 'fallback');
  assert.deepEqual(body.days, []);
});

test('events are listed from SQL with seats left', async () => {
  const body = await (await fetch(`${base}/api/events`)).json();
  assert.ok(body.count >= 5);
  assert.ok(body.events.every((e) => e.seats_left === e.capacity - e.booked));
});

test('booking: success 201, duplicate and sold out -> EVT-409, bad input -> 400', async () => {
  const ok = await post('/api/events/ai-for-beginners/bookings', { name: 'Asha', email: 'asha@college.edu', seats: 2 });
  assert.equal(ok.status, 201);
  const booking = await ok.json();
  assert.match(booking.reference, /^BK-/);
  assert.equal(booking.email_status, 'disabled'); // no Brevo key in tests: booking still succeeds
  assert.equal(booking.email, undefined); // personal data is not echoed back
  const looked = await (await fetch(`${base}/api/bookings/${booking.reference}`)).json();
  assert.equal(looked.seats, 2);

  const dup = await post('/api/events/ai-for-beginners/bookings', { name: 'Asha', email: 'ASHA@college.edu', seats: 1 });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error.code, 'EVT-409');

  const full = await post('/api/events/resume-clinic/bookings', { name: 'Ravi', email: 'ravi@college.edu', seats: 4 });
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error.code, 'EVT-409');

  const bad = await post('/api/events/ai-for-beginners/bookings', { name: '', email: 'nope', seats: 9 });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.details.length, 3);

  const missing = await post('/api/events/no-such-event/bookings', { name: 'A', email: 'a@b.co', seats: 1 });
  assert.equal(missing.status, 404);

  const auth = { Authorization: 'Bearer test-admin-token' };
  const cancel = await fetch(`${base}/api/admin/bookings/${booking.reference}/cancel`, { method: 'PATCH', headers: auth });
  assert.equal((await cancel.json()).status, 'cancelled');
  const event = await (await fetch(`${base}/api/events/ai-for-beginners`)).json();
  assert.equal(event.booked, 0);
});

test('assistant answers questions about events', async () => {
  const body = await (await post('/api/chat', { message: 'When is the hackathon?' })).json();
  assert.equal(body.source, 'event');
  assert.match(body.answer, /Hack the Campus/);
});

test('assistant explains the site-specific code', async () => {
  const body = await (await post('/api/chat', { message: 'I got EVT-409 when booking' })).json();
  assert.equal(body.source, 'error_code');
  assert.match(body.answer, /Sold Out/);
});

test('health check reports dependencies', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.checks.sql.ok);
  assert.ok('mongo' in body.checks && 'ai' in body.checks && 'weather' in body.checks);
});
