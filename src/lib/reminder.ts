import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { coveringSlots, slotWindowUtc, SLOTS, type Slot } from "./time";

/**
 * reminder_log repository (schema.md §2.4). Owns the slot lifecycle the scheduler
 * and the reminder API routes read/write:
 *   pending → fired → (filled | skipped | snoozed)
 *
 * `filled` is derived: a slot is filled the moment ≥1 entry overlaps its WIB
 * window (set in entries.ts on save). This module never downgrades a filled or
 * skipped slot — firing a slot that is already resolved is a no-op, which is how
 * the scheduler avoids re-nagging a slot the user already handled.
 */

export interface ReminderRow {
  id: string;
  work_date: string;
  slot: string;
  status: "pending" | "fired" | "filled" | "skipped" | "snoozed";
  fired_at: string | null;
  resolved_at: string | null;
  snooze_until: string | null;
  created_at: string;
}

export function getReminder(workDate: string, slot: string): ReminderRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM reminder_log WHERE work_date = ? AND slot = ?")
    .get(workDate, slot) as ReminderRow | undefined;
  return row ?? null;
}

/**
 * Does any entry overlap this slot's WIB window on this work_date? This is the
 * ground truth for "filled" — independent of whatever the reminder_log row says,
 * so a slot filled by an entry is never re-fired even if its row was 'pending'.
 */
export function slotHasEntry(workDate: string, slot: string): boolean {
  const db = getDb();
  const win = slotWindowUtc(workDate, slot);
  if (!win) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM entries
       WHERE work_date = ? AND start_at < ? AND end_at > ?
       LIMIT 1`,
    )
    .get(workDate, win.endAt, win.startAt);
  return !!row;
}

/** A slot is "resolved" when it should NOT fire: an entry covers it, or the user skipped it. */
export function slotResolved(workDate: string, slot: string): boolean {
  if (slotHasEntry(workDate, slot)) return true;
  const row = getReminder(workDate, slot);
  return row?.status === "skipped";
}

/**
 * Mark a slot 'fired' (upsert). No-op — returns null — when the slot is already
 * resolved (filled by an entry, or skipped). Returns the row that resulted when
 * it did fire, so the scheduler knows whether to raise a desktop notification.
 */
export function markFired(workDate: string, slot: string): ReminderRow | null {
  if (slotResolved(workDate, slot)) return null;
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO reminder_log (id, work_date, slot, status, fired_at, created_at)
     VALUES (?, ?, ?, 'fired', ?, ?)
     ON CONFLICT (work_date, slot) DO UPDATE SET
       status = 'fired',
       fired_at = excluded.fired_at`,
  ).run(randomUUID(), workDate, slot, nowIso, nowIso);
  return getReminder(workDate, slot);
}

/**
 * Snooze a slot 30 minutes (design.md §4). Sets status='snoozed' + snooze_until,
 * and returns the ISO instant it will re-fire at. No-op (returns null) if the
 * slot is already resolved. Does not downgrade — a snoozed slot that gets an
 * entry becomes 'filled' via entries.ts and this snooze simply expires unused.
 */
export function snoozeSlot(workDate: string, slot: string, minutes = 30): string | null {
  if (slotResolved(workDate, slot)) return null;
  const db = getDb();
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  db.prepare(
    `INSERT INTO reminder_log (id, work_date, slot, status, snooze_until, created_at)
     VALUES (?, ?, ?, 'snoozed', ?, ?)
     ON CONFLICT (work_date, slot) DO UPDATE SET
       status = 'snoozed',
       snooze_until = excluded.snooze_until`,
  ).run(randomUUID(), workDate, slot, until, nowIso);
  return until;
}

/**
 * Clear a pending snooze timer flag by promoting the slot out of 'snoozed'.
 * Called by /api/reminder/skip so a skip also cancels any pending re-fire
 * (the in-process setTimeout is cancelled separately in the scheduler).
 */
export function clearSnooze(workDate: string, slot: string): void {
  const db = getDb();
  const row = getReminder(workDate, slot);
  if (row?.status === "snoozed") {
    db.prepare(
      "UPDATE reminder_log SET snooze_until = NULL WHERE work_date = ? AND slot = ?",
    ).run(workDate, slot);
  }
}

/**
 * The slot a notification firing at `firedHour` WIB asks about (design.md §4):
 *   10:00 → day-start prompt (no covered slot)
 *   12:00 → 10-12
 *   14:00 → 12-14
 *   16:00 → 14-16
 * Returns null for the 10:00 day-start fire (nothing behind it to cover).
 */
export function coveredSlotForHour(firedHour: number): Slot | null {
  switch (firedHour) {
    case 12:
      return "10-12";
    case 14:
      return "12-14";
    case 16:
      return "14-16";
    default:
      return null;
  }
}

export interface PendingSlot {
  slot: Slot;
  status: ReminderRow["status"];
}

/**
 * Slots that still need the user's attention for a work_date: fired or snoozed
 * (and NOT since filled by an entry or skipped). Drives the in-app toast poll
 * (/api/reminder/pending). A slot an entry now covers is excluded even if its
 * row still says 'fired'.
 */
export function pendingSlots(workDate: string): PendingSlot[] {
  const out: PendingSlot[] = [];
  for (const slot of SLOTS) {
    if (slotHasEntry(workDate, slot)) continue; // filled wins
    const row = getReminder(workDate, slot);
    if (!row) continue;
    if (row.status === "fired" || row.status === "snoozed") {
      out.push({ slot, status: row.status });
    }
  }
  return out;
}

/** Re-export for callers that compute coverage from an interval. */
export { coveringSlots };
