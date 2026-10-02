# Worklog Reminder — Architecture

> **Companion docs:** [`design.md`](./design.md) · [`schema.md`](./schema.md)
> **Goal:** runs **entirely locally** on the laptop, auto-starts when the laptop
> is on, no cloud deploy, fast dashboards. Notifications are **local/desktop**
> (Android push deferred).

---

## 1. Deployment model — LOCAL ONLY

Nothing is deployed to the cloud. The app and its database live on the laptop and
start automatically when the laptop boots / the user logs in. When the laptop is
closed, the app isn't running — that's acceptable: the work window is 10:00–16:00
while I'm at the laptop, and backfill covers anything missed.

```
┌─────────────────────── Laptop (localhost only) ───────────────────────┐
│                                                                        │
│   Browser / installed PWA ──HTTP──▶  Next.js app  (127.0.0.1:7070)     │
│        ▲                                   │                           │
│        │ desktop notification              │ SQL                       │
│        │                                   ▼                           │
│   OS Notification  ◀── node scheduler ──  Local DB (Postgres or SQLite)│
│   (while laptop on)     (node-cron)                                    │
│                                                                        │
│   Auto-start: launchd (macOS) runs the app on login                    │
└────────────────────────────────────────────────────────────────────┘
```

Bind **127.0.0.1 only** — never `0.0.0.0`. The app is reachable only from the
laptop itself.

---

## 2. Stack (all local, all free)

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js (App Router)** | One repo = UI + API routes + runs locally with `next start`. |
| Runtime | **Node.js** on the laptop | No serverless, no cloud. |
| Scheduler | **`node-cron`** inside the app process | Fires reminders at WIB times while the app runs. No Vercel Cron. |
| Database | **SQLite (via better-sqlite3) — recommended**, or local Postgres | SQLite = zero-setup, single file, perfect for one local user. Postgres only if you already run it. |
| Notifications | **OS desktop notification** (`node-notifier` from the scheduler, and/or the browser Notification API in the open tab) | Works while the laptop is open. No VAPID / Web Push. |
| Auto-start | **launchd** user agent (macOS) | Starts the app on login, restarts if it dies. |
| Auth | **None needed** (localhost-only, single user) | Optionally a trivial passcode; low priority since not exposed. |
| PWA | manifest + service worker | Still installable locally for a tidy window + offline reads; **no push**. |
| UI / motion | **Framer Motion** + **lottie-react** + **@phosphor-icons/react** (light) + **Geist / Geist Mono** fonts | Enforces the premium motion-graphic design language. **Full spec = [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)**; every screen must pass its §8 checklist. |

> **DB choice:** default to **SQLite**. It's a single file, needs no server
> process, and the whole point is local + auto-start with minimal moving parts.
> The `schema.md` SQL is written for Postgres; the SQLite port is noted in
> `schema.md §6` (mainly: `TEXT` timestamps or `INTEGER` epoch, no `timestamptz`,
> no generated-column timezone functions — compute `work_date`/`duration_min` in
> the app layer).

---

## 3. Request / data flows

### 3.1 Reminder flow (local, no push)

1. The Next.js app runs a **`node-cron`** job (started once on app boot) scheduled
   at **10:00, 12:00, 14:00, 16:00 WIB**, weekdays. Because the process runs in the
   laptop's local timezone, schedule directly in WIB (no UTC conversion needed if
   the laptop is on WIB; otherwise set the cron `timezone` option to `Asia/Jakarta`).
2. On fire: upsert a `reminder_log` row (`status='fired'`), then raise an **OS
   desktop notification** via `node-notifier` ("What did you do 12:00–14:00?").
3. If the app tab is open, the browser also shows an in-page toast / Notification
   API prompt that deep-links to the pre-filled form.
4. Clicking the notification focuses the browser at `/log?slot=12-14`.
5. **Snooze / skip** are handled in-app (buttons on the toast / form), writing
   `reminder_log.status`.

> No service-worker push, no VAPID, no cloud scheduler. If the laptop is closed at
> a reminder time, no notification fires — the end-of-day safety net + backfill
> cover it.

### 3.2 Entry save flow

1. Form `POST /api/entries` with `{description, tags[], ticket_id?, start_at,
   end_at, summary?}`.
2. API computes `work_date` from `start_at` in WIB, inserts the `entry`.
3. For each tag: upsert into `tags` by `norm=lower(trim(name))`, bump
   `usage_count`/`last_used_at`, link via `entry_tags`.
4. Recompute the covering `reminder_log` slot(s) to `status='filled'`.

### 3.3 Recap flow

- `GET /api/recap/daily?date=` · `/api/recap/weekly?from=&to=` ·
  `/api/recap/monthly?from=&to=` · `/api/recap/export?from=&to=`
- Runs the SQL from `schema.md §3`/`§4`, returns JSON; export route renders Markdown.

---

## 4. API surface (v1)

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/entries` | Create entry (+ tag upsert, slot fill). |
| `GET` | `/api/entries?date=` | List entries for a day. |
| `PATCH` | `/api/entries/:id` | Edit entry. |
| `DELETE`| `/api/entries/:id` | Delete entry. |
| `GET` | `/api/tags?q=` | Tag autocomplete. |
| `GET` | `/api/recap/daily` | Daily recap. |
| `GET` | `/api/recap/weekly` | Weekly recap. |
| `GET` | `/api/recap/monthly` | Monthly recap. |
| `GET` | `/api/recap/export` | Boss-ready Markdown export for a range. |
| `POST` | `/api/reminder/skip` | Mark current slot skipped. |
| `POST` | `/api/reminder/snooze` | Snooze current slot 30m (in-process timer). |

No cron HTTP endpoint and no push subscribe route — the scheduler lives inside the
process. No auth gate required (localhost-only); add a passcode later if wanted.

---

## 5. Frontend routes (PWA, local)

| Path | View |
|------|------|
| `/` | Today timeline + quick-add + untracked warning. |
| `/log` | Entry form (accepts `?slot=` to pre-fill). |
| `/recap/daily` · `/recap/weekly` · `/recap/monthly` | Recap dashboards. |
| `/export` | Range picker → boss-ready export (copy / download `.md`). |
| `/settings` | Reminder on/off, window, (optional passcode). |

PWA assets: `manifest.json` (`display: standalone`, `start_url: /`) and a service
worker for **offline reads + app-shell cache only** — no push handlers in v1.

---

## 6. Auto-start on laptop open (macOS launchd)

A user LaunchAgent starts the app on login and keeps it alive:

`~/Library/LaunchAgents/com.rizky.worklog.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>            <string>com.rizky.worklog</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/sh</string>
      <string>-c</string>
      <string>cd /Users/rizkyrachmawan/MyProject/learn/worklog && npm run start</string>
    </array>
    <key>RunAtLoad</key>        <true/>
    <key>KeepAlive</key>        <true/>
    <key>StandardOutPath</key>  <string>/tmp/worklog.out.log</string>
    <key>StandardErrorPath</key><string>/tmp/worklog.err.log</string>
  </dict>
</plist>
```

Load it once: `launchctl load ~/Library/LaunchAgents/com.rizky.worklog.plist`.
From then on it runs on every login. (Optional convenience: open the browser to
`http://127.0.0.1:7070` on start.)

> `node-notifier` uses the macOS Notification Center, so reminders appear as native
> macOS notifications even when the browser tab isn't focused.

---

## 7. Environment & config

```
DATABASE_URL=file:./worklog.db          # SQLite file in the project (recommended)
# or postgres://localhost:5432/worklog  # if using local Postgres
TZ=Asia/Jakarta                          # so node-cron fires at WIB wall-clock
REMINDER_TIMES=10:00,12:00,14:00,16:00
REMINDER_DAYS=1-5                         # Mon–Fri
PORT=7070
HOST=127.0.0.1                            # localhost only — never 0.0.0.0
```

---

## 8. Roadmap

**v1 (this build) — LOCAL**
- Local Next.js app + local DB (SQLite), auto-start via launchd.
- `node-cron` scheduler → OS desktop notifications at WIB times.
- Quick-entry form with tag autocomplete + ticket auto-detect.
- Backfill, snooze, skip, end-of-day safety-net nudge.
- Daily / weekly / monthly recap + boss-ready export.
- Insights: effort-per-tag, untracked-time warning, streak, hour heatmap.

**v2 (later, deferred)**
- **Android / Web Push** — add service-worker push + VAPID. Requires hosting the
  app somewhere reachable (small VPS, Vercel, or a tunnel) since the laptop isn't
  always on. This is the piece we're skipping for now.
- **"Export to Notion" button** — DB stays source of truth; Notion as optional mirror.
- Cloud deploy option for always-on reminders + phone access.
- Configurable window / weekend toggle UI.

---

## 9. Build order (suggested)

1. Scaffold Next.js + local DB (SQLite) + migrations (`schema.md`).
2. `POST /api/entries` + `GET /api/tags` + the entry form (core loop first).
3. Today view + daily recap.
4. `node-cron` scheduler + `node-notifier` desktop notifications + snooze/skip.
5. Weekly/monthly recap + boss-ready export.
6. Insights (streak, heatmap, untracked-time).
7. launchd auto-start + bind to 127.0.0.1.
