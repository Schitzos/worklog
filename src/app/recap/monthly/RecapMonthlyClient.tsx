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
import { CaretLeft, CaretRight, Tag, Ticket } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import { fmtDuration } from "@/lib/view";
import type { DayRollup, EffortPerTag, MonthlyRecap } from "@/lib/recap";
import type { InsightsPayload } from "@/lib/insights";
import { HeatmapCard, UntrackedCard } from "../InsightCards";
import { NotesSection } from "../NotesSection";

const WIB_OFFSET_MS = 7 * 60 * 60_000;

function todayWib(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM' input value → first/last day of that month. */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/** Shift a 'YYYY-MM' by ±1 month. */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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

/** Per-day trend sparkline — one bar per day, grows from the bottom on view. */
function TrendBars({ trend }: { trend: DayRollup[] }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const max = Math.max(1, ...trend.map((d) => d.effortMin));
  return (
    <div className="trendbars" data-testid="trendbars" ref={ref}>
      {trend.map((d) => {
        const empty = d.effortMin === 0;
        const scale = empty ? 0.02 : d.effortMin / max;
        return (
          <motion.div
            key={d.workDate}
            className="trendbar"
            data-empty={empty}
            title={`${d.workDate}: ${d.effortMin > 0 ? fmtDuration(d.effortMin) : "nothing logged"}`}
            initial={reduce ? false : { scaleY: 0 }}
            animate={reduce ? { scaleY: scale } : inView ? { scaleY: scale } : { scaleY: 0 }}
            transition={SPRING}
            style={{ height: "100%", transformOrigin: "bottom center" }}
          />
        );
      })}
    </div>
  );
}

export function RecapMonthlyClient({ initial }: { initial: MonthlyRecap }) {
  // Derive the 'YYYY-MM' picker value from the range start.
  const [ym, setYm] = useState(initial.from.slice(0, 7));
  const [recap, setRecap] = useState<MonthlyRecap>(initial);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);

  const load = useCallback(async (month: string) => {
    const { from, to } = monthBounds(month);
    setLoading(true);
    try {
      const res = await fetch(`/api/recap/monthly?from=${from}&to=${to}`);
      if (res.ok) setRecap((await res.json()) as MonthlyRecap);
    } finally {
      setLoading(false);
    }
  }, []);

  // Insights over the month range (heatmap + untracked; streak unused here).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/insights?from=${recap.from}&to=${recap.to}&upTo=${recap.to}`,
      );
      if (res.ok && alive) setInsights((await res.json()) as InsightsPayload);
    })();
    return () => {
      alive = false;
    };
  }, [recap.from, recap.to]);

  useEffect(() => {
    if (ym !== recap.from.slice(0, 7)) void load(ym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  const maxTagEffort = useMemo(
    () => Math.max(1, ...recap.effortPerTag.map((t) => t.effortMin)),
    [recap.effortPerTag],
  );
  const curYm = todayWib().slice(0, 7);
  const atCurrentMonth = ym >= curYm;

  return (
    <main style={{ minHeight: "100dvh", maxWidth: "1280px", margin: "0 auto", padding: "var(--section-py) 1rem 5rem" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Monthly recap
          </h1>
          <p className="mono" style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
            {recap.from} – {recap.to} · WIB
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <button className="btn-ghost" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}>
            <CaretLeft size={16} weight="light" />
          </button>
          <input
            type="month"
            className="date-input mono"
            data-testid="month-date"
            value={ym}
            max={curYm}
            onChange={(e) => setYm(e.target.value || curYm)}
          />
          <button
            className="btn-ghost"
            aria-label="Next month"
            disabled={atCurrentMonth}
            onClick={() => setYm(shiftMonth(ym, 1))}
          >
            <CaretRight size={16} weight="light" />
          </button>
        </div>
      </header>

      <div className="bento" data-testid="monthly-bento" aria-busy={loading}>
        {/* Month totals */}
        <div className="bezel bento-totals">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Month totals</h3>
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
              <span className="metric-label">Active days</span>
              <CountUp className="metric-value mono" to={recap.activeDays} fmt={(n) => String(n)} />
            </div>
          </div>
        </div>

        {/* Per-day trend sparkline */}
        <div className="bezel bento-trend">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>Per-day trend</h3>
            <TrendBars trend={recap.trend} />
            <p className="mono" style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.72rem" }}>
              effort per day across the month
            </p>
          </div>
        </div>

        {/* Per-tag totals */}
        <div className="bezel bento-monthtags">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.9rem", fontSize: "0.9rem", fontWeight: 600 }}>Effort per tag</h3>
            {recap.effortPerTag.length === 0 ? (
              <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                No tagged activities this month.
              </p>
            ) : (
              recap.effortPerTag.map((t) => <TagBar key={t.label} tag={t} max={maxTagEffort} />)
            )}
          </div>
        </div>

        {/* Top tickets */}
        <div className="bezel bento-tickets">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <Ticket size={16} weight="light" /> Top tickets
            </h3>
            {recap.topTickets.length === 0 ? (
              <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
                No ticketed activities this month.
              </p>
            ) : (
              <table className="ticket-table" data-testid="ticket-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th className="num">Entries</th>
                    <th className="num">Effort</th>
                  </tr>
                </thead>
                <tbody>
                  {recap.topTickets.map((t) => (
                    <tr key={t.ticket_id} data-ticket={t.ticket_id}>
                      <td className="mono ticket-id">{t.ticket_id}</td>
                      <td className="mono num">{t.entries}</td>
                      <td className="mono num">{fmtDuration(t.effortMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Hour heatmap + untracked-time insights (Phase 6) */}
        {insights ? <HeatmapCard heatmap={insights.heatmap} /> : null}
        {insights ? <UntrackedCard untracked={insights.untracked} /> : null}

        {/* Daily notes written across the month (read-only) */}
        <NotesSection notes={recap.notes ?? {}} title="Daily notes this month" />
      </div>
    </main>
  );
}
