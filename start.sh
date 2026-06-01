#!/usr/bin/env bash
# Start both accounting backend and frontend dev servers

# Resolve absolute path of this script's directory regardless of where it's called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# The shared healthcare_inv DB uses the 'openpg' role, not the postgres/postgres
# default in settings. Pull POSTGRES_* from the pharmacy app's .env (if present)
# so the backend connects without per-shell setup. Skips silently if absent.
PHARMACY_ENV="$SCRIPT_DIR/../healthcare-pharmacy/backend/.env"
if [ -f "$PHARMACY_ENV" ]; then
  echo "Loading DB credentials from pharmacy .env ..."
  set -a; . "$PHARMACY_ENV"; set +a
fi

echo "Applying database migrations ..."
(cd "$BACKEND_DIR" && DJANGO_SETTINGS_MODULE=accounting_project.settings.dev \
  .venv/bin/python manage.py migrate)

echo "Starting Accounting Backend on http://localhost:8001 ..."
(cd "$BACKEND_DIR" && DJANGO_SETTINGS_MODULE=accounting_project.settings.dev \
  .venv/bin/python manage.py runserver 8001) &
BACKEND_PID=$!

echo "Starting Accounting Frontend on http://localhost:5174 ..."
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "Backend  PID: $BACKEND_PID  → http://localhost:8001"
echo "Frontend PID: $FRONTEND_PID → http://localhost:5174"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
