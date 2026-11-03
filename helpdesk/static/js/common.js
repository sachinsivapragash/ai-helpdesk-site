// Shared helpers: mobile navigation, API fetch wrapper and the error banner.
(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
  document.querySelectorAll('.site-nav a').forEach((a) => {
    if (a.getAttribute('href') === location.pathname) a.setAttribute('aria-current', 'page');
  });

  const banner = document.getElementById('error-banner');
  let bannerCode = null;

  function showErrorBanner(code, message) {
    if (!banner) return;
    bannerCode = code;
    banner.querySelector('.error-banner-text').textContent = `Error ${code}: ${message}`;
    banner.hidden = false;
  }

  if (banner) {
    banner.querySelector('.error-banner-close').addEventListener('click', () => { banner.hidden = true; });
    banner.querySelector('[data-ask-error]').addEventListener('click', () => {
      window.Chat && window.Chat.ask(`I got error ${bannerCode}. What does it mean and what should I do?`);
    });
  }

  // fetch wrapper: parses JSON, shows the error banner on failure (unless quiet), rethrows.
  async function api(path, options = {}) {
    const { quiet, ...init } = options;
    if (init.body && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      if (!quiet) showErrorBanner('503', 'Could not reach the server. Check your connection.');
      throw Object.assign(new Error('Network error'), { code: '503' });
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const code = (data && data.error && data.error.code) || String(res.status);
      const message = (data && data.error && data.error.message) || res.statusText;
      if (!quiet) showErrorBanner(code, message);
      throw Object.assign(new Error(message), { code, status: res.status, data });
    }
    return data;
  }

  document.addEventListener('click', (e) => {
    const askBtn = e.target.closest('[data-ask]');
    if (askBtn && window.Chat) window.Chat.ask(askBtn.getAttribute('data-ask'));
    const openBtn = e.target.closest('[data-open-chat]');
    if (openBtn && window.Chat) window.Chat.open();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Site = { api, showErrorBanner, escapeHtml };
})();
