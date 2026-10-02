# Worklog Reminder — Product Design

> **Status:** v1 design, approved 2026-10-02
> **Owner:** Rizky
> **Companion docs:** [`schema.md`](./schema.md) · [`architecture.md`](./architecture.md) · [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)

---

## 1. Problem

I do a lot of untracked work during the day — operational tasks, meetings, backlog,
checking errors, helping colleagues — and I forget to log it. At the end of the
quarter when my boss asks "what did you do?", I genuinely can't remember because
there was so much and none of it was written down.

**This app solves that** by nudging me every 2 hours to write down what I just did,
making the entry take <10 seconds, and turning the log into a boss-ready recap.

---

## 2. Core principles (the "why it will actually get used" rules)

1. **Backfill > reminder.** The real failure mode is "forgot when asked", not
   "wasn't reminded". I WILL skip some notifications (in a meeting, in flow). So
   filling in past slots must be trivial — the form defaults to the most recent
   unfilled slot, not "now".
2. **Quick-entry, not a long form.** Target < 10 seconds per entry. One main
   text box; everything else optional with smart defaults.
3. **Notifications are actionable.** Not just "open form" — also *snooze* and
   *skip*. "Skip" matters: it tells the app the slot was genuinely empty, not
   forgotten.
4. **A safety net catches incomplete days.** An afternoon recap nudge lists the
   day's empty slots so nothing silently falls through.
5. **The output is the point.** Everything exists to produce a clean,
   boss-ready quarterly recap grouped by tag.

---

## 3. Users & auth

- **Single user** (me). No multi-tenant, no team features in v1.
- **Runs entirely locally** on the laptop, bound to `127.0.0.1` — not exposed to
  the internet, so no login is required in v1. (A trivial passcode can be added
  later if desired; low priority since nothing is reachable from outside.)
- See [`architecture.md §1`](./architecture.md) for the local-only deployment model.

---

## 4. Reminder behavior

- **Timezone:** `Asia/Jakarta (WIB)`. All scheduling is WIB; storage is UTC.
- **Days:** weekdays (Mon–Fri). Weekend off. (Configurable later.)
- **Window:** 10:00 → 16:00 WIB.
- **Cadence:** every 2 hours → notifications fire at **10:00, 12:00, 14:00, 16:00**.

### What each notification asks

Each notification asks about the **2 hours behind it**:

| Fires at | Covers slot | Notification copy |
|----------|-------------|-------------------|
| 10:00 | (day start) | "New day — I'll check in every 2h. Anything from earlier to log?" |
| 12:00 | 10:00–12:00 | "What did you do 10:00–12:00?" |
| 14:00 | 12:00–14:00 | "What did you do 12:00–14:00?" |
| 16:00 | 14:00–16:00 | "What did you do 14:00–16:00?" + end-of-day recap: lists any empty slots |

- **Slots** = `10–12`, `12–14`, `14–16` (3 slots/day). Slots are a *grouping helper*
  for notifications and recap — **NOT** a hard boundary on entries (see §6).

### Notification actions

The notification offers these actions (as native desktop notification buttons where
supported, otherwise as buttons on the in-app toast / form):

- **Log now** → opens/focuses the form, pre-filled with the slot this notification covers.
- **Snooze 30m** → re-fires in 30 minutes (in-process timer).
- **Nothing to log** (skip) → marks the slot as intentionally empty (distinguishes
  "empty" from "forgotten" in the untracked-time warning).

---

## 5. The entry form (quick-entry)

Opened from a notification, from the dashboard, or via a floating "+" button.

**Fields:**

| Field | Required | Behavior |
|-------|----------|----------|
| Description | ✅ | The main text box. Autofocus. This is 90% of the entry. |
| Tags | optional | **Free-text with autocomplete** from previously-used tags. Type a new tag freely; past tags surface as suggestions. Multiple tags per entry. |
| Ticket / backlog ID | optional | Free text. Auto-detected from the description (patterns like `JIRA-123`, `#456`, `TSEL-99`) and pre-filled; editable. |
| Start / End time | defaults filled | Defaults to the covered slot's window; editable. Duration is **derived** from start/end. |
| Duration preset | optional helper | Chips: `15m` `30m` `1h` `2h` + custom. Adjusts end time. |
| Summary | optional | Longer note / outcome. |

**Flow:** type description → (tags auto-suggest, ticket auto-detected) → tap Save.
Everything else can be left at defaults. One slot can hold **many** entries.

---

## 6. Parallel / overlapping work (Option A — approved)

Work is async and often overlaps. Example: a 10:00–11:00 meeting while fixing a bug
10:00–10:30.

**Model:** each activity is an **independent entry** with its own `start_at` /
`end_at`. **Overlap is allowed and expected.**

```
Entry 1: Sprint meeting   | 10:00–11:00 | 60m | tag: meeting
Entry 2: Fix login bug    | 10:00–10:30 | 30m | tag: bugfix, JIRA-123
```

Consequence: total logged duration can exceed wall-clock time (90m logged in a
60m window). That's correct — it reflects multitasking. The dashboard therefore
reports **two distinct metrics**:

- **Wall-clock time** — real elapsed time covered (10:00–11:00 = 1h).
- **Effort logged** — sum of entry durations (90m).

Slots never block an entry; they only group entries for notifications and recap.

---

## 7. Dashboard & recaps

All recaps read from the DB (fast, queryable). Every view can drill into the
**detail** fields the form captured.

### Views

1. **Today** — timeline of today's entries (Google-Calendar-style, overlaps shown
   side by side), plus today's effort-per-tag and the untracked-time warning.
2. **Daily recap** — one day: entries grouped by tag, total effort, wall-clock
   coverage, list of filled vs skipped vs empty slots.
3. **Weekly recap** — Mon–Fri rollup: effort per tag, busiest tags, daily
   coverage streak, hours-per-day bar.
4. **Monthly recap** — per-tag totals, trend, top tickets touched.
5. **Boss-ready export** — a one-click summary for an arbitrary range (e.g. a
   quarter): entries grouped and summarized per tag, formatted as clean prose +
   a table. Copy to clipboard / download as Markdown. **This is the end-goal
   deliverable.**

### Insights (cheap, high-value)

- **Streak** — consecutive days with a complete log (all slots filled or skipped).
- **Hour heatmap** — which hours I'm most productive.
- **Untracked-time warning** — compares entry wall-clock coverage against the
  6-hour window (10–16); flags gaps that aren't explicitly skipped.
- **Effort per tag** — hours spent per tag over the range.

### Tag normalization

Because tags are free-text, recaps normalize for grouping: **case-insensitive +
trimmed** (`Meeting`, `meeting`, ` meeting ` all count as one). Original casing is
preserved for display using the most-frequent variant.

---

## 8. PWA & notifications (local)

- **Runs locally** on the laptop; auto-starts when the laptop is on (see
  `architecture.md §6`). Reminders fire only while the laptop/app is running —
  acceptable because the work window is while I'm at the laptop, and backfill +
  the end-of-day safety net cover anything missed.
- **Installable PWA** — can still be installed locally for a clean standalone
  window; service worker provides **offline reads + app-shell cache only**.
- **Notifications are LOCAL/desktop** — raised by the app's in-process scheduler
  via the OS Notification Center (macOS) and/or the browser Notification API while
  the tab is open. **No Web Push, no VAPID, no cloud scheduler in v1.**

### Deferred: Android / phone push (v2)

Android push and phone access are **out of scope for v1** (explicitly skipped).
They require the app to be hosted somewhere always-reachable (the laptop isn't
always on), plus service-worker push + VAPID. Documented in `architecture.md §8`
roadmap for later.

### Offline behavior

- Reading dashboards: served from cache.
- Creating an entry offline (e.g. laptop briefly off network): queued in IndexedDB,
  synced to the local API when back online. (Minor for a local-only app, but kept.)

---

## 9. Out of scope for v1 (deferred)

- **Cloud deploy** — v1 runs locally only. No Vercel/VPS hosting.
- **Android / phone push** — deferred to v2 (needs always-on hosting + VAPID).
- **Notion integration** — dropped from v1. Will be added later as an
  **"Export to Notion" button** (DB stays the source of truth; Notion is an
  optional mirror). See `architecture.md` roadmap.
- Multi-user / teams.
- Weekend / custom-window configuration UI (hardcoded weekday 10–16 for v1).
- Calendar / Jira auto-import.

---

## 10. Motion & UI polish

Motion-graphic polish is part of the spec, not an afterthought — it makes the
<10s entry feel instant and makes the recap dashboards something I *want* to open
(which is what keeps the habit alive).

**The full visual + motion language is the design authority in
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — derived from the installed taste skills
(`high-end-visual-design`, `stitch-design-taste`, `design-taste-frontend`,
`anthropics-skills-frontend-design`). Every component in the build must pass the
anti-pattern checklist in `DESIGN_SYSTEM.md §8`. Summary of what it mandates:

### Libraries

- **Framer Motion** — primary. Spring physics (`stiffness 100, damping 20`),
  route/sheet transitions, staggered list reveals, animated chart bars, count-ups.
- **Lottie** (`lottie-react`) — small delight moments: streak celebration,
  "day complete" check, composed empty states.
- **Native CSS** — micro-interactions (button press, chip select).
- **No GSAP / WebGL** — overkill for a product UI.

### Where motion is applied (full specs in `DESIGN_SYSTEM.md §6`)

| Moment | Animation | Purpose |
|--------|-----------|---------|
| Notification → form | Bottom sheet springs up, fields stagger in | Entry feels instant |
| Save entry | Entry flies into the timeline; slot chip flips empty→filled | Clear feedback |
| Tag autocomplete | Suggestions fade/slide; selected tag pops | Fast, legible |
| Duration chips | Selected chip scales + fills accent | Tactile |
| Today timeline | Overlapping blocks grow from their start time; now-line pulses | Overlap reads clearly |
| Recaps | Bars grow, totals count up, tags stagger in | Dashboard feels alive |
| Streak | Lottie flame/confetti on a new streak day | Habit reinforcement |
| Untracked-time warning | Gap pulses amber | Draws attention to what needs filling |

### Design identity (from `DESIGN_SYSTEM.md`)

- **Dashboard-correct subset** of the taste skills — the landing-page-only tricks
  (centered glass heroes, inline-image headline type, cinematic scroll stories) are
  deliberately **not** applied; worklog is a product UI.
- **Fonts:** Geist + Geist Mono (mono for all times/durations/ticket IDs/numbers).
  Inter and serifs banned.
- **Color:** Zinc neutrals + a single accent (Teal `#0F766E` / `#2DD4BF` dark),
  amber reserved only for the untracked warning. No pure black, no neon/purple.
- **Cards:** Double-Bezel nested architecture; diffused canvas-tinted shadows.
- **Icons:** Phosphor Light (ultra-light lines).

### Guardrails

- **Respect `prefers-reduced-motion`** — non-essential animation auto-disables.
- Durations **150–300ms**; the **save path is never blocked by animation**.
- Charts animate **once on view**; animate only `transform`/`opacity`.

> Scope: frontend only. Adds `framer-motion`, `lottie-react`, `@phosphor-icons/react`
> and Geist fonts. **No change to `schema.md` or the local-only `architecture.md`.**

---

## 11. Success criteria

- An entry takes < 10 seconds from notification tap to saved.
- At any point I can produce a boss-ready recap for a quarter in one click.
- Desktop notifications fire reliably at the WIB times while the laptop is on.
- The app auto-starts when the laptop is opened — no manual launching.
- No logged day is silently incomplete (empty vs skipped is always explicit).
- Every screen passes the `DESIGN_SYSTEM.md §8` anti-pattern checklist.
