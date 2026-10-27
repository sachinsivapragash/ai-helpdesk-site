// AI assistant: answers only from the FAQ and error-code tables, explains error codes,
// and opens a support ticket when it cannot answer. Uses Claude when ANTHROPIC_API_KEY is
// set; falls back to keyword matching if the key is missing or the API call fails/times out.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const sql = require('../db/sql');
const mongo = require('../db/mongo');
const tickets = require('./tickets');

const MAX_MESSAGE_LENGTH = 500;
const STOPWORDS = new Set(('a an and are as at be by can do does for from how i if in is it me my of on or ' +
  'the this to was what when where which who why will with you your about there their have has').split(' '));

const client = config.anthropicKey
  ? new Anthropic({ apiKey: config.anthropicKey, timeout: config.aiTimeoutMs, maxRetries: 1 })
  : null;

let lastAiStatus = { ok: null, detail: client ? 'not called yet' : 'ANTHROPIC_API_KEY not set - fallback mode' };

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Reply shown to the visitor. Plain text, at most 120 words.' },
    source: { type: 'string', enum: ['faq', 'error_code', 'greeting', 'none'] },
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
    const pattern = c.site_specific ? `(SITE-)?${c.code.replace('SITE-', '')}` : c.code;
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

function explainCode(c) {
  return `Error ${c.code} – ${c.title}${c.site_specific ? '' : ` (HTTP ${c.http_status})`}: ${c.meaning} What to do: ${c.user_action}`;
}

function buildKnowledgeBase(faqs, codes) {
  const faqText = faqs.map((f) => `[FAQ ${f.id}] Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  const codeText = codes.map((c) =>
    `[ERROR ${c.code}] HTTP ${c.http_status} ${c.title}. Meaning: ${c.meaning} What to do: ${c.user_action}`
  ).join('\n');
  return `FAQS\n${faqText}\n\nERROR CODES\n${codeText}`;
}

function systemPrompt(knowledgeBase) {
  return `You are the help assistant on the personal website of ${config.owner.name} (${config.owner.role}).
Answer visitor questions using ONLY the knowledge base below. Do not use outside knowledge about ${config.owner.name}, and do not invent facts, links or contact details.

- If the question matches an FAQ, answer from it in your own words (source "faq").
- If the visitor mentions or asks about an error code, explain what it means and what to do, using the ERROR CODES section (source "error_code").
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

function answerWithRules(message, faqs, codes) {
  const matchedCodes = detectErrorCodes(message, codes);
  if (matchedCodes.length) {
    return { answer: matchedCodes.map(explainCode).join('\n\n'), source: 'error_code', confident: true };
  }
  if (/^\s*(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening))\b/i.test(message)) {
    return {
      answer: 'Hi! I can answer questions about this website and its owner, and explain error codes such as 404 or 500. What would you like to know?',
      source: 'greeting', confident: true,
    };
  }
  const [best] = rankFaqs(message, faqs);
  if (best && best.score >= 3) return { answer: best.faq.answer, source: 'faq', confident: true };
  return { answer: "I couldn't find an answer to that in my FAQ data.", source: 'none', confident: false };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
}

async function chat({ message, sessionId, page, history, email }) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new ChatError(400, '400', 'Message is required.');
  }
  message = message.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ChatError(413, 'SITE-460', `Message is ${message.length} characters; the limit is ${MAX_MESSAGE_LENGTH}.`);
  }

  const started = Date.now();
  const [faqs, codes] = await Promise.all([
    sql.query('SELECT id, question, answer, keywords FROM faqs ORDER BY sort_order'),
    sql.query('SELECT * FROM error_codes ORDER BY http_status, code'),
  ]);

  let result;
  let engine = 'rules';
  if (client) {
    try {
      result = await askClaude(message, cleanHistory(history), buildKnowledgeBase(faqs, codes));
      engine = result.model || config.claudeModel;
      lastAiStatus = { ok: true, detail: `answered in ${Date.now() - started} ms`, at: new Date() };
    } catch (err) {
      lastAiStatus = { ok: false, detail: `fallback used: ${err.message}`, at: new Date() };
      console.warn(`[assistant] Claude call failed, using rules: ${err.message}`);
    }
  }
  if (!result) result = answerWithRules(message, faqs, codes);

  let ticket = null;
  if (!result.confident) {
    ticket = await tickets.create({
      subject: `Assistant could not answer: ${message.slice(0, 80)}`,
      message,
      email,
      source: 'assistant',
      sessionId,
    });
    result.answer = `${result.answer} I've created support ticket ${ticket.reference} so ${config.owner.name} can follow up. You can check its status on the Support page.`;
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
  status: () => ({ configured: Boolean(client), model: config.claudeModel, ...lastAiStatus }),
  _test: { detectErrorCodes, rankFaqs, answerWithRules },
};
