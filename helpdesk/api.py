"""REST API: health, FAQs, error codes, chat, feedback, tickets (CRUD), events, bookings, weather."""
import hmac
import json
import platform
import re
import time
from functools import wraps

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.db.models import F
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .middleware import recent_requests
from .models import Booking, ErrorCode, Event, Faq, Ticket
from .services import assistant, mailer, mongo, weather

EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def api_error(status, code, message, **extra):
    return JsonResponse({'error': {'status': status, 'code': code, 'message': message, **extra}}, status=status)


def body(request):
    """The JSON request body; raises ValueError on malformed JSON."""
    if not request.body:
        return {}
    data = json.loads(request.body)
    return data if isinstance(data, dict) else {}


def text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ''


def is_email(value):
    return isinstance(value, str) and bool(EMAIL.match(value))


def client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    return forwarded.split(',')[0].strip() if forwarded else request.META.get('REMOTE_ADDR', '')


def rate_limit(name, limit, window):
    """Allow `limit` requests per IP every `window` seconds; more get a 429."""
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            key = f'rl:{name}:{client_ip(request)}:{int(time.time() // window)}'
            cache.add(key, 0, window)
            if cache.incr(key) > limit:
                return api_error(429, '429', 'Too many requests. Please wait a minute and try again.')
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


def admin_only(view):
    """No token -> 401, wrong token -> 403."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        header = request.headers.get('Authorization', '')
        token = header[7:].strip() if header.startswith('Bearer ') else ''
        if not token:
            return api_error(401, '401', 'Admin token required (Authorization: Bearer <token>).')
        if not settings.ADMIN_TOKEN or not hmac.compare_digest(token.encode(), settings.ADMIN_TOKEN.encode()):
            return api_error(403, '403', 'This token is not allowed to manage tickets.')
        return view(request, *args, **kwargs)
    return wrapped


def json_view(view):
    """CSRF-exempt JSON endpoint: malformed JSON -> 400, unexpected errors -> 500 JSON."""
    @csrf_exempt
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except ValueError:
            return api_error(400, '400', 'The request body is not valid JSON.')
    return wrapped


# ---------- Health & logs ----------
@require_http_methods(['GET'])
def health(request):
    checks = {}
    started = time.monotonic()
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        checks['sql'] = {'ok': True, 'driver': connection.vendor, 'latencyMs': round((time.monotonic() - started) * 1000)}
    except Exception as err:  # noqa: BLE001
        checks['sql'] = {'ok': False, 'detail': str(err)}
    checks['mongo'] = mongo.ping()
    checks['ai'] = assistant.status()
    # Fetch (or reuse the cached) forecast so the weather status is never just "not called yet".
    weather.get_forecast()
    checks['weather'] = weather.status()
    checks['email'] = mailer.status()
    state = 'down' if not checks['sql']['ok'] else 'ok' if checks['mongo']['ok'] and checks['ai']['configured'] else 'degraded'
    return JsonResponse({
        'status': state, 'uptimeSeconds': round(time.monotonic() - STARTED), 'time': timezone.now().isoformat(),
        'node': f'Python {platform.python_version()} · Django', 'checks': checks,
    }, status=503 if state == 'down' else 200)


STARTED = time.monotonic()


@require_http_methods(['GET'])
def logs_recent(request):
    return JsonResponse({'requests': recent_requests()})


# ---------- FAQs & error codes ----------
@require_http_methods(['GET'])
def faqs(request):
    rows = [{'id': f.id, 'category': f.category, 'question': f.question, 'answer': f.answer} for f in Faq.objects.all()]
    return JsonResponse({'count': len(rows), 'faqs': rows})


def _code(c):
    return {'code': c.code, 'http_status': c.http_status, 'title': c.title, 'meaning': c.meaning,
            'user_action': c.user_action, 'site_specific': c.site_specific}


@require_http_methods(['GET'])
def error_codes(request):
    rows = [_code(c) for c in ErrorCode.objects.all()]
    return JsonResponse({'count': len(rows), 'codes': rows})


@require_http_methods(['GET'])
def error_code(request, code):
    c = ErrorCode.objects.filter(code__iexact=code).first()
    if not c:
        return api_error(404, '404', f'Unknown error code "{code}".')
    return JsonResponse(_code(c))


# ---------- Assistant & feedback ----------
@json_view
@require_http_methods(['POST'])
@rate_limit('chat', 15, 60)
def chat(request):
    data = body(request)
    try:
        reply = assistant.chat(
            data.get('message'), session_id=text(data.get('sessionId'), 64) or None, page=text(data.get('page'), 200) or None,
            history=data.get('history'), email=data.get('email') if is_email(data.get('email')) else None)
    except assistant.ChatError as err:
        return api_error(err.status, err.code, str(err))
    return JsonResponse(reply)


@json_view
@require_http_methods(['POST'])
@rate_limit('write', 20, 900)
def feedback(request):
    data = body(request)
    if data.get('rating') not in ('up', 'down'):
        return api_error(400, '400', 'rating must be "up" or "down".')
    if not text(data.get('messageId'), 64):
        return api_error(400, '400', 'messageId is required.')
    feedback_id = mongo.insert('feedback', {
        'messageId': text(data.get('messageId'), 64), 'rating': data['rating'],
        'comment': text(data.get('comment'), 500) or None, 'sessionId': text(data.get('sessionId'), 64) or None})
    return JsonResponse({'id': feedback_id, 'saved': True}, status=201)


# ---------- Tickets (CRUD) ----------
@json_view
@require_http_methods(['POST'])
@rate_limit('write', 20, 900)
def tickets_create(request):
    data = body(request)
    errors = []
    if not text(data.get('subject'), 150):
        errors.append('subject is required')
    if len(text(data.get('message'), 2000)) < 10:
        errors.append('message must be at least 10 characters')
    if data.get('email') and not is_email(data.get('email')):
        errors.append('email is not valid')
    if errors:
        return api_error(400, '400', 'Please fix the form.', details=errors)
    t = Ticket.objects.create(name=text(data.get('name'), 100) or None, email=data.get('email') or None,
                              subject=text(data.get('subject'), 150), message=text(data.get('message'), 2000), source='form')
    response = JsonResponse(t.public(), status=201)
    response['Location'] = f'/api/tickets/{t.reference}'
    return response


@require_http_methods(['GET'])
def ticket_detail(request, reference):
    t = Ticket.objects.filter(reference=reference.upper()).first()
    if not t:
        return api_error(404, '404', 'No ticket with that reference.')
    return JsonResponse(t.public())


@require_http_methods(['GET'])
@admin_only
def admin_tickets(request):
    qs = Ticket.objects.all()
    if request.GET.get('status') in Ticket.STATUSES:
        qs = qs.filter(status=request.GET['status'])
    rows = [t.full() for t in qs[:200]]
    return JsonResponse({'count': len(rows), 'tickets': rows})


@json_view
@require_http_methods(['PATCH', 'DELETE'])
@admin_only
def admin_ticket(request, reference):
    t = Ticket.objects.filter(reference=reference.upper()).first()
    if not t:
        return api_error(404, '404', 'No ticket with that reference.')
    if request.method == 'DELETE':
        t.delete()
        return HttpResponse(status=204)
    status = body(request).get('status')
    if status not in Ticket.STATUSES:
        return api_error(400, '400', f"status must be one of: {', '.join(Ticket.STATUSES)}")
    t.status = status
    t.save()
    return JsonResponse(t.full())


@require_http_methods(['GET'])
@admin_only
def admin_stats(request):
    return JsonResponse({'chatMessages': mongo.count('chat_logs'), 'feedback': mongo.feedback_summary()})


# ---------- Events & bookings ----------
@require_http_methods(['GET'])
def events(request):
    rows = [e.to_dict() for e in assistant.upcoming_events()]
    return JsonResponse({'count': len(rows), 'events': rows})


@require_http_methods(['GET'])
def event_detail(request, slug):
    e = Event.objects.filter(slug=slug).first()
    if not e:
        return api_error(404, '404', 'No event with that name.')
    return JsonResponse(e.to_dict())


@json_view
@require_http_methods(['POST'])
@rate_limit('write', 20, 900)
def book(request, slug):
    data = body(request)
    errors = []
    name = text(data.get('name'), 100)
    if not name:
        errors.append('name is required')
    if not is_email(data.get('email')):
        errors.append('a valid email is required')
    seats = data.get('seats')
    if not (isinstance(seats, int) and not isinstance(seats, bool) and 1 <= seats <= 4):
        errors.append('seats must be a whole number from 1 to 4')
    if errors:
        return api_error(400, '400', 'Please fix the booking form.', details=errors)

    email = data['email'].lower()
    try:
        with transaction.atomic():
            # Atomic seat reservation: only succeeds while enough seats are left.
            reserved = Event.objects.filter(slug=slug, starts_at__gt=timezone.now(),
                                            booked__lte=F('capacity') - seats).update(booked=F('booked') + seats)
            if not reserved:
                event = Event.objects.filter(slug=slug).first()
                if not event:
                    return api_error(404, '404', 'No event with that name.')
                if event.starts_at <= timezone.now():
                    return api_error(400, '400', 'This event has already started.')
                return api_error(409, 'EVT-409', f'Only {event.seats_left} seat(s) left for this event.'
                                 if event.seats_left > 0 else 'This event is sold out.')
            booking = Booking.objects.create(event=Event.objects.get(slug=slug), name=name, email=email, seats=seats)
    except IntegrityError:
        return api_error(409, 'EVT-409', 'You have already booked this event with this email.')

    # 'sent', 'failed' or 'disabled'; a failed email never fails the booking.
    email_status = mailer.booking_confirmed(booking)
    response = JsonResponse({
        'reference': booking.reference, 'seats': booking.seats, 'status': booking.status,
        'created_at': booking.created_at.isoformat(), 'event': booking.event.title,
        'starts_at': booking.event.starts_at.isoformat(), 'venue': booking.event.venue, 'email_status': email_status,
    }, status=201)
    response['Location'] = f'/api/bookings/{booking.reference}'
    return response


@require_http_methods(['GET'])
def booking_detail(request, reference):
    b = Booking.objects.select_related('event').filter(reference=reference.upper()).first()
    if not b:
        return api_error(404, '404', 'No booking with that reference.')
    return JsonResponse({'reference': b.reference, 'seats': b.seats, 'status': b.status,
                         'created_at': b.created_at.isoformat(), 'event': b.event.title,
                         'starts_at': b.event.starts_at.isoformat(), 'venue': b.event.venue})


@require_http_methods(['GET'])
@admin_only
def admin_bookings(request):
    rows = [{'reference': b.reference, 'event': b.event.title, 'name': b.name, 'email': b.email, 'seats': b.seats,
             'status': b.status, 'created_at': b.created_at.isoformat()}
            for b in Booking.objects.select_related('event')[:200]]
    return JsonResponse({'count': len(rows), 'bookings': rows})


@json_view
@require_http_methods(['PATCH'])
@admin_only
def admin_cancel_booking(request, reference):
    with transaction.atomic():
        b = Booking.objects.select_related('event').filter(reference=reference.upper(), status='confirmed').first()
        if not b:
            return api_error(404, '404', 'No confirmed booking with that reference.')
        b.status = 'cancelled'
        b.save()
        Event.objects.filter(pk=b.event_id).update(booked=F('booked') - b.seats)
    email_status = mailer.booking_cancelled(b)
    return JsonResponse({'reference': b.reference, 'status': b.status, 'seats': b.seats, 'event': b.event.title,
                         'email_status': email_status})


# ---------- Third-party ----------
@require_http_methods(['GET'])
def weather_forecast(request):
    return JsonResponse(weather.get_forecast())
