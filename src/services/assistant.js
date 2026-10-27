// AI assistant: answers only from the FAQ and error-code tables, explains error codes,
// and opens a support ticket when it cannot answer. Uses Google Gemini (GEMINI_API_KEY) or
// Claude (ANTHROPIC_API_KEY); falls back to keyword matching if no key is set or the AI call
// fails or times out.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const sql = require('../db/sql');
const mongo = require('../db/mongo');
const tickets = require('./tickets');
const eventsService = require('./events');

const MAX_MESSAGE_LENGTH = 500;
const STOPWORDS = new Set(('a an and are as at be by can do does for from how i if in is it me my of on or ' +
  'the this to was what when where which who why will with you your about there their have has').split(' '));

const provider = config.geminiKey ? 'gemini' : config.anthropicKey ? 'claude' : null;
const providerModel = provider === 'gemini' ? config.geminiModel : config.claudeModel;
const client = provider === 'claude'
  ? new Anthropic({ apiKey: config.anthropicKey, timeout: config.aiTimeoutMs, maxRetries: 1 })
  : null;

let lastAiStatus = { ok: null, detail: provider ? 'not called yet' : 'no AI key set (GEMINI_API_KEY or ANTHROPIC_API_KEY) - fallback mode' };

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Reply shown to the visitor. Plain text, at most 120 words.' },
    source: { type: 'string', enum: ['faq', 'error_code', 'event', 'greeting', 'none'] },
    confident: { type: 'boolean', description: 'False when the knowledge base does not contain the answer.' },
  },
  required: ['answer', 'source', 'confident'],
  additionalProperties: false,
};

class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function detectErrorCodes(message, codes) {
  const upper = message.toUpperCase();
  return codes.filter((c) => {
    // Site codes such as EVT-409 also match when written as just 409.
    const pattern = c.site_specific ? `(${c.code.split('-')[0]}-)?${c.code.split('-').pop()}` : c.code;
    return new RegExp(`(^|[^0-9])${pattern}([^0-9]|$)`).test(upper);
  });
}

function rankFaqs(message, faqs) {
  const words = new Set(tokenize(message));
  return faqs
    .map((f) => {
      const keywordHits = tokenize(f.keywords).filter((w) => words.has(w)).length;
      const questionHits = tokenize(f.question).filter((w) => words.has(w)).length;
      return { faq: f, score: keywordHits * 2 + questionHits };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function rankEvents(message, events) {
  const words = new Set(tokenize(message));
  return events
    .map((e) => ({ event: e, score: tokenize(`${e.title} ${e.category} ${e.slug.replace(/-/g, ' ')}`).filter((w) => words.has(w)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', {
    timeZone: config.site.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function describeEvent(e) {
  const seats = e.seats_left > 0 ? `${e.seats_left} of ${e.capacity} seats left` : 'sold out';
  return `${e.title} (${e.category}) is on ${formatDate(e.starts_at)} at ${e.venue}. ` +
    `${e.price > 0 ? `Ticket: Rs ${e.price}, paid at the venue.` : 'Entry is free.'} ${seats[0].toUpperCase()}${seats.slice(1)}. ${e.description}`;
}

function explainCode(c) {
  return `Error ${c.code} – ${c.title}${c.site_specific ? '' : ` (HTTP ${c.http_status})`}: ${c.meaning} What to do: ${c.user_action}`;
}

function buildKnowledgeBase(faqs, codes, events) {
  const faqText = faqs.map((f) => `[FAQ ${f.id}] Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  const codeText = codes.map((c) =>
    `[ERROR ${c.code}] HTTP ${c.http_status} ${c.title}. Meaning: ${c.meaning} What to do: ${c.user_action}`
  ).join('\n');
  const eventText = events.map((e) => `[EVENT ${e.slug}] ${describeEvent(e)} Book on the Events page.`).join('\n');
  return `FAQS\n${faqText}\n\nERROR CODES\n${codeText}\n\nUPCOMING EVENTS (times in ${config.site.timezone})\n${eventText || 'No upcoming events.'}`;
}

function systemPrompt(knowledgeBase) {
  return `You are the help assistant on ${config.site.name}, a campus event booking website for students at ${config.site.campus}.
Answer visitor questions using ONLY the knowledge base below. Do not invent events, dates, prices, policies, links or contact details.

- If the question matches an FAQ, answer from it in your own words (source "faq").
- If the visitor mentions or asks about an error code, explain what it means and what to do, using the ERROR CODES section (source "error_code").
- Questions about specific events (dates, venues, prices, seats left) are answered from UPCOMING EVENTS (source "event"). You cannot make bookings yourself; tell them to use the Events page.
- Greetings and thanks get a short friendly reply that says what you can help with (source "greeting", confident true).
- If the knowledge base does not contain the answer, say so briefly and honestly, set confident to false and source "none". The website will then open a support ticket for the visitor, so do not promise anything else.

Keep answers under 120 words, plain text, no markdown headings.

KNOWLEDGE BASE
${knowledgeBase}`;
}

async function askClaude(message, history, knowledgeBase) {
  const response = await client.beta.messages.create({
    model: config.claudeModel,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    system: systemPrompt(knowledgeBase),
    messages: [...history, { role: 'user', content: message }],
  });
  if (response.stop_reason === 'refusal') throw new Error('model declined the request');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  return { ...parsed, model: response.model };
}

// Google Gemini REST API with a JSON response schema (free tier available).
async function askGemini(message, history, knowledgeBase) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      signal: AbortSignal.timeout(config.aiTimeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(knowledgeBase) }] },
        contents: [...history, { role: 'user', content: message }].map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              answer: { type: 'STRING' },
              source: { type: 'STRING', enum: RESPONSE_SCHEMA.properties.source.enum },
              confident: { type: 'BOOLEAN' },
            },
            required: ['answer', 'source', 'confident'],
          },
        },
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(data.error && data.error.message) || res.statusText}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`Gemini returned no answer (${data.candidates?.[0]?.finishReason || 'unknown reason'})`);
  const parsed = JSON.parse(text);
  if (typeof parsed.answer !== 'string' || typeof parsed.confident !== 'boolean') throw new Error('Gemini answer had the wrong shape');
  return { ...parsed, model: config.geminiModel };
}

function answerWithRules(message, faqs, codes, events = []) {
  const matchedCodes = detectErrorCodes(message, codes);
  if (matchedCodes.length) {
    return { answer: matchedCodes.map(explainCode).join('\n\n'), source: 'error_code', confident: true };
  }
  if (/^\s*(hi|hello|hey|hii+|yo|thanks|thank you|thx|ok(ay)?|cool|bye|good (morning|afternoon|evening)|how are you|how r u|what'?s up|sup|what can you do|help)\b/i.test(message)) {
    return {
      answer: `Hi! I'm the ${config.site.name} assistant. I can tell you about upcoming events, explain how booking works, and explain error codes such as 404 or EVT-409. What would you like to know?`,
      source: 'greeting', confident: true,
    };
  }
  const [best] = rankFaqs(message, faqs);
  const [bestEvent] = rankEvents(message, events);
  if (bestEvent && bestEvent.score >= 1 && (!best || bestEvent.score * 3 >= best.score)) {
    return { answer: describeEvent(bestEvent.event), source: 'event', confident: true };
  }
  if (/\b(events?|happening|upcoming|this week)\b/i.test(message) && events.length && (!best || best.score < 3)) {
    const list = events.slice(0, 5).map((e) => `• ${e.title} – ${formatDate(e.starts_at)}`).join('\n');
    return { answer: `Upcoming events:\n${list}\nSee the Events page for details and booking.`, source: 'event', confident: true };
  }
  if (best && best.score >= 3) return { answer: best.faq.answer, source: 'faq', confident: true };
  return { answer: "I couldn't find an answer to that in the EventEase help data.", source: 'none', confident: false };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
}

async function chat({ message, sessionId, page, history, email }) {
  if (message !== undefined && message !== null && typeof message !== 'string') {
    throw new ChatError(400, '400', 'Message must be text.');
  }
  if (!message || !message.trim()) {
    throw new ChatError(400, '400', 'Message is required.');
  }
  message = message.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ChatError(413, 'EVT-460', `Message is ${message.length} characters; the limit is ${MAX_MESSAGE_LENGTH}.`);
  }

  const started = Date.now();
  const [faqs, codes, events] = await Promise.all([
    sql.query('SELECT id, question, answer, keywords FROM faqs ORDER BY sort_order'),
    sql.query('SELECT * FROM error_codes ORDER BY http_status, code'),
    eventsService.list(),
  ]);

  let result;
  let engine = 'rules';
  if (provider) {
    try {
      const ask = provider === 'gemini' ? askGemini : askClaude;
      result = await ask(message, cleanHistory(history), buildKnowledgeBase(faqs, codes, events));
      engine = result.model || config.claudeModel;
      lastAiStatus = { ok: true, detail: `answered in ${Date.now() - started} ms`, at: new Date() };
    } catch (err) {
      lastAiStatus = { ok: false, detail: `fallback used: ${err.message}`, at: new Date() };
      console.warn(`[assistant] ${provider} call failed, using rules: ${err.message}`);
    }
  }
  if (!result) result = answerWithRules(message, faqs, codes, events);

  let ticket = null;
  if (!result.confident) {
    ticket = await tickets.create({
      subject: `Assistant could not answer: ${message.slice(0, 80)}`,
      message,
      email,
      source: 'assistant',
      sessionId,
    });
    result.answer = `${result.answer} I've created support ticket ${ticket.reference} so the ${config.site.name} team can follow up. You can check its status on the Support page.`;
  }

  const messageId = await mongo.insert('chat_logs', {
    sessionId, page, question: message, answer: result.answer, source: result.source,
    confident: result.confident, engine, ticketReference: ticket ? ticket.reference : null,
    latencyMs: Date.now() - started,
  });

  return {
    messageId,
    answer: result.answer,
    source: result.source,
    engine: engine === 'rules' ? 'fallback' : 'ai',
    ticket: ticket ? ticket.reference : null,
  };
}

module.exports = {
  chat, ChatError, MAX_MESSAGE_LENGTH,
  status: () => ({ configured: Boolean(provider), provider: provider || 'none', model: provider ? providerModel : null, ...lastAiStatus }),
  _test: { detectErrorCodes, rankFaqs, answerWithRules },
};
