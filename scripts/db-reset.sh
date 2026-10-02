#!/usr/bin/env bash
#
# Worklog — reset ONE environment's SQLite database to a clean slate.
#
# Usage: db-reset.sh [dev|test|prod]   (default: dev)
#
# Deletes <env>'s worklog.<env>.db and its WAL/SHM/journal sidecars. The schema
# is recreated empty by runMigrations() on the next server start
# (src/lib/db/index.ts). Safe to run when the files are absent (rm -f no-op).
#
# PROD IS GUARDED: resetting production requires an explicit confirmation
# (WORKLOG_CONFIRM_PROD=yes) because that is your real logged data. There is no
# way to wipe prod by a bare `db:reset` — that targets dev.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

ENVIRONMENT="${1:-dev}"

case "${ENVIRONMENT}" in
  dev)  DB="worklog.dev.db" ;;
  test) DB="worklog.test.db" ;;
  prod)
    DB="worklog.prod.db"
    if [ "${WORKLOG_CONFIRM_PROD:-no}" != "yes" ]; then
      echo "[worklog] REFUSING to reset PRODUCTION (${DB}) — this is your real data." >&2
      echo "[worklog] If you truly mean it: WORKLOG_CONFIRM_PROD=yes npm run db:reset prod" >&2
      exit 1
    fi
    # Back up prod before wiping, just in case.
    if [ -f "${DB}" ]; then
      BK="backups/$(date +%Y%m%d-%H%M%S)-prod-before-reset.db"
      mkdir -p backups
      cp "${DB}" "${BK}"
      echo "[worklog] backed up prod → ${BK} before reset"
    fi
    ;;
  *)
    echo "[worklog] unknown environment '${ENVIRONMENT}' (use: dev | test | prod)" >&2
    exit 1
    ;;
esac

rm -f "${DB}" "${DB}-wal" "${DB}-shm" "${DB}-journal"
echo "[worklog] ${ENVIRONMENT} db reset — ${DB}{,-wal,-shm,-journal} removed; schema recreates on next start"
