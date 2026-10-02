# Worklog

A **local-only** worklog reminder app that nudges you every two hours during the
work window and turns what you logged into boss-ready recaps. It runs entirely on
your laptop — a Next.js app bound to `127.0.0.1:7070` with a single-file SQLite
database — so nothing leaves the machine and there is no cloud deploy. A
`node-cron` scheduler fires native macOS desktop notifications at WIB reminder
times, and the UI gives you a Today timeline, daily/weekly/monthly recaps, a
boss-ready Markdown export, and insights (streak, hour heatmap, untracked-time).

## Run locally

Everything binds to `127.0.0.1:7070` (never `0.0.0.0`).

```bash
npm install

# Development (hot reload):
npm run dev

# Production:
npm run build
npm run start
```

Then open <http://127.0.0.1:7070>.

## Auto-start on login (macOS launchd)

The app can start automatically on every login via a user LaunchAgent. The plist
lives in the repo at `deploy/com.rizky.worklog.plist` for review; it invokes
`scripts/start.sh`, which ensures a production build exists (building first if
`.next/BUILD_ID` is missing), opens the browser, then runs `npm run start`.

Install it once:

```bash
cp deploy/com.rizky.worklog.plist ~/Library/LaunchAgents/com.rizky.worklog.plist
launchctl load ~/Library/LaunchAgents/com.rizky.worklog.plist
```

To stop / disable auto-start:

```bash
launchctl unload ~/Library/LaunchAgents/com.rizky.worklog.plist
```

Logs are written to `/tmp/worklog.out.log` and `/tmp/worklog.err.log`.
`KeepAlive` is on, so the app restarts if it dies while you are logged in. When
the laptop is closed the app isn't running — that's by design; the work window is
10:00–16:00 and backfill covers anything missed.

## Reminders & notifications

Reminders fire on **weekdays (Mon–Fri)** at **10:00, 12:00, 14:00, and 16:00
WIB** (`Asia/Jakarta`). Each nudge asks what you did in the slot and deep-links to
a pre-filled log form; you can snooze or skip from the in-app toast.

Notifications are **native macOS desktop notifications** raised by `node-notifier`
from the scheduler, so they appear even when the browser tab isn't focused. For
them to show:

- macOS must have notifications **allowed** for the delivering app (System
  Settings → Notifications).
- `node-notifier` delivers via **`terminal-notifier`**, which it bundles and also
  expects at `/opt/homebrew/bin/terminal-notifier`. If notifications don't appear,
  install it with `brew install terminal-notifier`.

## Reset the data

The database is a single SQLite file (`worklog.db`) in the project root. To wipe
all entries and start clean:

```bash
npm run db:reset
```

This deletes `worklog.db` and its `-wal`/`-shm` sidecars; the empty schema is
recreated automatically on the next server start.

## Docs

Design and architecture live under [`.kiro/`](./.kiro/):

- [`.kiro/architecture.md`](./.kiro/architecture.md) — deployment model, stack,
  API surface, launchd auto-start.
- [`.kiro/design.md`](./.kiro/design.md) — product design and screens.
- [`.kiro/DESIGN_SYSTEM.md`](./.kiro/DESIGN_SYSTEM.md) — visual/motion language.
- [`.kiro/schema.md`](./.kiro/schema.md) — database schema.
