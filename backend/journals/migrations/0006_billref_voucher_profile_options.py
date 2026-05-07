from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('journals', '0005_journalentry_cost_center'),
        ('core', '0012_costcategory_costcentre'),
    ]

    operations = [
        migrations.CreateModel(
            name='VoucherTypeProfile',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='User-facing name, e.g. "Cash Sales" or "Lab Purchase".', max_length=100, unique=True)),
                ('base_type', models.CharField(choices=[
                    ('PURCHASE', 'Purchase Invoice'), ('SALE', 'Sale Invoice'),
                    ('PAYMENT', 'Payment'), ('RECEIPT', 'Receipt'),
                    ('CONTRA', 'Contra'), ('JOURNAL', 'Journal'),
                    ('CREDIT_NOTE', 'Credit Note'), ('DEBIT_NOTE', 'Debit Note'),
                ], help_text='Maps to one of the 8 system voucher types.', max_length=20)),
                ('prefix', models.CharField(blank=True, help_text='Voucher number prefix, e.g. "CS-" → CS-2026-000001.', max_length=10)),
                ('numbering_method', models.CharField(choices=[('AUTO', 'Auto (sequential)'), ('MANUAL', 'Manual')], default='AUTO', max_length=10)),
                ('restart_yearly', models.BooleanField(default=True, help_text='Reset the sequence at the start of each fiscal year.')),
                ('default_narration', models.CharField(blank=True, max_length=500)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['base_type', 'name'],
            },
        ),
        migrations.AddField(
            model_name='journalentry',
            name='cost_centre',
            field=models.ForeignKey(blank=True, help_text='Tally-style cost-centre allocation (master).', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='journal_entries', to='core.costcentre'),
        ),
        migrations.AddField(
            model_name='journalentry',
            name='voucher_type_profile',
            field=models.ForeignKey(blank=True, help_text='Optional custom voucher-type profile (e.g. "Cash Sales").', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='journal_entries', to='journals.vouchertypeprofile'),
        ),
        migrations.AddField(
            model_name='journalentry',
            name='is_optional',
            field=models.BooleanField(default=False, help_text='Optional vouchers do not affect ledger balances (Tally semantics).'),
        ),
        migrations.AddField(
            model_name='journalentry',
            name='is_memorandum',
            field=models.BooleanField(default=False, help_text='Memorandum vouchers are tracked outside the books.'),
        ),
        migrations.AddField(
            model_name='journalentry',
            name='reversal_date',
            field=models.DateField(blank=True, db_index=True, help_text='If set, an auto-reversal entry will be created on this date.', null=True),
        ),
        migrations.AddField(
            model_name='journalentry',
            name='auto_reversed',
            field=models.BooleanField(default=False, help_text='Set once the auto-reverse run has created the reversal.'),
        ),
        migrations.AlterField(
            model_name='journalentry',
            name='cost_center',
            field=models.CharField(blank=True, db_index=True, help_text='Free-form cost-center label (legacy). New code should use cost_centre FK.', max_length=50),
        ),
        migrations.CreateModel(
            name='BillReference',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[
                    ('NEW', 'New Reference'),
                    ('AGAINST', 'Against Reference'),
                    ('ADVANCE', 'Advance'),
                    ('ON_ACCOUNT', 'On Account'),
                ], max_length=15)),
                ('ref_no', models.CharField(blank=True, help_text='Bill / invoice number this line refers to.', max_length=100)),
                ('ref_date', models.DateField(blank=True, null=True)),
                ('amount', models.DecimalField(decimal_places=2, default='0.00', max_digits=15)),
                ('bill_id', models.PositiveIntegerField(blank=True, db_index=True, help_text='If linked to a bill row in the bills app.', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('line', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='bill_references', to='journals.journalentryline')),
            ],
            options={
                'indexes': [
                    models.Index(fields=['ref_no'], name='journals_bi_ref_no_idx'),
                    models.Index(fields=['bill_id'], name='journals_bi_bill_id_idx'),
                ],
            },
        ),
    ]
