// Booking emails with the Brevo API mocked.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BREVO_API_KEY = 'test-key';
process.env.MAIL_FROM = 'events@example.com';
const mailer = require('../src/services/email');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const booking = {
  reference: 'BK-ABC123', name: 'Asha <b>', email: 'asha@college.edu', seats: 2,
  event: 'AI for Beginners Workshop', starts_at: '2026-10-31T08:30:00Z', venue: 'Lab 3, CS Block',
};

test('sends a booking confirmation through Brevo', async () => {
  let sent;
  global.fetch = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return { ok: true, status: 201, json: async () => ({}) }; };
  assert.equal(await mailer.bookingConfirmed(booking), 'sent');
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(sent.opts.headers['api-key'], 'test-key');
  assert.deepEqual(sent.body.to, [{ email: 'asha@college.edu', name: 'Asha <b>' }]);
  assert.equal(sent.body.sender.email, 'events@example.com');
  assert.match(sent.body.subject, /Booking confirmed: AI for Beginners Workshop \(BK-ABC123\)/);
  assert.match(sent.body.htmlContent, /Asha &lt;b&gt;/); // user text is escaped in the HTML email
  assert.match(sent.body.textContent, /Sat, 31 October 2026|Saturday, 31 October 2026/);
  assert.equal(mailer.status().ok, true);
});

test('a Brevo error is reported, not thrown', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  assert.equal(await mailer.bookingCancelled(booking), 'failed');
  assert.equal(mailer.status().ok, false);
  assert.match(mailer.status().detail, /401: Key not found/);
});

test('a slow email service times out and is reported', async () => {
  global.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); };
  assert.equal(await mailer.bookingConfirmed(booking), 'failed');
  assert.match(mailer.status().detail, /timed out after 5000 ms/);
});
