// Third-party API: GitHub public repositories for the Projects page.
// Every call has a hard time limit and falls back to a static list on timeout/error.
const config = require('../config');

const CACHE_MS = 10 * 60 * 1000;
let cache = null;
let lastStatus = { ok: null, detail: 'not called yet', at: null };

const fallbackProjects = [
  {
    name: 'ai-helpdesk-site',
    description: 'This website: Express + PostgreSQL + MongoDB with a Claude-powered FAQ assistant.',
    language: 'JavaScript', stars: 0, url: `https://github.com/${config.owner.github}`,
  },
  {
    name: 'task-tracker-api',
    description: 'REST API for to-do lists with authentication, validation and automated tests.',
    language: 'JavaScript', stars: 0, url: `https://github.com/${config.owner.github}`,
  },
  {
    name: 'weather-dashboard',
    description: 'Responsive dashboard that shows forecasts from a public weather API with caching.',
    language: 'HTML', stars: 0, url: `https://github.com/${config.owner.github}`,
  },
];

async function getProjects() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { source: 'github-cache', projects: cache.projects };
  }
  const url = `https://api.github.com/users/${encodeURIComponent(config.owner.github)}/repos?sort=updated&per_page=6`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-helpdesk-site' },
      signal: AbortSignal.timeout(config.githubTimeoutMs),
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const repos = await res.json();
    const projects = repos
      .filter((r) => !r.fork)
      .map((r) => ({
        name: r.name,
        description: r.description || 'No description yet.',
        language: r.language || 'n/a',
        stars: r.stargazers_count,
        url: r.html_url,
      }));
    cache = { at: Date.now(), projects };
    lastStatus = { ok: true, detail: `${projects.length} repos in ${Date.now() - started} ms`, at: new Date() };
    return { source: 'github', projects };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${config.githubTimeoutMs} ms` : err.message;
    lastStatus = { ok: false, detail: `fallback used: ${reason}`, at: new Date() };
    console.warn(`[github] ${lastStatus.detail}`);
    return { source: 'fallback', reason, projects: fallbackProjects };
  }
}

module.exports = { getProjects, status: () => lastStatus };
