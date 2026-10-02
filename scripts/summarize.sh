#!/usr/bin/env bash
#
# Worklog — daily summary catch-up (invoked by the launchd summary agent).
#
# Calls the PRODUCTION app's catch-up endpoint, which summarizes every past day
# (before today-in-WIB) that has activity but no up-to-date Gemini summary.
# This is the RELIABLE mechanism: if the Mac was asleep/off at the scheduled
# time, launchd runs this on the next wake/login and it backfills.
#
# It talks to the already-running prod server on 127.0.0.1:7070 (kept alive by
# the main launchd agent), so it needs no Node/build of its own and writes only
# the daily_summary table — never the user's notes or entries.
#
# Reads the Gemini key from the prod server's own environment (.env), so the
# SAME single key is used everywhere.

set -euo pipefail

PORT="${WORKLOG_PORT:-7070}"
BASE="http://127.0.0.1:${PORT}"
LOG="/tmp/worklog.summary.log"

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

echo "[$(ts)] summary catch-up: starting (base=${BASE})" >> "${LOG}"

# Wait up to ~60s for the prod server to answer health — it may be mid-boot when
# launchd fires this (e.g. right after login). Non-fatal if it never comes up.
up=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "${BASE}/api/health" >/dev/null 2>&1; then
    up="yes"
    break
  fi
  sleep 2
done

if [ -z "${up}" ]; then
  echo "[$(ts)] summary catch-up: prod server not reachable on ${BASE} — skipping (will retry next run)" >> "${LOG}"
  exit 0
fi

# Fire the catch-up. Generous timeout: one Gemini call per unsummarized day.
resp="$(curl -fsS --max-time 300 -X POST "${BASE}/api/summary/catchup" 2>>"${LOG}" || echo '{"ok":false,"error":"curl_failed"}')"
echo "[$(ts)] summary catch-up: response ${resp}" >> "${LOG}"
