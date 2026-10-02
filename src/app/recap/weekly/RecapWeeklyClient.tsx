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
import { CaretLeft, CaretRight, Tag } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import { fmtDuration } from "@/lib/view";
import type { DayRollup, EffortPerTag, WeeklyRecap } from "@/lib/recap";
import type { InsightsPayload } from "@/lib/insights";
import { HeatmapCard, UntrackedCard } from "../InsightCards";
import { NotesSection } from "../NotesSection";

const WIB_OFFSET_MS = 7 * 60 * 60_000;

function todayWib(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Add days to a 'YYYY-MM-DD' (noon-anchored, DST-safe). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + days * 86_400_000;
  const dt = new Date(t);
  return dt.toISOString().slice(0, 10);
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** A number that counts up from 0 to `to` once on view. */
function CountUp({ to, fmt, className }: { to: number; fmt: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const mv = useMotionValue(reduce ? to : 0);
  const text = useTransform(mv, (v) => fmt(Math.round(v)));
  useEffect(() => {
    if (reduce) { mv.set(to); return; }
    if (inView) {
      const c = animate(mv, to, { duration: 0.9, ease: [0.32, 0.72, 0, 1] });
      return () => c.stop();
    }
  }, [inView, to, reduce, mv]);
  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}

/** Per-tag horizontal bar that grows on view. */
function TagBar({ tag, max }: { tag: EffortPerTag; max: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const scale = max > 0 ? tag.effortMin / max : 0;
  return (
    <div ref={ref} style={{ marginBottom: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem" }}>
          <Tag size={14} weight="light" /> {tag.label}
          <span className="mono" style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
            · {tag.activities} {tag.activities === 1 ? "activity" : "activities"}
          </span>
        </span>
        <span className="mono" style={{ fontSize: "0.85rem", fontWeight: 600 }}>{fmtDuration(tag.effortMin)}</span>
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

/** Per-day vertical hours bar (grows from the bottom on view). */
function WeekBar({ day, max, dow }: { day: DayRollup; max: number; dow: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const scale = max > 0 ? day.effortMin / max : 0;
  const empty = day.effortMin === 0;
  return (
    <div className="weekbar-col" ref={ref}>
      <span className="weekbar-val mono">{day.effortMin > 0 ? fmtDuration(day.effortMin) : "–"}</span>
      <div className="weekbar-track">
        <motion.div
          className="weekbar-fill"
          data-testid="weekbar-fill"
          data-empty={empty}
          initial={reduce ? false : { scaleY: 0 }}
          animate={reduce ? { scaleY: empty ? 0.02 : scale } : inView ? { scaleY: empty ? 0.02 : scale } : { scaleY: 0 }}
          transition={SPRING}
          style={{ height: "100%", transformOrigin: "bottom center" }}
        />
      </div>
      <span className="weekbar-day mono">{dow}</span>
    </div>
  );
}

export function RecapWeeklyClient({ initial }: { initial: WeeklyRecap }) {
  const [monday, setMonday] = useState(initial.monday);
  const [recap, setRecap] = useState<WeeklyRecap>(initial);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recap/weekly?monday=${m}`);
      if (res.ok) {
        const data = (await res.json()) as WeeklyRecap;
        setRecap(data);
        setMonday(data.monday);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Insights (streak unused here; heatmap + untracked over the Mon–Fri range).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/insights?from=${recap.monday}&to=${recap.friday}&upTo=${recap.friday}`,
      );
      if (res.ok && alive) setInsights((await res.json()) as InsightsPayload);
    })();
    return () => {
      alive = false;
    };
  }, [recap.monday, recap.friday]);

  useEffect(() => {
    if (monday !== recap.monday) void load(monday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  const maxTagEffort = useMemo(
    () => Math.max(1, ...recap.effortPerTag.map((t) => t.effortMin)),
    [recap.effortPerTag],
  );
  const maxDayEffort = useMemo(
    () => Math.max(1, ...recap.days.map((d) => d.effortMin)),
    [recap.days],
  );

  // Monday of the current WIB week — disable "next" past it.
  const currentMonday = useMemo(() => {
    const t = todayWib();
    const [y, m, d] = t.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
    const back = dow === 0 ? 6 : dow - 1;
    return addDays(t, -back);
  }, []);
  const atCurrentWeek = recap.monday >= currentMonday;

  return (
    <main style={{ minHeight: "100dvh", maxWidth: "1280px", margin: "0 auto", padding: "var(--section-py) 1rem 5rem" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Weekly recap
          </h1>
          <p className="mono" style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
            {recap.monday} – {recap.friday} · WIB
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <button className="btn-ghost" aria-label="Previous week" onClick={() => setMonday(addDays(recap.monday, -7))}>
            <CaretLeft size={16} weight="light" />
          </button>
          <input
            type="date"
            className="date-input mono"
            data-testid="week-date"
            value={monday}
            max={todayWib()}
            onChange={(e) => setMonday(e.target.value || todayWib())}
          />
          <button
            className="btn-ghost"
            aria-label="Next week"
            disabled={atCurrentWeek}
            onClick={() => setMonday(addDays(recap.monday, 7))}
          >
            <CaretRight size={16} weight="light" />
          </button>
        </div>
      </header>

      <div className="bento" data-testid="weekly-bento" aria-busy={loading}>
        {/* Week totals */}
        <div className="bezel bento-weektotals">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Week totals</h3>
            <div className="metric-row">
              <span className="metric-label">Effort logged</span>
              <CountUp className="metric-value mono" to={recap.totalEffortMin} fmt={fmtDuration} />
            </div>
            <div className="metric-row">
              <span className="metric-label">Wall-clock</span>
              <CountUp className="metric-value mono" to={recap.totalWallClockMin} fmt={fmtDuration} />
            </div>
            <div className="metric-row">
              <span className="metric-label">Activities</span>
              <CountUp className="metric-value mono" to={recap.totalActivities} fmt={(n) => String(n)} />
            </div>
            <div className="metric-row">
              <span className="metric-label">Complete days</span>
              <CountUp className="metric-value mono" to={recap.completeDays} fmt={(n) => `${n}/5`} />
            </div>
          </div>
        </div>

        {/* Per-day hours bar chart */}
        <div className="bezel bento-weekdays">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>Hours per day</h3>
            <div className="weekbars" data-testid="weekbars">
              {recap.days.map((d, i) => (
                <WeekBar key={d.workDate} day={d} max={maxDayEffort} dow={DOW[i]} />
              ))}
            </div>
          </div>
        </div>

        {/* Effort per tag */}
        <div className="bezel bento-tags">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.9rem", fontSize: "0.9rem", fontWeight: 600 }}>Effort per tag</h3>
            {recap.effortPerTag.length === 0 ? (
              <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                No tagged activities this week.
              </p>
            ) : (
              recap.effortPerTag.map((t) => <TagBar key={t.label} tag={t} max={maxTagEffort} />)
            )}
          </div>
        </div>

        {/* Coverage streak */}
        <div className="bezel bento-coverage">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Coverage</h3>
            <div className="coverage-row" data-testid="coverage-row">
              {recap.days.map((d, i) => (
                <div className="coverage-cell" key={d.workDate}>
                  <span className="coverage-swatch" data-coverage={d.coverage} title={`${d.workDate}: ${d.coverage}`} />
                  <span className="coverage-label mono">{DOW[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Busiest tags */}
        <div className="bezel bento-busiest">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Busiest tags</h3>
            {recap.busiestTags.length === 0 ? (
              <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                Nothing logged this week yet.
              </p>
            ) : (
              <ul className="busiest-list">
                {recap.busiestTags.map((t, i) => (
                  <li className="busiest-item" key={t.label}>
                    <span>
                      <span className="busiest-rank mono">{i + 1}</span>
                      {t.label}
                    </span>
                    <span className="mono" style={{ fontWeight: 600, fontSize: "0.85rem" }}>{fmtDuration(t.effortMin)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Hour heatmap + untracked-time insights (Phase 6) */}
        {insights ? <HeatmapCard heatmap={insights.heatmap} /> : null}
        {insights ? <UntrackedCard untracked={insights.untracked} /> : null}

        {/* Daily notes written across the week (read-only) */}
        <NotesSection notes={recap.notes ?? {}} title="Daily notes this week" />
      </div>
    </main>
  );
}
