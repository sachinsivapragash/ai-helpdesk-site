"""SQL tables: FAQs, error codes, support tickets, events and bookings."""
import secrets

from django.db import models


def new_reference(prefix):
    return f'{prefix}-{secrets.token_hex(3).upper()}'


class Faq(models.Model):
    category = models.CharField(max_length=60)
    question = models.CharField(max_length=300, unique=True)
    answer = models.TextField()
    keywords = models.TextField(blank=True, default='')
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order']

    def __str__(self):
        return self.question


class ErrorCode(models.Model):
    code = models.CharField(max_length=20, primary_key=True)
    http_status = models.IntegerField()
    title = models.CharField(max_length=120)
    meaning = models.TextField()
    user_action = models.TextField()
    site_specific = models.BooleanField(default=False)

    class Meta:
        ordering = ['site_specific', 'http_status', 'code']

    def __str__(self):
        return self.code


class Ticket(models.Model):
    STATUSES = ['open', 'in_progress', 'resolved', 'closed']

    reference = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    subject = models.CharField(max_length=150)
    message = models.TextField()
    source = models.CharField(max_length=20, default='form')
    status = models.CharField(max_length=20, default='open', choices=[(s, s) for s in STATUSES])
    session_id = models.CharField(max_length=64, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = new_reference('TCK')
        super().save(*args, **kwargs)

    def public(self):
        return {
            'reference': self.reference, 'subject': self.subject, 'status': self.status, 'source': self.source,
            'created_at': self.created_at.isoformat(), 'updated_at': self.updated_at.isoformat(),
        }

    def full(self):
        return {**self.public(), 'id': self.id, 'name': self.name, 'email': self.email, 'message': self.message,
                'session_id': self.session_id}


class Event(models.Model):
    # Each slot shows one event at a time from helpdesk/catalog.py; variant says which one.
    slot = models.CharField(max_length=60, unique=True)
    variant = models.IntegerField(default=0)
    slug = models.SlugField(max_length=80, unique=True)
    title = models.CharField(max_length=150)
    category = models.CharField(max_length=40)
    description = models.TextField()
    venue = models.CharField(max_length=120)
    starts_at = models.DateTimeField()
    price = models.IntegerField(default=0)
    capacity = models.PositiveIntegerField()
    booked = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['starts_at']
        constraints = [models.CheckConstraint(condition=models.Q(booked__lte=models.F('capacity')), name='booked_within_capacity')]

    @property
    def seats_left(self):
        return self.capacity - self.booked

    def to_dict(self):
        return {
            'id': self.id, 'slug': self.slug, 'title': self.title, 'category': self.category,
            'description': self.description, 'venue': self.venue, 'starts_at': self.starts_at.isoformat(),
            'price': self.price, 'capacity': self.capacity, 'booked': self.booked, 'seats_left': self.seats_left,
        }


class Booking(models.Model):
    reference = models.CharField(max_length=20, unique=True)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='bookings')
    name = models.CharField(max_length=100)
    email = models.EmailField()
    seats = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, default='confirmed', choices=[('confirmed', 'confirmed'), ('cancelled', 'cancelled')])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['event', 'email'], name='one_booking_per_email_per_event')]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = new_reference('BK')
        super().save(*args, **kwargs)
