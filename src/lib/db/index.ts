import "server-only";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

/**
 * Tiny DB access layer: opens the local SQLite file once per process and
 * auto-runs migrations on first open. The DB file lives at ./worklog.db in the
 * project root (per architecture.md §7: DATABASE_URL=file:./worklog.db).
 *
 * The connection is cached on globalThis so Next.js hot-reload in dev does not
 * open a new handle on every module reload.
 */

const DB_PATH =
  process.env.DATABASE_URL?.replace(/^file:/, "") ??
  path.join(process.cwd(), "worklog.db");

type DBGlobal = typeof globalThis & {
  __worklogDb?: Database.Database;
};

const g = globalThis as DBGlobal;

export function getDb(): Database.Database {
  if (g.__worklogDb) return g.__worklogDb;

  const db = new Database(DB_PATH);
  runMigrations(db);
  g.__worklogDb = db;
  return db;
}

export function closeDb(): void {
  if (g.__worklogDb) {
    g.__worklogDb.close();
    g.__worklogDb = undefined;
  }
}
