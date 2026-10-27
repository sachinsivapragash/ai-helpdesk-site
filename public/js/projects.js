(async function () {
  const { api, escapeHtml } = window.Site;
  const grid = document.getElementById('projects');
  const source = document.getElementById('projects-source');
  try {
    const data = await api('/api/projects');
    if (data.source === 'fallback') {
      source.textContent = `GitHub is unavailable right now (${data.reason}), so this is a saved offline list.`;
      source.classList.add('warn');
    } else {
      source.textContent = data.source === 'github-cache' ? 'Live from GitHub (cached for 10 minutes).' : 'Live from GitHub.';
    }
    source.hidden = false;
    grid.innerHTML = data.projects.length
      ? data.projects.map((p) => `
        <a class="card card-link" href="${escapeHtml(p.url)}" rel="noopener">
          <h3>${escapeHtml(p.name)}</h3>
          <p>${escapeHtml(p.description)}</p>
          <div class="meta"><span>${escapeHtml(p.language)}</span><span>★ ${Number(p.stars) || 0}</span></div>
        </a>`).join('')
      : '<p class="muted">No public repositories yet.</p>';
  } catch (err) {
    grid.innerHTML = `<p class="notice warn">Could not load projects (error ${escapeHtml(err.code)}).</p>`;
  }
})();
