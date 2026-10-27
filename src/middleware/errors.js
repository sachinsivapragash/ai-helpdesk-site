// Consistent JSON errors for the API and custom HTML pages for browser requests.
const path = require('path');

function apiError(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: { status, code, message, ...extra } });
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || !req.accepts('html');
}

function notFound(req, res) {
  if (wantsJson(req)) return apiError(res, 404, '404', `No route for ${req.method} ${req.originalUrl}`);
  res.status(404).render('404');
}

// eslint-disable-next-line no-unused-vars
function serverError(err, req, res, next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.id} ${req.method} ${req.originalUrl}:`, err);
  if (wantsJson(req)) {
    const message = status >= 500 ? 'Something went wrong on our side.' : err.message;
    const code = status < 500 && err.expose !== false && typeof err.code === 'string' ? err.code : String(status);
    return apiError(res, status, code, message, { requestId: req.id });
  }
  res.status(500).render('500', { requestId: req.id });
}

module.exports = { apiError, notFound, serverError, viewsDir: path.join(__dirname, '..', '..', 'views') };
