# Worklog Reminder — Data Schema

> **DB:** **local**, single user. Default = **SQLite** (one file, zero-setup);
> local **Postgres** optional. SQL below is written for Postgres — see §6 for the
> SQLite port notes.
> **Companion docs:** [`design.md`](./design.md) · [`architecture.md`](./architecture.md)
> **Timezone rule:** store **UTC**, render **WIB** in the UI.

---

## 1. Overview

Four tables:

| Table | Purpose |
|-------|---------|
| `entries` | One worklog activity. The core table. |
| `tags` | Canonical tag registry for autocomplete + normalization. |
| `entry_tags` | Many-to-many join between entries and tags. |
| `reminder_log` | One row per notification slot per day: fired / filled / skipped. The safety-net source. |

A single user, so no `user_id` columns in v1 (added trivially later if needed).
No `push_subscriptions` table — v1 uses **local desktop notifications**, not Web
Push (see `architecture.md §1`).

---

## 2. Tables

### 2.1 `entries`

The core activity record. Duration is **derived** from `start_at` / `end_at`.

```sql
CREATE TABLE entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT        NOT NULL,
  ticket_id   TEXT,                       -- e.g. 'JIRA-123', '#456', nullable
  summary     TEXT,                       -- optional longer note
  start_at    TIMESTAMPTZ NOT NULL,       -- UTC
  end_at      TIMESTAMPTZ NOT NULL,       -- UTC; end_at >= start_at
  -- generated duration in minutes, always consistent with start/end
  duration_min INTEGER GENERATED ALWAYS AS
    (CEIL(EXTRACT(EPOCH FROM (end_at - start_at)) / 60.0)::int) STORED,
  -- the WIB calendar day this entry belongs to (for fast daily grouping)
  work_date   DATE        NOT NULL,       -- = (start_at AT TIME ZONE 'Asia/Jakarta')::date
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT end_after_start CHECK (end_at >= start_at)
);

CREATE INDEX idx_entries_work_date ON entries (work_date);
CREATE INDEX idx_entries_start_at  ON entries (start_at);
```

**Notes**
- `work_date` is denormalized from `start_at` in WIB so daily/weekly/monthly
  grouping never has to do a timezone conversion at query time. Set it in the API
  on insert/update.
- Overlapping entries are allowed by design (Option A) — no exclusion constraint.
- `duration_min` is a generated column, so "effort logged" is always truthful.

### 2.2 `tags`

Canonical registry. Powers autocomplete and case-insensitive grouping.

```sql
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- normalized key: lower(trim(name)). This is the identity for grouping.
  norm        TEXT        NOT NULL UNIQUE,
  -- display label: the most-recently-used original casing.
  label       TEXT        NOT NULL,
  usage_count INTEGER     NOT NULL DEFAULT 0,  -- for ranking autocomplete
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tags_usage ON tags (usage_count DESC, last_used_at DESC);
```

**Normalization rule:** `norm = lower(trim(name))`. On entry save, upsert each tag
by `norm`; if it exists, bump `usage_count` + `last_used_at` and refresh `label`
to the latest casing. This is how free-text tags stay groupable (`Meeting` ==
`meeting`) while displaying the user's preferred casing.

### 2.3 `entry_tags`

```sql
CREATE TABLE entry_tags (
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   UUID NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX idx_entry_tags_tag ON entry_tags (tag_id);
```

### 2.4 `reminder_log`

One row per (day, slot). Tracks the lifecycle of each reminder so we can tell
"empty" from "forgotten" and drive the end-of-day safety net.

```sql
CREATE TYPE slot_status AS ENUM ('pending', 'fired', 'filled', 'skipped', 'snoozed');

CREATE TABLE reminder_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date  DATE        NOT NULL,                -- WIB calendar day
  slot       TEXT        NOT NULL,                -- '10-12' | '12-14' | '14-16'
  status     slot_status NOT NULL DEFAULT 'pending',
  fired_at   TIMESTAMPTZ,                         -- when push was sent
  resolved_at TIMESTAMPTZ,                        -- when filled/skipped
  snooze_until TIMESTAMPTZ,                       -- if snoozed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_date, slot)
);

CREATE INDEX idx_reminder_log_date ON reminder_log (work_date);
```

- `status = 'filled'` is derived: the slot becomes `filled` once ≥1 entry overlaps
  the slot window (set by the API when an entry is saved, or recomputed in recap).
- `skipped` is set only by the user tapping "Nothing to log".
- The untracked-time warning treats a slot that is neither `filled` nor `skipped`
  as a gap.

---

## 3. Representative queries

### 3.1 Autocomplete tags (ranked)

```sql
SELECT label, usage_count
FROM tags
WHERE norm LIKE lower(trim($1)) || '%'
ORDER BY usage_count DESC, last_used_at DESC
LIMIT 10;
```

### 3.2 Daily recap — effort per tag for a given WIB day

```sql
SELECT t.label,
       COUNT(DISTINCT e.id)        AS activities,
       SUM(e.duration_min)         AS effort_min
FROM entries e
JOIN entry_tags et ON et.entry_id = e.id
JOIN tags t        ON t.id = et.tag_id
WHERE e.work_date = $1              -- '2026-10-02'
GROUP BY t.label
ORDER BY effort_min DESC;
```

### 3.3 Weekly recap — effort per tag over a date range

```sql
SELECT t.label, SUM(e.duration_min) AS effort_min
FROM entries e
JOIN entry_tags et ON et.entry_id = e.id
JOIN tags t        ON t.id = et.tag_id
WHERE e.work_date BETWEEN $1 AND $2  -- Monday .. Friday
GROUP BY t.label
ORDER BY effort_min DESC;
```

### 3.4 Monthly recap — per-tag totals + top tickets

```sql
-- effort per tag for the month
SELECT t.label, SUM(e.duration_min) AS effort_min, COUNT(DISTINCT e.id) AS activities
FROM entries e
JOIN entry_tags et ON et.entry_id = e.id
JOIN tags t        ON t.id = et.tag_id
WHERE e.work_date BETWEEN $1 AND $2
GROUP BY t.label
ORDER BY effort_min DESC;

-- top tickets touched
SELECT ticket_id, COUNT(*) AS entries, SUM(duration_min) AS effort_min
FROM entries
WHERE work_date BETWEEN $1 AND $2 AND ticket_id IS NOT NULL
GROUP BY ticket_id
ORDER BY effort_min DESC
LIMIT 20;
```

### 3.5 Wall-clock vs effort for a day

```sql
-- effort = sum of durations (double-counts overlap, by design)
SELECT SUM(duration_min) AS effort_min FROM entries WHERE work_date = $1;

-- wall-clock = union of covered intervals (overlap counted once).
-- Computed in the API by merging intervals; Postgres range types can also do it:
SELECT EXTRACT(EPOCH FROM (
         SELECT range_agg(tstzrange(start_at, end_at))  -- PG 14+
         FROM entries WHERE work_date = $1
       )) / 60.0 AS wallclock_min_approx;
-- (range_agg returns a multirange; sum its sub-ranges' durations in the API
--  for an exact wall-clock figure.)
```

### 3.6 Untracked-time / incomplete-day check

```sql
SELECT slot, status
FROM reminder_log
WHERE work_date = $1
  AND status NOT IN ('filled', 'skipped');   -- these are the gaps
```

### 3.7 Hour heatmap (effort by WIB hour of day)

```sql
SELECT EXTRACT(HOUR FROM (start_at AT TIME ZONE 'Asia/Jakarta')) AS wib_hour,
       SUM(duration_min) AS effort_min
FROM entries
WHERE work_date BETWEEN $1 AND $2
GROUP BY wib_hour
ORDER BY wib_hour;
```

---

## 4. Boss-ready export (shape)

The export query is §3.3/§3.4 for the chosen range, plus the raw entries grouped
by tag for the prose section:

```sql
SELECT t.label,
       json_agg(json_build_object(
         'date', e.work_date,
         'desc', e.description,
         'ticket', e.ticket_id,
         'summary', e.summary,
         'min', e.duration_min
       ) ORDER BY e.work_date) AS items,
       SUM(e.duration_min) AS total_min
FROM entries e
JOIN entry_tags et ON et.entry_id = e.id
JOIN tags t        ON t.id = et.tag_id
WHERE e.work_date BETWEEN $1 AND $2
GROUP BY t.label
ORDER BY total_min DESC;
```

The API renders this into Markdown: a per-tag section with a one-line summary and
a bullet list of activities, plus a totals table.

---

## 5. Migration order

1. `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` (Postgres only — for `gen_random_uuid()`)
2. `tags`
3. `entries`
4. `entry_tags`
5. `slot_status` type → `reminder_log`

---

## 6. SQLite port notes (default local DB)

The SQL above targets Postgres. For the recommended **SQLite** backend, adjust:

- **IDs:** no `gen_random_uuid()`. Use `TEXT PRIMARY KEY` with a UUID generated in
  the app layer (e.g. `crypto.randomUUID()`), or `INTEGER PRIMARY KEY AUTOINCREMENT`.
- **Timestamps:** no `timestamptz`. Store **UTC as ISO-8601 `TEXT`** (e.g.
  `2026-10-02T03:00:00Z`) or epoch `INTEGER`. All timezone math (WIB `work_date`,
  heatmap hour) is done in the **app layer**, not in SQL.
- **Generated columns:** SQLite supports generated columns but not timezone
  functions — compute `duration_min` and `work_date` in the API on insert/update
  and store them as plain columns.
- **Enums:** no `CREATE TYPE`. Use a `TEXT` column with a `CHECK (status IN
  ('pending','fired','filled','skipped','snoozed'))` constraint.
- **`range_agg` (wall-clock, §3.5):** not available. Merge intervals in the app
  layer (sort by `start_at`, fold overlaps) to compute wall-clock coverage.
- **`json_agg` (export, §4):** use `json_group_array(json_object(...))` in SQLite,
  or just assemble the JSON in the app layer.

Everything else (schema shape, indexes, the grouping/normalization logic) carries
over unchanged.
