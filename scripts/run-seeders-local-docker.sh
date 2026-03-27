#!/bin/sh
set -eu

# Run World Monitor seeders in a clean Node 22 container against the local
# Redis REST proxy exposed by the self-hosted stack.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! docker compose ps >/dev/null 2>&1; then
  echo "docker compose is not available from $PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"

NETWORK_NAME="${NETWORK_NAME:-worldmonitor-forked_default}"
LOCAL_REDIS_URL="${LOCAL_REDIS_URL:-http://redis-rest:80}"
LOCAL_REDIS_TOKEN="${LOCAL_REDIS_TOKEN:-wm-local-token}"

docker run --rm \
  --network "$NETWORK_NAME" \
  -v "$PROJECT_DIR":/app \
  -w /app \
  --env-file .env \
  -e UPSTASH_REDIS_REST_URL="$LOCAL_REDIS_URL" \
  -e UPSTASH_REDIS_REST_TOKEN="$LOCAL_REDIS_TOKEN" \
  node:22-alpine \
  sh -lc '
    apk add --no-cache python3 make g++ >/dev/null
    npm ci --prefix scripts --omit=dev
    ./scripts/run-seeders.sh
  '
