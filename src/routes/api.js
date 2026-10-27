const express = require('express');
const rateLimit = require('express-rate-limit');
const sql = require('../db/sql');
const mongo = require('../db/mongo');
const assistant = require('../services/assistant');
const tickets = require('../services/tickets');
const github = require('../services/github');
const adminAuth = require('../middleware/adminAuth');
const { apiError } = require('../middleware/errors');
const { recentRequests } = require('../middleware/requestLogger');

const router = express.Router();

const rateLimitHandler = (req, res) =>
  apiError(res, 429, '429', 'Too many requests. Please wait a minute and try again.');

const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler });

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
  checks.github = github.status();

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

// ---------- Third-party ----------
router.get('/projects', async (req, res) => {
  res.json(await github.getProjects());
});

module.exports = router;
