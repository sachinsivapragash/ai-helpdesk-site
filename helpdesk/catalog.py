"""Demo content: FAQs, error codes and rotating events, kept up to date in the database.

Each of the event slots shows one event at a time. When it has ended (6 hours after its start),
the slot moves three weeks ahead and shows the next, different event from its list, with all
seats free again, so the site always has fresh upcoming events.
"""
import json
import logging
import math
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Booking, ErrorCode, Event, Faq

log = logging.getLogger(__name__)
DATA = Path(__file__).resolve().parent / 'data'
STEP_DAYS = 21
ENDED_AFTER = timedelta(hours=6)


def _load(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


def _fill(text):
    return text.format(site=settings.SITE['name'], campus=settings.SITE['campus'],
                       owner=settings.OWNER['name'], email=settings.OWNER['email'], github=settings.OWNER['github'])


SLOTS = _load('event_catalog.json')


def variant_for(slot, variant):
    s = next((x for x in SLOTS if x['slot'] == slot), None)
    if not s:
        return None
    return {**s['variants'][variant % len(s['variants'])], 'category': s['category']}


def local_start(day, hour):
    """A timezone-aware datetime for `hour`:00 on `day` in the campus time zone."""
    tz = ZoneInfo(settings.SITE['timezone'])
    return datetime.combine(day, time(hour=hour), tzinfo=tz)


@transaction.atomic
def seed():
    faqs = _load('faqs.json')
    for i, f in enumerate(faqs, start=1):
        Faq.objects.update_or_create(question=_fill(f['question']), defaults={
            'category': f['category'], 'answer': _fill(f['answer']), 'keywords': f['keywords'], 'sort_order': i})
    Faq.objects.exclude(question__in=[_fill(f['question']) for f in faqs]).delete()

    codes = _load('error_codes.json')
    for c in codes:
        ErrorCode.objects.update_or_create(code=c['code'], defaults={
            'http_status': c['http_status'], 'title': c['title'], 'meaning': _fill(c['meaning']),
            'user_action': c['user_action'], 'site_specific': bool(c.get('site_specific'))})
    ErrorCode.objects.exclude(code__in=[c['code'] for c in codes]).delete()

    today = timezone.localdate()
    for s in SLOTS:
        first = s['variants'][0]
        event, created = Event.objects.get_or_create(slot=s['slot'], defaults={
            'variant': 0, 'slug': first['slug'], 'title': first['title'], 'category': s['category'],
            'description': first['description'], 'venue': first['venue'], 'price': first['price'],
            'capacity': first['capacity'], 'starts_at': local_start(today + timedelta(days=s['days']), first['hour'])})
        if not created:  # keep date and bookings, refresh the text from the catalogue
            v = variant_for(s['slot'], event.variant)
            for field in ('slug', 'title', 'category', 'description', 'venue', 'price'):
                setattr(event, field, v[field])
            event.capacity = max(v['capacity'], event.booked)
            event.save()
    roll_forward_past_events()


def roll_forward_past_events(now=None):
    now = now or timezone.now()
    moved = 0
    for event in Event.objects.filter(starts_at__lt=now - ENDED_AFTER):
        overdue = (now - ENDED_AFTER - event.starts_at).total_seconds()
        steps = max(1, math.ceil(overdue / (STEP_DAYS * 86400)))
        with transaction.atomic():
            Booking.objects.filter(event=event).delete()
            nxt = variant_for(event.slot, event.variant + steps)
            local_day = timezone.localtime(event.starts_at).date() + timedelta(days=STEP_DAYS * steps)
            if nxt:
                event.variant += steps
                for field in ('slug', 'title', 'category', 'description', 'venue', 'price', 'capacity'):
                    setattr(event, field, nxt[field])
                event.starts_at = local_start(local_day, nxt['hour'])
            else:
                event.starts_at += timedelta(days=STEP_DAYS * steps)
            event.booked = 0
            event.save()
        moved += 1
    if moved:
        log.info('[events] moved %s past event(s) forward to their next event', moved)
    return moved
