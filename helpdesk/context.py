import time

from django.conf import settings

# Changes on every deploy/restart so browsers fetch fresh JS and CSS.
ASSET_VERSION = format(int(time.time()), 'x')


def site(request):
    return {
        'siteName': settings.SITE['name'], 'campus': settings.SITE['campus'], 'city': settings.SITE['city'],
        'ownerName': settings.OWNER['name'], 'ownerEmail': settings.OWNER['email'], 'github': settings.OWNER['github'],
        'year': time.localtime().tm_year, 'assetVersion': ASSET_VERSION,
    }
