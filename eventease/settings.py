"""Django settings for EventEase. Every secret comes from environment variables."""
import os
import sys
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

env = os.environ.get

# A missing DJANGO_SECRET_KEY is only acceptable locally; Render generates one (see render.yaml).
SECRET_KEY = env('DJANGO_SECRET_KEY', 'dev-only-insecure-key-change-me')
DEBUG = env('DJANGO_DEBUG', 'false').lower() == 'true'

ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'testserver']
if env('RENDER_EXTERNAL_HOSTNAME'):  # set automatically by Render
    ALLOWED_HOSTS.append(env('RENDER_EXTERNAL_HOSTNAME'))
ALLOWED_HOSTS += [h.strip() for h in env('ALLOWED_HOSTS', '').split(',') if h.strip()]
CSRF_TRUSTED_ORIGINS = [f'https://{h}' for h in ALLOWED_HOSTS if '.' in h and h != '127.0.0.1']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    'helpdesk',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'helpdesk.middleware.RequestLogMiddleware',
    'helpdesk.middleware.SecurityHeadersMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'helpdesk.views.DatabaseDownMiddleware',
]

ROOT_URLCONF = 'eventease.urls'
APPEND_SLASH = False
WSGI_APPLICATION = 'eventease.wsgi.application'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': ['helpdesk.context.site']},
}]

# PostgreSQL (Neon) when DATABASE_URL is set; a local SQLite file otherwise.
DATABASES = {
    'default': dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=60,
        conn_health_checks=True,  # Neon closes idle connections; check before reuse
    )
}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LANGUAGE_CODE = 'en-in'
TIME_ZONE = env('CAMPUS_TIMEZONE', 'Asia/Kolkata')
USE_I18N = False
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
if not DEBUG and env('RENDER'):
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 15552000

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '%(message)s'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
        # Keep test output readable: request lines and expected service warnings are hidden in tests.
        'requests': {'level': 'WARNING' if 'test' in sys.argv else 'INFO'},
        'helpdesk': {'level': 'ERROR' if 'test' in sys.argv else 'INFO'},
    },
}

# ---------- EventEase settings ----------
SITE = {
    'name': env('SITE_NAME', 'EventEase'),
    'campus': env('CAMPUS_NAME', 'colleges in Coimbatore'),
    'city': env('CAMPUS_CITY', 'Coimbatore'),
    'lat': float(env('CAMPUS_LAT', '11.0168')),
    'lon': float(env('CAMPUS_LON', '76.9558')),
    'timezone': TIME_ZONE,
}
OWNER = {
    'name': env('SITE_OWNER_NAME', 'Your Name'),
    'email': env('SITE_OWNER_EMAIL', 'you@example.com'),
    'github': env('GITHUB_USERNAME', 'octocat'),
}
ADMIN_TOKEN = env('ADMIN_TOKEN', '')
MONGODB_URI = env('MONGODB_URI', '')
MONGODB_DB = env('MONGODB_DB', 'helpdesk')
GEMINI_API_KEY = env('GEMINI_API_KEY', '')
GEMINI_MODEL = env('GEMINI_MODEL', 'gemini-flash-lite-latest')
GEMINI_BACKUP_MODEL = env('GEMINI_BACKUP_MODEL', 'gemini-flash-latest')
ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY', '')
CLAUDE_MODEL = env('CLAUDE_MODEL', 'claude-opus-5-5')
AI_TIMEOUT = float(env('AI_TIMEOUT_MS', '15000')) / 1000
WEATHER_TIMEOUT = float(env('WEATHER_TIMEOUT_MS', '3000')) / 1000
BREVO_API_KEY = env('BREVO_API_KEY', '')
MAIL_FROM = env('MAIL_FROM', '')
MAIL_TIMEOUT = float(env('MAIL_TIMEOUT_MS', '5000')) / 1000
