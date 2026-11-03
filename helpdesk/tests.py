"""End-to-end tests for every requirement. Run with: python manage.py test"""
import json
from datetime import timedelta
from unittest import mock

import requests
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from . import catalog
from .models import Booking, ErrorCode, Event, Faq, Ticket
from .services import mailer, weather

ADMIN = {'HTTP_AUTHORIZATION': 'Bearer test-admin-token'}


@override_settings(ADMIN_TOKEN='test-admin-token', GEMINI_API_KEY='', ANTHROPIC_API_KEY='',
                   BREVO_API_KEY='', MAIL_FROM='', WEATHER_TIMEOUT=0.001)
class SiteTests(TestCase):
    def setUp(self):
        cache.clear()
        weather.reset()
        catalog.seed()

    def post(self, path, data, **extra):
        return self.client.post(path, json.dumps(data), content_type='application/json', **extra)

    # ---------- pages ----------
    def test_pages_render_with_chat_widget(self):
        for path in ['/', '/events', '/about', '/faq', '/error-codes', '/support', '/health', '/admin']:
            res = self.client.get(path)
            self.assertEqual(res.status_code, 200, path)
            self.assertContains(res, '/static/js/chat.js', msg_prefix=path)

    def test_custom_404_and_500_pages_have_ask_button(self):
        res = self.client.get('/no-such-page', HTTP_ACCEPT='text/html')
        self.assertEqual(res.status_code, 404)
        self.assertContains(res, 'Ask the assistant about this error', status_code=404)
        self.client.raise_request_exception = False
        res = self.client.get('/demo/500', HTTP_ACCEPT='text/html')
        self.assertEqual(res.status_code, 500)
        self.assertContains(res, 'Ask the assistant about this error', status_code=500)

    def test_api_errors_are_json(self):
        res = self.client.get('/api/nothing')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['error']['code'], '404')

    # ---------- FAQs and error codes ----------
    def test_faqs_and_error_codes_come_from_sql(self):
        self.assertGreaterEqual(self.client.get('/api/faqs').json()['count'], 10)
        codes = [c['code'] for c in self.client.get('/api/error-codes').json()['codes']]
        for c in ['400', '401', '403', '404', '429', '500', '503']:
            self.assertIn(c, codes)
        self.assertTrue(ErrorCode.objects.filter(site_specific=True).exists())
        self.assertEqual(Faq.objects.count(), 12)

    # ---------- assistant (rule-based fallback, no AI key) ----------
    def test_assistant_explains_error_code(self):
        body = self.post('/api/chat', {'message': 'What does error 429 mean?'}).json()
        self.assertEqual(body['source'], 'error_code')
        self.assertIn('Too Many Requests', body['answer'])

    def test_assistant_answers_from_faq(self):
        body = self.post('/api/chat', {'message': 'Do I get a participation certificate?'}).json()
        self.assertEqual(body['source'], 'faq')
        self.assertIsNone(body['ticket'])

    def test_assistant_answers_about_events(self):
        body = self.post('/api/chat', {'message': 'When is the hackathon?'}).json()
        self.assertEqual(body['source'], 'event')
        self.assertIn('Hack the Campus', body['answer'])

    def test_assistant_creates_ticket_when_unsure(self):
        body = self.post('/api/chat', {'message': 'What is the airspeed velocity of a swallow?'}).json()
        self.assertTrue(body['ticket'].startswith('TCK-'))
        ticket = self.client.get(f"/api/tickets/{body['ticket']}").json()
        self.assertEqual((ticket['status'], ticket['source']), ('open', 'assistant'))

    def test_assistant_handles_bad_input(self):
        self.assertEqual(self.post('/api/chat', {'message': ''}).status_code, 400)
        self.assertEqual(self.post('/api/chat', {'message': 42}).status_code, 400)
        res = self.post('/api/chat', {'message': 'x' * 501})
        self.assertEqual((res.status_code, res.json()['error']['code']), (413, 'EVT-460'))
        res = self.client.post('/api/chat', '{bad', content_type='application/json')
        self.assertEqual(res.status_code, 400)

    @override_settings(GEMINI_API_KEY='fake-key')
    def test_assistant_falls_back_when_ai_fails(self):
        with mock.patch('helpdesk.services.assistant.requests.post', side_effect=requests.ConnectionError('down')):
            body = self.post('/api/chat', {'message': 'What is error 404?'}).json()
        self.assertEqual((body['engine'], body['source']), ('fallback', 'error_code'))

    @override_settings(GEMINI_API_KEY='fake-key')
    def test_assistant_uses_gemini_answer(self):
        reply = mock.Mock(ok=True, status_code=200)
        reply.json.return_value = {'candidates': [{'content': {'parts': [{'text': json.dumps(
            {'answer': 'Bring your college ID.', 'source': 'faq', 'confident': True})}]}}]}
        with mock.patch('helpdesk.services.assistant.requests.post', return_value=reply) as post:
            body = self.post('/api/chat', {'message': 'What should I bring?'}).json()
        self.assertEqual((body['engine'], body['answer']), ('ai', 'Bring your college ID.'))
        sent = post.call_args.kwargs['json']
        self.assertIn('KNOWLEDGE BASE', sent['systemInstruction']['parts'][0]['text'])

    def test_rate_limit_returns_429(self):
        statuses = [self.post('/api/chat', {'message': 'hi'}).status_code for _ in range(16)]
        self.assertEqual(statuses[-1], 429)

    def test_feedback_is_stored(self):
        self.assertEqual(self.post('/api/feedback', {'messageId': 'abc', 'rating': 'down'}).status_code, 201)
        self.assertEqual(self.post('/api/feedback', {'messageId': 'abc', 'rating': 'meh'}).status_code, 400)

    # ---------- tickets ----------
    def test_ticket_crud_with_admin_auth(self):
        created = self.post('/api/tickets', {'subject': 'Test', 'message': 'This is a test ticket', 'email': 'a@b.co'})
        self.assertEqual(created.status_code, 201)
        ref = created.json()['reference']
        self.assertEqual(self.client.get('/api/admin/tickets').status_code, 401)
        self.assertEqual(self.client.get('/api/admin/tickets', HTTP_AUTHORIZATION='Bearer nope').status_code, 403)
        res = self.client.patch(f'/api/admin/tickets/{ref}', json.dumps({'status': 'resolved'}),
                                content_type='application/json', **ADMIN)
        self.assertEqual(res.json()['status'], 'resolved')
        self.assertEqual(self.client.delete(f'/api/admin/tickets/{ref}', **ADMIN).status_code, 204)
        self.assertEqual(self.client.get(f'/api/tickets/{ref}').status_code, 404)
        bad = self.post('/api/tickets', {'subject': '', 'message': 'x', 'email': 'bad'})
        self.assertEqual(len(bad.json()['error']['details']), 3)

    # ---------- events and bookings ----------
    def test_events_listed_with_seats_left(self):
        body = self.client.get('/api/events').json()
        self.assertEqual(body['count'], len(catalog.SLOTS))
        self.assertTrue(all(e['seats_left'] == e['capacity'] - e['booked'] for e in body['events']))

    def test_booking_flow_and_evt_409(self):
        ok = self.post('/api/events/ai-for-beginners/bookings', {'name': 'Asha', 'email': 'asha@college.edu', 'seats': 2})
        self.assertEqual(ok.status_code, 201)
        booking = ok.json()
        self.assertTrue(booking['reference'].startswith('BK-'))
        self.assertEqual(booking['email_status'], 'disabled')
        self.assertNotIn('email', booking)
        self.assertEqual(self.client.get(f"/api/bookings/{booking['reference']}").json()['seats'], 2)

        dup = self.post('/api/events/ai-for-beginners/bookings', {'name': 'Asha', 'email': 'ASHA@college.edu', 'seats': 1})
        self.assertEqual((dup.status_code, dup.json()['error']['code']), (409, 'EVT-409'))
        self.assertEqual(Event.objects.get(slug='ai-for-beginners').booked, 2, 'a refused duplicate keeps the seat count')
        full = self.post('/api/events/resume-clinic/bookings', {'name': 'Ravi', 'email': 'ravi@college.edu', 'seats': 4})
        self.assertEqual((full.status_code, full.json()['error']['code']), (409, 'EVT-409'))
        bad = self.post('/api/events/ai-for-beginners/bookings', {'name': '', 'email': 'nope', 'seats': 9})
        self.assertEqual(len(bad.json()['error']['details']), 3)
        self.assertEqual(self.post('/api/events/missing/bookings', {'name': 'A', 'email': 'a@b.co', 'seats': 1}).status_code, 404)

        cancel = self.client.patch(f"/api/admin/bookings/{booking['reference']}/cancel", **ADMIN)
        self.assertEqual(cancel.json()['status'], 'cancelled')
        self.assertEqual(Event.objects.get(slug='ai-for-beginners').booked, 0)

    def test_past_event_is_replaced_by_a_different_event(self):
        Event.objects.filter(slot='startup-talk').update(starts_at=timezone.now() - timedelta(days=2), booked=3)
        self.assertEqual(catalog.roll_forward_past_events(), 1)
        e = Event.objects.get(slot='startup-talk')
        self.assertGreater(e.starts_at, timezone.now())
        self.assertEqual((e.booked, e.variant, e.title), (0, 1, 'Cracking Product Company Interviews'))
        days = (e.starts_at - timezone.now()).total_seconds() / 86400
        self.assertTrue(18 < days < 20, days)

    def test_180_days_of_operation(self):
        """Six months, one day at a time: moving events a day earlier = the clock moving a day on."""
        titles, bookings = set(), 0
        for day in range(1, 181):
            Event.objects.update(starts_at=models_shift())
            catalog.roll_forward_past_events()
            if day % 30 == 0:
                catalog.seed()  # restarts must be safe on a live database
            events = list(Event.objects.all())
            self.assertEqual(len(events), len(catalog.SLOTS))
            now = timezone.now()
            for e in events:
                titles.add(e.title)
                ahead = (e.starts_at - now).total_seconds() / 86400
                self.assertTrue(-0.26 < ahead < 22, f'day {day}: {e.title} {ahead:.2f} days away')
                self.assertTrue(0 <= e.booked <= e.capacity)
                v = catalog.variant_for(e.slot, e.variant)
                self.assertEqual(e.title, v['title'])
                self.assertEqual(timezone.localtime(e.starts_at).hour, v['hour'])
            upcoming = [e for e in events if e.starts_at > now and e.seats_left > 0]
            if upcoming:
                target = upcoming[0]
                res = self.post(f'/api/events/{target.slug}/bookings', {'name': 'Sim', 'email': f'sim{day}@college.edu', 'seats': 1})
                bookings += res.status_code == 201
                cache.clear()  # the simulation is many days, not many requests a minute
            self.assertFalse(Booking.objects.filter(event__starts_at__lt=now - catalog.ENDED_AFTER).exists())
        all_titles = {v['title'] for s in catalog.SLOTS for v in s['variants']}
        self.assertEqual(titles, all_titles, 'every event in the catalogue appeared')
        self.assertGreater(bookings, 150)

    # ---------- monitoring, third-party API, email ----------
    def test_health_and_request_log(self):
        self.client.get('/api/bookings/BK-ABC123')
        body = self.client.get('/api/health').json()
        self.assertTrue(body['checks']['sql']['ok'])
        self.assertTrue({'mongo', 'ai', 'weather', 'email'} <= set(body['checks']))
        paths = [r['path'] for r in self.client.get('/api/logs/recent').json()['requests']]
        self.assertIn('/api/bookings/BK-******', paths, 'references are masked on the public health page')

    def test_weather_falls_back_when_services_fail(self):
        with mock.patch('helpdesk.services.weather.requests.get', side_effect=requests.Timeout()):
            body = self.client.get('/api/weather').json()
        self.assertEqual((body['source'], body['days']), ('fallback', []))
        self.assertIn('open-meteo timed out', body['reason'])

    def test_weather_uses_met_norway_when_open_meteo_is_rate_limited(self):
        met = {'properties': {'timeseries': [
            {'time': '2026-10-28T06:30:00Z', 'data': {'instant': {'details': {'air_temperature': 31.6}},
             'next_1_hours': {'summary': {'symbol_code': 'lightrainshowers_day'}, 'details': {'precipitation_amount': 1.2}}}},
        ]}}

        def fake_get(url, **kwargs):
            res = mock.Mock()
            res.ok = 'open-meteo' not in url
            res.status_code = 200 if res.ok else 429
            res.json.return_value = met
            return res

        with mock.patch('helpdesk.services.weather.requests.get', side_effect=fake_get):
            body = self.client.get('/api/weather').json()
        self.assertEqual(body['source'], 'met-norway')
        self.assertEqual(body['days'][0], {'date': '2026-10-28', 'summary': 'Rain showers', 'maxTempC': 32,
                                           'rainChance': None, 'rainMm': 1.2})

    @override_settings(BREVO_API_KEY='test-key', MAIL_FROM='events@example.com')
    def test_booking_email_sent_through_brevo(self):
        with mock.patch('helpdesk.services.mailer.requests.post', return_value=mock.Mock(ok=True, status_code=201)) as post:
            res = self.post('/api/events/startup-talk/bookings', {'name': 'Asha <b>', 'email': 'asha@college.edu', 'seats': 1})
        self.assertEqual(res.json()['email_status'], 'sent')
        sent = post.call_args.kwargs
        self.assertEqual(sent['headers']['api-key'], 'test-key')
        self.assertIn('Booking confirmed', sent['json']['subject'])
        self.assertIn('Asha &lt;b&gt;', sent['json']['htmlContent'])

    @override_settings(BREVO_API_KEY='test-key', MAIL_FROM='events@example.com')
    def test_failed_email_never_blocks_booking(self):
        with mock.patch('helpdesk.services.mailer.requests.post', side_effect=requests.Timeout()):
            res = self.post('/api/events/startup-talk/bookings', {'name': 'Asha', 'email': 'asha@college.edu', 'seats': 1})
        self.assertEqual((res.status_code, res.json()['email_status']), (201, 'failed'))
        self.assertIn('timed out', mailer.status()['detail'])

    def test_tickets_saved_in_sql(self):
        self.post('/api/tickets', {'subject': 'Hello', 'message': 'Testing the ticket form'})
        self.assertEqual(Ticket.objects.filter(subject='Hello').count(), 1)


def models_shift():
    from django.db.models import F
    return F('starts_at') - timedelta(days=1)
