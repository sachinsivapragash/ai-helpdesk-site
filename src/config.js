require('dotenv').config({ quiet: true });

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === 'production',
  site: {
    name: env.SITE_NAME || 'EventEase',
    campus: env.CAMPUS_NAME || 'our campus',
    city: env.CAMPUS_CITY || 'Chennai',
    lat: Number(env.CAMPUS_LAT) || 13.0827,
    lon: Number(env.CAMPUS_LON) || 80.2707,
    timezone: env.CAMPUS_TIMEZONE || 'Asia/Kolkata',
  },
  owner: {
    name: env.SITE_OWNER_NAME || 'Your Name',
    email: env.SITE_OWNER_EMAIL || 'you@example.com',
    github: env.GITHUB_USERNAME || 'octocat',
  },
  databaseUrl: env.DATABASE_URL || '',
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'helpdesk',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  claudeModel: env.CLAUDE_MODEL || 'claude-opus-5-5',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS) || 15000,
  weatherTimeoutMs: Number(env.WEATHER_TIMEOUT_MS) || 3000,
  adminToken: env.ADMIN_TOKEN || '',
};
