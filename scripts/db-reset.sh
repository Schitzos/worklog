#!/usr/bin/env bash
#
# Worklog — reset the local SQLite database to a clean slate.
#
# Deletes worklog.db and its WAL/SHM sidecar files. The schema is recreated
# empty by runMigrations() on the next server start (src/lib/db/index.ts), so
# nothing else is needed — just delete and reboot the app.
#
# Safe to run when the files are absent (rm -f is a no-op then).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

rm -f worklog.db worklog.db-wal worklog.db-shm worklog.db-journal
echo "[worklog] db reset — worklog.db{,-wal,-shm,-journal} removed; schema recreates on next start"
