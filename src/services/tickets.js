const crypto = require('crypto');
const sql = require('../db/sql');

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const PUBLIC_FIELDS = 'reference, subject, status, source, created_at, updated_at';

function newReference() {
  return `TCK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function create({ name, email, subject, message, source = 'form', sessionId = null }) {
  const [ticket] = await sql.query(
    `INSERT INTO tickets (reference, name, email, subject, message, source, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PUBLIC_FIELDS}`,
    [newReference(), name || null, email || null, subject, message, source, sessionId]
  );
  return ticket;
}

async function getPublic(reference) {
  const [ticket] = await sql.query(`SELECT ${PUBLIC_FIELDS} FROM tickets WHERE reference = $1`, [reference]);
  return ticket || null;
}

async function list({ status } = {}) {
  if (status) return sql.query('SELECT * FROM tickets WHERE status = $1 ORDER BY created_at DESC', [status]);
  return sql.query('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200');
}

async function updateStatus(reference, status) {
  const [ticket] = await sql.query(
    'UPDATE tickets SET status = $2, updated_at = NOW() WHERE reference = $1 RETURNING *',
    [reference, status]
  );
  return ticket || null;
}

async function remove(reference) {
  const rows = await sql.query('DELETE FROM tickets WHERE reference = $1 RETURNING reference', [reference]);
  return rows.length > 0;
}

module.exports = { STATUSES, create, getPublic, list, updateStatus, remove };
