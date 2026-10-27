(function () {
  const { api, escapeHtml } = window.Site;
  const form = document.getElementById('admin-login');
  const rows = document.getElementById('ticket-rows');
  const stats = document.getElementById('admin-stats');
  const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
  let token = '';
  try { token = sessionStorage.getItem('admin-token') || ''; } catch (e) { /* ignore */ }

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function load() {
    const [data, s] = await Promise.all([
      api('/api/admin/tickets', { headers: auth() }),
      api('/api/admin/stats', { headers: auth() }),
    ]);
    stats.textContent = `${data.count} tickets · ${s.chatMessages} chat messages logged · feedback 👍 ${s.feedback.up || 0} / 👎 ${s.feedback.down || 0}`;
    rows.innerHTML = data.tickets.map((t) => `
      <tr data-ref="${escapeHtml(t.reference)}">
        <td><code>${escapeHtml(t.reference)}</code></td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
        <td>${escapeHtml(t.source)}</td>
        <td><strong>${escapeHtml(t.subject)}</strong><br><span class="muted">${escapeHtml(t.message)}</span></td>
        <td>${escapeHtml(t.name || '')}<br>${escapeHtml(t.email || '')}</td>
        <td><select aria-label="Status">${STATUSES.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn btn-small btn-danger" type="button">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No tickets yet.</td></tr>';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    token = form.token.value.trim();
    try { sessionStorage.setItem('admin-token', token); } catch (err) { /* ignore */ }
    load().catch(() => {});
  });

  rows.addEventListener('change', async (e) => {
    if (e.target.tagName !== 'SELECT') return;
    const ref = e.target.closest('tr').dataset.ref;
    await api(`/api/admin/tickets/${ref}`, { method: 'PATCH', headers: auth(), body: { status: e.target.value } }).catch(() => {});
  });

  rows.addEventListener('click', async (e) => {
    if (!e.target.matches('.btn-danger')) return;
    const tr = e.target.closest('tr');
    if (!confirm(`Delete ticket ${tr.dataset.ref}?`)) return;
    await api(`/api/admin/tickets/${tr.dataset.ref}`, { method: 'DELETE', headers: auth() }).then(() => tr.remove()).catch(() => {});
  });

  if (token) { form.token.value = token; load().catch(() => {}); }
})();
