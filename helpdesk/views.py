"""HTML pages and the custom 404 / 500 handlers."""
import logging

from django.db import DatabaseError
from django.shortcuts import redirect, render

from .api import api_error

log = logging.getLogger(__name__)

PAGES = ['index', 'events', 'about', 'faq', 'error-codes', 'support', 'health', 'admin']


def page(name):
    def view(request):
        return render(request, f'pages/{name}.html')
    view.__name__ = f'page_{name.replace("-", "_")}'
    return view


def old_projects(request):
    return redirect('/events', permanent=True)


def demo_500(request):
    raise RuntimeError('Deliberate test error from /demo/500')


def wants_json(request):
    return request.path.startswith('/api/') or 'text/html' not in request.headers.get('Accept', 'text/html')


def not_found(request, exception=None):
    if wants_json(request):
        return api_error(404, '404', f'No route for {request.method} {request.path}')
    return render(request, 'pages/404.html', status=404)


def server_error(request):
    if wants_json(request):
        return api_error(500, '500', 'Something went wrong on our side.', requestId=getattr(request, 'id', None))
    return render(request, 'pages/500.html', {'requestId': getattr(request, 'id', '')}, status=500)


class DatabaseDownMiddleware:
    """If the database is unreachable, API calls get a clear 503 instead of a generic 500."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if isinstance(exception, DatabaseError):
            log.error('[sql] database error on %s: %s', request.path, exception)
            if wants_json(request):
                return api_error(503, '503', 'The database is starting up or unavailable. Please try again shortly.')
            return render(request, 'pages/500.html', {'requestId': getattr(request, 'id', '')}, status=503)
        return None
