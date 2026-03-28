import os
from .base import *

DEBUG = True

# Use PostgreSQL via DATABASE_URL in Docker, fall back to SQLite locally
if os.environ.get('DATABASE_URL'):
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.config(conn_max_age=600),
    }
