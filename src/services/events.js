const crypto = require('crypto');
const sql = require('../db/sql');

const EVENT_FIELDS = `id, slug, title, category, description, venue, starts_at, price, capacity, booked,
  capacity - booked AS seats_left`;

class BookingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function list() {
  return sql.query(`SELECT ${EVENT_FIELDS} FROM events WHERE starts_at > NOW() - INTERVAL '6 hours' ORDER BY starts_at`);
}

async function get(slug) {
  const [event] = await sql.query(`SELECT ${EVENT_FIELDS} FROM events WHERE slug = $1`, [slug]);
  return event || null;
}

// Reserves seats atomically: the UPDATE only succeeds while enough seats are left.
async function book(slug, { name, email, seats }) {
  const [reserved] = await sql.query(
    `UPDATE events SET booked = booked + $2
      WHERE slug = $1 AND starts_at > NOW() AND booked + $2 <= capacity
      RETURNING id, title, starts_at, venue`,
    [slug, seats]
  );
  if (!reserved) {
    const event = await get(slug);
    if (!event) throw new BookingError(404, '404', 'No event with that name.');
    if (new Date(event.starts_at) <= new Date()) throw new BookingError(400, '400', 'This event has already started.');
    throw new BookingError(409, 'EVT-409', event.seats_left > 0
      ? `Only ${event.seats_left} seat(s) left for this event.`
      : 'This event is sold out.');
  }
  try {
    const [booking] = await sql.query(
      `INSERT INTO bookings (reference, event_id, name, email, seats)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING reference, seats, status, created_at`,
      [`BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, reserved.id, name, email.toLowerCase(), seats]
    );
    return { ...booking, name, email: email.toLowerCase(), event: reserved.title, starts_at: reserved.starts_at, venue: reserved.venue };
  } catch (err) {
    await sql.query('UPDATE events SET booked = booked - $2 WHERE id = $1', [reserved.id, seats]);
    if (err.code === '23505') throw new BookingError(409, 'EVT-409', 'You have already booked this event with this email.');
    throw err;
  }
}

async function getBooking(reference) {
  const [booking] = await sql.query(
    `SELECT b.reference, b.seats, b.status, b.created_at, e.title AS event, e.starts_at, e.venue
       FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.reference = $1`,
    [reference]
  );
  return booking || null;
}

async function listBookings() {
  return sql.query(
    `SELECT b.*, e.title AS event FROM bookings b JOIN events e ON e.id = b.event_id
      ORDER BY b.created_at DESC LIMIT 200`
  );
}

// Cancels a booking and gives its seats back to the event.
async function cancelBooking(reference) {
  const [booking] = await sql.query(
    `UPDATE bookings SET status = 'cancelled' WHERE reference = $1 AND status = 'confirmed'
     RETURNING event_id, seats, reference, status, name, email`,
    [reference]
  );
  if (!booking) return null;
  const [event] = await sql.query(
    'UPDATE events SET booked = GREATEST(booked - $2, 0) WHERE id = $1 RETURNING title, starts_at',
    [booking.event_id, booking.seats]
  );
  return { ...booking, event: event.title, starts_at: event.starts_at };
}

module.exports = { BookingError, list, get, book, getBooking, listBookings, cancelBooking };
