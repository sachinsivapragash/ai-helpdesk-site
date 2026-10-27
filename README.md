# EventEase – Campus Event Booking with an AI Help Assistant

**Task title:** EventEase – Campus Event Booking Website with an AI FAQ & Error-Code Assistant

**Live site:** https://ai-helpdesk-site.onrender.com
**Health check:** https://ai-helpdesk-site.onrender.com/health

EventEase is a responsive website where students browse campus events (hackathons, workshops, talks, cultural nights and sports) and book seats online. Every page has a chat widget whose AI assistant answers questions from the site's own data, explains error codes, and opens a support ticket when it cannot answer.

## The idea

Campus events are usually announced on posters and WhatsApp groups. Students miss them, popular events overflow, and organisers can't tell how many people will turn up. EventEase puts every event in one place with live seat counts, instant booking references, and an assistant that handles common questions.

## Features

| Requirement | How it is met |
|---|---|
| Responsive site, 3+ pages, chat widget on every page | Home, Events, About, FAQ, Error codes, Support, Health and Organisers pages. Mobile-first CSS, checked at phone width. The widget (`public/js/chat.js`) is in the shared footer, so it loads on every page, including 404 and 500 |
| 10+ FAQs in SQL, shown on the FAQ page | 12 event-booking FAQs in the PostgreSQL `faqs` table, served by `GET /api/faqs` and rendered on `/faq` with search |
| 8+ error codes | `error_codes` table: 400, 401, 403, 404, 429, 500, 503, plus two site-specific codes: **EVT-409** (event sold out or already booked) and **EVT-460** (chat message too long). The "Try them out" buttons on `/error-codes` trigger each one for real |
| Custom 404 and 500 pages with "Ask the assistant" | `views/pages/404.html` and `500.html`. Visit any wrong address, or `/demo/500` |
| Error banner | Any failed request shows a banner with an **Ask the assistant about this error** button |
| Assistant answers from site data, explains codes, creates a ticket when unsure | `src/services/assistant.js`. The AI (Google Gemini on the free tier, or Claude) receives only the FAQ, error-code and upcoming-event rows and must return `confident: false` when the answer isn't there. The server then creates a ticket in SQL and returns its reference. If the AI is unavailable, keyword matching takes over |
| Tickets in SQL; chat logs and feedback in MongoDB | `tickets` table with full CRUD on the Organisers page. `chat_logs` and `feedback` (thumbs up/down) collections in MongoDB |
| Keys in environment variables | All secrets are read from `process.env` (`src/config.js`). `.env` is git-ignored and only `.env.example` is committed |
| Request logging and health check | Every request is logged with an ID, status and response time. `/api/health` returns JSON and `/health` shows it as a page, with the last 20 requests |
| Extra third-party API with a time limit and fallback | The Open-Meteo weather API supplies the forecast for each event day and the home-page weather strip. Each call has a 3-second `AbortSignal.timeout`. If Open-Meteo is rate-limited or down, the free MET Norway API is tried next. If both fail, the last good forecast (up to 24 hours old) is shown, and with nothing saved the page shows "forecast unavailable" without breaking. Forecasts are cached for 3 hours |

Bookings are stored in SQL as well. Seats are reserved with one atomic `UPDATE ... WHERE booked + seats <= capacity`, so two people can't take the last seat. Organisers can cancel a booking, which releases its seats.

## Architecture

```
Browser (HTML/CSS/vanilla JS, chat widget)
   │  fetch JSON
   ▼
Express server (server.js)
   ├── helmet security headers, JSON body limit, rate limits (429)
   ├── request logger ──► stdout + in-memory recent log
   ├── /api routes (src/routes/api.js)
   │     ├── PostgreSQL ── events, bookings, faqs, error_codes, tickets
   │     ├── MongoDB ───── chat_logs, feedback (held in memory and retried if MongoDB is down)
   │     ├── Gemini / Claude ── assistant answers (timeout 15 s, then rule-based fallback)
   │     └── Open-Meteo ─► MET Norway ─► saved forecast ─► fallback (3 s limit per call)
   └── HTML pages (views/) + custom 404 / 500
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
npm install
cp .env.example .env     # optional: set your name, email, API keys
npm run dev              # http://localhost:3000
npm test                 # 19 automated tests
```

Without `DATABASE_URL`, the app uses an embedded PostgreSQL ([PGlite](https://pglite.dev)) in `./data`. Without `MONGODB_URI`, chat logs are kept in memory. Without `GEMINI_API_KEY` (free from [Google AI Studio](https://aistudio.google.com/apikey)) or `ANTHROPIC_API_KEY`, the assistant runs in rule-based fallback mode. Tables are created and seeded on start. Demo events are scheduled relative to the first start, and events that have passed move forward three weeks, so the site always has upcoming events.

## Deployment

The site is hosted on Render using `render.yaml`. PostgreSQL runs on Neon and MongoDB on MongoDB Atlas, all on free plans. Every push to `main` on GitHub redeploys the site automatically. The free Render plan sleeps after 15 minutes idle, so the first request can take about 50 seconds.

## Security

- No secrets in the repository: `.env` is git-ignored, and `render.yaml` marks secrets `sync: false`.
- Helmet sets a strict Content-Security-Policy (no inline scripts) along with other security headers.
- Rate limits: 15 chat messages per minute and 20 bookings/tickets/feedback per 15 minutes per IP (`429`).
- All SQL uses parameterised queries. All user text is HTML-escaped before it is rendered.
- The admin token is compared in constant time.
- The AI only sees FAQ, error-code and public event data, never bookings, tickets or personal data.

## Proposed improvement

**Email confirmations and a waiting list.** When a booking is made or cancelled, email the student their reference and a calendar invite through a transactional email API such as Resend. When an event is sold out (EVT-409), offer to join a waiting list, and email the next person automatically when someone cancels. It would follow the same pattern as the weather call: an API key in an environment variable, a time limit, and a retry queue if the email service is down.
