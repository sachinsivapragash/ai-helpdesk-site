from django.urls import path

from . import api, views

urlpatterns = [
    path('', views.page('index'), name='home'),
    *[path(name, views.page(name), name=name) for name in views.PAGES if name != 'index'],
    path('projects', views.old_projects),
    path('demo/500', views.demo_500),

    path('api/health', api.health),
    path('api/logs/recent', api.logs_recent),
    path('api/faqs', api.faqs),
    path('api/error-codes', api.error_codes),
    path('api/error-codes/<str:code>', api.error_code),
    path('api/chat', api.chat),
    path('api/feedback', api.feedback),
    path('api/tickets', api.tickets_create),
    path('api/tickets/<str:reference>', api.ticket_detail),
    path('api/admin/tickets', api.admin_tickets),
    path('api/admin/tickets/<str:reference>', api.admin_ticket),
    path('api/admin/stats', api.admin_stats),
    path('api/events', api.events),
    path('api/events/<slug:slug>', api.event_detail),
    path('api/events/<slug:slug>/bookings', api.book),
    path('api/bookings/<str:reference>', api.booking_detail),
    path('api/admin/bookings', api.admin_bookings),
    path('api/admin/bookings/<str:reference>/cancel', api.admin_cancel_booking),
    path('api/weather', api.weather_forecast),
]
