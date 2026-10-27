const express = require('express');
const rateLimit = require('express-rate-limit');
const sql = require('../db/sql');
const mongo = require('../db/mongo');
const assistant = require('../services/assistant');
const tickets = require('../services/tickets');
const events = require('../services/events');
const weather = require('../services/weather');
const mailer = require('../services/email');
const adminAuth = require('../middleware/adminAuth');
const { apiError } = require('../middleware/errors');
const { recentRequests } = require('../middleware/requestLogger');

const router = express.Router();

const rateLimitHandler = (req, res) =>
  apiError(res, 429, '429', 'Too many requests. Please wait a minute and try again.');

const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler });

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- Health ----------
router.get('/health', async (req, res) => {
  const checks = {};
  try {
    checks.sql = { ok: true, ...(await sql.ping()) };
  } catch (err) {
    checks.sql = { ok: false, detail: err.message };
  }
  try {
    checks.mongo = await mongo.ping();
  } catch (err) {
    checks.mongo = { ok: false, detail: err.message };
  }
  checks.ai = assistant.status();
  checks.weather = weather.status();
  checks.email = mailer.status();

  const status = !checks.sql.ok ? 'down' : checks.mongo.ok && checks.ai.configured ? 'ok' : 'degraded';
  res.status(status === 'down' ? 503 : 200).json({
    status,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
    node: process.version,
    checks,
  });
});

router.get('/logs/recent', (req, res) => res.json({ requests: recentRequests() }));

// ---------- FAQ & error codes (read from SQL) ----------
router.get('/faqs', async (req, res) => {
  const faqs = await sql.query('SELECT id, category, question, answer FROM faqs ORDER BY sort_order');
  res.json({ count: faqs.length, faqs });
});

router.get('/error-codes', async (req, res) => {
  const codes = await sql.query('SELECT * FROM error_codes ORDER BY site_specific, http_status, code');
  res.json({ count: codes.length, codes });
});

router.get('/error-codes/:code', async (req, res) => {
  const [code] = await sql.query('SELECT * FROM error_codes WHERE UPPER(code) = UPPER($1)', [req.params.code]);
  if (!code) return apiError(res, 404, '404', `Unknown error code "${req.params.code}".`);
  res.json(code);
});

// ---------- Assistant ----------
router.post('/chat', chatLimiter, async (req, res) => {
  const { message, sessionId, page, history, email } = req.body || {};
  try {
    const reply = await assistant.chat({
      message,
      sessionId: str(sessionId, 64) || null,
      page: str(page, 200) || null,
      history,
      email: isEmail(email) ? email : null,
    });
    res.json(reply);
  } catch (err) {
    if (err instanceof assistant.ChatError) return apiError(res, err.status, err.code, err.message);
    throw err;
  }
});

router.post('/feedback', writeLimiter, async (req, res) => {
  const { messageId, rating, comment, sessionId } = req.body || {};
  if (!['up', 'down'].includes(rating)) return apiError(res, 400, '400', 'rating must be "up" or "down".');
  if (!str(messageId, 64)) return apiError(res, 400, '400', 'messageId is required.');
  const id = await mongo.insert('feedback', {
    messageId: str(messageId, 64), rating, comment: str(comment, 500) || null, sessionId: str(sessionId, 64) || null,
  });
  res.status(201).json({ id, saved: true });
});

// ---------- Tickets (CRUD) ----------
router.post('/tickets', writeLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  const errors = [];
  if (!str(subject, 150)) errors.push('subject is required');
  if (str(message, 2000).length < 10) errors.push('message must be at least 10 characters');
  if (email && !isEmail(email)) errors.push('email is not valid');
  if (errors.length) return apiError(res, 400, '400', 'Please fix the form.', { details: errors });
  const ticket = await tickets.create({
    name: str(name, 100), email: email || null, subject: str(subject, 150), message: str(message, 2000), source: 'form',
  });
  res.status(201).location(`/api/tickets/${ticket.reference}`).json(ticket);
});

router.get('/tickets/:reference', async (req, res) => {
  const ticket = await tickets.getPublic(req.params.reference.toUpperCase());
  if (!ticket) return apiError(res, 404, '404', 'No ticket with that reference.');
  res.json(ticket);
});

router.get('/admin/tickets', adminAuth, async (req, res) => {
  const status = tickets.STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const rows = await tickets.list({ status });
  res.json({ count: rows.length, tickets: rows });
});

router.patch('/admin/tickets/:reference', adminAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!tickets.STATUSES.includes(status)) {
    return apiError(res, 400, '400', `status must be one of: ${tickets.STATUSES.join(', ')}`);
  }
  const ticket = await tickets.updateStatus(req.params.reference.toUpperCase(), status);
  if (!ticket) return apiError(res, 404, '404', 'No ticket with that reference.');
  res.json(ticket);
});

router.delete('/admin/tickets/:reference', adminAuth, async (req, res) => {
  const removed = await tickets.remove(req.params.reference.toUpperCase());
  if (!removed) return apiError(res, 404, '404', 'No ticket with that reference.');
  res.status(204).end();
});

router.get('/admin/stats', adminAuth, async (req, res) => {
  const [chats, feedback] = await Promise.all([mongo.count('chat_logs'), mongo.feedbackSummary()]);
  res.json({ chatMessages: chats, feedback });
});

// ---------- Events & bookings ----------
router.get('/events', async (req, res) => {
  const rows = await events.list();
  res.json({ count: rows.length, events: rows });
});

router.get('/events/:slug', async (req, res) => {
  const event = await events.get(req.params.slug);
  if (!event) return apiError(res, 404, '404', 'No event with that name.');
  res.json(event);
});

router.post('/events/:slug/bookings', writeLimiter, async (req, res) => {
  const { name, email, seats } = req.body || {};
  const errors = [];
  if (!str(name, 100)) errors.push('name is required');
  if (!isEmail(email)) errors.push('a valid email is required');
  const count = Number(seats);
  if (!Number.isInteger(count) || count < 1 || count > 4) errors.push('seats must be a whole number from 1 to 4');
  if (errors.length) return apiError(res, 400, '400', 'Please fix the booking form.', { details: errors });
  try {
    const booking = await events.book(req.params.slug, { name: str(name, 100), email, seats: count });
    // 'sent', 'failed' or 'disabled'; a failed email never fails the booking.
    const emailStatus = await mailer.bookingConfirmed(booking);
    const { name: _n, email: _e, ...publicBooking } = booking;
    res.status(201).location(`/api/bookings/${booking.reference}`).json({ ...publicBooking, email_status: emailStatus });
  } catch (err) {
    if (err instanceof events.BookingError) return apiError(res, err.status, err.code, err.message);
    throw err;
  }
});

router.get('/bookings/:reference', async (req, res) => {
  const booking = await events.getBooking(req.params.reference.toUpperCase());
  if (!booking) return apiError(res, 404, '404', 'No booking with that reference.');
  res.json(booking);
});

router.get('/admin/bookings', adminAuth, async (req, res) => {
  const rows = await events.listBookings();
  res.json({ count: rows.length, bookings: rows });
});

router.patch('/admin/bookings/:reference/cancel', adminAuth, async (req, res) => {
  const booking = await events.cancelBooking(req.params.reference.toUpperCase());
  if (!booking) return apiError(res, 404, '404', 'No confirmed booking with that reference.');
  const emailStatus = await mailer.bookingCancelled(booking);
  res.json({ reference: booking.reference, status: booking.status, seats: booking.seats, event: booking.event, email_status: emailStatus });
});

// ---------- Third-party ----------
router.get('/weather', async (req, res) => {
  res.json(await weather.getForecast());
});

module.exports = router;
