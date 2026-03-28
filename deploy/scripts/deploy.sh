#!/usr/bin/env bash
# ============================================================
# deploy.sh – Deploy accounting app (dev or prod)
# Called by GitHub Actions or manually:
#   bash deploy/scripts/deploy.sh dev
#   bash deploy/scripts/deploy.sh prod
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
    COMPOSE_FILE="${REPO_DIR}/deploy/docker-compose.prod.yml"
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

# ---- Ensure PostgreSQL is available (shared with inventory) ----
echo "[1/5] Checking PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "  PostgreSQL not found. It should already be installed by the inventory app."
    echo "  Run the inventory deploy first, or install PostgreSQL manually."
fi

# ---- Pull latest code ----
echo "[2/5] Pulling latest code (branch: ${BRANCH})..."
cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ---- Build and deploy ----
echo "[3/5] Building containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache

echo "[4/5] Stopping old containers and starting new..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans || true
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ---- Update Nginx configs ----
echo "[5/5] Updating Nginx configuration..."
if [ -f /etc/letsencrypt/live/devaccounting.seefmed.com/fullchain.pem ]; then
    sudo cp "${REPO_DIR}/deploy/nginx/dev.conf" /etc/nginx/sites-available/devaccounting.conf
else
    sudo cp "${REPO_DIR}/deploy/nginx/dev.bootstrap.conf" /etc/nginx/sites-available/devaccounting.conf
fi
if [ -f /etc/letsencrypt/live/accounting.biloop.ai/fullchain.pem ]; then
    sudo cp "${REPO_DIR}/deploy/nginx/prod.conf" /etc/nginx/sites-available/accounting.conf
else
    sudo cp "${REPO_DIR}/deploy/nginx/prod.bootstrap.conf" /etc/nginx/sites-available/accounting.conf
fi
sudo ln -sf /etc/nginx/sites-available/devaccounting.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/accounting.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# ---- Health check ----
echo ""
echo "Waiting for containers to be healthy..."
sleep 10

if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps | grep -q "Up"; then
    echo ""
    echo "========================================="
    echo "  Deployment successful! ($ENV)"
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
