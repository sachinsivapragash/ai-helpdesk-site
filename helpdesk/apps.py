from django.apps import AppConfig


class HelpdeskConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'helpdesk'

    def ready(self):
        # Background work (MongoDB, keep-awake) starts per process on its first request; see
        # helpdesk/services/lifecycle.py. Nothing starts here, so migrate/test/seed stay quiet.
        return
