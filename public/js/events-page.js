(async function () {
  const { api, escapeHtml } = window.Site;
  const grid = document.getElementById('events');
  const note = document.getElementById('weather-note');
  let events = [];
  let forecast = null;

  function render(filter) {
    const shown = events.filter((e) => filter === 'all' || e.category === filter);
    grid.innerHTML = shown.map((e) => window.Events.card(e, forecast)).join('') || '<p class="muted">No events in this category yet.</p>';
  }

  async function refresh(filter = 'all') {
    try {
      const [data, fc] = await Promise.all([window.Events.load(), forecast ? Promise.resolve(forecast) : window.Events.loadForecast()]);
      events = data.events;
      forecast = fc;
      if (!forecast || forecast.source === 'fallback') {
        note.textContent = 'Weather forecasts are unavailable right now, so they are hidden. Events go ahead as planned.';
        note.classList.add('warn');
        note.hidden = false;
      }
      render(filter);
    } catch (err) {
      grid.innerHTML = `<p class="notice warn">Could not load events (error ${escapeHtml(err.code)}).</p>`;
    }
  }

  document.querySelectorAll('[data-filter]').forEach((chip) => chip.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('active', c === chip));
    render(chip.dataset.filter);
  }));

  grid.addEventListener('submit', async (e) => {
    if (!e.target.matches('.booking-form')) return;
    e.preventDefault();
    const form = e.target;
    const slug = form.closest('.event-card').dataset.slug;
    const out = form.querySelector('.form-result');
    const btn = form.querySelector('button');
    btn.disabled = true;
    out.className = 'form-result';
    out.textContent = 'Booking…';
    try {
      const body = Object.fromEntries(new FormData(form));
      body.seats = Number(body.seats);
      const b = await api(`/api/events/${encodeURIComponent(slug)}/bookings`, { method: 'POST', body });
      out.className = 'form-result ok';
      out.textContent = `Booked! Your reference is ${b.reference} for ${b.seats} seat(s). Bring it and your college ID.`;
      form.querySelectorAll('input, select').forEach((i) => { i.disabled = true; });
      btn.hidden = true;
      // Update the seat count on this card without re-rendering (keeps the confirmation visible).
      const ev = events.find((x) => x.slug === slug);
      if (ev) {
        ev.booked += b.seats;
        ev.seats_left -= b.seats;
        const cardEl = form.closest('.event-card');
        cardEl.querySelector('.seats-bar span').style.width = `${Math.min(100, Math.round((ev.booked / ev.capacity) * 100))}%`;
        cardEl.querySelector('.seats-text').textContent = ev.seats_left > 0 ? `${ev.seats_left} of ${ev.capacity} seats left` : 'Sold out';
      }
    } catch (err) {
      out.className = 'form-result err';
      const details = err.data && err.data.error && err.data.error.details;
      out.textContent = `Error ${err.code}: ${err.message}${details ? ' ' + details.join('; ') + '.' : ''}`;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('booking-lookup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const out = form.querySelector('.form-result');
    const ref = form.reference.value.trim();
    if (!ref) return;
    try {
      const b = await api(`/api/bookings/${encodeURIComponent(ref)}`, { quiet: true });
      out.className = 'form-result';
      out.innerHTML = `<strong>${escapeHtml(b.reference)}</strong>: ${escapeHtml(b.event)}, ${escapeHtml(window.Events.formatDate(b.starts_at))}, ${escapeHtml(b.venue)} · ${b.seats} seat(s) · <strong>${escapeHtml(b.status)}</strong>`;
    } catch (err) {
      out.className = 'form-result err';
      out.textContent = `Error ${err.code}: ${err.message}`;
    }
  });

  refresh();
})();
