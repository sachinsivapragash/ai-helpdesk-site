(function () {
  const { api, escapeHtml } = window.Site;
  const overall = document.getElementById('health-overall');
  const checksEl = document.getElementById('health-checks');
  const logEl = document.getElementById('request-log');

  const labels = {
    sql: 'SQL database (events, bookings, FAQs, tickets)',
    mongo: 'MongoDB (chat logs, feedback)',
    ai: 'AI assistant',
    weather: 'Weather API (Open-Meteo, third-party)',
  };

  function dot(ok) {
    return `<span class="status-dot ${ok === true ? 'status-ok' : ok === false ? 'status-down' : 'status-warn'}"></span>`;
  }

  function describe(name, c) {
    if (name === 'sql') return c.ok ? `${c.driver}, ${c.latencyMs} ms` : c.detail;
    if (name === 'mongo') return c.ok ? `connected, ${c.latencyMs} ms` : c.detail;
    if (name === 'ai') return `${c.configured ? `${c.provider}, model ${c.model}` : 'not configured'} — ${c.detail}`;
    return c.detail;
  }

  async function refresh() {
    let data;
    try {
      data = await api('/api/health', { quiet: true });
    } catch (err) {
      data = err.data; // 503 still carries the JSON body
    }
    if (!data) {
      overall.innerHTML = `${dot(false)} Server unreachable`;
      return;
    }
    const text = { ok: 'All systems operational', degraded: 'Running with fallbacks (degraded)', down: 'Database down' };
    overall.innerHTML = `${dot(data.status === 'ok' ? true : data.status === 'down' ? false : null)} ${text[data.status]}
      <span class="muted"> · up ${Math.floor(data.uptimeSeconds / 60)} min · ${escapeHtml(data.node)}</span>`;
    checksEl.innerHTML = Object.entries(data.checks).map(([name, c]) => `
      <div class="card">
        <h3>${dot(name === 'ai' ? (c.configured ? c.ok !== false : null) : c.ok)}${escapeHtml(name === 'ai' && c.configured
          ? `AI assistant (${c.provider === 'gemini' ? 'Google Gemini API' : 'Claude API'})` : labels[name] || name)}</h3>
        <p class="muted">${escapeHtml(describe(name, c) || '')}</p>
      </div>`).join('');

    try {
      const logs = await api('/api/logs/recent', { quiet: true });
      logEl.innerHTML = logs.requests.map((r) => `
        <tr><td>${new Date(r.time).toLocaleTimeString()}</td><td><code>${escapeHtml(r.id)}</code></td><td>${escapeHtml(r.method)}</td>
        <td>${escapeHtml(r.path)}</td><td>${r.status}</td><td>${r.ms}</td></tr>`).join('');
    } catch (err) { /* keep previous log */ }
  }

  refresh();
  setInterval(refresh, 15000);
})();
