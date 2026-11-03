(function () {
  const { api, escapeHtml } = window.Site;
  const form = document.getElementById('admin-login');
  const rows = document.getElementById('ticket-rows');
  const bookingRows = document.getElementById('booking-rows');
  const stats = document.getElementById('admin-stats');
  const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
  let token = '';
  try { token = sessionStorage.getItem('admin-token') || ''; } catch (e) { /* ignore */ }

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function load() {
    const [data, s, b] = await Promise.all([
      api('/api/admin/tickets', { headers: auth() }),
      api('/api/admin/stats', { headers: auth() }),
      api('/api/admin/bookings', { headers: auth() }),
    ]);
    bookingRows.innerHTML = b.bookings.map((x) => `
      <tr data-ref="${escapeHtml(x.reference)}">
        <td><code>${escapeHtml(x.reference)}</code></td>
        <td>${escapeHtml(x.event)}</td>
        <td>${escapeHtml(x.name)}<br>${escapeHtml(x.email)}</td>
        <td>${x.seats}</td>
        <td>${new Date(x.created_at).toLocaleString()}</td>
        <td>${escapeHtml(x.status)}</td>
        <td>${x.status === 'confirmed' ? '<button class="btn btn-small btn-danger cancel-booking" type="button">Cancel</button>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No bookings yet.</td></tr>';
    stats.textContent = `${b.count} bookings · ${data.count} tickets · ${s.chatMessages} chat messages logged · feedback 👍 ${s.feedback.up || 0} / 👎 ${s.feedback.down || 0}`;
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

  bookingRows.addEventListener('click', async (e) => {
    if (!e.target.matches('.cancel-booking')) return;
    const ref = e.target.closest('tr').dataset.ref;
    if (!confirm(`Cancel booking ${ref} and release its seats?`)) return;
    await api(`/api/admin/bookings/${ref}/cancel`, { method: 'PATCH', headers: auth() }).then(load).catch(() => {});
  });

  if (token) { form.token.value = token; load().catch(() => {}); }
})();
