require('dotenv').config({ quiet: true });

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === 'production',
  owner: {
    name: env.SITE_OWNER_NAME || 'Your Name',
    role: env.SITE_OWNER_ROLE || 'Software Development Student',
    email: env.SITE_OWNER_EMAIL || 'you@example.com',
    github: env.GITHUB_USERNAME || 'octocat',
  },
  databaseUrl: env.DATABASE_URL || '',
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'helpdesk',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  claudeModel: env.CLAUDE_MODEL || 'claude-opus-5-5',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS) || 15000,
  githubTimeoutMs: Number(env.GITHUB_TIMEOUT_MS) || 3000,
  adminToken: env.ADMIN_TOKEN || '',
};
