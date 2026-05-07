from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0011_accountingsettings_bill_approval_threshold_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='CostCategory',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, unique=True)),
                ('description', models.CharField(blank=True, max_length=255)),
                ('allocate_revenue', models.BooleanField(default=True, help_text='Whether this category applies to revenue ledgers (Tally semantics).')),
                ('allocate_non_revenue', models.BooleanField(default=True, help_text='Whether this category applies to non-revenue ledgers.')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['name'],
                'verbose_name_plural': 'Cost Categories',
            },
        ),
        migrations.CreateModel(
            name='CostCentre',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('code', models.CharField(blank=True, help_text='Short label', max_length=20)),
                ('location_id', models.IntegerField(blank=True, help_text='Optional inventory-system location to scope this centre.', null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('description', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='centres', to='core.costcategory')),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='core.costcentre')),
            ],
            options={
                'ordering': ['category__name', 'name'],
                'unique_together': {('category', 'name')},
            },
        ),
    ]
