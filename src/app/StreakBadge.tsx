"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Flame } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";
import streakCelebration from "@/lib/streakCelebration";
import type { Streak } from "@/lib/insights";

// lottie-react pulls in a DOM renderer; load it client-only to keep it out of
// the server bundle (and so SSR never touches `document`).
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

const MILESTONES = [3, 5, 10, 15, 20, 30, 50, 100];
const SEEN_KEY = "worklog.streak.celebrated";

/** Highest milestone <= current, or 0 if the streak hasn't reached the first. */
function reachedMilestone(current: number): number {
  let hit = 0;
  for (const m of MILESTONES) if (current >= m) hit = m;
  return hit;
}

/**
 * Today-rail streak badge (design.md §7, §10). Shows the current complete-day
 * streak as a Geist Mono number + label. When a NEW milestone is reached (one
 * not previously celebrated on this device) it plays the Lottie burst ONCE.
 * prefers-reduced-motion suppresses the celebration (badge still renders).
 */
export function StreakBadge({ initial }: { initial?: Streak }) {
  const reduce = useReducedMotion();
  const [streak, setStreak] = useState<Streak | null>(initial ?? null);
  const [celebrate, setCelebrate] = useState(false);
  const fetchedRef = useRef(false);

  // Fetch fresh insights on mount (SSR value may be stale across a day flip).
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/insights");
        if (res.ok) {
          const data = await res.json();
          if (data?.streak) setStreak(data.streak as Streak);
        }
      } catch {
        /* keep the SSR value on failure */
      }
    })();
  }, []);

  // One-shot celebration when a new milestone is reached.
  useEffect(() => {
    if (!streak || reduce) return;
    const milestone = reachedMilestone(streak.current);
    if (milestone === 0) return;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(SEEN_KEY) ?? "0");
    } catch {
      seen = 0;
    }
    if (milestone > seen) {
      setCelebrate(true);
      try {
        localStorage.setItem(SEEN_KEY, String(milestone));
      } catch {
        /* non-fatal */
      }
      const t = setTimeout(() => setCelebrate(false), 1100);
      return () => clearTimeout(t);
    }
  }, [streak, reduce]);

  if (!streak) return null;

  const n = streak.current;
  const atMilestone = reachedMilestone(n) > 0;

  return (
    <div className="streak-badge" data-testid="streak-badge" data-milestone={atMilestone}>
      <span className="streak-icon" aria-hidden="true">
        <Flame size={18} weight="light" color="var(--accent)" />
      </span>
      <span className="streak-text">
        <motion.span
          key={n}
          className="streak-num mono"
          data-testid="streak-current"
          initial={reduce ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRING}
        >
          {n}
        </motion.span>
        <span className="streak-label">
          day{n === 1 ? "" : "s"} streak
          {streak.best > n ? (
            <span className="streak-best mono"> · best {streak.best}</span>
          ) : null}
        </span>
      </span>

      {/* One-shot celebration overlay (reduced-motion never sets celebrate). */}
      <AnimatePresence>
        {celebrate ? (
          <motion.span
            className="streak-celebration"
            data-testid="streak-celebration"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Lottie
              animationData={streakCelebration as object}
              loop={false}
              autoplay
              style={{ width: 120, height: 120 }}
            />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
