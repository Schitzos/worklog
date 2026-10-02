#!/usr/bin/env bash
#
# Worklog — "go live": promote the CURRENT code to PRODUCTION on 7070.
#
# What it does, in order:
#   1. Back up the production DB (worklog.prod.db) with a timestamp — a promote
#      must never be able to lose real data.
#   2. Build the current code (`next build`).
#   3. (Re)start the production server on 127.0.0.1:7070 against worklog.prod.db,
#      replacing any running prod instance. Dev (7071 / worklog.dev.db) and the
#      test DB are never touched — only CODE is promoted, never databases.
#
# Nothing here deletes or copies any dev/test data into prod. The three
# environments share code, never state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

PROD_DB="worklog.prod.db"
PROD_PORT=7070

# 1. Back up prod data first (if it exists).
if [ -f "${PROD_DB}" ]; then
  mkdir -p backups
  BK="backups/$(date +%Y%m%d-%H%M%S)-prod.db"
  cp "${PROD_DB}" "${BK}"
  echo "[worklog] prod DB backed up → ${BK}"
else
  echo "[worklog] no prod DB yet — will be created empty on first start"
fi

# 2. Build current code.
echo "[worklog] building current code for production…"
npm run build

# 3. Restart the production server on 7070 (replace any running prod instance).
#    Match only the prod start command so we never kill the dev server on 7071.
echo "[worklog] (re)starting production on 127.0.0.1:${PROD_PORT}…"
pkill -f "next start -H 127.0.0.1 -p ${PROD_PORT}" 2>/dev/null || true
sleep 1

# Start detached; prod binds its own DB via the start:prod script's env.
nohup npm run start:prod > /tmp/worklog.prod.log 2>&1 &
echo "[worklog] production starting (pid $!). Logs: /tmp/worklog.prod.log"

# Wait for health.
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROD_PORT}/api/health" 2>/dev/null || true)"
  if [ "${code}" = "200" ]; then
    echo "[worklog] ✅ production live at http://127.0.0.1:${PROD_PORT} (health 200)"
    exit 0
  fi
  sleep 1
done
echo "[worklog] ⚠️ production did not report healthy within 60s — check /tmp/worklog.prod.log" >&2
exit 1
