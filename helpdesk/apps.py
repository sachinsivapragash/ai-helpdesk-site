import os
import sys

from django.apps import AppConfig


class HelpdeskConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'helpdesk'

    def ready(self):
        # Start background connections only when serving requests, not for migrate/test/etc.
        serving = 'gunicorn' in os.path.basename(sys.argv[0]) or 'runserver' in sys.argv
        if serving:
            from .services import keepawake, mongo
            mongo.start()
            keepawake.start()
