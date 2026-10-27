require('dotenv').config({ quiet: true });

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === 'production',
  site: {
    name: env.SITE_NAME || 'EventEase',
    campus: env.CAMPUS_NAME || 'colleges in Coimbatore',
    city: env.CAMPUS_CITY || 'Coimbatore',
    lat: Number(env.CAMPUS_LAT) || 11.0168,
    lon: Number(env.CAMPUS_LON) || 76.9558,
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
  // AI provider: Google Gemini (free tier) if GEMINI_API_KEY is set, otherwise Claude if
  // ANTHROPIC_API_KEY is set, otherwise rule-based answers only.
  geminiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  // Tried when the main model is overloaded (503) or rate-limited (429).
  geminiBackupModel: env.GEMINI_BACKUP_MODEL || 'gemini-flash-latest',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  claudeModel: env.CLAUDE_MODEL || 'claude-opus-5-5',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS) || 15000,
  weatherTimeoutMs: Number(env.WEATHER_TIMEOUT_MS) || 3000,
  adminToken: env.ADMIN_TOKEN || '',
};
