// Keeps the demo events evergreen: an event that ended (6 hours after its start) moves forward
// in 3-week steps and starts again with no bookings. Runs on start-up and at most once an hour
// while the site is running, so the Events page never runs out of upcoming events.
async function rollForwardPastEvents(query) {
  const stale = await query("SELECT id FROM events WHERE starts_at < NOW() - INTERVAL '6 hours'");
  if (!stale.length) return 0;
  const ids = stale.map((r) => r.id);
  await query('DELETE FROM bookings WHERE event_id = ANY($1)', [ids]);
  await query(
    `UPDATE events
        SET starts_at = starts_at + make_interval(days => 21 * CEIL(EXTRACT(EPOCH FROM NOW() - INTERVAL '6 hours' - starts_at) / (21 * 86400))::int),
            booked = 0
      WHERE id = ANY($1)`,
    [ids]
  );
  console.log(`[events] moved ${ids.length} past event(s) forward`);
  return ids.length;
}

module.exports = { rollForwardPastEvents };
