// Simulates the site running for 6 months, a day at a time, against its own in-memory database.
// Moving every event one day earlier is the same as the clock moving one day forward.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { seed } = require('../src/db/seed');
const { rollForwardPastEvents } = require('../src/db/evergreen');
const { slots } = require('../src/db/eventCatalog');

test('180 days of operation: events always upcoming, rotating, valid and bookable', async () => {
  const db = new PGlite();
  const query = async (text, params = []) => (await db.query(text, params)).rows;
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  await seed(query);

  const titlesSeen = new Set();
  let bookingsMade = 0;
  for (let day = 1; day <= 180; day++) {
    await query("UPDATE events SET starts_at = starts_at - INTERVAL '1 day'");
    await rollForwardPastEvents(query);
    // Restarts happen now and then; the seed must be safe to run again on a live database.
    if (day % 30 === 0) await seed(query);

    const events = await query(
      `SELECT *, capacity - booked AS seats_left,
              EXTRACT(HOUR FROM starts_at AT TIME ZONE 'Asia/Kolkata') AS local_hour
         FROM events ORDER BY starts_at`);
    assert.equal(events.length, slots.length, `day ${day}: one event per slot`);
    for (const e of events) {
      titlesSeen.add(e.title);
      const daysAhead = (new Date(e.starts_at) - Date.now()) / 86400000;
      assert.ok(daysAhead > -0.26 && daysAhead < 22, `day ${day}: ${e.title} is ${daysAhead.toFixed(2)} days away`);
      assert.ok(e.booked >= 0 && e.booked <= e.capacity, `day ${day}: ${e.title} seats ${e.booked}/${e.capacity}`);
      const slot = slots.find((s) => s.slot === e.slot);
      const v = slot.variants[e.variant % slot.variants.length];
      assert.equal(e.title, v.title, `day ${day}: title matches its rotation`);
      assert.equal(Number(e.local_hour), v.hour, `day ${day}: ${e.title} starts at ${v.hour}:00 local time`);
    }
    const upcoming = events.filter((e) => new Date(e.starts_at) > new Date());
    assert.ok(upcoming.length >= slots.length - 2, `day ${day}: at least ${slots.length - 2} events are bookable`);

    // A student books one seat on the next event with seats left.
    const target = upcoming.find((e) => e.seats_left > 0);
    if (target) {
      const [r] = await query(
        'UPDATE events SET booked = booked + 1 WHERE id = $1 AND booked + 1 <= capacity RETURNING id', [target.id]);
      if (r) {
        await query('INSERT INTO bookings (reference, event_id, name, email, seats) VALUES ($1, $2, $3, $4, 1)',
          [`BK-SIM${day}`, target.id, 'Sim', `sim${day}@college.edu`]);
        bookingsMade++;
      }
    }
    const [orphans] = await query(
      `SELECT COUNT(*)::int AS n FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.starts_at < NOW() - INTERVAL '6 hours'`);
    assert.equal(orphans.n, 0, `day ${day}: no bookings left on finished events`);
  }
  const allTitles = slots.flatMap((s) => s.variants.map((v) => v.title));
  assert.deepEqual([...titlesSeen].sort(), [...allTitles].sort(), 'every event in the catalogue appeared');
  assert.ok(bookingsMade > 150, `bookings kept working (${bookingsMade} made)`);
  await db.close();
});
