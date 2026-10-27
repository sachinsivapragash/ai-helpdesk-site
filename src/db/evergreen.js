// Keeps the demo events evergreen: when an event has ended (6 hours after its start), its slot
// moves forward in 3-week steps and shows the next, different event from src/db/eventCatalog.js,
// with all seats free again. Runs on start-up and at most once an hour while the site is running.
const config = require('../config');
const { variantFor } = require('./eventCatalog');

const STEP_DAYS = 21;

async function rollForwardPastEvents(query) {
  const stale = await query(
    `SELECT id, slot, variant, EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours' - starts_at) AS overdue_seconds
       FROM events WHERE starts_at < NOW() - INTERVAL '6 hours'`
  );
  for (const e of stale) {
    const steps = Math.max(1, Math.ceil(Number(e.overdue_seconds) / (STEP_DAYS * 86400)));
    const variant = e.variant + steps;
    const next = variantFor(e.slot, variant);
    await query('DELETE FROM bookings WHERE event_id = $1', [e.id]);
    if (!next) {
      // An event that is not in the catalogue just moves forward unchanged.
      await query(
        `UPDATE events SET starts_at = starts_at + make_interval(days => $2), booked = 0 WHERE id = $1`,
        [e.id, STEP_DAYS * steps]
      );
      continue;
    }
    await query(
      `UPDATE events
          SET variant = $2, slug = $3, title = $4, category = $5, description = $6, venue = $7, price = $8, capacity = $9,
              booked = 0,
              starts_at = (date_trunc('day', starts_at AT TIME ZONE $10) + make_interval(days => $11, hours => $12)) AT TIME ZONE $10
        WHERE id = $1`,
      [e.id, variant, next.slug, next.title, next.category, next.description, next.venue, next.price, next.capacity,
        config.site.timezone, STEP_DAYS * steps, next.hour]
    );
  }
  if (stale.length) console.log(`[events] moved ${stale.length} past event(s) forward to their next event`);
  return stale.length;
}

module.exports = { rollForwardPastEvents };
