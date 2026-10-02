#!/usr/bin/env bash
#
# Worklog — production start script (invoked by the launchd LaunchAgent).
#
# A login with a stale or missing build must still boot cleanly, so this:
#   1. cd's to the project root (resolved from this script's own location),
#   2. ensures a production build exists (runs `npm run build` only when the
#      .next/BUILD_ID marker is absent),
#   3. opens the browser to the local app (best-effort, non-fatal),
#   4. hands off to `npm run start` (next start -H 127.0.0.1 -p 7070) via exec
#      so launchd's KeepAlive tracks the Node process directly.
#
# Local-only: the app binds 127.0.0.1 — never 0.0.0.0.

set -euo pipefail

# Resolve the project root as the parent of this script's directory, so the
# script works regardless of the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

URL="http://127.0.0.1:7070"

# 1. Ensure a production build exists. .next/BUILD_ID is written only on a
#    successful `next build`, so its absence is the reliable "no build" signal.
if [ ! -f ".next/BUILD_ID" ]; then
  echo "[worklog] no production build found — running npm run build"
  npm run build
fi

# 2. Open the browser once, best-effort. Never let this fail the boot.
if command -v open >/dev/null 2>&1; then
  ( sleep 2; open "${URL}" ) >/dev/null 2>&1 &
fi

# 3. Start the server (binds 127.0.0.1:7070). exec so launchd supervises Node.
echo "[worklog] starting next on ${URL}"
exec npm run start
