# ---------- Backend Dockerfile ----------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Collect static files
RUN DJANGO_ENV=production DJANGO_SECRET_KEY=build-placeholder \
    python manage.py collectstatic --noinput || true

EXPOSE 8000

CMD ["gunicorn", "accounting_project.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "1800"]
