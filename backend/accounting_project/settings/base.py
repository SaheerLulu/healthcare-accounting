"""
Django base settings – shared across dev and prod.
"""
import os
from pathlib import Path
from datetime import timedelta

# Build paths inside the project like this: BASE_DIR / 'subdir'.
# BASE_DIR points to the backend/ folder (parent of accounting_project/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
_SECRET_KEY_ENV = os.environ.get('DJANGO_SECRET_KEY')
# WARNING: Set DJANGO_SECRET_KEY environment variable in production.
# The fallback below is intentionally insecure and must NOT be used in prod.
if not _SECRET_KEY_ENV:
    import warnings
    warnings.warn(
        "DJANGO_SECRET_KEY environment variable is not set. "
        "Using insecure fallback key – this is only safe in local development.",
        stacklevel=2,
    )
SECRET_KEY = _SECRET_KEY_ENV or 'django-insecure--3fejku$$i93u7o15lm79*vl1tve0*tsl8em6hx1x8y4@=k4hr'

ALLOWED_HOSTS = ['*']

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    # Accounting modules
    'inventory_reader',
    'core',
    'journals',
    'gst_returns',
    'tds',
    'reports',
    'sync',
    'audit',
    'payroll',
    'parties',
    'bills',
    'banking',
    'expenses',
    'fixed_assets',
    'loans',
    'notifications',
    'budgets',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'core.middleware.ActiveLocationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'accounting_project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'accounting_project.wsgi.application'

# ---------------------------------------------------------------------------
# Database – shared Postgres with healthcare-inventory-management & dashboard.
# Override priority: DATABASE_URL > POSTGRES_* env vars > auto-detected defaults.
# On WSL2 the Windows host is the default-route gateway, and that IP changes
# between WSL sessions — re-derive it on every startup.
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if DATABASE_URL:
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.parse(DATABASE_URL, conn_max_age=600),
    }
else:
    def _default_postgres_host():
        try:
            with open('/proc/sys/kernel/osrelease') as f:
                if 'microsoft' not in f.read().lower():
                    return 'localhost'
        except OSError:
            return 'localhost'
        try:
            import subprocess
            out = subprocess.check_output(['ip', 'route', 'show', 'default'], text=True)
            for tok in out.split():
                if tok.count('.') == 3:
                    return tok
        except Exception:
            pass
        return 'localhost'

    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('POSTGRES_DB', 'healthcare_inv'),
            'USER': os.environ.get('POSTGRES_USER', 'postgres'),
            'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'postgres'),
            'HOST': os.environ.get('POSTGRES_HOST') or _default_postgres_host(),
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
            # CONN_MAX_AGE=0 (the default) closes connections at request end,
            # which prevents Postgres from hitting max_connections when the
            # dev server, pipelines, and shells all share the same DB.
        }
    }

# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static & Media files
# ---------------------------------------------------------------------------
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = True

# ---------------------------------------------------------------------------
# REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    # Map Django ValidationError / PeriodLockedError raised below the serializer
    # (in services & model saves) to clean 400s instead of leaking HTTP 500s.
    'EXCEPTION_HANDLER': 'core.exception_handler.custom_exception_handler',
}

# ---------------------------------------------------------------------------
# JWT – uses the same SECRET_KEY so tokens issued by the inventory app are
# accepted here without re-login.
# ---------------------------------------------------------------------------
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
    'TOKEN_TYPE_CLAIM': 'token_type',
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

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
            'filename': str(LOG_DIR / 'accounting.log'),
            'maxBytes': 10 * 1024 * 1024,  # 10 MB
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

# ---------------------------------------------------------------------------
# Accounting – fiscal year starts in April (month 4) per Indian standard
# ---------------------------------------------------------------------------
ACCOUNTING_FY_START_MONTH = 4

# ---------------------------------------------------------------------------
# Per-party ledgers (Tally Sundry Creditor/Debtor model). When True, party
# postings route to a per-party leaf ledger under 2105/1125 instead of the
# shared 2110/1130 control. Set False for staged rollout / fallback.
#
# Defaults ON at runtime, but OFF under the test runner so the large existing
# suite keeps asserting the established control-account behaviour. Feature
# tests opt in explicitly with @override_settings(PARTY_LEDGERS_ENABLED=True).
# ---------------------------------------------------------------------------
import sys as _sys
_TESTING = ('test' in _sys.argv) or ('pytest' in _sys.modules)
PARTY_LEDGERS_ENABLED = (
    os.environ.get('PARTY_LEDGERS_ENABLED', 'true').lower() != 'false'
    and not _TESTING
)

# Customer types that are walk-in/retail (B2C) and do NOT get a proactively
# created ledger — every other (B2B / Hospital / Clinic / Corporate / …)
# customer does. Inventory customer_type values are Retail / B2B / Hospital /
# Clinic. (Retail credit sales still create a ledger lazily if a receivable
# actually arises.)
PARTY_LEDGER_RETAIL_CUSTOMER_TYPES = ('Retail', '')
