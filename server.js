const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./src/config');
const sql = require('./src/db/sql');
const mongo = require('./src/db/mongo');
const views = require('./src/views');
const apiRoutes = require('./src/routes/api');
const { requestLogger } = require('./src/middleware/requestLogger');
const { apiError, notFound, serverError, viewsDir } = require('./src/middleware/errors');

const app = express();
let sqlReady = false;

app.set('trust proxy', 1); // behind the hosting provider's HTTPS proxy
app.engine('html', views.render);
app.set('view engine', 'html');
app.set('views', path.join(viewsDir, 'pages'));

app.use(helmet({
  contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"] } },
}));
app.use(requestLogger);
app.use(express.json({ limit: '20kb' }));
// maxAge 0: browsers revalidate static files, so a redeploy shows up immediately.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

// API: everything except /health needs the SQL database; answer 503 until it is up.
app.use('/api', (req, res, next) => {
  if (sqlReady || req.path === '/health' || req.path === '/logs/recent') return next();
  apiError(res, 503, '503', 'The database is starting up or unavailable. Please try again shortly.');
});
app.use('/api', apiRoutes);

const pages = {
  '/': 'index',
  '/about': 'about',
  '/events': 'events',
  '/faq': 'faq',
  '/error-codes': 'error-codes',
  '/support': 'support',
  '/health': 'health',
  '/admin': 'admin',
};
for (const [route, view] of Object.entries(pages)) {
  app.get(route, (req, res) => res.render(view));
}

// Lets examiners see the custom 500 page on the live site.
// The old portfolio address now points to the events page.
app.get('/projects', (req, res) => res.redirect(301, '/events'));

app.get('/demo/500', () => {
  throw new Error('Deliberate test error from /demo/500');
});

app.use(notFound);
app.use(serverError);

async function connectSql(attempt = 1) {
  try {
    await sql.connect();
    sqlReady = true;
  } catch (err) {
    const wait = Math.min(30, attempt * 5);
    console.error(`[sql] connection failed (attempt ${attempt}): ${err.message}. Retrying in ${wait}s`);
    setTimeout(() => connectSql(attempt + 1), wait * 1000);
  }
}

if (require.main === module) {
  app.listen(config.port, () => console.log(`[server] listening on http://localhost:${config.port}`));
  connectSql();
  mongo.connect();
}

module.exports = { app, start: async () => { await sql.connect(); sqlReady = true; await mongo.connect(); } };
