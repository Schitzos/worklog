"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Clock, Warning } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import { fmtDuration } from "@/lib/view";
import type { HeatmapCell, UntrackedRollup } from "@/lib/insights";

/**
 * Shared recap insight cards (design.md §7, DESIGN_SYSTEM §2/§6/§8):
 *   - HeatmapCard   — hours 8–18 as cells, intensity = effortMin on a SINGLE
 *                     teal hue ramp (no rainbow), Geist Mono labels. Cells grow
 *                     in on whileInView.
 *   - UntrackedCard — amber headline "Xh untracked", per-day mini breakdown
 *                     (gap/skipped/covered of the 6h window). Bars animate in.
 *
 * Both obey transform/opacity-only motion and prefers-reduced-motion.
 */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dowOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/** 150 → "2.5h"; whole-hour values drop the decimal (150→"2.5h", 120→"2h"). */
function hoursLabel(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

/** A single heatmap cell: teal fill whose alpha ramps with intensity. */
function HeatCell({ cell, max, delay }: { cell: HeatmapCell; max: number; delay: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  // Single-hue intensity ramp: 0..1 → alpha 0.06..0.95 (no rainbow).
  const t = max > 0 ? cell.effortMin / max : 0;
  const alpha = cell.effortMin > 0 ? 0.08 + t * 0.87 : 0;
  const show = reduce ? true : inView;
  return (
    <div className="heat-cell-col" ref={ref}>
      <motion.div
        className="heat-cell"
        data-testid="heat-cell"
        data-hour={cell.hour}
        data-empty={cell.effortMin === 0}
        title={`${String(cell.hour).padStart(2, "0")}:00 — ${
          cell.effortMin > 0 ? fmtDuration(cell.effortMin) : "nothing logged"
        }`}
        style={{
          background:
            cell.effortMin > 0
              ? `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, transparent)`
              : "color-mix(in srgb, var(--ink) 5%, transparent)",
        }}
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={show ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
        transition={{ ...SPRING, delay: reduce ? 0 : delay }}
      />
      <span className="heat-hour mono">{String(cell.hour).padStart(2, "0")}</span>
    </div>
  );
}

export function HeatmapCard({ heatmap }: { heatmap: HeatmapCell[] }) {
  const max = Math.max(1, ...heatmap.map((c) => c.effortMin));
  const anyLogged = heatmap.some((c) => c.effortMin > 0);
  return (
    <div className="bezel bento-heatmap">
      <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
        <h3
          style={{
            margin: "0 0 0.75rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <Clock size={16} weight="light" /> Hour heatmap
        </h3>
        {!anyLogged ? (
          <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
            No effort logged in these hours yet.
          </p>
        ) : (
          <>
            <div className="heat-row" data-testid="hour-heatmap">
              {heatmap.map((c, i) => (
                <HeatCell key={c.hour} cell={c} max={max} delay={Math.min(i * 0.03, 0.3)} />
              ))}
            </div>
            <p className="mono" style={{ margin: "0.6rem 0 0", color: "var(--muted)", fontSize: "0.72rem" }}>
              effort by WIB hour · darker = more
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** One day's untracked breakdown bar: covered | skipped | gap of the window. */
function UntrackedDayRow({
  day,
  delay,
}: {
  day: UntrackedRollup["days"][number];
  delay: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const show = reduce ? true : inView;
  const w = (min: number) => `${(min / day.windowMin) * 100}%`;
  return (
    <div className="untracked-day" ref={ref}>
      <span className="untracked-day-label mono">{dowOf(day.date)}</span>
      <div className="untracked-day-track">
        <motion.div
          className="untracked-seg untracked-seg--covered"
          initial={reduce ? false : { scaleX: 0 }}
          animate={show ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ ...SPRING, delay }}
          style={{ width: w(day.coveredMin), transformOrigin: "left center" }}
          title={`covered ${fmtDuration(day.coveredMin)}`}
        />
        <motion.div
          className="untracked-seg untracked-seg--skipped"
          initial={reduce ? false : { scaleX: 0 }}
          animate={show ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ ...SPRING, delay: delay + 0.03 }}
          style={{ width: w(day.skippedMin), transformOrigin: "left center" }}
          title={`skipped ${fmtDuration(day.skippedMin)}`}
        />
        <motion.div
          className="untracked-seg untracked-seg--gap"
          data-testid="untracked-gap-seg"
          initial={reduce ? false : { scaleX: 0 }}
          animate={show ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ ...SPRING, delay: delay + 0.06 }}
          style={{ width: w(day.gapMin), transformOrigin: "left center" }}
          title={`untracked ${fmtDuration(day.gapMin)}`}
        />
      </div>
      <span className="untracked-day-gap mono" data-empty={day.gapMin === 0}>
        {day.gapMin > 0 ? fmtDuration(day.gapMin) : "—"}
      </span>
    </div>
  );
}

export function UntrackedCard({ untracked }: { untracked: UntrackedRollup }) {
  const headline = hoursLabel(untracked.totalGapMin);
  return (
    <div className="bezel bento-untracked">
      <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
        <h3
          style={{
            margin: "0 0 0.5rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <Warning size={16} weight="light" color="var(--warn)" /> Untracked time
        </h3>
        <p className="untracked-headline" data-testid="untracked-headline">
          <span className="untracked-headline-num mono">{headline}</span>
          <span className="untracked-headline-sub">
            untracked across {untracked.days.length} day{untracked.days.length === 1 ? "" : "s"}
          </span>
        </p>
        <div className="untracked-days" data-testid="untracked-days">
          {untracked.days.map((d, i) => (
            <UntrackedDayRow key={d.date} day={d} delay={Math.min(i * 0.04, 0.3)} />
          ))}
        </div>
        <div className="untracked-legend mono" aria-hidden="true">
          <span><i className="untracked-key untracked-key--covered" /> logged</span>
          <span><i className="untracked-key untracked-key--skipped" /> skipped</span>
          <span><i className="untracked-key untracked-key--gap" /> gap</span>
        </div>
      </div>
    </div>
  );
}
