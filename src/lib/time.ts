/**
 * Timezone + duration helpers. Storage is UTC (ISO-8601 TEXT); the UI and all
 * calendar-day grouping are in Asia/Jakarta (WIB, fixed UTC+7, no DST).
 *
 * All WIB math is done in the app layer per schema.md §6 — SQLite cannot do
 * timezone functions. WIB has no daylight saving, so a fixed +7h offset is exact.
 */

export const WIB_OFFSET_MIN = 7 * 60; // Asia/Jakarta is a fixed UTC+7 (no DST).

/** The slot grouping helpers (design.md §4). NOT a hard boundary on entries. */
export const SLOTS = ["10-12", "12-14", "14-16"] as const;
export type Slot = (typeof SLOTS)[number];

export function isSlot(v: string): v is Slot {
  return (SLOTS as readonly string[]).includes(v);
}

/** Parse a slot label like "10-12" into its WIB start/end hours. */
export function slotHours(slot: string): { startHour: number; endHour: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(slot.trim());
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null;
  return { startHour, endHour };
}

/**
 * The WIB calendar date ('YYYY-MM-DD') that a UTC instant falls on. Done by
 * shifting the instant by +7h and reading its UTC date parts (so no reliance on
 * the host's local timezone).
 */
export function wibWorkDate(utcIso: string | Date): string {
  const d = typeof utcIso === "string" ? new Date(utcIso) : utcIso;
  const shifted = new Date(d.getTime() + WIB_OFFSET_MIN * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const da = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Today's WIB work_date for "now". */
export function wibToday(now: Date = new Date()): string {
  return wibWorkDate(now);
}

/** CEIL duration in whole minutes between two UTC instants (schema.md §2.1). */
export function durationMin(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.ceil(ms / 60_000);
}

/**
 * Build a UTC ISO instant for a given WIB work_date + WIB wall-clock hour.
 * e.g. workDate "2026-10-02", hour 10 (WIB) -> "2026-10-02T03:00:00.000Z".
 */
export function wibWallClockToUtc(workDate: string, hour: number, minute = 0): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDate);
  if (!m) throw new Error(`invalid work_date: ${workDate}`);
  const [, y, mo, da] = m;
  // WIB wall-clock -> UTC is minus the offset.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(da), hour, minute) - WIB_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * The default start/end UTC window for a slot on a WIB work_date. Used to
 * pre-fill the form's start/end times when opened for a slot.
 */
export function slotWindowUtc(
  workDate: string,
  slot: string,
): { startAt: string; endAt: string } | null {
  const hours = slotHours(slot);
  if (!hours) return null;
  return {
    startAt: wibWallClockToUtc(workDate, hours.startHour),
    endAt: wibWallClockToUtc(workDate, hours.endHour),
  };
}

/**
 * Which slot(s) a UTC [start,end] interval covers, for a given work_date. An
 * entry "covers" a slot if it overlaps that slot's WIB window at all (Option A:
 * overlap is expected). Returns the slot labels to mark 'filled'.
 */
export function coveringSlots(workDate: string, startIso: string, endIso: string): Slot[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const out: Slot[] = [];
  for (const slot of SLOTS) {
    const win = slotWindowUtc(workDate, slot);
    if (!win) continue;
    const ws = new Date(win.startAt).getTime();
    const we = new Date(win.endAt).getTime();
    // Overlap test: start < slotEnd && end > slotStart.
    if (start < we && end > ws) out.push(slot);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * WIB calendar-date arithmetic (Phase 5 — weekly/monthly/range recaps).
 * All math is on the WIB calendar date string 'YYYY-MM-DD'. We parse to a UTC
 * noon anchor (12:00Z) so a ±N-day shift never crosses a DST boundary of the
 * host — WIB itself has none, and noon keeps us far from any date flip.
 * ------------------------------------------------------------------------- */

/** Parse 'YYYY-MM-DD' into its y/m/d parts (month 1-based). */
function ymd(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format y/m/d (month 1-based) back to 'YYYY-MM-DD'. */
function fmtYmd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Add `days` (may be negative) to a WIB calendar date, returning 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = ymd(date);
  const t = Date.UTC(y, m - 1, d, 12) + days * 86_400_000;
  const dt = new Date(t);
  return fmtYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Day of week for a WIB calendar date: 0=Sun … 6=Sat. */
export function dayOfWeek(date: string): number {
  const { y, m, d } = ymd(date);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** The Monday (WIB) of the week containing `date`. */
export function mondayOf(date: string): string {
  const dow = dayOfWeek(date); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  return addDays(date, -back);
}

/** Mon–Fri (5) WIB dates of the work-week whose Monday is `monday`. */
export function workWeekDates(monday: string): string[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** Every WIB calendar date in [from, to] inclusive. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // Guard against a reversed range: swap so the loop always terminates.
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  cur = lo;
  while (cur <= hi) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** First WIB calendar date of the month containing `date`. */
export function monthStart(date: string): string {
  const { y, m } = ymd(date);
  return fmtYmd(y, m, 1);
}

/** Last WIB calendar date of the month containing `date`. */
export function monthEnd(date: string): string {
  const { y, m } = ymd(date);
  const lastDay = new Date(Date.UTC(y, m, 0, 12)).getUTCDate(); // day 0 of next month
  return fmtYmd(y, m, lastDay);
}
