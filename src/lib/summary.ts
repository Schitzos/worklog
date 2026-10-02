import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import { listEntriesByDate } from "./entries";
import { geminiGenerate, hasGeminiKey, GEMINI_MODEL } from "./gemini";

/**
 * Daily SUMMARY (auto-generated prose) — distinct from the user's daily NOTE.
 *
 *  - daily_notes   : typed by the user, never auto-written.
 *  - daily_summary : written by Gemini (or a deterministic fallback) from the
 *                    day's entries. The cron/launchd job and the regenerate
 *                    button write here; the user's note is never touched.
 *
 * Flow: gather the day's entries → build compact FACTS → ask Gemini for a short
 * first-person paragraph → store it. If there is no key or Gemini errors, store
 * a clean deterministic sentence instead (source='fallback') so the feature
 * never crashes and a summary always exists.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailySummary {
  work_date: string;
  summary: string;
  source: "gemini" | "fallback";
  model: string | null;
  src_hash: string;
  created_at: string;
  updated_at: string;
}

/** Fingerprint of the day's entries, so we can tell "already summarized" from "stale". */
function entriesHash(workDate: string): string {
  const rows = listEntriesByDate(workDate);
  const basis = rows
    .map((e) =>
      [e.id, e.description, e.ticket_id ?? "", e.summary ?? "", e.start_at, e.end_at, e.tags.join(",")].join("|"),
    )
    .join("\n");
  return createHash("sha1").update(`${workDate}\n${basis}`).digest("hex");
}

function fmtMin(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact, model-friendly facts for one day (the Gemini input). */
export function dayFacts(workDate: string): {
  workDate: string;
  activityCount: number;
  effortMin: number;
  lines: string[];
  tagTotals: { label: string; min: number }[];
  tickets: string[];
} {
  const entries = listEntriesByDate(workDate);
  const effortMin = entries.reduce((a, e) => a + e.duration_min, 0);

  const tagMap = new Map<string, number>();
  const ticketSet = new Set<string>();
  const lines: string[] = [];

  for (const e of entries) {
    const bits = [`${fmtMin(e.duration_min)}`, e.description];
    if (e.ticket_id) {
      bits.push(`(${e.ticket_id})`);
      ticketSet.add(e.ticket_id);
    }
    if (e.tags.length) bits.push(`[${e.tags.join(", ")}]`);
    if (e.summary) bits.push(`— ${e.summary}`);
    lines.push(bits.join(" "));
    for (const t of e.tags) tagMap.set(t, (tagMap.get(t) ?? 0) + e.duration_min);
  }

  const tagTotals = [...tagMap.entries()]
    .map(([label, min]) => ({ label, min }))
    .sort((a, b) => b.min - a.min);

  return {
    workDate,
    activityCount: entries.length,
    effortMin,
    lines,
    tagTotals,
    tickets: [...ticketSet],
  };
}

/** Build the Gemini prompt from the day's facts. */
function buildPrompt(facts: ReturnType<typeof dayFacts>): string {
  const tagStr = facts.tagTotals.map((t) => `${t.label}: ${fmtMin(t.min)}`).join(", ") || "none";
  const ticketStr = facts.tickets.join(", ") || "none";
  return [
    "You are writing a concise daily work summary for a software developer's status report.",
    "Write ONE short first-person paragraph (2–4 sentences), professional and factual.",
    "Summarize what was worked on, grouping related activities. Mention tickets naturally if present.",
    "Do NOT invent anything not in the data. Do NOT use bullet points or markdown. Plain prose only.",
    "",
    `Date: ${facts.workDate}`,
    `Total effort: ${fmtMin(facts.effortMin)} across ${facts.activityCount} ${facts.activityCount === 1 ? "activity" : "activities"}.`,
    `Time per tag: ${tagStr}.`,
    `Tickets: ${ticketStr}.`,
    "",
    "Activities:",
    ...facts.lines.map((l) => `- ${l}`),
  ].join("\n");
}

/** Deterministic one-paragraph fallback (no LLM) — used when Gemini is unavailable. */
function fallbackSummary(facts: ReturnType<typeof dayFacts>): string {
  if (facts.activityCount === 0) return "No activities were logged on this day.";
  const tagStr = facts.tagTotals.map((t) => `${t.label} (${fmtMin(t.min)})`).join(", ");
  const ticketStr = facts.tickets.length ? ` Tickets touched: ${facts.tickets.join(", ")}.` : "";
  return (
    `Logged ${fmtMin(facts.effortMin)} of effort across ${facts.activityCount} ` +
    `${facts.activityCount === 1 ? "activity" : "activities"}` +
    `${tagStr ? `, spent on ${tagStr}` : ""}.${ticketStr}`
  );
}

export function getDailySummary(workDate: string): DailySummary | null {
  if (!DATE_RE.test(workDate)) throw new Error(`invalid work_date: ${workDate}`);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT work_date, summary, source, model, src_hash, created_at, updated_at
       FROM daily_summary WHERE work_date = ?`,
    )
    .get(workDate) as DailySummary | undefined;
  return row ?? null;
}

function upsertSummary(
  workDate: string,
  summary: string,
  source: "gemini" | "fallback",
  model: string | null,
  srcHash: string,
): DailySummary {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO daily_summary (work_date, summary, source, model, src_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(work_date) DO UPDATE SET
       summary = excluded.summary, source = excluded.source,
       model = excluded.model, src_hash = excluded.src_hash,
       updated_at = excluded.updated_at`,
  ).run(workDate, summary, source, model, srcHash, now, now);
  return getDailySummary(workDate)!;
}

/**
 * Generate (or regenerate) the summary for a day. Reuses the day's entries,
 * calls Gemini, falls back to deterministic text on any failure. Writes to
 * daily_summary only — never the user's note.
 */
export async function buildDailySummary(
  workDate: string,
  opts: { force?: boolean } = {},
): Promise<DailySummary> {
  if (!DATE_RE.test(workDate)) throw new Error(`invalid work_date: ${workDate}`);
  const facts = dayFacts(workDate);
  const srcHash = entriesHash(workDate);

  // Nothing logged → store a trivial fallback (so the day isn't re-processed forever).
  if (facts.activityCount === 0) {
    return upsertSummary(workDate, fallbackSummary(facts), "fallback", null, srcHash);
  }

  const prompt = buildPrompt(facts);
  const result = await geminiGenerate(prompt);
  if (result.ok) {
    return upsertSummary(workDate, result.text, "gemini", result.model, srcHash);
  }
  // No key or API error → deterministic fallback, flagged as such.
  return upsertSummary(workDate, fallbackSummary(facts), "fallback", null, srcHash);
}

/**
 * CATCH-UP: summarize every past day that has activity but no up-to-date
 * summary. "Up to date" = a summary exists whose src_hash matches the day's
 * current entries. This is the reliable mechanism — if the machine was asleep
 * at the scheduled time, the next run backfills. Only processes days strictly
 * before `today` (today is still in progress). Returns the dates it summarized.
 */
export async function summarizeMissingDays(today: string): Promise<string[]> {
  const db = getDb();
  // Distinct past days that have at least one entry.
  const activeDays = (
    db
      .prepare(
        `SELECT DISTINCT work_date FROM entries WHERE work_date < ? ORDER BY work_date ASC`,
      )
      .all(today) as { work_date: string }[]
  ).map((r) => r.work_date);

  const done: string[] = [];
  for (const d of activeDays) {
    const existing = getDailySummary(d);
    const currentHash = entriesHash(d);
    if (existing && existing.src_hash === currentHash && existing.source === "gemini") {
      continue; // already summarized by Gemini and entries unchanged
    }
    await buildDailySummary(d);
    done.push(d);
  }
  return done;
}

export const summaryMeta = {
  model: GEMINI_MODEL,
  hasKey: hasGeminiKey,
};
