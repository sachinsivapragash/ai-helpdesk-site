"""Third-party API: daily campus weather forecast (no API keys needed).

Tries Open-Meteo first, then MET Norway if Open-Meteo is rate-limited or down. Each call has a
hard time limit. A good forecast is cached for 3 hours; if every service fails, the last good
forecast (up to 24 hours old) is served, and with nothing saved the page shows a fallback."""
import logging
import math
import re
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
from django.conf import settings

from .errors import short_reason

log = logging.getLogger(__name__)
FRESH_SECONDS = 3 * 3600
STALE_SECONDS = 24 * 3600
USER_AGENT = 'EventEase/1.0 github.com/sachinsivapragash/ai-helpdesk-site'

_cache = None  # {'at', 'source', 'days'}
_status = {'ok': None, 'detail': 'not called yet', 'at': None}

OPEN_METEO_CODES = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
}


def _get_json(url, headers=None):
    res = requests.get(url, headers=headers or {}, timeout=settings.WEATHER_TIMEOUT)
    if not res.ok:
        raise RuntimeError(f'responded {res.status_code}')
    return res.json()


def from_open_meteo():
    s = settings.SITE
    daily = _get_json(
        f"https://api.open-meteo.com/v1/forecast?latitude={s['lat']}&longitude={s['lon']}"
        f"&daily=weather_code,temperature_2m_max,precipitation_probability_max&forecast_days=16&timezone={s['timezone']}"
    )['daily']
    return [{
        'date': date,
        'summary': OPEN_METEO_CODES.get(daily['weather_code'][i], 'Mixed weather'),
        'maxTempC': round(daily['temperature_2m_max'][i]),
        'rainChance': daily['precipitation_probability_max'][i],
        'rainMm': None,
    } for i, date in enumerate(daily['time'])]


def met_summary(symbol):
    s = re.sub(r'_(day|night|polartwilight)$', '', symbol or '')
    if 'thunder' in s:
        return 'Thunderstorm'
    if s.startswith('heavyrain'):
        return 'Heavy rain'
    if 'rainshowers' in s:
        return 'Rain showers'
    if s.startswith('lightrain'):
        return 'Light rain'
    if s.startswith('rain'):
        return 'Rain'
    return {'clearsky': 'Clear sky', 'fair': 'Mainly clear', 'partlycloudy': 'Partly cloudy',
            'cloudy': 'Overcast', 'fog': 'Fog'}.get(s, 'Mixed weather')


def from_met_norway():
    s = settings.SITE
    tz = ZoneInfo(s['timezone'])
    # MET Norway asks every client to identify itself in the User-Agent header.
    data = _get_json(
        f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={s['lat']:.4f}&lon={s['lon']:.4f}",
        {'User-Agent': USER_AGENT},
    )
    days = {}
    for t in data['properties']['timeseries']:
        when = datetime.fromisoformat(t['time'].replace('Z', '+00:00')).astimezone(tz)
        d = days.setdefault(when.date().isoformat(),
                            {'max': -math.inf, 'rain': 0.0, 'symbol': None, 'distance': math.inf})
        d['max'] = max(d['max'], t['data']['instant']['details']['air_temperature'])
        one_hour = t['data'].get('next_1_hours')
        if one_hour:
            d['rain'] += one_hour.get('details', {}).get('precipitation_amount', 0) or 0
        nxt = t['data'].get('next_6_hours') or one_hour
        symbol = (nxt or {}).get('summary', {}).get('symbol_code')
        if symbol and abs(when.hour - 12) < d['distance']:  # describe the day by its midday forecast
            d['symbol'], d['distance'] = symbol, abs(when.hour - 12)
    return [{
        'date': date, 'summary': met_summary(d['symbol']), 'maxTempC': round(d['max']),
        'rainChance': None, 'rainMm': round(d['rain'], 1),
    } for date, d in days.items() if d['symbol'] and math.isfinite(d['max'])]


PROVIDERS = [('open-meteo', from_open_meteo), ('met-norway', from_met_norway)]


def get_forecast():
    global _cache, _status
    city = settings.SITE['city']
    now = time.time()
    if _cache and now - _cache['at'] < FRESH_SECONDS:
        return {'source': f"{_cache['source']}-cache", 'city': city, 'days': _cache['days']}

    failures = []
    for name, load in PROVIDERS:
        started = time.monotonic()
        try:
            days = load()
            if not days:
                raise RuntimeError('no forecast days')
            _cache = {'at': time.time(), 'source': name, 'days': days}
            extra = f" (after {'; '.join(failures)})" if failures else ''
            _status = {'ok': True, 'detail': f'{name}: {len(days)}-day forecast in {round((time.monotonic() - started) * 1000)} ms{extra}',
                       'at': datetime.now(timezone.utc).isoformat()}
            return {'source': name, 'city': city, 'days': days}
        except Exception as err:  # noqa: BLE001
            failures.append(f'{name} {short_reason(err, settings.WEATHER_TIMEOUT)}')

    reason = '; '.join(failures)
    log.warning('[weather] all providers failed: %s', reason)
    if _cache and now - _cache['at'] < STALE_SECONDS:
        _status = {'ok': True, 'detail': f"serving saved forecast from {_cache['source']}; live call failed ({reason})",
                   'at': datetime.now(timezone.utc).isoformat()}
        return {'source': f"{_cache['source']}-saved", 'city': city, 'days': _cache['days'], 'reason': reason}
    _status = {'ok': False, 'detail': f'fallback used: {reason}', 'at': datetime.now(timezone.utc).isoformat()}
    return {'source': 'fallback', 'reason': reason, 'city': city, 'days': []}


def status():
    return dict(_status)


def reset():
    global _cache
    _cache = None
