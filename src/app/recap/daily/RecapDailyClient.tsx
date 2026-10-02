"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { Tag } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import { fmtDuration, wibHHMM } from "@/lib/view";
import type { DailyRecap, EffortPerTag } from "@/lib/recap";
import type { EntryRow } from "@/lib/entries";

function todayWib(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

function slotLabel(slot: string): string {
  const [a, b] = slot.split("-");
  return `${a}:00–${b}:00`;
}

/** Format a fractional WIB hour (e.g. 11.5) as HH:MM. */
function hourToHHMM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  // Guard the rounding edge (e.g. 11.999 → 12:00, not 11:60).
  const carry = mm === 60 ? 1 : 0;
  return `${String(hh + carry).padStart(2, "0")}:${String(carry ? 0 : mm).padStart(2, "0")}`;
}

/** A number that counts up from 0 to `to` once, formatted by `fmt`. */
function CountUp({
  to,
  fmt,
  className,
}: {
  to: number;
  fmt: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const mv = useMotionValue(reduce ? to : 0);
  const text = useTransform(mv, (v) => fmt(Math.round(v)));

  useEffect(() => {
    if (reduce) {
      mv.set(to);
      return;
    }
    if (inView) {
      const controls = animate(mv, to, { duration: 0.9, ease: [0.32, 0.72, 0, 1] });
      return () => controls.stop();
    }
  }, [inView, to, reduce, mv]);

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}

/** A per-tag bar that grows from 0 once it scrolls into view. */
function RecapTagBar({ tag, max }: { tag: EffortPerTag; max: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const scale = max > 0 ? tag.effortMin / max : 0;

  return (
    <div ref={ref} style={{ marginBottom: "0.9rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.3rem",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem" }}>
          <Tag size={14} weight="light" /> {tag.label}
          <span className="mono" style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
            · {tag.activities} {tag.activities === 1 ? "activity" : "activities"}
          </span>
        </span>
        <span className="mono" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          {fmtDuration(tag.effortMin)}
        </span>
      </div>
      <div className="recap-tagbar-track">
        <motion.div
          className="recap-tagbar-fill"
          data-testid="recap-tagbar-fill"
          initial={reduce ? false : { scaleX: 0 }}
          animate={reduce ? { scaleX: scale } : inView ? { scaleX: scale } : { scaleX: 0 }}
          transition={SPRING}
          style={{ transformOrigin: "left center" }}
        />
      </div>
    </div>
  );
}

interface TagGroup {
  label: string;
  entries: EntryRow[];
  effortMin: number;
}

function groupByTag(entries: EntryRow[]): { groups: TagGroup[]; untagged: EntryRow[] } {
  const map = new Map<string, TagGroup>();
  const untagged: EntryRow[] = [];
  for (const e of entries) {
    if (e.tags.length === 0) {
      untagged.push(e);
      continue;
    }
    for (const t of e.tags) {
      const key = t.toLowerCase();
      const g = map.get(key) ?? { label: t, entries: [], effortMin: 0 };
      g.entries.push(e);
      g.effortMin += e.duration_min;
      map.set(key, g);
    }
  }
  return {
    groups: [...map.values()].sort((a, b) => b.effortMin - a.effortMin),
    untagged,
  };
}

function SkeletonRecap() {
  return (
    <div className="bento" aria-hidden="true">
      <div className="bezel bento-totals">
        <div className="bezel-core" style={{ padding: "1.1rem" }}>
          <div className="skeleton" style={{ height: 20, width: "60%", marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 32, width: "80%" }} />
        </div>
      </div>
      <div className="bezel bento-tags">
        <div className="bezel-core" style={{ padding: "1.1rem" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 24, marginBottom: 14 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const NOTE_MAX = 2000;

/**
 * Editable free-text note for one day. Loads the note for `workDate`, lets the
 * user edit a textarea (capped at 2000 chars), and saves via PUT. Independent
 * of entries/slots — purely a personal reminder for the day.
 */
function DailyNoteCard({ workDate }: { workDate: string }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "saving" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/notes/daily?date=${workDate}`)
      .then((r) => (r.ok ? r.json() : { note: "" }))
      .then((d: { note?: string }) => {
        if (cancelled) return;
        setNote(d.note ?? "");
        setSaved(d.note ?? "");
        setState("idle");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [workDate]);

  const dirty = note !== saved;

  const save = useCallback(async () => {
    setState("saving");
    try {
      const res = await fetch(`/api/notes/daily?date=${workDate}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { note?: string };
      setSaved(d.note ?? "");
      setNote(d.note ?? "");
      setState("done");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("error");
    }
  }, [note, workDate]);

  return (
    <div className="bezel bento-note" data-testid="daily-note-card">
      <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>
            Daily note <span className="mono" style={{ color: "var(--muted)", fontWeight: 400, fontSize: "0.72rem" }}>· optional</span>
          </h3>
          <span className="mono" style={{ fontSize: "0.7rem", color: note.length > NOTE_MAX * 0.9 ? "var(--warn)" : "var(--muted)" }}>
            {note.length}/{NOTE_MAX}
          </span>
        </div>
        <textarea
          data-testid="daily-note-input"
          className="note-textarea"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="A reminder or summary for this day — what to remember later, context the timed entries don't capture…"
          disabled={state === "loading"}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          rows={5}
          style={{
            width: "100%",
            minHeight: "7rem",
            resize: "vertical",
            background: "var(--canvas)",
            color: "var(--ink)",
            border: "1px solid var(--hairline)",
            borderRadius: "0.6rem",
            padding: "0.6rem 0.7rem",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.6rem" }}>
          {state === "done" ? (
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--accent)" }}>Saved ✓</span>
          ) : state === "error" ? (
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--warn)" }}>Save failed — retry</span>
          ) : null}
          <button
            type="button"
            data-testid="daily-note-save"
            className="pill-cta"
            onClick={() => void save()}
            disabled={!dirty || state === "saving" || state === "loading"}
            style={{ opacity: !dirty || state === "saving" ? 0.5 : 1 }}
          >
            {state === "saving" ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only AUTO summary for the day, written by Gemini (or a deterministic
 * fallback). DISTINCT from the editable Daily note above — the user never types
 * here; a cron/launchd job or the Regenerate button produces it. Shows the
 * source (Gemini vs fallback) so it's clear when the key is missing.
 */
function DailySummaryCard({ workDate }: { workDate: string }) {
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState<"gemini" | "fallback" | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "generating" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/summary/daily?date=${workDate}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { summary?: string; source?: "gemini" | "fallback" | null; hasKey?: boolean }) => {
        if (cancelled) return;
        setSummary(d.summary ?? "");
        setSource(d.source ?? null);
        setHasKey(d.hasKey ?? true);
        setState("idle");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [workDate]);

  const regenerate = useCallback(async () => {
    setState("generating");
    try {
      const res = await fetch(`/api/summary/daily?date=${workDate}`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as {
        summary?: string;
        source?: "gemini" | "fallback" | null;
        hasKey?: boolean;
      };
      setSummary(d.summary ?? "");
      setSource(d.source ?? null);
      setHasKey(d.hasKey ?? true);
      setState("idle");
    } catch {
      setState("error");
    }
  }, [workDate]);

  return (
    <div className="bezel bento-summary" data-testid="daily-summary-card">
      <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem", gap: "0.6rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>
            Auto summary{" "}
            <span className="mono" style={{ color: "var(--muted)", fontWeight: 400, fontSize: "0.72rem" }}>
              · {source === "fallback" ? "basic (no AI key)" : "AI-generated"}
            </span>
          </h3>
          <button
            type="button"
            data-testid="daily-summary-regenerate"
            className="pill-cta"
            onClick={() => void regenerate()}
            disabled={state === "generating" || state === "loading"}
            style={{ opacity: state === "generating" || state === "loading" ? 0.5 : 1 }}
          >
            {state === "generating" ? "Generating…" : "Regenerate"}
          </button>
        </div>

        <div
          data-testid="daily-summary-text"
          style={{
            minHeight: "4.5rem",
            background: "var(--canvas)",
            border: "1px solid var(--hairline)",
            borderRadius: "0.6rem",
            padding: "0.7rem 0.8rem",
            fontSize: "0.86rem",
            lineHeight: 1.6,
            color: summary ? "var(--ink)" : "var(--muted)",
            whiteSpace: "pre-wrap",
          }}
        >
          {state === "loading"
            ? "Loading…"
            : state === "error"
              ? "Could not load the summary."
              : summary ||
                "No summary yet. It is generated automatically for past days, or press Regenerate to create one now."}
        </div>

        {!hasKey ? (
          <p className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)", margin: "0.5rem 0 0" }}>
            No Gemini key found — showing a basic summary. Add GEMINI_KEY to .env for AI-written prose.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function RecapDailyClient({ initial }: { initial: DailyRecap }) {
  const [date, setDate] = useState(initial.workDate);
  const [recap, setRecap] = useState<DailyRecap>(initial);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recap/daily?date=${d}`);
      if (res.ok) setRecap((await res.json()) as DailyRecap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (date !== recap.workDate) void load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const { groups, untagged } = useMemo(() => groupByTag(recap.entries), [recap.entries]);
  const maxTagEffort = useMemo(
    () => Math.max(1, ...recap.effortPerTag.map((t) => t.effortMin)),
    [recap.effortPerTag],
  );

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "var(--section-py) 1rem 5rem",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Daily recap
          </h1>
          <p className="mono" style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
            {recap.workDate} · WIB
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="date"
            className="date-input mono"
            data-testid="recap-date"
            value={date}
            max={todayWib()}
            onChange={(e) => setDate(e.target.value || todayWib())}
          />
        </div>
      </header>

      {loading ? (
        <SkeletonRecap />
      ) : (
        <div className="bento" data-testid="recap-bento">
          {/* Totals */}
          <div className="bezel bento-totals">
            <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Totals</h3>
              <div className="metric-row">
                <span className="metric-label">Effort logged</span>
                <CountUp className="metric-value mono" to={recap.effortMin} fmt={fmtDuration} />
              </div>
              <div className="metric-row">
                <span className="metric-label">Wall-clock</span>
                <CountUp className="metric-value mono" to={recap.wallClockMin} fmt={fmtDuration} />
              </div>
              <div className="metric-row">
                <span className="metric-label">Activities</span>
                <CountUp className="metric-value mono" to={recap.entries.length} fmt={(n) => String(n)} />
              </div>
              {recap.effortMin > recap.wallClockMin ? (
                <p className="mono" style={{ margin: "0.6rem 0 0", color: "var(--muted)", fontSize: "0.72rem" }}>
                  {fmtDuration(recap.effortMin - recap.wallClockMin)} of parallel work
                </p>
              ) : null}
            </div>
          </div>

          {/* Effort per tag — growing bars */}
          <div className="bezel bento-tags">
            <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
              <h3 style={{ margin: "0 0 0.9rem", fontSize: "0.9rem", fontWeight: 600 }}>Effort per tag</h3>
              {recap.effortPerTag.length === 0 ? (
                <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                  No tagged activities on this day.
                </p>
              ) : (
                recap.effortPerTag.map((t) => <RecapTagBar key={t.label} tag={t} max={maxTagEffort} />)
              )}
            </div>
          </div>

          {/* Slot coverage */}
          <div className="bezel bento-slots">
            <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Slot coverage</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {recap.slots.map((s) => (
                  <span key={s.slot} className="slotpill mono" data-state={s.status}>
                    <span className="slotpill-dot" aria-hidden="true" />
                    {slotLabel(s.slot)} · {s.status}
                  </span>
                ))}
              </div>
              {recap.gaps.length > 0 ? (
                <p className="mono" style={{ margin: "0.75rem 0 0", color: "var(--warn)", fontSize: "0.76rem" }}>
                  {recap.gaps.length} untracked gap{recap.gaps.length > 1 ? "s" : ""}:{" "}
                  {recap.gaps
                    .map((g) => `${hourToHHMM(g.fromHour)}–${hourToHHMM(g.toHour)}`)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>

          {/* Entries grouped by tag */}
          <div className="bezel bento-entries">
            <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
              <h3 style={{ margin: "0 0 0.9rem", fontSize: "0.9rem", fontWeight: 600 }}>Activities by tag</h3>
              {groups.length === 0 && untagged.length === 0 ? (
                <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                  Nothing logged on this day.
                </p>
              ) : (
                <>
                  {groups.map((g) => (
                    <div key={g.label} style={{ marginBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.4rem" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontWeight: 600, fontSize: "0.9rem" }}>
                          <Tag size={14} weight="light" /> {g.label}
                        </span>
                        <span className="mono" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                          {fmtDuration(g.effortMin)}
                        </span>
                      </div>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.3rem" }}>
                        {g.entries.map((e) => (
                          <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", borderTop: "1px solid var(--hairline)", paddingTop: "0.3rem" }}>
                            <span style={{ fontSize: "0.85rem" }}>
                              {e.description}
                              {e.ticket_id ? (
                                <span className="mono" style={{ color: "var(--accent)", marginLeft: "0.4rem", fontSize: "0.76rem" }}>
                                  {e.ticket_id}
                                </span>
                              ) : null}
                            </span>
                            <span className="mono" style={{ color: "var(--muted)", fontSize: "0.76rem", whiteSpace: "nowrap" }}>
                              {wibHHMM(e.start_at)}–{wibHHMM(e.end_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {untagged.length > 0 ? (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.4rem", color: "var(--muted)" }}>
                        Untagged
                      </div>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.3rem" }}>
                        {untagged.map((e) => (
                          <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", borderTop: "1px solid var(--hairline)", paddingTop: "0.3rem" }}>
                            <span style={{ fontSize: "0.85rem" }}>{e.description}</span>
                            <span className="mono" style={{ color: "var(--muted)", fontSize: "0.76rem", whiteSpace: "nowrap" }}>
                              {wibHHMM(e.start_at)}–{wibHHMM(e.end_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Daily note (editable, optional) — full-width row */}
          <DailyNoteCard key={`note-${recap.workDate}`} workDate={recap.workDate} />

          {/* Auto summary (read-only, AI-generated) — full-width row */}
          <DailySummaryCard key={`sum-${recap.workDate}`} workDate={recap.workDate} />
        </div>
      )}
    </main>
  );
}
