// Third-party API: daily campus weather forecast (no API keys needed).
// Tries Open-Meteo first, then MET Norway if Open-Meteo is rate-limited or down. Each call has a
// hard time limit. A good forecast is cached for 3 hours and, if every service fails, the last
// good forecast (up to 24 hours old) is served; with nothing cached the page shows a fallback.
const config = require('../config');

const FRESH_MS = 3 * 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
let cache = null; // { at, source, days }
let lastStatus = { ok: null, detail: 'not called yet', at: null };

const OPEN_METEO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(config.weatherTimeoutMs) });
  if (!res.ok) throw new Error(`responded ${res.status}`);
  return res.json();
}

async function fromOpenMeteo() {
  const { lat, lon, timezone } = config.site;
  const { daily } = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,precipitation_probability_max&forecast_days=16&timezone=${encodeURIComponent(timezone)}`);
  return daily.time.map((date, i) => ({
    date,
    summary: OPEN_METEO_CODES[daily.weather_code[i]] || 'Mixed weather',
    maxTempC: Math.round(daily.temperature_2m_max[i]),
    rainChance: daily.precipitation_probability_max[i] ?? null,
    rainMm: null,
  }));
}

// MET Norway symbol codes, e.g. "lightrainshowers_day" -> "Light rain showers".
function metSummary(symbol) {
  const s = (symbol || '').replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 'Thunderstorm';
  if (s.startsWith('heavyrain')) return 'Heavy rain';
  if (s.includes('rainshowers')) return 'Rain showers';
  if (s.startsWith('lightrain')) return 'Light rain';
  if (s.startsWith('rain')) return 'Rain';
  return { clearsky: 'Clear sky', fair: 'Mainly clear', partlycloudy: 'Partly cloudy', cloudy: 'Overcast', fog: 'Fog' }[s] || 'Mixed weather';
}

async function fromMetNorway() {
  const { lat, lon, timezone } = config.site;
  // MET Norway asks every client to identify itself in the User-Agent header.
  const data = await getJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
    { 'User-Agent': 'EventEase/1.0 github.com/sachinsivapragash/ai-helpdesk-site' }
  );
  const byDay = new Map();
  for (const t of data.properties.timeseries) {
    const when = new Date(t.time);
    const date = when.toLocaleDateString('en-CA', { timeZone: timezone });
    const hour = Number(when.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }));
    const day = byDay.get(date) || { date, maxTempC: -Infinity, rainMm: 0, symbol: null, symbolDistance: Infinity };
    day.maxTempC = Math.max(day.maxTempC, t.data.instant.details.air_temperature);
    const next = t.data.next_6_hours || t.data.next_1_hours;
    if (t.data.next_1_hours) day.rainMm += t.data.next_1_hours.details?.precipitation_amount || 0;
    // Describe the day by the forecast closest to midday.
    if (next?.summary?.symbol_code && Math.abs(hour - 12) < day.symbolDistance) {
      day.symbol = next.summary.symbol_code;
      day.symbolDistance = Math.abs(hour - 12);
    }
    byDay.set(date, day);
  }
  return [...byDay.values()]
    .filter((d) => d.symbol && Number.isFinite(d.maxTempC))
    .map((d) => ({
      date: d.date,
      summary: metSummary(d.symbol),
      maxTempC: Math.round(d.maxTempC),
      rainChance: null,
      rainMm: Math.round(d.rainMm * 10) / 10,
    }));
}

const PROVIDERS = [['open-meteo', fromOpenMeteo], ['met-norway', fromMetNorway]];

async function getForecast() {
  const city = config.site.city;
  if (cache && Date.now() - cache.at < FRESH_MS) return { source: `${cache.source}-cache`, city, days: cache.days };

  const failures = [];
  for (const [name, load] of PROVIDERS) {
    const started = Date.now();
    try {
      const days = await load();
      if (!days.length) throw new Error('no forecast days');
      cache = { at: Date.now(), source: name, days };
      lastStatus = {
        ok: true,
        detail: `${name}: ${days.length}-day forecast in ${Date.now() - started} ms${failures.length ? ` (after ${failures.join('; ')})` : ''}`,
        at: new Date(),
      };
      return { source: name, city, days };
    } catch (err) {
      failures.push(`${name} ${err.name === 'TimeoutError' ? `timed out after ${config.weatherTimeoutMs} ms` : err.message}`);
    }
  }

  const reason = failures.join('; ');
  console.warn(`[weather] all providers failed: ${reason}`);
  if (cache && Date.now() - cache.at < STALE_MS) {
    lastStatus = { ok: true, detail: `serving saved forecast from ${cache.source}; live call failed (${reason})`, at: new Date() };
    return { source: `${cache.source}-saved`, city, days: cache.days, reason };
  }
  lastStatus = { ok: false, detail: `fallback used: ${reason}`, at: new Date() };
  return { source: 'fallback', reason, city, days: [] };
}

module.exports = { getForecast, status: () => lastStatus, _test: { fromMetNorway, metSummary, reset: () => { cache = null; } } };
