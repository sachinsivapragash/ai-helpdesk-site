"""Request logging (one line per request to the server log, plus the last 50 for the health
page) and security headers."""
import logging
import re
import time
import uuid
from collections import deque
from datetime import datetime, timezone

from .services.lifecycle import ensure_started

log = logging.getLogger('requests')
_recent = deque(maxlen=50)

# Not shown on the health page: the favicon is requested by browsers and by the keep-awake ping.
HIDDEN_PATHS = {'/static/favicon.svg', '/favicon.ico', '/favicon.svg'}
REFERENCE = re.compile(r'\b(BK|TCK)-[0-9A-Za-z]+', re.I)


def recent_requests():
    return list(_recent)[:20]


class RequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        ensure_started()
        request.id = uuid.uuid4().hex[:8]
        started = time.monotonic()
        response = self.get_response(request)
        ms = round((time.monotonic() - started) * 1000, 1)
        response['X-Request-Id'] = request.id
        log.info('%s %s %s %s %s %s ms', datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                 request.id, request.method, request.get_full_path(), response.status_code, ms)
        if request.path not in HIDDEN_PATHS:
            # Booking and ticket references are masked so the public health page can't be used to look them up.
            path = REFERENCE.sub(lambda m: f"{m.group(1).upper()}-******", request.path)
            _recent.appendleft({'id': request.id, 'time': datetime.now(timezone.utc).isoformat(),
                                'method': request.method, 'path': path, 'status': response.status_code, 'ms': ms})
        return response


CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; "
       "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', CSP)
        response.setdefault('Referrer-Policy', 'no-referrer')
        response.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        return response
