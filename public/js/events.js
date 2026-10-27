// Shared helpers for event cards and the weather forecast (used by the home and events pages).
(function () {
  const { api, escapeHtml } = window.Site;
  const TZ = 'Asia/Kolkata';

  function formatDate(iso) {
    const d = new Date(iso);
    const date = `${d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short' })}, ${d.toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })}`;
    const time = d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    return `${date}, ${time}`;
  }
  function dayKey(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  }

  function weatherFor(event, forecast) {
    const day = forecast && forecast.days.find((d) => d.date === dayKey(event.starts_at));
    if (!day) return '';
    const rain = day.rainChance != null ? ` · ${day.rainChance}% rain` : '';
    return `<p class="event-weather">Forecast: ${escapeHtml(day.summary)}, ${day.maxTempC}°C${rain}</p>`;
  }

  function card(e, forecast, { bookable = true } = {}) {
    const soldOut = e.seats_left <= 0;
    const pct = Math.min(100, Math.round((e.booked / e.capacity) * 100));
    return `
      <article class="card event-card" data-category="${escapeHtml(e.category)}" data-slug="${escapeHtml(e.slug)}">
        <div class="event-top">
          <span class="tag">${escapeHtml(e.category)}</span>
          <span class="price">${e.price > 0 ? `₹${e.price}` : 'Free'}</span>
        </div>
        <h3>${escapeHtml(e.title)}</h3>
        <p class="event-when">${escapeHtml(formatDate(e.starts_at))} · ${escapeHtml(e.venue)}</p>
        <p>${escapeHtml(e.description)}</p>
        ${weatherFor(e, forecast)}
        <div class="seats"><div class="seats-bar"><span style="width:${pct}%"></span></div>
          <span class="seats-text ${soldOut ? 'sold-out' : ''}">${soldOut ? 'Sold out' : `${e.seats_left} of ${e.capacity} seats left`}</span></div>
        ${bookable ? `
        <details class="book">
          <summary class="btn btn-small ${soldOut ? 'btn-outline' : ''}">${soldOut ? 'Try to book (sold out)' : 'Book seats'}</summary>
          <form class="form booking-form" novalidate>
            <label>Your name <input name="name" required maxlength="100" autocomplete="name"></label>
            <label>College email <input name="email" type="email" required autocomplete="email"></label>
            <label>Seats <select name="seats">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join('')}</select></label>
            <button class="btn" type="submit">Confirm booking</button>
            <p class="form-result" aria-live="polite"></p>
          </form>
        </details>` : '<a class="btn btn-small btn-outline" href="/events">View &amp; book</a>'}
      </article>`;
  }

  async function loadForecast() {
    try { return await api('/api/weather', { quiet: true }); } catch (err) { return null; }
  }

  window.Events = {
    formatDate,
    card,
    load: () => api('/api/events'),
    loadForecast,
  };
})();
