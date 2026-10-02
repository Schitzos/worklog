"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Tag } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import { assignLanes, fmtDuration, wibFractionalHour, wibHHMM } from "@/lib/view";
import type { DailyRecap } from "@/lib/recap";
import type { Streak } from "@/lib/insights";
import type { EntryRow } from "@/lib/entries";
import { StreakBadge } from "./StreakBadge";

// Visible timeline window (WIB wall-clock hours). 10–16 is the reminder window.
const VIEW_START = 8;
const VIEW_END = 18;
const HIGHLIGHT_START = 10;
const HIGHLIGHT_END = 16;
const PX_PER_HOUR = 64; // row height
const TOTAL_PX = (VIEW_END - VIEW_START) * PX_PER_HOUR;

function slotLabel(slot: string): string {
  const [a, b] = slot.split("-");
  return `${a}:00–${b}:00`;
}

export function TodayTimeline({ recap, initialStreak }: { recap: DailyRecap; initialStreak?: Streak }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [recapState, setRecapState] = useState<DailyRecap>(recap);
  const [nowHour, setNowHour] = useState<number | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  // Is the viewed date "today" in WIB? Only then show the now-line.
  useEffect(() => {
    const todayWib = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    const update = () => {
      if (todayWib !== recapState.workDate) {
        setNowHour(null);
        return;
      }
      const wib = new Date(Date.now() + 7 * 60 * 60_000);
      setNowHour(wib.getUTCHours() + wib.getUTCMinutes() / 60);
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [recapState.workDate]);

  const laned = useMemo(
    () => assignLanes<EntryRow>(recapState.entries),
    [recapState.entries],
  );

  const maxTagEffort = useMemo(
    () => Math.max(1, ...recapState.effortPerTag.map((t) => t.effortMin)),
    [recapState.effortPerTag],
  );

  const emptySlots = recapState.slots.filter((s) => s.status === "empty");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/recap/daily?date=${recapState.workDate}`);
    if (res.ok) setRecapState((await res.json()) as DailyRecap);
  }, [recapState.workDate]);

  const skipSlot = useCallback(
    async (slot: string) => {
      setBusySlot(slot);
      try {
        await fetch("/api/reminder/skip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_date: recapState.workDate, slot }),
        });
        await refetch();
      } finally {
        setBusySlot(null);
      }
    },
    [recapState.workDate, refetch],
  );

  const clampHour = (h: number) => Math.min(VIEW_END, Math.max(VIEW_START, h));
  const yOf = (h: number) => (clampHour(h) - VIEW_START) * PX_PER_HOUR;

  return (
    <div className="today-grid">
      {/* Timeline column */}
      <div className="bezel">
        <div className="bezel-core" style={{ padding: "1rem 1rem 1.25rem" }}>
          <div className="timeline" style={{ height: TOTAL_PX }} data-testid="timeline">
            {/* Hour grid */}
            {Array.from({ length: VIEW_END - VIEW_START + 1 }, (_, i) => {
              const hour = VIEW_START + i;
              const active = hour >= HIGHLIGHT_START && hour < HIGHLIGHT_END;
              return (
                <div
                  key={hour}
                  className="timeline-hour"
                  data-active={active}
                  style={{ top: i * PX_PER_HOUR, height: PX_PER_HOUR }}
                >
                  <span className="timeline-hour-label mono">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>
              );
            })}

            {/* Lane area: positioned entry blocks */}
            <div className="timeline-lane-area">
              {laned.map(({ block, lane, lanes }, i) => {
                const startH = wibFractionalHour(block.start_at);
                const endH = wibFractionalHour(block.end_at);
                const top = yOf(startH);
                const height = Math.max(22, yOf(endH) - top);
                const widthPct = 100 / lanes;
                return (
                  <motion.div
                    key={block.id}
                    className="timeline-block"
                    data-testid="timeline-block"
                    data-lane={lane}
                    data-lanes={lanes}
                    style={{
                      top,
                      height,
                      left: `calc(${lane * widthPct}% + ${lane ? 2 : 0}px)`,
                      width: `calc(${widthPct}% - 4px)`,
                    }}
                    initial={reduce ? false : { scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{ ...SPRING, delay: Math.min(i * 0.04, 0.3) }}
                  >
                    <div className="tb-desc">{block.description}</div>
                    <div className="tb-meta mono">
                      {wibHHMM(block.start_at)}–{wibHHMM(block.end_at)} ·{" "}
                      {fmtDuration(block.duration_min)}
                      {block.ticket_id ? (
                        <span style={{ color: "var(--accent)" }}> · {block.ticket_id}</span>
                      ) : null}
                    </div>
                    {block.tags.length > 0 && height >= 48 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.2rem" }}>
                        {block.tags.map((t) => (
                          <span key={t} className="tag-pill" style={{ fontSize: "0.68rem", padding: "0.08rem 0.4rem" }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>

            {/* Now line */}
            {nowHour !== null && nowHour >= VIEW_START && nowHour <= VIEW_END ? (
              <div
                className="now-line"
                data-testid="now-line"
                style={{ top: yOf(nowHour) }}
                aria-label="current time"
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Side rail */}
      <aside style={{ display: "grid", gap: "1rem" }}>
        {/* Streak badge (design.md §7/§10) */}
        <StreakBadge initial={initialStreak} />

        {/* Effort vs wall-clock — two distinct metrics */}
        <div className="bezel">
          <div className="bezel-core" style={{ padding: "1rem 1.1rem" }}>
            <div className="metric-row">
              <span className="metric-label">Effort logged</span>
              <span className="metric-value mono" data-testid="effort-min">
                {fmtDuration(recapState.effortMin)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Wall-clock</span>
              <span className="metric-value mono" data-testid="wallclock-min">
                {fmtDuration(recapState.wallClockMin)}
              </span>
            </div>
            {recapState.effortMin > recapState.wallClockMin ? (
              <p className="mono" style={{ margin: "0.6rem 0 0", color: "var(--muted)", fontSize: "0.72rem" }}>
                {fmtDuration(recapState.effortMin - recapState.wallClockMin)} overlap — parallel work
              </p>
            ) : null}
          </div>
        </div>

        {/* Effort per tag mini bars */}
        {recapState.effortPerTag.length > 0 ? (
          <div className="bezel">
            <div className="bezel-core" style={{ padding: "1rem 1.1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>
                Effort per tag
              </h3>
              {recapState.effortPerTag.map((t) => (
                <div className="tagbar-row" key={t.label}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8125rem" }}>
                    <Tag size={13} weight="light" /> {t.label}
                  </span>
                  <span className="mono" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    {fmtDuration(t.effortMin)}
                  </span>
                  <div className="tagbar-track">
                    <motion.div
                      className="tagbar-fill"
                      initial={reduce ? false : { scaleX: 0 }}
                      animate={{ scaleX: t.effortMin / maxTagEffort }}
                      transition={SPRING}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Untracked-time warning */}
        {emptySlots.length > 0 ? (
          <div className="untracked" data-testid="untracked-warning">
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>
              <span className="untracked-dot" aria-hidden="true" />
              Untracked time
            </p>
            <p className="mono" style={{ margin: "0.3rem 0 0.6rem", color: "var(--muted)", fontSize: "0.76rem" }}>
              {emptySlots.length} slot{emptySlots.length > 1 ? "s" : ""} with nothing logged yet
            </p>
            {emptySlots.map((s) => (
              <div key={s.slot} style={{ marginTop: "0.5rem" }}>
                <span className="mono" style={{ fontSize: "0.8rem" }}>{slotLabel(s.slot)}</span>
                <div className="slot-actions">
                  <button
                    className="btn-mini"
                    data-variant="accent"
                    onClick={() => router.push(`/log?slot=${s.slot}`)}
                  >
                    Log
                  </button>
                  <button
                    className="btn-mini"
                    disabled={busySlot === s.slot}
                    onClick={() => skipSlot(s.slot)}
                  >
                    {busySlot === s.slot ? "…" : "Nothing to log"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Link to the full daily recap */}
        <a className="nav-link" href={`/recap/daily?date=${recapState.workDate}`}>
          Daily recap <ArrowRight size={14} weight="light" />
        </a>
      </aside>
    </div>
  );
}
