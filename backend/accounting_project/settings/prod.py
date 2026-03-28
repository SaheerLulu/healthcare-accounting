import os
import dj_database_url
from .base import *
from corsheaders.defaults import default_headers

DEBUG = False

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

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_ROOT = BASE_DIR / 'staticfiles'
