import os
import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from .base import *
from corsheaders.defaults import default_headers

DEBUG = False

# Refuse to start in production with the publicly-known fallback SECRET_KEY —
# anyone with the repo could otherwise forge JWTs and session cookies.
# (deploy/docker-compose.prod.yml and the deploy workflow always supply it;
# the Docker image build uses a placeholder env var for collectstatic only.)
if not os.environ.get('DJANGO_SECRET_KEY'):
    raise ImproperlyConfigured(
        'DJANGO_SECRET_KEY environment variable must be set in production.'
    )

# ---------------------------------------------------------------------------
# Hosts & CORS
# ---------------------------------------------------------------------------
ALLOWED_HOSTS = os.environ.get(
    'DJANGO_ALLOWED_HOSTS',
    'devaccounting.seefmed.com,localhost,127.0.0.1'
).split(',')

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'https://devaccounting.seefmed.com'
).split(',')
CSRF_TRUSTED_ORIGINS = os.environ.get(
    'CSRF_TRUSTED_ORIGINS',
    'https://devaccounting.seefmed.com'
).split(',')
CORS_ALLOW_HEADERS = list(default_headers) + ['x-location-id']

# ---------------------------------------------------------------------------
# Database – use DATABASE_URL (shared PostgreSQL with inventory)
# ---------------------------------------------------------------------------
if os.environ.get('DATABASE_URL'):
    DATABASES = {
        'default': dj_database_url.config(conn_max_age=600),
    }

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'SAMEORIGIN'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
# Session/CSRF cookies only ever travel over HTTPS (all prod origins are https).
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_ROOT = BASE_DIR / 'staticfiles'

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{asctime} {levelname} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': str(BASE_DIR / 'logs' / 'accounting.log'),
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 5,
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': 'INFO',
    },
    'loggers': {
        'sync': {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
        'journals': {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
        'gst_returns': {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
        'tds': {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
    },
}
