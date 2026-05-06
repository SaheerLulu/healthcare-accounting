"""Settings for the test suite.

Inherits everything from base.py but switches to an isolated SQLite DB so
tests don't touch the shared inventory database. The `inventory_reader`
proxy models are `managed=False`, so the test DB has no inventory tables —
sync tests use the `IntegrationDataMixin` (in core/tests/utils.py) to
monkeypatch those querysets when they need them.
"""
from .base import *  # noqa: F401,F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Speed: in-memory cache for sessions, no need for the file logger
LOGGING = {
    'version': 1,
    'disable_existing_loggers': True,
    'handlers': {'null': {'class': 'logging.NullHandler'}},
    'root': {'handlers': ['null'], 'level': 'CRITICAL'},
}

# Faster password hashing for tests (CryptPasswordHasher etc are slow)
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

# Skip the active-location middleware in tests — tests pass location_id
# explicitly into models or set X-Location-Id when testing the API.
MIDDLEWARE = [m for m in MIDDLEWARE if 'ActiveLocationMiddleware' not in m]  # noqa: F405

# Our test runner uses the default Django test runner.
TEST_RUNNER = 'django.test.runner.DiscoverRunner'
