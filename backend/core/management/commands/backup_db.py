"""
Daily DB backup with rotation. Designed to run from cron.

Usage examples:
  python manage.py backup_db                       # default dest = backend/backups
  python manage.py backup_db --dest /var/backups   # custom dest
  python manage.py backup_db --keep 14             # retention (default 30)
  python manage.py backup_db --gpg-recipient ops@biloop.ai  # encrypt with GPG

Cron suggestion: `15 2 * * * cd /app/backend && .venv/bin/python manage.py backup_db --keep 30`
"""
import gzip
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Back up the configured database to a gzipped (and optionally GPG-encrypted) file.'

    def add_arguments(self, parser):
        parser.add_argument('--dest', default=None,
                            help='Destination directory (default: <BASE_DIR>/backups)')
        parser.add_argument('--keep', type=int, default=30,
                            help='Number of recent backup files to keep (default 30)')
        parser.add_argument('--gpg-recipient', default=None,
                            help='If set, pipe through `gpg --encrypt -r <recipient>`.')

    def handle(self, *args, **opts):
        db = settings.DATABASES['default']
        engine = db['ENGINE']
        ts = datetime.now().strftime('%Y%m%d-%H%M%S')

        dest_dir = Path(opts['dest'] or (Path(settings.BASE_DIR) / 'backups'))
        dest_dir.mkdir(parents=True, exist_ok=True)

        if 'sqlite' in engine:
            src = Path(db['NAME'])
            if not src.exists():
                raise CommandError(f'SQLite file not found: {src}')
            target = dest_dir / f'sqlite-{src.stem}-{ts}.sqlite3.gz'
            with src.open('rb') as fin, gzip.open(target, 'wb') as fout:
                shutil.copyfileobj(fin, fout)
        elif 'postgres' in engine:
            target = dest_dir / f'pg-{db["NAME"]}-{ts}.sql.gz'
            env_pw = {'PGPASSWORD': db.get('PASSWORD', '')}
            cmd = [
                'pg_dump',
                '-h', db.get('HOST') or 'localhost',
                '-p', str(db.get('PORT') or 5432),
                '-U', db.get('USER') or '',
                '--no-owner', '--no-acl',
                db['NAME'],
            ]
            with gzip.open(target, 'wb') as fout:
                proc = subprocess.run(cmd, stdout=subprocess.PIPE, env={**env_pw}, check=True)
                fout.write(proc.stdout)
        else:
            raise CommandError(f'Unsupported DB engine: {engine}')

        # Optional encryption
        if opts['gpg_recipient']:
            enc_target = target.with_suffix(target.suffix + '.gpg')
            subprocess.run(
                ['gpg', '--yes', '--batch', '--encrypt',
                 '-r', opts['gpg_recipient'], '-o', str(enc_target), str(target)],
                check=True,
            )
            target.unlink()
            target = enc_target

        self.stdout.write(self.style.SUCCESS(f'Backup written: {target}'))

        # Retention — keep newest `keep`, delete the rest
        keep = opts['keep']
        existing = sorted(
            [p for p in dest_dir.iterdir() if p.is_file() and p.name.startswith(('sqlite-', 'pg-'))],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in existing[keep:]:
            old.unlink()
            self.stdout.write(self.style.WARNING(f'  pruned old backup: {old.name}'))
