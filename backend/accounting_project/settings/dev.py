import os
from .base import *

# DEBUG defaults on for frictionless local development, but the public dev
# deployment (deploy/docker-compose.dev.yml, behind real TLS at
# devaccounting.seefmed.com) sets DJANGO_DEBUG=False — a reachable server
# must never expose Django tracebacks/settings.
DEBUG = os.environ.get('DJANGO_DEBUG', 'True').strip().lower() not in (
    'false', '0', 'no')

# Hosts: base.py already honours DJANGO_ALLOWED_HOSTS (comma list). The '*'
# fallback is acceptable only while DEBUG; a non-debug dev deployment that
# didn't set the env gets the same safe default as prod.
if not DEBUG and ALLOWED_HOSTS == ['*']:
    ALLOWED_HOSTS = ['devaccounting.seefmed.com', 'localhost', '127.0.0.1']

# CORS: an explicit DJANGO_CORS_ALLOWED_ORIGINS allowlist always wins over
# allow-all; otherwise allow-all is only kept while DEBUG (local dev with the
# Vite proxy). Mirrors prod.py's allowlist pattern.
_cors_origins = [
    o.strip()
    for o in os.environ.get('DJANGO_CORS_ALLOWED_ORIGINS', '').split(',')
    if o.strip()
]
if _cors_origins:
    from corsheaders.defaults import default_headers
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = _cors_origins
    CORS_ALLOW_HEADERS = list(default_headers) + ['x-location-id']
    CSRF_TRUSTED_ORIGINS = [o for o in _cors_origins if o.startswith('http')]
else:
    CORS_ALLOW_ALL_ORIGINS = DEBUG

# Use PostgreSQL via DATABASE_URL in Docker, fall back to SQLite locally
if os.environ.get('DATABASE_URL'):
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.config(conn_max_age=600),
    }
