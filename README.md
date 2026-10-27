# Personal Website with an AI Help Assistant

**Task title:** Personal Portfolio Website with an AI FAQ & Error-Code Assistant

**Live site:** https://YOUR-APP.onrender.com  <!-- replace after deploying -->
**Health check:** https://YOUR-APP.onrender.com/health

A responsive personal website built with Node.js and Express. Every page has a chat widget whose AI assistant answers questions from the site's FAQ data, explains error codes, and opens a support ticket when it cannot answer.

## Features

| Requirement | How it is met |
|---|---|
| Responsive site, 3+ pages, chat widget on every page | Home, About, Projects, FAQ, Error codes, Support, Health, Admin. Mobile-first CSS. The widget (`public/js/chat.js`) is in the shared footer partial, so it loads on every page, including 404 and 500 |
| 10+ FAQs in SQL, shown on the FAQ page | 12 FAQs in the PostgreSQL `faqs` table, served by `GET /api/faqs` and rendered on `/faq` with search |
| 8+ error codes | `error_codes` table: 400, 401, 403, 404, 429, 500, 503 and the site-specific **SITE-460** (chat message too long). All are listed on `/error-codes`, and the "Try them out" buttons trigger them for real |
| Custom 404 and 500 pages with "Ask the assistant" | `views/pages/404.html` and `500.html`. Visit any wrong address, or `/demo/500` |
| Error banner | Any failed API call shows a banner with an **Ask the assistant about this error** button |
| Assistant answers from FAQ data, explains codes, creates a ticket when unsure | `src/services/assistant.js`: Claude gets only the FAQ and error-code rows as its knowledge base and must return `confident: false` when the answer isn't there. The server then creates a ticket in SQL and returns its reference. If the AI is unavailable it falls back to keyword matching |
| Tickets in SQL; chat logs and feedback in MongoDB | `tickets` table with full CRUD. `chat_logs` and `feedback` (thumbs up/down) collections in MongoDB |
| Keys in environment variables | All secrets are read from `process.env` (`src/config.js`). `.env` is git-ignored and only `.env.example` is committed |
| Request logging and health check | Every request is logged with an ID, status and response time (`src/middleware/requestLogger.js`). `/api/health` returns JSON and `/health` shows it as a page, along with the last 20 requests |
| Extra third-party API with a time limit and fallback | The GitHub REST API supplies the Projects page. The call has a 3-second `AbortSignal.timeout`, a 10-minute cache, and falls back to a saved project list on timeout or error |

## Architecture

```
Browser (HTML/CSS/vanilla JS, chat widget)
   │  fetch JSON
   ▼
Express server (server.js)
   ├── helmet security headers, JSON body limit, rate limits (429)
   ├── request logger ──► stdout + in-memory recent log
   ├── /api routes (src/routes/api.js)
   │     ├── PostgreSQL ── faqs, error_codes, tickets
   │     ├── MongoDB ───── chat_logs, feedback
   │     ├── Claude API ── assistant answers (timeout 15 s, then rule-based fallback)
   │     └── GitHub API ── projects (timeout 3 s, then saved list)
   └── HTML pages (views/) + custom 404 / 500
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status of SQL, MongoDB, AI and GitHub (`200` ok or degraded, `503` if the database is down) |
| GET | `/api/faqs` | All FAQs |
| GET | `/api/error-codes`, `/api/error-codes/:code` | Error-code reference |
| POST | `/api/chat` | `{ message, sessionId, page, history }` → `{ answer, source, engine, ticket, messageId }` |
| POST | `/api/feedback` | `{ messageId, rating: "up" \| "down" }` → `201` |
| POST | `/api/tickets` | Create a ticket → `201` + `Location` header |
| GET | `/api/tickets/:reference` | Public ticket status |
| GET | `/api/admin/tickets` | List tickets (admin) |
| PATCH | `/api/admin/tickets/:reference` | Update status (admin) |
| DELETE | `/api/admin/tickets/:reference` | Delete (admin) → `204` |
| GET | `/api/projects` | GitHub repos, or the fallback list |

Admin routes need `Authorization: Bearer <ADMIN_TOKEN>`. A missing token returns `401` and a wrong one returns `403`. The `/admin` page is a small dashboard for these routes.

Errors always look like `{ "error": { "status": 404, "code": "404", "message": "..." } }`.

## Run locally

```bash
npm install
cp .env.example .env     # then edit your name, email, GitHub username
npm run dev              # http://localhost:3000
npm test                 # 12 automated end-to-end tests
```

Without `DATABASE_URL`, the app uses an embedded PostgreSQL ([PGlite](https://pglite.dev)) stored in `./data`. Without `MONGODB_URI`, chat logs are kept in memory. Without `ANTHROPIC_API_KEY`, the assistant runs in rule-based fallback mode. The health page shows which mode each service is in.

## Deploy (free tiers)

1. **PostgreSQL:** create a free database on [Neon](https://neon.tech) and copy the connection string (it includes `?sslmode=require`).
2. **MongoDB:** create a free M0 cluster on [MongoDB Atlas](https://www.mongodb.com/atlas). Add a database user, allow access from `0.0.0.0/0`, and copy the `mongodb+srv://` URI.
3. **Claude API key:** create one at [platform.claude.com](https://platform.claude.com).
4. **Render:** push this repo to GitHub, then in [Render](https://render.com) choose **New → Blueprint** and select the repo (it reads `render.yaml`). Fill in `SITE_OWNER_NAME`, `SITE_OWNER_EMAIL`, `GITHUB_USERNAME`, `DATABASE_URL`, `MONGODB_URI` and `ANTHROPIC_API_KEY`. Render generates `ADMIN_TOKEN`, which you can view in the dashboard.
5. Open `https://<your-app>.onrender.com/health` and check that every service is green. Then put the URL at the top of this README.

Tables are created and seeded automatically on start. The free Render tier sleeps after 15 minutes idle, so the first request can take about 50 seconds.

## Security

- No secrets in the repository: `.env` is git-ignored, and `render.yaml` marks secrets `sync: false`.
- Helmet sets a strict Content-Security-Policy (no inline scripts) along with other security headers.
- Rate limits: 15 chat messages per minute and 10 tickets/feedback per 15 minutes per IP (`429`).
- All SQL uses parameterised queries. All user text is HTML-escaped before it is rendered.
- The admin token is compared in constant time.
- The AI only sees the FAQ and error-code data, never ticket or personal data.

## Proposed improvement

**Email notifications for tickets.** When the assistant or the form creates a ticket, or an admin changes its status, send an email to the visitor (if they left an address) and to the site owner, using a transactional email API such as Resend or SendGrid. This would close the loop, because visitors currently have to come back and check the status themselves. It would use the same pattern as the GitHub call: an API key in an environment variable, a time limit, and a fallback that queues the message for a retry if the email service is down.
