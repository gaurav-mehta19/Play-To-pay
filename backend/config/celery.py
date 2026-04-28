import os
from celery import Celery
from datetime import timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('playtopay')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.conf.beat_schedule = {
    'detect-stuck-payouts': {
        'task': 'payouts.tasks.detect_stuck_payouts',
        'schedule': timedelta(seconds=15),
    },
}
