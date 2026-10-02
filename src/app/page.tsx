import { dailyRecap } from "@/lib/recap";
import { streak } from "@/lib/insights";
import { wibToday } from "@/lib/time";
import { Fab } from "./TodayClient";
import { TodayTimeline } from "./TodayTimeline";

/**
 * Home — the Today view (design.md §7). A calendar-style vertical timeline for
 * the WIB window with overlapping entries rendered side-by-side in lanes
 * (Option A, the signature feature), a pulsing now-line, and a rail showing
 * effort vs wall-clock, effort-per-tag, and the untracked-time warning.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function Home() {
  const workDate = wibToday();
  const recap = dailyRecap(workDate);
  const initialStreak = streak(workDate);

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "var(--section-py) 1rem 6rem",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(1.5rem, 3vw, 2rem)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Today
          </h1>
          <p className="mono" style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
            {workDate} · WIB · {recap.entries.length}{" "}
            {recap.entries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
      </header>

      <TodayTimeline recap={recap} initialStreak={initialStreak} />
      <Fab />
    </main>
  );
}
