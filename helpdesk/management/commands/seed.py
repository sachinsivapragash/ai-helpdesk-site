from django.core.management.base import BaseCommand

from helpdesk.catalog import seed


class Command(BaseCommand):
    help = 'Load or refresh the FAQs, error codes and demo events (safe to run on every start).'

    def handle(self, *args, **options):
        seed()
        self.stdout.write(self.style.SUCCESS('Seed data is up to date.'))
