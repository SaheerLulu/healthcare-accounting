# Hand-written: composite indexes for the hottest filter paths.
# - JournalEntry(location_id, date): every store-scoped list/report filters on
#   location_id, almost always with a date range.
# - JournalEntryLine(party_type, party_id): party ledgers / aging / outstanding.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("journals", "0009_alter_journalentry_reference_type"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(
                fields=["location_id", "date"], name="journals_je_loc_date_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="journalentryline",
            index=models.Index(
                fields=["party_type", "party_id"], name="journals_jel_party_idx"
            ),
        ),
    ]
