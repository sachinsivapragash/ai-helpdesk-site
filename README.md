# EventEase – Campus Event Booking with an AI Help Assistant

**Task title:** EventEase – Campus Event Booking Website with an AI FAQ & Error-Code Assistant

**Live site:** https://ai-helpdesk-site-2.onrender.com
**Health check:** https://ai-helpdesk-site-2.onrender.com/health

EventEase is a responsive **Django** website where students browse campus events (hackathons, workshops, talks, symposiums, clubs, cultural nights and sports) and book seats online. Every page has a chat widget whose AI assistant answers questions from the site's own data, explains error codes, and opens a support ticket when it cannot answer.

## Quick links for evaluation

| Requirement | Where to see it |
|---|---|
| 3+ pages, chat widget on every page | [Home](https://ai-helpdesk-site-2.onrender.com) · [Events](https://ai-helpdesk-site-2.onrender.com/events) · [About](https://ai-helpdesk-site-2.onrender.com/about) · [Support](https://ai-helpdesk-site-2.onrender.com/support) (chat button at the bottom right) |
| 10+ FAQs from SQL | [FAQ page](https://ai-helpdesk-site-2.onrender.com/faq) · [API](https://ai-helpdesk-site-2.onrender.com/api/faqs) |
| 8+ error codes, error banner | [Error codes page](https://ai-helpdesk-site-2.onrender.com/error-codes) (use the "Try them out" buttons) · [API](https://ai-helpdesk-site-2.onrender.com/api/error-codes) |
| Custom 404 / 500 pages | [Wrong address](https://ai-helpdesk-site-2.onrender.com/this-page-does-not-exist) · [Test server error](https://ai-helpdesk-site-2.onrender.com/demo/500) |
| AI assistant + ticket when unsure | Chat button on any page. Ask something off-topic to get a `TCK-` ticket, then check it on [Support](https://ai-helpdesk-site-2.onrender.com/support) |
| Health check + request logging | [Health page](https://ai-helpdesk-site-2.onrender.com/health) (live status of every service and the last 20 requests) · [JSON](https://ai-helpdesk-site-2.onrender.com/api/health) |
| Third-party API with time limit + fallback | Weather on the [home page](https://ai-helpdesk-site-2.onrender.com) and on event cards · [API](https://ai-helpdesk-site-2.onrender.com/api/weather) · code in `helpdesk/services/weather.py` |
| Secrets in environment variables | `eventease/settings.py` reads every key from `os.environ`; only `.env.example` is committed |

## Tech stack

- **Backend:** Python 3.13, Django 5.2 (LTS), served by gunicorn, static files by WhiteNoise
- **SQL:** PostgreSQL on Neon through the Django ORM and migrations (SQLite locally)
- **NoSQL:** MongoDB Atlas through PyMongo
- **AI:** Google Gemini API (free tier) or the Claude API
- **Third-party APIs:** Open-Meteo and MET Norway (weather), Brevo (email)
- **Frontend:** Django templates, CSS and vanilla JavaScript

## The idea

Campus events are usually announced on posters and WhatsApp groups. Students miss them, popular events overflow, and organisers can't tell how many people will turn up. EventEase puts every event in one place with live seat counts, instant booking references, and an assistant that handles common questions.

## Features

| Requirement | How it is met |
|---|---|
| Responsive site, 3+ pages, chat widget on every page | Home, Events, About, FAQ, Error codes, Support, Health and Organisers pages. Mobile-first CSS, checked at phone width. The widget (`helpdesk/static/js/chat.js`) is in the shared footer template, so it loads on every page, including 404 and 500 |
| 10+ FAQs in SQL, shown on the FAQ page | 12 event-booking FAQs in the `Faq` model (PostgreSQL table `helpdesk_faq`), served by `GET /api/faqs` and rendered on `/faq` with search |
| 8+ error codes | `ErrorCode` model: 400, 401, 403, 404, 429, 500, 503, plus two site-specific codes: **EVT-409** (event sold out or already booked) and **EVT-460** (chat message too long). The "Try them out" buttons on `/error-codes` trigger each one for real |
| Custom 404 and 500 pages with "Ask the assistant" | `helpdesk/templates/pages/404.html` and `500.html`, wired up as Django's `handler404` and `handler500`. Visit any wrong address, or `/demo/500` |
| Error banner | Any failed request shows a banner with an **Ask the assistant about this error** button |
| Assistant answers from site data, explains codes, creates a ticket when unsure | `helpdesk/services/assistant.py`. The AI (Google Gemini on the free tier, or Claude) receives only the FAQ, error-code and upcoming-event rows and must return `confident: false` when the answer isn't there. The server then creates a ticket in SQL and returns its reference. If the AI is unavailable, keyword matching takes over |
| Tickets in SQL; chat logs and feedback in MongoDB | `Ticket` model with full CRUD on the Organisers page. `chat_logs` and `feedback` (thumbs up/down) collections in MongoDB |
| Keys in environment variables | All secrets are read from environment variables in `eventease/settings.py`. `.env` is git-ignored and only `.env.example` is committed |
| Request logging and health check | Every request is logged with an ID, status and response time by `helpdesk/middleware.py`. `/api/health` returns JSON and `/health` shows it as a page, with the last 20 requests |
| Extra third-party API with a time limit and fallback | The Open-Meteo weather API supplies the forecast for each event day and the home-page weather strip. Each call has a 3-second `requests` timeout. If Open-Meteo is rate-limited or down, the free MET Norway API is tried next. If both fail, the last good forecast (up to 24 hours old) is shown, and with nothing saved the page shows "forecast unavailable" without breaking. Forecasts are cached for 3 hours |

Bookings are stored in SQL as well, and each booking or cancellation sends an email through the Brevo API (5-second time limit; if email fails, the booking still goes through and the student is told). Seats are reserved with one atomic `Event.objects.filter(booked__lte=F('capacity') - seats).update(booked=F('booked') + seats)` inside a transaction, so two people can't take the last seat. Organisers can cancel a booking, which releases its seats.

## Architecture

```
Browser (Django templates, CSS, vanilla JS chat widget)
   │  fetch JSON
   ▼
Django (gunicorn) ── eventease/settings.py, eventease/urls.py
   ├── middleware: security headers + CSP, request logging (stdout + recent log), 503 on database errors
   ├── helpdesk/api.py (REST API, rate limits → 429, admin token → 401/403)
   │     ├── PostgreSQL (Django ORM) ── Event, Booking, Faq, ErrorCode, Ticket
   │     ├── MongoDB (PyMongo) ── chat_logs, feedback (held in memory and retried if MongoDB is down)
   │     ├── Gemini / Claude ── assistant answers (timeout 15 s, then rule-based fallback)
   │     ├── Brevo ── booking confirmation / cancellation emails (timeout 5 s, best effort)
   │     └── Open-Meteo ─► MET Norway ─► saved forecast ─► fallback (3 s limit per call)
   └── helpdesk/views.py (HTML pages) + custom 404 / 500 handlers
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status of SQL, MongoDB, AI and weather (`200` ok or degraded, `503` if the database is down) |
| GET | `/api/events`, `/api/events/:slug` | Upcoming events with seats left |
| POST | `/api/events/:slug/bookings` | `{ name, email, seats }` → `201` with a `BK-` reference. Returns `409 EVT-409` if sold out or already booked |
| GET | `/api/bookings/:reference` | Booking status |
| GET | `/api/faqs` | All FAQs |
| GET | `/api/error-codes`, `/api/error-codes/:code` | Error-code reference |
| POST | `/api/chat` | `{ message, sessionId, page, history }` → `{ answer, source, engine, ticket, messageId }` |
| POST | `/api/feedback` | `{ messageId, rating: "up" \| "down" }` → `201` |
| POST | `/api/tickets` | Create a support ticket → `201` |
| GET | `/api/tickets/:reference` | Ticket status |
| GET | `/api/weather` | Campus forecast, or the fallback |
| GET | `/api/admin/tickets`, `/api/admin/bookings`, `/api/admin/stats` | Organiser views (admin) |
| PATCH | `/api/admin/tickets/:reference` | Update ticket status (admin) |
| DELETE | `/api/admin/tickets/:reference` | Delete a ticket (admin) → `204` |
| PATCH | `/api/admin/bookings/:reference/cancel` | Cancel a booking and release its seats (admin) |

Admin routes need `Authorization: Bearer <ADMIN_TOKEN>`. A missing token returns `401` and a wrong one returns `403`. Errors always look like `{ "error": { "status": 409, "code": "EVT-409", "message": "..." } }`.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # optional: set your name, email, API keys
python manage.py migrate        # creates the tables
python manage.py seed           # loads FAQs, error codes and events
python manage.py runserver      # http://127.0.0.1:8000  (set DJANGO_DEBUG=true for local static files)
python manage.py test           # 24 automated tests, including a 180-day simulation
```

Without `DATABASE_URL`, Django uses a local SQLite file. Without `MONGODB_URI`, chat logs are kept in memory. Without `GEMINI_API_KEY` (free from [Google AI Studio](https://aistudio.google.com/apikey)) or `ANTHROPIC_API_KEY`, the assistant runs in rule-based fallback mode. The `seed` command is safe to run on every start. Demo events are scheduled relative to the first start, and when an event has passed, its slot moves three weeks ahead and shows a different event of the same type (8 event types with 3 rotating events each, defined in `helpdesk/data/event_catalog.json`), so the site always has fresh upcoming events.

## Deployment

The site is hosted on Render as a Python web service (`render.yaml`: build `pip install -r requirements.txt && python manage.py collectstatic`, start `python manage.py migrate && python manage.py seed && gunicorn eventease.wsgi`). PostgreSQL runs on Neon and MongoDB on MongoDB Atlas, all on free plans. Every push to `main` on GitHub redeploys the site automatically. The free Render plan sleeps after 15 minutes idle. To prevent that, the app visits its own address every 10 minutes while it runs on Render (`helpdesk/services/keepawake.py`, a static file so the database stays asleep), and a scheduled GitHub Action pings it as a backup.

## Security

- No secrets in the repository: `.env` is git-ignored, and `render.yaml` marks secrets `sync: false`.
- Django's security middleware plus a strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, HTTPS redirect and HSTS on Render.
- Rate limits: 15 chat messages per minute and 20 bookings/tickets/feedback per 15 minutes per IP (`429`).
- All SQL goes through the Django ORM (parameterised queries). Django templates and the frontend escape all user text.
- The admin token is compared in constant time.
- The AI only sees FAQ, error-code and public event data, never bookings, tickets or personal data.

## Proposed improvement

**Waiting list with automatic seat offers.** When an event is sold out (EVT-409), let students join a waiting list stored in SQL. When someone cancels, offer the freed seats to the first person on the list by email, with a link that holds the seat for 2 hours. If they don't confirm in time, offer it to the next person. This would fill cancelled seats without organisers doing anything, and it reuses the existing booking, email and EVT-409 pieces.
