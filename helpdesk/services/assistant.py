"""AI assistant: answers only from the FAQ, error-code and event data, explains error codes, and
opens a support ticket when it cannot answer. Uses Google Gemini (GEMINI_API_KEY) or Claude
(ANTHROPIC_API_KEY); falls back to keyword matching if no key is set or the AI call fails or
times out."""
import json
import logging
import re
import time
from datetime import datetime, timezone

import requests
from django.conf import settings
from django.utils import timezone as dj_tz

from .. import catalog
from ..models import ErrorCode, Event, Faq, Ticket
from . import mongo
from .errors import short_reason

log = logging.getLogger(__name__)
MAX_MESSAGE_LENGTH = 500
STOPWORDS = set(('a an and are as at be by can do does for from how i if in is it me my of on or the this to was what '
                 'when where which who why will with you your about there their have has').split())
SOURCES = ['faq', 'error_code', 'event', 'greeting', 'none']
GREETING = re.compile(r"^\s*(hi|hello|hey|hii+|yo|thanks|thank you|thx|ok(ay)?|cool|bye|good (morning|afternoon|evening)"
                      r"|how are you|how r u|what'?s up|sup|what can you do|help)\b", re.I)


class ChatError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def _provider():
    if settings.GEMINI_API_KEY:
        return 'gemini'
    if settings.ANTHROPIC_API_KEY:
        return 'claude'
    return None


_status = {'ok': None, 'detail': 'not called yet', 'at': None}


def status():
    p = _provider()
    if not p:
        return {'configured': False, 'provider': 'none', 'model': None, 'ok': None,
                'detail': 'no AI key set (GEMINI_API_KEY or ANTHROPIC_API_KEY) - fallback mode', 'at': None}
    return {'configured': True, 'provider': p,
            'model': settings.GEMINI_MODEL if p == 'gemini' else settings.CLAUDE_MODEL, **_status}


# ---------- knowledge base ----------
def tokenize(text):
    return [w for w in re.sub(r'[^a-z0-9\s-]', ' ', text.lower()).split() if len(w) > 2 and w not in STOPWORDS]


def detect_error_codes(message, codes):
    upper = message.upper()
    found = []
    for c in codes:
        # Site codes such as EVT-409 also match when written as just 409.
        pattern = f"({c.code.split('-')[0]}-)?{c.code.split('-')[-1]}" if c.site_specific else c.code
        if re.search(rf'(^|[^0-9]){pattern}([^0-9]|$)', upper):
            found.append(c)
    return found


def rank_faqs(message, faqs):
    words = set(tokenize(message))
    ranked = []
    for f in faqs:
        score = 2 * sum(w in words for w in tokenize(f.keywords)) + sum(w in words for w in tokenize(f.question))
        if score:
            ranked.append((score, f))
    return sorted(ranked, key=lambda r: -r[0])


def rank_events(message, events):
    words = set(tokenize(message))
    ranked = []
    for e in events:
        score = sum(w in words for w in tokenize(f"{e.title} {e.category} {e.slug.replace('-', ' ')}"))
        if score:
            ranked.append((score, e))
    return sorted(ranked, key=lambda r: -r[0])


def format_date(dt):
    local = dj_tz.localtime(dt)
    return f"{local.strftime('%a')}, {local.day} {local.strftime('%b %Y')}, {local.strftime('%I:%M %p').lstrip('0').lower()}"


def describe_event(e):
    seats = f'{e.seats_left} of {e.capacity} seats left' if e.seats_left > 0 else 'sold out'
    price = f'Ticket: Rs {e.price}, paid at the venue.' if e.price > 0 else 'Entry is free.'
    return (f'{e.title} ({e.category}) is on {format_date(e.starts_at)} at {e.venue}. {price} '
            f'{seats[0].upper()}{seats[1:]}. {e.description}')


def explain_code(c):
    http = '' if c.site_specific else f' (HTTP {c.http_status})'
    return f'Error {c.code} – {c.title}{http}: {c.meaning} What to do: {c.user_action}'


def knowledge_base(faqs, codes, events):
    faq_text = '\n\n'.join(f'[FAQ {f.id}] Q: {f.question}\nA: {f.answer}' for f in faqs)
    code_text = '\n'.join(f'[ERROR {c.code}] HTTP {c.http_status} {c.title}. Meaning: {c.meaning} What to do: {c.user_action}'
                          for c in codes)
    event_text = '\n'.join(f'[EVENT {e.slug}] {describe_event(e)} Book on the Events page.' for e in events) or 'No upcoming events.'
    return (f'FAQS\n{faq_text}\n\nERROR CODES\n{code_text}\n\n'
            f"UPCOMING EVENTS (times in {settings.SITE['timezone']})\n{event_text}")


def system_prompt(kb):
    s = settings.SITE
    return f"""You are the help assistant on {s['name']}, a campus event booking website for students at {s['campus']}.
Answer visitor questions using ONLY the knowledge base below. Do not invent events, dates, prices, policies, links or contact details.

- If the question matches an FAQ, answer from it in your own words (source "faq").
- If the visitor mentions or asks about an error code, explain what it means and what to do, using the ERROR CODES section (source "error_code").
- Questions about specific events (dates, venues, prices, seats left) are answered from UPCOMING EVENTS (source "event"). You cannot make bookings yourself; tell them to use the Events page.
- Greetings and thanks get a short friendly reply that says what you can help with (source "greeting", confident true).
- If the knowledge base does not contain the answer, say so briefly and honestly, set confident to false and source "none". The website will then open a support ticket for the visitor, so do not promise anything else.

Keep answers under 120 words, plain text, no markdown headings.

KNOWLEDGE BASE
{kb}"""


# ---------- AI providers ----------
class AiError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def _check(parsed):
    if not isinstance(parsed.get('answer'), str) or not isinstance(parsed.get('confident'), bool):
        raise AiError('AI answer had the wrong shape')
    if parsed.get('source') not in SOURCES:
        parsed['source'] = 'none' if not parsed['confident'] else 'faq'
    return parsed


def _ask_gemini_model(model, message, history, kb):
    contents = [{'role': 'model' if m['role'] == 'assistant' else 'user', 'parts': [{'text': m['content']}]}
                for m in [*history, {'role': 'user', 'content': message}]]
    res = requests.post(
        f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        headers={'x-goog-api-key': settings.GEMINI_API_KEY, 'Content-Type': 'application/json'},
        timeout=settings.AI_TIMEOUT,
        json={
            'systemInstruction': {'parts': [{'text': system_prompt(kb)}]},
            'contents': contents,
            'generationConfig': {
                'temperature': 0.2,
                'responseMimeType': 'application/json',
                'responseSchema': {
                    'type': 'OBJECT',
                    'properties': {'answer': {'type': 'STRING'}, 'source': {'type': 'STRING', 'enum': SOURCES},
                                   'confident': {'type': 'BOOLEAN'}},
                    'required': ['answer', 'source', 'confident'],
                },
            },
        },
    )
    try:
        data = res.json()
    except ValueError:
        data = {}
    if not res.ok:
        raise AiError(f"Gemini {res.status_code}: {(data.get('error') or {}).get('message', res.reason)}", res.status_code)
    candidate = (data.get('candidates') or [{}])[0]
    text = ''.join(p.get('text', '') for p in (candidate.get('content') or {}).get('parts', []))
    if not text:
        raise AiError(f"Gemini returned no answer ({candidate.get('finishReason', 'unknown reason')})")
    return {**_check(json.loads(text)), 'model': model}


def ask_gemini(message, history, kb):
    try:
        return _ask_gemini_model(settings.GEMINI_MODEL, message, history, kb)
    except AiError as err:
        # The main model is overloaded or rate-limited: try the backup model once.
        if err.status not in (429, 503) or not settings.GEMINI_BACKUP_MODEL:
            raise
        log.warning('[assistant] %s unavailable (%s), trying %s', settings.GEMINI_MODEL, err.status, settings.GEMINI_BACKUP_MODEL)
        return _ask_gemini_model(settings.GEMINI_BACKUP_MODEL, message, history, kb)


def ask_claude(message, history, kb):
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=settings.AI_TIMEOUT, max_retries=1)
    response = client.beta.messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=2000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',
        output_config={'effort': 'low', 'format': {'type': 'json_schema', 'schema': {
            'type': 'object',
            'properties': {'answer': {'type': 'string'}, 'source': {'type': 'string', 'enum': SOURCES},
                           'confident': {'type': 'boolean'}},
            'required': ['answer', 'source', 'confident'], 'additionalProperties': False}}},
        system=system_prompt(kb),
        messages=[*history, {'role': 'user', 'content': message}],
    )
    if response.stop_reason == 'refusal':
        raise AiError('model declined the request')
    text = ''.join(b.text for b in response.content if b.type == 'text')
    return {**_check(json.loads(text)), 'model': response.model}


# ---------- rule-based fallback ----------
def answer_with_rules(message, faqs, codes, events=()):
    matched = detect_error_codes(message, codes)
    if matched:
        return {'answer': '\n\n'.join(explain_code(c) for c in matched), 'source': 'error_code', 'confident': True}
    if GREETING.search(message):
        return {'answer': f"Hi! I'm the {settings.SITE['name']} assistant. I can tell you about upcoming events, explain how "
                          'booking works, and explain error codes such as 404 or EVT-409. What would you like to know?',
                'source': 'greeting', 'confident': True}
    faq_ranked = rank_faqs(message, faqs)
    best = faq_ranked[0] if faq_ranked else None
    ev_ranked = rank_events(message, events)
    if ev_ranked and ev_ranked[0][0] >= 1 and (not best or ev_ranked[0][0] * 3 >= best[0]):
        return {'answer': describe_event(ev_ranked[0][1]), 'source': 'event', 'confident': True}
    if re.search(r'\b(events?|happening|upcoming|this week)\b', message, re.I) and events and (not best or best[0] < 3):
        listing = '\n'.join(f'• {e.title} – {format_date(e.starts_at)}' for e in list(events)[:5])
        return {'answer': f'Upcoming events:\n{listing}\nSee the Events page for details and booking.', 'source': 'event', 'confident': True}
    if best and best[0] >= 3:
        return {'answer': best[1].answer, 'source': 'faq', 'confident': True}
    return {'answer': "I couldn't find an answer to that in the EventEase help data.", 'source': 'none', 'confident': False}


def clean_history(history):
    if not isinstance(history, list):
        return []
    cleaned = [{'role': m['role'], 'content': m['content'][:1000]} for m in history
               if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), str)]
    return cleaned[-6:]


def chat(message, session_id=None, page=None, history=None, email=None):
    global _status
    if message is not None and not isinstance(message, str):
        raise ChatError(400, '400', 'Message must be text.')
    if not message or not message.strip():
        raise ChatError(400, '400', 'Message is required.')
    message = message.strip()
    if len(message) > MAX_MESSAGE_LENGTH:
        raise ChatError(413, 'EVT-460', f'Message is {len(message)} characters; the limit is {MAX_MESSAGE_LENGTH}.')

    started = time.monotonic()
    faqs = list(Faq.objects.all())
    codes = list(ErrorCode.objects.all())
    events = upcoming_events()

    result, engine = None, 'rules'
    provider = _provider()
    if provider:
        try:
            ask = ask_gemini if provider == 'gemini' else ask_claude
            result = ask(message, clean_history(history), knowledge_base(faqs, codes, events))
            engine = result.get('model') or provider
            _status = {'ok': True, 'detail': f'answered in {round((time.monotonic() - started) * 1000)} ms',
                       'at': datetime.now(timezone.utc).isoformat()}
        except Exception as err:  # noqa: BLE001 - any AI failure means "answer with rules"
            reason = short_reason(err, settings.AI_TIMEOUT)
            _status = {'ok': False, 'detail': f'fallback used: {reason}', 'at': datetime.now(timezone.utc).isoformat()}
            log.warning('[assistant] %s call failed, using rules: %s', provider, reason)
            result = None
    if not result:
        result = answer_with_rules(message, faqs, codes, events)

    ticket = None
    if not result['confident']:
        ticket = Ticket.objects.create(subject=f'Assistant could not answer: {message[:80]}', message=message,
                                       email=email, source='assistant', session_id=session_id)
        result['answer'] = (f"{result['answer']} I've created support ticket {ticket.reference} so the "
                            f"{settings.SITE['name']} team can follow up. You can check its status on the Support page.")

    message_id = mongo.insert('chat_logs', {
        'sessionId': session_id, 'page': page, 'question': message, 'answer': result['answer'],
        'source': result['source'], 'confident': result['confident'], 'engine': engine,
        'ticketReference': ticket.reference if ticket else None,
        'latencyMs': round((time.monotonic() - started) * 1000),
    })
    return {'messageId': message_id, 'answer': result['answer'], 'source': result['source'],
            'engine': 'fallback' if engine == 'rules' else 'ai', 'ticket': ticket.reference if ticket else None}


# ---------- events (shared with the API) ----------
_last_roll = 0.0


def upcoming_events():
    """Upcoming events, rolling finished ones forward at most once an hour."""
    global _last_roll
    if time.time() - _last_roll > 3600:
        _last_roll = time.time()
        try:
            catalog.roll_forward_past_events()
        except Exception as err:  # noqa: BLE001
            log.error('[events] roll forward failed: %s', err)
    return list(Event.objects.filter(starts_at__gt=dj_tz.now() - catalog.ENDED_AFTER))
