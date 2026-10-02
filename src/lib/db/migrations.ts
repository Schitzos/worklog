import type Database from "better-sqlite3";

/**
 * SQLite schema for Worklog, ported from schema.md per the §6 notes:
 *  - IDs: TEXT PRIMARY KEY, UUID generated in the app layer (crypto.randomUUID()).
 *  - Timestamps: UTC as ISO-8601 TEXT (e.g. '2026-10-02T03:00:00Z').
 *  - duration_min + work_date are computed in the app layer and stored as plain
 *    columns (SQLite generated columns cannot do timezone math).
 *  - Enums: TEXT column + CHECK constraint.
 *  - No push_subscriptions table (v1 uses local desktop notifications).
 *
 * Each migration runs exactly once; applied versions are tracked in `_migrations`.
 * Migrations auto-run on boot (see ./index.ts).
 */

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: /* sql */ `
      -- Canonical tag registry: powers autocomplete + case-insensitive grouping.
      CREATE TABLE IF NOT EXISTS tags (
        id           TEXT PRIMARY KEY,
        norm         TEXT NOT NULL UNIQUE,              -- lower(trim(name)): grouping identity
        label        TEXT NOT NULL,                     -- most-recent original casing
        usage_count  INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,                     -- ISO-8601 UTC
        last_used_at TEXT NOT NULL                      -- ISO-8601 UTC
      );
      CREATE INDEX IF NOT EXISTS idx_tags_usage
        ON tags (usage_count DESC, last_used_at DESC);

      -- Core activity record. duration_min + work_date computed in the app layer.
      CREATE TABLE IF NOT EXISTS entries (
        id           TEXT PRIMARY KEY,
        description  TEXT NOT NULL,
        ticket_id    TEXT,                              -- e.g. 'JIRA-123', nullable
        summary      TEXT,                              -- optional longer note
        start_at     TEXT NOT NULL,                     -- ISO-8601 UTC
        end_at       TEXT NOT NULL,                     -- ISO-8601 UTC; end_at >= start_at
        duration_min INTEGER NOT NULL,                  -- CEIL((end-start)/60s), app-computed
        work_date    TEXT NOT NULL,                     -- WIB calendar day 'YYYY-MM-DD', app-computed
        created_at   TEXT NOT NULL,                     -- ISO-8601 UTC
        updated_at   TEXT NOT NULL,                     -- ISO-8601 UTC
        CONSTRAINT end_after_start CHECK (end_at >= start_at)
      );
      CREATE INDEX IF NOT EXISTS idx_entries_work_date ON entries (work_date);
      CREATE INDEX IF NOT EXISTS idx_entries_start_at  ON entries (start_at);

      -- Many-to-many join between entries and tags.
      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags (tag_id);

      -- One row per (day, slot): fired / filled / skipped. The safety-net source.
      CREATE TABLE IF NOT EXISTS reminder_log (
        id           TEXT PRIMARY KEY,
        work_date    TEXT NOT NULL,                     -- WIB calendar day 'YYYY-MM-DD'
        slot         TEXT NOT NULL,                     -- '10-12' | '12-14' | '14-16'
        status       TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','fired','filled','skipped','snoozed')),
        fired_at     TEXT,                              -- ISO-8601 UTC
        resolved_at  TEXT,                              -- ISO-8601 UTC
        snooze_until TEXT,                              -- ISO-8601 UTC
        created_at   TEXT NOT NULL,                     -- ISO-8601 UTC
        UNIQUE (work_date, slot)
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_log_date ON reminder_log (work_date);
    `,
  },
];

export function runMigrations(db: Database.Database): number {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM _migrations")
      .all()
      .map((r) => (r as { version: number }).version),
  );

  const record = db.prepare(
    "INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  let appliedCount = 0;
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    const tx = db.transaction(() => {
      db.exec(migration.up);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    tx();
    appliedCount += 1;
  }

  return appliedCount;
}
