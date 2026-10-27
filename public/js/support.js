(function () {
  const { api, escapeHtml } = window.Site;
  const ticketForm = document.getElementById('ticket-form');
  const lookupForm = document.getElementById('lookup-form');

  ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = ticketForm.querySelector('.form-result');
    const btn = ticketForm.querySelector('button');
    const body = Object.fromEntries(new FormData(ticketForm));
    btn.disabled = true;
    out.className = 'form-result';
    out.textContent = 'Sending…';
    try {
      const t = await api('/api/tickets', { method: 'POST', body, quiet: true });
      out.className = 'form-result ok';
      out.textContent = `Thanks! Your ticket reference is ${t.reference}. Keep it to check the status later.`;
      ticketForm.reset();
    } catch (err) {
      out.className = 'form-result err';
      const details = err.data && err.data.error && err.data.error.details;
      out.textContent = `Error ${err.code}: ${err.message}${details ? ' ' + details.join('; ') + '.' : ''}`;
    } finally {
      btn.disabled = false;
    }
  });

  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = lookupForm.querySelector('.form-result');
    const ref = lookupForm.reference.value.trim();
    if (!ref) return;
    out.textContent = 'Checking…';
    try {
      const t = await api(`/api/tickets/${encodeURIComponent(ref)}`, { quiet: true });
      out.innerHTML = `<p><strong>${escapeHtml(t.reference)}</strong> — ${escapeHtml(t.subject)}</p>
        <p>Status: <strong>${escapeHtml(t.status.replace('_', ' '))}</strong><br>
        <span class="muted">Opened ${new Date(t.created_at).toLocaleString()} · last update ${new Date(t.updated_at).toLocaleString()}</span></p>`;
    } catch (err) {
      out.innerHTML = `<p class="form-result err">Error ${escapeHtml(err.code)}: ${escapeHtml(err.message)}</p>`;
    }
  });
})();
