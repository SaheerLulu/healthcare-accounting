#!/usr/bin/env bash
# ============================================================
# deploy.sh – Deploy accounting app (dev)
# Called by GitHub Actions or manually:
#   bash deploy/scripts/deploy.sh dev
# ============================================================
set -euo pipefail

ENV="${1:-dev}"
REPO_DIR="/opt/accounting/repo"
ENV_DIR="/opt/accounting/${ENV}"

echo "========================================="
echo "  Deploying Accounting: ${ENV}"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "========================================="

# ---- Validate environment ----
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo "ERROR: Environment must be 'dev' or 'prod'"
    exit 1
fi

# ---- Set compose file ----
if [ "$ENV" = "dev" ]; then
    COMPOSE_FILE="${REPO_DIR}/deploy/docker-compose.dev.yml"
    BRANCH="develop"
else
    COMPOSE_FILE="${REPO_DIR}/deploy/docker-compose.dev.yml"
    BRANCH="main"
fi

ENV_FILE="${ENV_DIR}/.env"

# ---- Check env file exists ----
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Environment file not found: ${ENV_FILE}"
    echo "Create it from the example:"
    echo "  cp ${REPO_DIR}/deploy/envs/.env.${ENV}.example ${ENV_FILE}"
    exit 1
fi

# ---- Pull latest code ----
echo "[1/4] Pulling latest code (branch: ${BRANCH})..."
cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ---- Build and deploy ----
echo "[2/4] Building containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache

echo "[3/4] Stopping old containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans || true

echo "[3/4] Starting new containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ---- Update Nginx config for accounting ----
echo "[4/4] Updating Nginx configuration..."
if [ -f /etc/letsencrypt/live/devaccounting.seefmed.com/fullchain.pem ]; then
    sudo cp "${REPO_DIR}/deploy/nginx/dev.conf" /etc/nginx/sites-available/devaccounting.conf
else
    sudo cp "${REPO_DIR}/deploy/nginx/dev.bootstrap.conf" /etc/nginx/sites-available/devaccounting.conf
fi
sudo ln -sf /etc/nginx/sites-available/devaccounting.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# ---- Health check ----
echo ""
echo "Waiting for containers to be healthy..."
sleep 10

if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps | grep -q "Up"; then
    echo ""
    echo "========================================="
    echo "  Deployment successful! ($ENV)"
    echo "  URL: https://devaccounting.seefmed.com"
    echo "========================================="
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
else
    echo ""
    echo "========================================="
    echo "  WARNING: Some containers may not be running"
    echo "========================================="
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50
    exit 1
fi
