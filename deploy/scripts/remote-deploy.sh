#!/usr/bin/env bash
# ============================================================
# remote-deploy.sh — runs ON the target server, invoked over
# SSH by the "Build & Deploy" GitHub Actions workflow.
#
# Pulls the images built in CI, rolls this environment's
# compose stack, then refreshes the nginx vhost and TLS cert.
#
# Required env:
#   ENV_NAME        biloop-dev | biloop-prod | seefmed-dev | seefmed-prod
#   DOMAIN          public hostname of this environment
#   BACKEND_IMAGE   full GHCR image ref pinned to the commit SHA
#   FRONTEND_IMAGE  full GHCR image ref pinned to the commit SHA
#   REGISTRY_USER   GHCR username (github.actor)
#   REGISTRY_TOKEN  GHCR token (the job's GITHUB_TOKEN)
# Optional env:
#   DATABASE_URL    — overrides (and is persisted into) the env
#       file's DATABASE_URL; set as a per-environment GitHub secret
#   DJANGO_SECRET_KEY, POSTGRES_PASSWORD  — used only when
#       bootstrapping a missing .env from its example file
#   CERTBOT_EMAIL   default info@biloop.ai
#   APP_BASE        default /opt/accounting
# ============================================================
set -euo pipefail

: "${ENV_NAME:?}" "${DOMAIN:?}" "${BACKEND_IMAGE:?}" "${FRONTEND_IMAGE:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"

APP_BASE="${APP_BASE:-/opt/accounting}"
REPO_DIR="${APP_BASE}/repo-${ENV_NAME}"
ENV_DIR="${APP_BASE}/${ENV_NAME}"
ENV_FILE="${ENV_DIR}/.env"
COMPOSE_FILE="${REPO_DIR}/deploy/docker-compose.app.yml"
PROJECT="accounting-${ENV_NAME}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-info@biloop.ai}"

log() { echo "[deploy ${ENV_NAME}] $*"; }

SUDO="sudo -n"
[ "$(id -u)" = "0" ] && SUDO=""

log "=== Deployment started at $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
log "backend image:  ${BACKEND_IMAGE}"
log "frontend image: ${FRONTEND_IMAGE}"

# ---- 1. Environment file -----------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "No ${ENV_FILE} — bootstrapping from example"
  mkdir -p "$ENV_DIR"
  cp "${REPO_DIR}/deploy/envs/.env.${ENV_NAME}.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if [ -n "${DJANGO_SECRET_KEY:-}" ]; then
    sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}|" "$ENV_FILE"
  else
    sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$(openssl rand -hex 48)|" "$ENV_FILE"
  fi
  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    sed -i "s|\(postgres://[^:]*:\)[^@]*@|\1${POSTGRES_PASSWORD}@|" "$ENV_FILE"
  fi
fi

FRONTEND_PORT="$(grep -E '^FRONTEND_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
[ -n "$FRONTEND_PORT" ] || { log "ERROR: FRONTEND_PORT missing from ${ENV_FILE}"; exit 1; }

# DATABASE_URL passed from GitHub (per-environment secret) wins and is
# persisted into the env file, so manual `compose up` on the server uses
# the same database; otherwise the env file's value is used.
if [ -n "${DATABASE_URL:-}" ]; then
  log "Using DATABASE_URL from GitHub secret"
  grep -vE '^DATABASE_URL=' "$ENV_FILE" > "${ENV_FILE}.tmp"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL" >> "${ENV_FILE}.tmp"
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
fi

# ---- 2. PostgreSQL on the host (idempotent) ----------------
# The accounting app shares the pharmacy app's database. Postgres
# itself is installed by the pharmacy deploy, which also creates
# the role and database. We only bootstrap them on a genuinely
# fresh env — and never let that step fail the deploy, since the
# app's own connection is the real source of truth.
DB_NAME="${DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
DB_USER="$(echo "$DATABASE_URL" | sed -E 's|^[a-z]+://([^:/@]+).*|\1|')"
DB_PASS="$(echo "$DATABASE_URL" | sed -E 's|^[a-z]+://[^:]+:([^@]*)@.*|\1|')"
DB_PORT="$(echo "$DATABASE_URL" | sed -nE 's|^[a-z]+://[^@]+@[^:/]+:([0-9]+)/.*|\1|p')"
DB_PORT="${DB_PORT:-5432}"

case "$DATABASE_URL" in
  *host.docker.internal*|*localhost*|*127.0.0.1*)
    if ! command -v psql >/dev/null 2>&1; then
      log "ERROR: PostgreSQL is not installed on this server."
      log "The accounting app shares the pharmacy database — deploy the pharmacy app first."
      exit 1
    fi
    # If the app role can already reach its database, it's provisioned
    # (the pharmacy deploy owns it) — nothing for us to bootstrap. This
    # is the same TCP connection Django makes, so it's the real test.
    if PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; then
      log "Database ${DB_NAME} reachable as ${DB_USER} — skipping superuser bootstrap"
    elif sudo -n -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1; then
      # Fresh env: we can act as the postgres superuser, so create them.
      if ! sudo -n -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
        log "Creating PostgreSQL role ${DB_USER}"
        sudo -n -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASS//\'/\'\'}';
SQL
      fi
      if ! sudo -n -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
        log "Creating database ${DB_NAME}"
        sudo -n -u postgres createdb -O "$DB_USER" "$DB_NAME"
      fi
    else
      # Neither the app role nor the postgres superuser could connect
      # (superuser login is commonly disabled for hardening). Assume the
      # pharmacy deploy already provisioned the role/database; the app's
      # own DB connection below will surface any real problem.
      log "WARNING: cannot reach ${DB_NAME} as ${DB_USER} and the postgres"
      log "         superuser is unavailable — assuming the pharmacy deploy"
      log "         already provisioned the role/database, continuing."
    fi
    ;;
  *)
    log "External DATABASE_URL — skipping local PostgreSQL setup"
    ;;
esac

# ---- 3. Pull images and roll the stack ---------------------
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin

export BACKEND_IMAGE FRONTEND_IMAGE
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

log "Pulling images"
compose pull --quiet
log "Rolling stack ${PROJECT}"
compose up -d --remove-orphans

# ---- 4. Nginx vhost + TLS ----------------------------------
render_vhost() {
  DOMAIN="$DOMAIN" FRONTEND_PORT="$FRONTEND_PORT" \
    envsubst '${DOMAIN} ${FRONTEND_PORT}' <"${REPO_DIR}/deploy/nginx/$1" >"/tmp/${DOMAIN}.conf"
  $SUDO mv "/tmp/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}.conf"
  $SUDO ln -sf "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
}

reload_nginx() {
  if $SUDO nginx -t 2>&1; then
    $SUDO systemctl reload nginx
    return 0
  fi
  log "WARNING: nginx config test failed — reload skipped"
  return 1
}

if command -v nginx >/dev/null 2>&1; then
  command -v envsubst >/dev/null 2>&1 || { $SUDO apt-get update -qq; $SUDO apt-get install -y -qq gettext-base; }
  $SUDO mkdir -p /var/www/certbot
  $SUDO rm -f /etc/nginx/sites-enabled/default
  if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    render_vhost site.conf.template
    reload_nginx || true
  else
    log "No certificate for ${DOMAIN} yet — installing HTTP bootstrap vhost"
    render_vhost site.bootstrap.conf.template
    if reload_nginx && command -v certbot >/dev/null 2>&1; then
      log "Requesting Let's Encrypt certificate for ${DOMAIN}"
      if $SUDO certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
           --non-interactive --agree-tos -m "$CERTBOT_EMAIL"; then
        render_vhost site.conf.template
        reload_nginx || true
        log "HTTPS enabled for ${DOMAIN}"
      else
        log "WARNING: certbot failed (is DNS for ${DOMAIN} pointing at this server?) — staying on HTTP"
      fi
    fi
  fi
else
  log "WARNING: nginx not installed — skipped vhost setup"
fi

# ---- 5. Health check ---------------------------------------
sleep 10
compose ps || true
if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:${FRONTEND_PORT}/"; then
  log "Frontend responding on port ${FRONTEND_PORT}"
else
  log "WARNING: frontend not responding on port ${FRONTEND_PORT}"
  compose logs --tail=40 || true
fi
compose logs --tail=15 backend || true

# ---- 6. Cleanup old images ---------------------------------
docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true

log "=== Deployment finished at $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
