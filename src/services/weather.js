// Third-party API: daily campus weather forecast from Open-Meteo (no API key needed).
// Every call has a hard time limit and falls back to "forecast unavailable" on timeout/error.
const config = require('../config');

const CACHE_MS = 30 * 60 * 1000;
let cache = null;
let lastStatus = { ok: null, detail: 'not called yet', at: null };

const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

async function getForecast() {
  if (cache && Date.now() - cache.at < CACHE_MS) return { source: 'open-meteo-cache', city: config.site.city, days: cache.days };
  const { lat, lon, timezone } = config.site;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,precipitation_probability_max&forecast_days=16&timezone=${encodeURIComponent(timezone)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(config.weatherTimeoutMs) });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const { daily } = await res.json();
    const days = daily.time.map((date, i) => ({
      date,
      summary: CODES[daily.weather_code[i]] || 'Mixed weather',
      maxTempC: Math.round(daily.temperature_2m_max[i]),
      rainChance: daily.precipitation_probability_max[i] ?? null,
    }));
    cache = { at: Date.now(), days };
    lastStatus = { ok: true, detail: `${days.length}-day forecast in ${Date.now() - started} ms`, at: new Date() };
    return { source: 'open-meteo', city: config.site.city, days };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${config.weatherTimeoutMs} ms` : err.message;
    lastStatus = { ok: false, detail: `fallback used: ${reason}`, at: new Date() };
    console.warn(`[weather] ${lastStatus.detail}`);
    return { source: 'fallback', reason, city: config.site.city, days: [] };
  }
}

module.exports = { getForecast, status: () => lastStatus };
