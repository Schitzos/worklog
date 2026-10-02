import "server-only";
import { listEntriesByDate } from "./entries";
import { slotStatus } from "./recap";
import {
  SLOTS,
  addDays,
  dayOfWeek,
  datesInRange,
  slotWindowUtc,
  wibWorkDate,
} from "./time";

/**
 * Habit-insight aggregation (design.md §7 Insights, schema.md §3.6/§3.7).
 *
 * Three insights, all dual-metric-consistent with recap.ts:
 *   - streak        — consecutive COMPLETE weekdays (every slot filled/skipped),
 *                     counting backwards from a given WIB date. {current, best}.
 *   - hourHeatmap   — per WIB hour-of-day EFFORT minutes (overlap double-counts,
 *                     same as effortPerTag) for the window hours 8..18.
 *   - untrackedRollup — per day WALL-CLOCK coverage of the 6h window (10–16),
 *                     overlap counted once, plus skipped + gap minutes.
 *
 * All timezone math is in the app layer (schema.md §6). WIB is a fixed UTC+7.
 */

const WINDOW_START_HOUR = 10;
const WINDOW_END_HOUR = 16;
const WINDOW_MIN = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60; // 360
const HEATMAP_FROM_HOUR = 8;
const HEATMAP_TO_HOUR = 18;

export interface Streak {
  /** Consecutive complete weekdays ending at (and counting back from) upToDate. */
  current: number;
  /** Longest run of consecutive complete weekdays found anywhere in the data. */
  best: number;
}

export interface HeatmapCell {
  /** WIB hour of day (24h). */
  hour: number;
  /** Sum of entry durations overlapping that WIB hour (effort; overlap counts). */
  effortMin: number;
}

export interface UntrackedDay {
  date: string;
  /** The reminder window length in minutes (10–16 = 360). */
  windowMin: number;
  /** Wall-clock minutes covered by entries WITHIN the window (overlap once). */
  coveredMin: number;
  /** Minutes inside skipped slots not otherwise covered by an entry. */
  skippedMin: number;
  /** Minutes neither covered nor skipped — the real untracked gap. */
  gapMin: number;
}

export interface UntrackedRollup {
  from: string;
  to: string;
  days: UntrackedDay[];
  totalWindowMin: number;
  totalCoveredMin: number;
  totalSkippedMin: number;
  /** Headline figure: "X hours untracked this week/month". */
  totalGapMin: number;
}

export interface InsightsPayload {
  streak: Streak;
  heatmap: HeatmapCell[];
  untracked: UntrackedRollup;
}

/** Is a WIB calendar date a weekday (Mon–Fri)? */
function isWeekday(date: string): boolean {
  const dow = dayOfWeek(date); // 0=Sun..6=Sat
  return dow >= 1 && dow <= 5;
}

/** A weekday is COMPLETE when every slot is filled or skipped (none empty). */
function isCompleteDay(date: string): boolean {
  const slots = slotStatus(date);
  return slots.every((s) => s.status === "filled" || s.status === "skipped");
}

/**
 * streak(upToDate): consecutive COMPLETE weekdays counting backwards from
 * upToDate (weekends are skipped over, not counted and not break the run), and
 * the longest such run found scanning back over the data window.
 *
 * `best` is computed by walking back a bounded horizon of weekdays (default
 * ~1 year) so it reflects the longest run in the stored data without an
 * unbounded scan. The current run is the tail ending at upToDate.
 */
export function streak(upToDate: string, horizonDays = 400): Streak {
  // Build the ordered list of weekday dates from (upToDate - horizon) .. upToDate.
  const start = addDays(upToDate, -horizonDays);
  const weekdays = datesInRange(start, upToDate).filter(isWeekday);

  // Completeness per weekday, oldest → newest.
  const complete = weekdays.map(isCompleteDay);

  // best = longest consecutive run of `true`.
  let best = 0;
  let run = 0;
  for (const c of complete) {
    run = c ? run + 1 : 0;
    if (run > best) best = run;
  }

  // current = run of trailing `true`s ending at upToDate.
  let current = 0;
  for (let i = complete.length - 1; i >= 0; i--) {
    if (complete[i]) current++;
    else break;
  }

  return { current, best };
}

/**
 * hourHeatmap(from,to): per WIB hour-of-day EFFORT minutes across a WIB date
 * range, for hours HEATMAP_FROM_HOUR..HEATMAP_TO_HOUR inclusive. An entry
 * contributes to each WIB hour its [start,end] interval overlaps, by the number
 * of minutes it overlaps that hour (so a 90-min entry spanning 10:00–11:30
 * gives 60 to hour 10 and 30 to hour 11). Overlap across entries double-counts,
 * consistent with the effort metric (design.md §6).
 */
export function hourHeatmap(from: string, to: string): HeatmapCell[] {
  const buckets = new Map<number, number>();
  for (let h = HEATMAP_FROM_HOUR; h <= HEATMAP_TO_HOUR; h++) buckets.set(h, 0);

  for (const date of datesInRange(from, to)) {
    for (const e of listEntriesByDate(date)) {
      const startMs = new Date(e.start_at).getTime();
      const endMs = new Date(e.end_at).getTime();
      // Walk each WIB hour in the heatmap window and add the overlap minutes.
      for (let h = HEATMAP_FROM_HOUR; h <= HEATMAP_TO_HOUR; h++) {
        const hStart = new Date(hourStartUtc(date, h)).getTime();
        const hEnd = hStart + 60 * 60_000;
        const overlapMs = Math.min(endMs, hEnd) - Math.max(startMs, hStart);
        if (overlapMs > 0) {
          buckets.set(h, (buckets.get(h) ?? 0) + Math.round(overlapMs / 60_000));
        }
      }
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, effortMin]) => ({ hour, effortMin }));
}

/** UTC instant for a WIB date + WIB wall-clock hour (reuses time.ts math). */
function hourStartUtc(date: string, hour: number): string {
  // slotWindowUtc builds via wibWallClockToUtc; replicate just the start math.
  // Any WIB hour → UTC = WIB wall-clock minus the +7h offset.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid work_date: ${date}`);
  const [, y, mo, da] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(da), hour) - 7 * 60 * 60_000;
  return new Date(utcMs).toISOString();
}

interface Interval {
  start: number;
  end: number;
}

/** Merge overlapping/adjacent intervals; return disjoint sorted set. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Clamp an interval to [winStart,winEnd]; return covered ms (>=0). */
function clampedMs(iv: Interval, winStart: number, winEnd: number): number {
  const s = Math.max(iv.start, winStart);
  const e = Math.min(iv.end, winEnd);
  return Math.max(0, e - s);
}

/**
 * untrackedRollup(from,to): per-day WALL-CLOCK coverage of the 6h window
 * (10–16, 360 min). coveredMin = union of entry intervals clipped to the window
 * (overlap counted once); skippedMin = minutes inside skipped slots not already
 * covered by an entry; gapMin = window − covered − skipped. The range headline
 * is the sum of gapMin ("X hours untracked this week/month").
 */
export function untrackedRollup(from: string, to: string): UntrackedRollup {
  const days: UntrackedDay[] = datesInRange(from, to).map((date) => {
    const winStart = new Date(slotWindowUtc(date, "10-12")!.startAt).getTime();
    const winEnd = new Date(slotWindowUtc(date, "14-16")!.endAt).getTime();

    const entries = listEntriesByDate(date);
    const entryIntervals: Interval[] = entries.map((e) => ({
      start: new Date(e.start_at).getTime(),
      end: new Date(e.end_at).getTime(),
    }));
    const mergedEntries = mergeIntervals(entryIntervals);
    const coveredMin = Math.round(
      mergedEntries.reduce((a, iv) => a + clampedMs(iv, winStart, winEnd), 0) / 60_000,
    );

    // Skipped slots that are NOT already covered by an entry.
    const slots = slotStatus(date);
    const skippedIntervals: Interval[] = [];
    for (const s of slots) {
      if (s.status !== "skipped") continue;
      const win = slotWindowUtc(date, s.slot)!;
      skippedIntervals.push({
        start: new Date(win.startAt).getTime(),
        end: new Date(win.endAt).getTime(),
      });
    }
    // Covered-or-skipped union, then subtract covered to get skipped-only min.
    const unionAll = mergeIntervals([...entryIntervals, ...skippedIntervals]);
    const coveredOrSkippedMin = Math.round(
      unionAll.reduce((a, iv) => a + clampedMs(iv, winStart, winEnd), 0) / 60_000,
    );
    const skippedMin = Math.max(0, coveredOrSkippedMin - coveredMin);
    const gapMin = Math.max(0, WINDOW_MIN - coveredOrSkippedMin);

    return {
      date,
      windowMin: WINDOW_MIN,
      coveredMin,
      skippedMin,
      gapMin,
    };
  });

  return {
    from,
    to,
    days,
    totalWindowMin: days.reduce((a, d) => a + d.windowMin, 0),
    totalCoveredMin: days.reduce((a, d) => a + d.coveredMin, 0),
    totalSkippedMin: days.reduce((a, d) => a + d.skippedMin, 0),
    totalGapMin: days.reduce((a, d) => a + d.gapMin, 0),
  };
}

/** The combined insights payload for GET /api/insights. */
export function insights(from: string, to: string, upTo: string): InsightsPayload {
  return {
    streak: streak(upTo),
    heatmap: hourHeatmap(from, to),
    untracked: untrackedRollup(from, to),
  };
}

/** Re-export the window constants used by the UI for labelling. */
export const INSIGHT_WINDOW = {
  startHour: WINDOW_START_HOUR,
  endHour: WINDOW_END_HOUR,
  windowMin: WINDOW_MIN,
  heatmapFromHour: HEATMAP_FROM_HOUR,
  heatmapToHour: HEATMAP_TO_HOUR,
} as const;

/** Convenience used by the Today page: today's WIB streak. */
export function streakForToday(now: Date = new Date()): Streak {
  return streak(wibWorkDate(now));
}

/** Keep SLOTS referenced so a future slot-count change is a single source. */
export const SLOT_COUNT = SLOTS.length;
