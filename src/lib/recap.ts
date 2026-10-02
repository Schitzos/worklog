import "server-only";
import { getDb } from "./db";
import { listEntriesByDate, type EntryRow } from "./entries";
import { getDailyNote, dailyNotesInRange } from "./notes";
import {
  SLOTS,
  slotWindowUtc,
  type Slot,
  datesInRange,
  mondayOf,
  monthEnd,
  monthStart,
  workWeekDates,
} from "./time";

/**
 * Server-side recap aggregation (design.md §6/§7, schema.md §3.2/§3.5/§3.6).
 *
 * Two distinct day metrics, by design (Option A — overlap is expected):
 *   - effortMin    = sum of every entry's duration (overlap double-counts).
 *   - wallClockMin = union of covered [start,end] intervals (overlap once).
 *
 * All timezone math already lives in time.ts; this module only aggregates.
 */

export interface EffortPerTag {
  label: string;
  effortMin: number;
  activities: number;
}

export type SlotState = "filled" | "skipped" | "empty";

export interface SlotStatus {
  slot: Slot;
  status: SlotState;
}

export interface Gap {
  /** WIB wall-clock hours of the uncovered, unskipped window. */
  fromHour: number;
  toHour: number;
}

export interface DailyRecap {
  workDate: string;
  entries: EntryRow[];
  effortPerTag: EffortPerTag[];
  effortMin: number;
  wallClockMin: number;
  slots: SlotStatus[];
  gaps: Gap[];
  /** Optional free-text note for the day ("" when none). */
  note: string;
}

/** Day's entries + tags. Thin reuse of the Phase-1 repository. */
export function dayEntries(workDate: string): EntryRow[] {
  return listEntriesByDate(workDate);
}

/**
 * Effort per tag for a WIB date range [from, to] inclusive (schema.md §3.2/§3.3).
 * Grouping is by the normalized tag key; the display label is the tags table's
 * canonical casing. effortMin double-counts overlap by design.
 */
export function effortPerTag(from: string, to: string): EffortPerTag[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.label        AS label,
              COUNT(DISTINCT e.id) AS activities,
              SUM(e.duration_min)  AS effortMin
       FROM entries e
       JOIN entry_tags et ON et.entry_id = e.id
       JOIN tags t        ON t.id = et.tag_id
       WHERE e.work_date BETWEEN ? AND ?
       GROUP BY t.norm, t.label
       ORDER BY effortMin DESC, t.label ASC`,
    )
    .all(from, to) as { label: string; activities: number; effortMin: number }[];
  return rows.map((r) => ({
    label: r.label,
    activities: r.activities,
    effortMin: r.effortMin ?? 0,
  }));
}

/** Sum of entry durations for a day (effort; overlap double-counts). */
export function effortMinForDay(workDate: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COALESCE(SUM(duration_min), 0) AS effortMin FROM entries WHERE work_date = ?")
    .get(workDate) as { effortMin: number };
  return row.effortMin ?? 0;
}

interface Interval {
  start: number;
  end: number;
}

/** Merge overlapping/adjacent intervals (ms epochs), return disjoint set sorted. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      // Overlapping or touching → extend.
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Wall-clock minutes covered for a day: union of all entry intervals, overlap
 * counted once (schema.md §3.5). Merge in JS since SQLite has no range_agg.
 */
export function wallClockMin(workDate: string): number {
  const entries = listEntriesByDate(workDate);
  const intervals: Interval[] = entries.map((e) => ({
    start: new Date(e.start_at).getTime(),
    end: new Date(e.end_at).getTime(),
  }));
  const merged = mergeIntervals(intervals);
  const ms = merged.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
  return Math.round(ms / 60_000);
}

/**
 * Per-slot status for the three reminder slots (schema.md §3.6):
 *   - filled  — ≥1 entry overlaps the slot's WIB window, OR reminder_log says so.
 *   - skipped — reminder_log row with status 'skipped' and no covering entry.
 *   - empty   — neither.
 * Entry coverage wins over a stale 'skipped' row (an entry logged after a skip).
 */
export function slotStatus(workDate: string): SlotStatus[] {
  const db = getDb();
  const entries = listEntriesByDate(workDate);
  const intervals: Interval[] = entries.map((e) => ({
    start: new Date(e.start_at).getTime(),
    end: new Date(e.end_at).getTime(),
  }));

  const logRows = db
    .prepare("SELECT slot, status FROM reminder_log WHERE work_date = ?")
    .all(workDate) as { slot: string; status: string }[];
  const logBySlot = new Map(logRows.map((r) => [r.slot, r.status]));

  return SLOTS.map((slot) => {
    const win = slotWindowUtc(workDate, slot)!;
    const ws = new Date(win.startAt).getTime();
    const we = new Date(win.endAt).getTime();
    const covered = intervals.some((iv) => iv.start < we && iv.end > ws);
    if (covered) return { slot, status: "filled" as SlotState };
    if (logBySlot.get(slot) === "skipped") return { slot, status: "skipped" as SlotState };
    return { slot, status: "empty" as SlotState };
  });
}

/**
 * Gaps across the full window (10–16 WIB): the sub-ranges NOT covered by any
 * entry AND NOT inside a skipped slot (design.md §7 untracked warning,
 * schema.md §3.6). Returned as WIB wall-clock hour ranges.
 */
export function gapsForDay(workDate: string): Gap[] {
  const WINDOW_START = 10;
  const WINDOW_END = 16;

  const entries = listEntriesByDate(workDate);
  const slots = slotStatus(workDate);
  const skippedSlots = new Set(
    slots.filter((s) => s.status === "skipped").map((s) => s.slot),
  );

  const dayStartMs = new Date(slotWindowUtc(workDate, "10-12")!.startAt).getTime();

  // Mark each minute offset [0, 360) of the 10–16 window as covered or not.
  // 6h * 60 = 360 minutes — cheap and exact for a single day.
  const TOTAL_MIN = (WINDOW_END - WINDOW_START) * 60;
  const covered = new Array<boolean>(TOTAL_MIN).fill(false);

  const markRange = (startMs: number, endMs: number) => {
    const from = Math.max(0, Math.floor((startMs - dayStartMs) / 60_000));
    const to = Math.min(TOTAL_MIN, Math.ceil((endMs - dayStartMs) / 60_000));
    for (let i = from; i < to; i++) covered[i] = true;
  };

  // Entries cover their own interval.
  for (const e of entries) {
    markRange(new Date(e.start_at).getTime(), new Date(e.end_at).getTime());
  }
  // Skipped slots cover their whole 2h window (intentionally empty, not a gap).
  for (const slot of skippedSlots) {
    const win = slotWindowUtc(workDate, slot)!;
    markRange(new Date(win.startAt).getTime(), new Date(win.endAt).getTime());
  }

  // Fold the uncovered minutes into contiguous hour-fractional gaps.
  const gaps: Gap[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= TOTAL_MIN; i++) {
    const isGap = i < TOTAL_MIN && !covered[i];
    if (isGap && runStart === null) {
      runStart = i;
    } else if (!isGap && runStart !== null) {
      gaps.push({
        fromHour: WINDOW_START + runStart / 60,
        toHour: WINDOW_START + i / 60,
      });
      runStart = null;
    }
  }
  return gaps;
}

/** The complete daily recap payload (API GET /api/recap/daily). */
export function dailyRecap(workDate: string): DailyRecap {
  const entries = dayEntries(workDate);
  return {
    workDate,
    entries,
    effortPerTag: effortPerTag(workDate, workDate),
    effortMin: effortMinForDay(workDate),
    wallClockMin: wallClockMin(workDate),
    slots: slotStatus(workDate),
    gaps: gapsForDay(workDate),
    note: getDailyNote(workDate)?.note ?? "",
  };
}

/* ===========================================================================
 * Phase 5 — weekly / monthly recaps + boss-ready range export.
 * Everything aggregates over a WIB work_date range, reusing effortPerTag,
 * effortMinForDay and wallClockMin. Tag grouping is already normalized by the
 * tags table (norm key, canonical label) in effortPerTag.
 * ========================================================================= */

/** Per-day effort + wall-clock + coverage, for weekly/monthly trends. */
export interface DayRollup {
  workDate: string;
  /** Mon, Tue … for weekly display (WIB). */
  effortMin: number;
  wallClockMin: number;
  activities: number;
  /** complete = every slot filled or skipped; partial = some filled; empty = none. */
  coverage: "complete" | "partial" | "empty";
}

export interface WeeklyRecap {
  monday: string;
  friday: string;
  days: DayRollup[];
  effortPerTag: EffortPerTag[];
  busiestTags: EffortPerTag[];
  totalEffortMin: number;
  totalWallClockMin: number;
  totalActivities: number;
  completeDays: number;
  /** { work_date -> note } for days in the week that have a note. */
  notes: Record<string, string>;
}

export interface TopTicket {
  ticket_id: string;
  entries: number;
  effortMin: number;
}

export interface MonthlyRecap {
  from: string;
  to: string;
  effortPerTag: EffortPerTag[];
  topTickets: TopTicket[];
  trend: DayRollup[];
  totalEffortMin: number;
  totalWallClockMin: number;
  totalActivities: number;
  activeDays: number;
  /** { work_date -> note } for days in the month that have a note. */
  notes: Record<string, string>;
}

/** One activity line in the boss-ready export. */
export interface ExportItem {
  date: string;
  desc: string;
  ticket: string | null;
  summary: string | null;
  min: number;
}

/** A per-tag section of the boss-ready export, ordered by totalMin desc. */
export interface ExportTagSection {
  label: string;
  totalMin: number;
  items: ExportItem[];
}

export interface RangeExport {
  from: string;
  to: string;
  tags: ExportTagSection[];
  /** Entries carrying no tag — still worth reporting. */
  untagged: ExportTagSection | null;
  grandTotalMin: number;
  grandTotalActivities: number;
  /** Distinct days with ≥1 entry in the range. */
  activeDays: number;
}

/** Coverage verdict for a single day from its slot statuses. */
function dayCoverage(workDate: string): "complete" | "partial" | "empty" {
  const slots = slotStatus(workDate);
  const resolved = slots.filter((s) => s.status === "filled" || s.status === "skipped").length;
  const filled = slots.filter((s) => s.status === "filled").length;
  if (resolved === slots.length) return "complete";
  if (filled > 0) return "partial";
  return "empty";
}

/** Per-day rollup (effort, wall-clock, activities, coverage) for a WIB day. */
function dayRollup(workDate: string): DayRollup {
  const entries = listEntriesByDate(workDate);
  return {
    workDate,
    effortMin: effortMinForDay(workDate),
    wallClockMin: wallClockMin(workDate),
    activities: entries.length,
    coverage: dayCoverage(workDate),
  };
}

/**
 * Weekly recap (design.md §7, schema.md §3.3): Mon–Fri rollup for the work-week
 * containing `mondayDate` (any date in the week is accepted — it's snapped to
 * that week's Monday). Returns per-tag effort, per-day effort+wallclock, daily
 * coverage, and the busiest tags.
 */
export function weeklyRecap(mondayDate: string): WeeklyRecap {
  const monday = mondayOf(mondayDate);
  const dates = workWeekDates(monday);
  const friday = dates[dates.length - 1];

  const days = dates.map(dayRollup);
  const perTag = effortPerTag(monday, friday);

  return {
    monday,
    friday,
    days,
    effortPerTag: perTag,
    busiestTags: perTag.slice(0, 3),
    totalEffortMin: days.reduce((a, d) => a + d.effortMin, 0),
    totalWallClockMin: days.reduce((a, d) => a + d.wallClockMin, 0),
    totalActivities: days.reduce((a, d) => a + d.activities, 0),
    completeDays: days.filter((d) => d.coverage === "complete").length,
    notes: dailyNotesInRange(monday, friday),
  };
}

/** Top tickets touched in a WIB range (schema.md §3.4), ranked by effort. */
export function topTickets(from: string, to: string, limit = 20): TopTicket[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ticket_id            AS ticket_id,
              COUNT(*)             AS entries,
              SUM(duration_min)    AS effortMin
       FROM entries
       WHERE work_date BETWEEN ? AND ? AND ticket_id IS NOT NULL AND ticket_id <> ''
       GROUP BY ticket_id
       ORDER BY effortMin DESC, entries DESC, ticket_id ASC
       LIMIT ?`,
    )
    .all(from, to, limit) as { ticket_id: string; entries: number; effortMin: number }[];
  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    entries: r.entries,
    effortMin: r.effortMin ?? 0,
  }));
}

/**
 * Monthly recap (design.md §7, schema.md §3.4): per-tag totals, top tickets,
 * and a per-day trend for the month containing any date in [from, to]. When
 * `from`/`to` are given they're used verbatim; a single date can be passed as
 * both to mean "that month" via monthlyRecapForMonth.
 */
export function monthlyRecap(from: string, to: string): MonthlyRecap {
  const trend = datesInRange(from, to).map(dayRollup);
  return {
    from,
    to,
    effortPerTag: effortPerTag(from, to),
    topTickets: topTickets(from, to),
    trend,
    totalEffortMin: trend.reduce((a, d) => a + d.effortMin, 0),
    totalWallClockMin: trend.reduce((a, d) => a + d.wallClockMin, 0),
    totalActivities: trend.reduce((a, d) => a + d.activities, 0),
    activeDays: trend.filter((d) => d.activities > 0).length,
    notes: dailyNotesInRange(from, to),
  };
}

/** Convenience: monthly recap for the whole month containing `date`. */
export function monthlyRecapForMonth(date: string): MonthlyRecap {
  return monthlyRecap(monthStart(date), monthEnd(date));
}

/**
 * Boss-ready export structure (schema.md §4): entries grouped by normalized tag,
 * each tag a section { label, totalMin, items:[{date,desc,ticket,summary,min}] }
 * ordered by totalMin desc, plus grand totals + range meta. Entries with
 * multiple tags appear under each of their tags (effort is per-tag, so totals
 * double-count across tags by design — same as effortPerTag).
 */
export function rangeExport(from: string, to: string): RangeExport {
  const dates = datesInRange(from, to);

  // Collect every entry in the range (ordered by date, then start).
  const allEntries: EntryRow[] = [];
  for (const d of dates) allEntries.push(...listEntriesByDate(d));

  // Group by normalized tag; preserve the most-frequent casing as display label.
  const sections = new Map<string, { label: string; labelCounts: Map<string, number>; items: ExportItem[]; totalMin: number }>();
  const untaggedItems: ExportItem[] = [];
  let untaggedMin = 0;

  for (const e of allEntries) {
    const item: ExportItem = {
      date: e.work_date,
      desc: e.description,
      ticket: e.ticket_id,
      summary: e.summary,
      min: e.duration_min,
    };
    if (e.tags.length === 0) {
      untaggedItems.push(item);
      untaggedMin += e.duration_min;
      continue;
    }
    for (const tag of e.tags) {
      const key = tag.trim().toLowerCase();
      const sec = sections.get(key) ?? {
        label: tag,
        labelCounts: new Map<string, number>(),
        items: [] as ExportItem[],
        totalMin: 0,
      };
      sec.items.push(item);
      sec.totalMin += e.duration_min;
      sec.labelCounts.set(tag, (sec.labelCounts.get(tag) ?? 0) + 1);
      sections.set(key, sec);
    }
  }

  const tagSections: ExportTagSection[] = [...sections.values()]
    .map((s) => {
      // Pick the most-frequent original casing as the display label.
      let bestLabel = s.label;
      let bestCount = -1;
      for (const [lbl, c] of s.labelCounts) {
        if (c > bestCount) {
          bestCount = c;
          bestLabel = lbl;
        }
      }
      return { label: bestLabel, totalMin: s.totalMin, items: s.items };
    })
    .sort((a, b) => b.totalMin - a.totalMin || a.label.localeCompare(b.label));

  const untagged: ExportTagSection | null =
    untaggedItems.length > 0
      ? { label: "Untagged", totalMin: untaggedMin, items: untaggedItems }
      : null;

  const activeDays = new Set(allEntries.map((e) => e.work_date)).size;

  return {
    from,
    to,
    tags: tagSections,
    untagged,
    grandTotalMin: allEntries.reduce((a, e) => a + e.duration_min, 0),
    grandTotalActivities: allEntries.length,
    activeDays,
  };
}

/** Hours string for Markdown totals, e.g. 150 -> "2.5h". */
function hours(min: number): string {
  return `${(min / 60).toFixed(1)}h`;
}

/** HH:mm→ nothing; export uses dates + durations, not wall-clock times. */
function fmtMinMd(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Render rangeExport into clean, boss-readable Markdown (deliverable §4):
 *   - a title with the range,
 *   - a per-tag section: heading + total hours + bulleted activities
 *     (date · ticket · duration + description/summary),
 *   - a totals table (tag → activities, effort hours) + grand total row.
 */
export function exportMarkdown(from: string, to: string): string {
  const data = rangeExport(from, to);
  const lines: string[] = [];

  lines.push(`# Worklog — ${from} to ${to}`);
  lines.push("");
  lines.push(
    `${data.grandTotalActivities} ${data.grandTotalActivities === 1 ? "activity" : "activities"} across ${data.activeDays} active ${data.activeDays === 1 ? "day" : "days"} · ${hours(data.grandTotalMin)} total effort logged.`,
  );
  lines.push("");

  const allSections = [...data.tags];
  if (data.untagged) allSections.push(data.untagged);

  if (allSections.length === 0) {
    lines.push("_No activities logged in this range._");
    lines.push("");
  }

  // Per-tag prose sections.
  for (const sec of allSections) {
    lines.push(`## ${sec.label} — ${hours(sec.totalMin)}`);
    lines.push("");
    for (const item of sec.items) {
      const bits: string[] = [item.date];
      if (item.ticket) bits.push(item.ticket);
      bits.push(fmtMinMd(item.min));
      const meta = bits.join(" · ");
      const summary = item.summary ? ` — ${item.summary}` : "";
      lines.push(`- **${meta}** ${item.desc}${summary}`);
    }
    lines.push("");
  }

  // Totals table.
  lines.push("## Totals");
  lines.push("");
  lines.push("| Tag | Activities | Effort |");
  lines.push("| --- | ---: | ---: |");
  for (const sec of allSections) {
    lines.push(`| ${sec.label} | ${sec.items.length} | ${hours(sec.totalMin)} |`);
  }
  lines.push(`| **Total** | **${data.grandTotalActivities}** | **${hours(data.grandTotalMin)}** |`);
  lines.push("");

  return lines.join("\n");
}
