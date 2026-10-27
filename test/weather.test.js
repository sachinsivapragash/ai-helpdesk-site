// Weather fallback chain, with fetch mocked: Open-Meteo -> MET Norway -> saved forecast -> fallback.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const weather = require('../src/services/weather');

const realFetch = global.fetch;
const realNow = Date.now;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A small MET Norway "compact" response: two days in Asia/Kolkata.
const metSample = {
  properties: {
    timeseries: [
      { time: '2026-10-28T03:30:00Z', data: { instant: { details: { air_temperature: 24.1 } }, next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0 } } } },
      { time: '2026-10-28T06:30:00Z', data: { instant: { details: { air_temperature: 31.6 } }, next_1_hours: { summary: { symbol_code: 'lightrainshowers_day' }, details: { precipitation_amount: 1.2 } }, next_6_hours: { summary: { symbol_code: 'lightrainshowers_day' } } } },
      { time: '2026-10-29T06:30:00Z', data: { instant: { details: { air_temperature: 30.2 } }, next_6_hours: { summary: { symbol_code: 'partlycloudy_day' } } } },
    ],
  },
};

beforeEach(() => weather._test.reset());
afterEach(() => { global.fetch = realFetch; Date.now = realNow; });

test('uses MET Norway when Open-Meteo is rate-limited (429)', async () => {
  global.fetch = async (url) => (String(url).includes('open-meteo') ? json({}, 429) : json(metSample));
  const f = await weather.getForecast();
  assert.equal(f.source, 'met-norway');
  assert.deepEqual(f.days[0], { date: '2026-10-28', summary: 'Rain showers', maxTempC: 32, rainChance: null, rainMm: 1.2 });
  assert.equal(f.days[1].summary, 'Partly cloudy');
  assert.equal(weather.status().ok, true);
});

test('serves the saved forecast when every service fails later', async () => {
  global.fetch = async () => json(metSample);
  await weather.getForecast();
  const start = realNow();
  Date.now = () => start + 4 * 60 * 60 * 1000; // past the 3-hour cache
  global.fetch = async () => json({}, 503);
  const f = await weather.getForecast();
  assert.equal(f.source, 'met-norway-saved');
  assert.ok(f.days.length > 0);
});

test('falls back to "unavailable" when nothing works and nothing is saved', async () => {
  global.fetch = async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
  const f = await weather.getForecast();
  assert.equal(f.source, 'fallback');
  assert.deepEqual(f.days, []);
  assert.match(f.reason, /open-meteo timed out.*met-norway timed out/);
});
