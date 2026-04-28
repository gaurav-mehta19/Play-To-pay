from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payouts', '0001_initial'),
    ]

    operations = [
        migrations.RenameField(
            model_name='idempotencyrecord',
            old_name='response_json',
            new_name='response_body',
        ),
        migrations.AlterField(
            model_name='idempotencyrecord',
            name='response_body',
            field=models.TextField(blank=True, null=True),
        ),
    ]
