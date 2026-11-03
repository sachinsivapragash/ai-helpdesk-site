(async function () {
  const { api, escapeHtml } = window.Site;
  const list = document.getElementById('faq-list');
  const search = document.getElementById('faq-search');
  let faqs = [];

  function render(filter) {
    const q = (filter || '').toLowerCase();
    const shown = faqs.filter((f) => !q || `${f.question} ${f.answer} ${f.category}`.toLowerCase().includes(q));
    list.innerHTML = shown.length
      ? shown.map((f) => `
        <details id="faq-${f.id}">
          <summary><span><span class="faq-category">${escapeHtml(f.category)}</span><br>${escapeHtml(f.question)}</span></summary>
          <div class="faq-answer"><p>${escapeHtml(f.answer)}</p></div>
        </details>`).join('')
      : '<p class="muted">No questions match your search. Try the assistant instead.</p>';
  }

  try {
    const data = await api('/api/faqs');
    faqs = data.faqs;
    render();
  } catch (err) {
    list.innerHTML = `<p class="notice warn">Could not load FAQs (error ${escapeHtml(err.code)}).</p>`;
  }
  search.addEventListener('input', () => render(search.value));
})();
