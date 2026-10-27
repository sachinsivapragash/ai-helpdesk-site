// Request logging: one line per request to stdout (picked up by the host's log viewer)
// plus the last 50 entries in memory for the /health page.
const crypto = require('crypto');
const morgan = require('morgan');

const recent = [];
const MAX_RECENT = 50;

morgan.token('id', (req) => req.id);

function assignId(req, res, next) {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
}

// Not shown on the health page: the favicon is requested by browsers and by the keep-awake job
// every 10 minutes. These requests are still written to the main log.
const HIDDEN_PATHS = new Set(['/favicon.svg', '/favicon.ico']);

function remember(req, res, next) {
  if (HIDDEN_PATHS.has(req.path)) return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    recent.unshift({
      id: req.id,
      time: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1000000n),
    });
    if (recent.length > MAX_RECENT) recent.pop();
  });
  next();
}

const logLine = morgan(':date[iso] :id :method :url :status :res[content-length] - :response-time ms');

module.exports = { requestLogger: [assignId, remember, logLine], recentRequests: () => recent.slice(0, 20) };
