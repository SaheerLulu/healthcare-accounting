"""Drop AccountingSettings.stock_method.

The system is now single-mode perpetual inventory — purchases hit 1190
Closing Stock (ASSET), every sale posts COGS to 5560 / credits 1190. The
stock_method toggle and the periodic-mode branches it gated are gone.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0016_backfill_chart_of_accounts'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='accountingsettings',
            name='stock_method',
        ),
    ]
