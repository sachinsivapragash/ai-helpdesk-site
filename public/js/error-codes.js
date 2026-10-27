(async function () {
  const { api, escapeHtml } = window.Site;
  const grid = document.getElementById('codes');
  try {
    const data = await api('/api/error-codes');
    grid.innerHTML = data.codes.map((c) => `
      <article class="card" id="code-${escapeHtml(c.code)}">
        <div class="code-head">
          <span class="code-badge">${escapeHtml(c.code)}</span>
          <h3>${escapeHtml(c.title)}</h3>
          <button class="btn btn-small btn-outline" type="button"
            data-ask="Explain error ${escapeHtml(c.code)}. What does it mean and what should I do?">Ask</button>
        </div>
        <p>${escapeHtml(c.meaning)}</p>
        <p><strong>What to do:</strong> ${escapeHtml(c.user_action)}</p>
        <p class="muted">${c.site_specific ? `Site-specific code (sent with HTTP ${c.http_status})` : `HTTP status ${c.http_status}`}</p>
      </article>`).join('');
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  } catch (err) {
    grid.innerHTML = `<p class="notice warn">Could not load error codes (error ${escapeHtml(err.code)}).</p>`;
  }

  // Demo buttons trigger real errors; Site.api shows the error banner.
  const demos = {
    400: () => api('/api/chat', { method: 'POST', body: { message: '' } }),
    401: () => api('/api/admin/tickets'),
    403: () => api('/api/admin/tickets', { headers: { Authorization: 'Bearer wrong-token' } }),
    'EVT-409': () => api('/api/events/resume-clinic/bookings', { method: 'POST', body: { name: 'Demo', email: 'demo@example.com', seats: 4 } }),
    'EVT-460': () => api('/api/chat', { method: 'POST', body: { message: 'x'.repeat(600) } }),
  };
  document.querySelectorAll('[data-demo]').forEach((b) => {
    b.addEventListener('click', () => {
      demos[b.getAttribute('data-demo')]().catch(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    });
  });
})();
