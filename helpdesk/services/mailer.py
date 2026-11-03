"""Booking emails through the Brevo HTTP API (free tier). Render's free plan blocks SMTP ports,
so an HTTP email API is used instead. Email is best-effort: a failed or slow email never fails
the booking itself, and the result is shown on the health page."""
import html
import logging
import time
from datetime import datetime, timezone

import requests
from django.conf import settings
from django.utils import timezone as dj_tz

from .errors import short_reason

log = logging.getLogger(__name__)
_status = {'ok': None, 'detail': 'not used yet', 'at': None}


def enabled():
    return bool(settings.BREVO_API_KEY and settings.MAIL_FROM)


def _when(dt):
    local = dj_tz.localtime(dt)
    return f"{local.strftime('%A')}, {local.day} {local.strftime('%B %Y')}, {local.strftime('%I:%M %p').lstrip('0').lower()}"


def _layout(title, intro, rows, footer):
    e = html.escape
    table = ''.join(
        f'<tr><td style="padding:6px 12px 6px 0;color:#64748b">{e(k)}</td><td style="padding:6px 0;font-weight:600">{e(v)}</td></tr>'
        for k, v in rows)
    return f'''<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
  <div style="background:#4f46e5;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">{e(settings.SITE['name'])}</div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 8px">{e(title)}</h2>
    <p style="margin:0 0 16px">{e(intro)}</p>
    <table style="border-collapse:collapse;margin-bottom:16px">{table}</table>
    <p style="margin:0;color:#64748b;font-size:14px">{e(footer)}</p>
  </div>
</div>'''


def send(to, name, subject, html_body, text_body):
    global _status
    if not enabled():
        return 'disabled'
    started = time.monotonic()
    try:
        res = requests.post('https://api.brevo.com/v3/smtp/email', timeout=settings.MAIL_TIMEOUT, headers={
            'api-key': settings.BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json',
        }, json={
            'sender': {'name': settings.SITE['name'], 'email': settings.MAIL_FROM},
            'to': [{'email': to, 'name': name}],
            'subject': subject, 'htmlContent': html_body, 'textContent': text_body,
        })
        if not res.ok:
            try:
                message = res.json().get('message', '')
            except ValueError:
                message = ''
            raise RuntimeError(f'Brevo responded {res.status_code}' + (f': {message}' if message else ''))
        _status = {'ok': True, 'detail': f'last email sent in {round((time.monotonic() - started) * 1000)} ms',
                   'at': datetime.now(timezone.utc).isoformat()}
        return 'sent'
    except Exception as err:  # noqa: BLE001
        reason = short_reason(err, settings.MAIL_TIMEOUT)
    _status = {'ok': False, 'detail': f'last email failed: {reason}', 'at': datetime.now(timezone.utc).isoformat()}
    log.warning('[email] %s to %s failed: %s', subject, to, reason)
    return 'failed'


def booking_confirmed(booking):
    ev = booking.event
    rows = [('Reference', booking.reference), ('Event', ev.title), ('When', _when(ev.starts_at)),
            ('Venue', ev.venue), ('Seats', str(booking.seats))]
    footer = 'Bring this reference and your college ID. To cancel, open a support ticket with your reference.'
    text = '\n'.join(f'{k}: {v}' for k, v in rows)
    return send(booking.email, booking.name, f'Booking confirmed: {ev.title} ({booking.reference})',
                _layout(f"You're booked, {booking.name}!", 'Your seats are reserved. Here are your booking details:', rows, footer),
                f"Hi {booking.name},\n\nYour booking is confirmed.\n\n{text}\n\n{footer}\n\n{settings.SITE['name']}")


def booking_cancelled(booking):
    ev = booking.event
    rows = [('Reference', booking.reference), ('Event', ev.title), ('When', _when(ev.starts_at)),
            ('Seats released', str(booking.seats))]
    footer = 'If you did not ask for this, open a support ticket on the website.'
    text = '\n'.join(f'{k}: {v}' for k, v in rows)
    return send(booking.email, booking.name, f'Booking cancelled: {ev.title} ({booking.reference})',
                _layout('Your booking was cancelled', f'Hi {booking.name}, the organisers have cancelled this booking:', rows, footer),
                f"Hi {booking.name},\n\nYour booking was cancelled.\n\n{text}\n\n{footer}\n\n{settings.SITE['name']}")


def status():
    if not enabled():
        return {'configured': False, 'from': None, 'ok': None,
                'detail': 'BREVO_API_KEY or MAIL_FROM not set - emails disabled', 'at': None}
    return {'configured': True, 'from': settings.MAIL_FROM, **_status}
