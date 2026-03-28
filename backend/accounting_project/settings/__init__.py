import os

env = os.environ.get('DJANGO_ENV', 'development')

if env == 'production':
    from .prod import *
else:
    from .dev import *
