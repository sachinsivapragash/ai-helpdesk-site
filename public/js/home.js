(async function () {
  const { escapeHtml } = window.Site;
  const grid = document.getElementById('next-events');
  const strip = document.getElementById('weather-strip');
  const [data, forecast] = await Promise.all([window.Events.load().catch(() => null), window.Events.loadForecast()]);

  if (data) {
    document.getElementById('stat-events').textContent = data.count;
    document.getElementById('stat-seats').textContent = data.events.reduce((n, e) => n + Math.max(e.seats_left, 0), 0);
    document.getElementById('stat-free').textContent = data.events.filter((e) => e.price === 0).length;
    grid.innerHTML = data.events.slice(0, 3).map((e) => window.Events.card(e, forecast, { bookable: false })).join('')
      || '<p class="muted">No upcoming events yet.</p>';
  } else {
    grid.innerHTML = '<p class="notice warn">Could not load events right now.</p>';
  }

  if (forecast && forecast.days.length) {
    strip.innerHTML = forecast.days.slice(0, 7).map((d) => `
      <div class="weather-day">
        <strong>${new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</strong>
        <span>${escapeHtml(d.summary)}</span>
        <span>${d.maxTempC}°C${d.rainChance != null ? ` · ${d.rainChance}% rain` : ''}</span>
      </div>`).join('');
  } else {
    strip.innerHTML = `<p class="notice warn">Weather forecast is unavailable right now${forecast && forecast.reason ? ` (${escapeHtml(forecast.reason)})` : ''}. Events go ahead as planned unless we email you.</p>`;
  }
})();
