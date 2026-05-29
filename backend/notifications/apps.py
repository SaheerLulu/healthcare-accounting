from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notifications'
    # This codebase shares the pharmacy Postgres DB, which already has a
    # different `notifications` app owning the `notifications_*` tables. Use a
    # distinct app label so this app gets its own `acct_notifications_*` tables
    # and migration history instead of colliding with pharmacy's.
    label = 'acct_notifications'
