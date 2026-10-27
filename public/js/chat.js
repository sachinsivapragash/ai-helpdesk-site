// Chat widget, injected on every page. Talks to POST /api/chat and POST /api/feedback.
(function () {
  const MAX = 500;
  const STORE_KEY = 'helpdesk-chat';
  const { api } = window.Site;

  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  const state = load();
  state.sessionId = state.sessionId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  state.history = state.history || [];
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ sessionId: state.sessionId, history: state.history.slice(-20) })); } catch (e) { /* ignore */ }
  }

  const launcher = document.createElement('button');
  launcher.className = 'chat-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-controls', 'chat-panel');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = '<span aria-hidden="true">💬</span> Ask the assistant';

  const panel = document.createElement('section');
  panel.className = 'chat-panel';
  panel.id = 'chat-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'AI assistant chat');
  panel.innerHTML = `
    <div class="chat-header">
      <div><strong>AI assistant</strong><small>Answers from the FAQ &amp; error codes</small></div>
      <button class="chat-close" type="button" aria-label="Close chat">&times;</button>
    </div>
    <div class="chat-messages" aria-live="polite"></div>
    <div class="chat-suggestions">
      <button type="button">What is error 404?</button>
      <button type="button">What skills do you have?</button>
      <button type="button">How can I contact you?</button>
    </div>
    <form class="chat-form">
      <label class="sr-only" for="chat-input">Your question</label>
      <textarea id="chat-input" rows="2" placeholder="Type your question…"></textarea>
      <button class="btn" type="submit">Send</button>
    </form>
    <div class="chat-counter">0 / ${MAX}</div>`;

  document.body.append(launcher, panel);

  const messagesEl = panel.querySelector('.chat-messages');
  const form = panel.querySelector('.chat-form');
  const input = panel.querySelector('textarea');
  const counter = panel.querySelector('.chat-counter');
  const sendBtn = form.querySelector('button');

  function addMessage(role, text, meta) {
    const el = document.createElement('div');
    el.className = `msg msg-${role}`;
    el.textContent = text;
    if (meta) el.appendChild(meta);
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function feedbackControls(reply) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const label = document.createElement('span');
    label.textContent = reply.engine === 'ai' ? 'AI answer' : 'Answer from FAQ data';
    if (reply.ticket) label.textContent += ` · ticket ${reply.ticket}`;
    meta.appendChild(label);
    ['up', 'down'].forEach((rating) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = rating === 'up' ? '👍' : '👎';
      b.setAttribute('aria-label', rating === 'up' ? 'Helpful' : 'Not helpful');
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', async () => {
        meta.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        b.setAttribute('aria-pressed', 'true');
        try {
          await api('/api/feedback', { method: 'POST', body: { messageId: reply.messageId, rating, sessionId: state.sessionId }, quiet: true });
          label.textContent = 'Thanks for your feedback!';
        } catch (err) {
          label.textContent = `Feedback not saved (${err.code})`;
        }
      });
      meta.appendChild(b);
    });
    return meta;
  }

  function greet() {
    if (messagesEl.childElementCount) return;
    addMessage('bot', "Hi! I can answer questions about this website and explain error codes like 404 or 500. If I don't know, I'll open a support ticket for you.");
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    greet();
    input.focus();
  }
  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  async function send(text) {
    text = text.trim();
    if (!text || sendBtn.disabled) return;
    addMessage('user', text);
    input.value = '';
    updateCounter();
    sendBtn.disabled = true;
    const typing = addMessage('bot', 'Thinking…');
    typing.classList.add('typing');
    try {
      const reply = await api('/api/chat', {
        method: 'POST',
        quiet: true,
        body: { message: text, sessionId: state.sessionId, page: location.pathname, history: state.history.slice(-6) },
      });
      typing.remove();
      addMessage('bot', reply.answer, feedbackControls(reply));
      state.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply.answer });
      save();
    } catch (err) {
      typing.remove();
      const el = addMessage('error', `Error ${err.code}: ${err.message}`);
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const explain = document.createElement('button');
      explain.type = 'button';
      explain.textContent = 'What does this error mean?';
      explain.addEventListener('click', () => {
        window.location.href = `/error-codes#code-${encodeURIComponent(err.code)}`;
      });
      meta.appendChild(explain);
      el.appendChild(meta);
    } finally {
      sendBtn.disabled = false;
    }
  }

  function updateCounter() {
    counter.textContent = `${input.value.length} / ${MAX}`;
    counter.classList.toggle('over', input.value.length > MAX);
  }

  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('.chat-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  panel.querySelectorAll('.chat-suggestions button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
  input.addEventListener('input', updateCounter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

  window.Chat = {
    open,
    ask(question) { open(); send(question); },
    sessionId: state.sessionId,
  };
})();
