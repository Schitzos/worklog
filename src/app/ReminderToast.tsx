"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellRinging, X } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";

/**
 * In-app reminder toast (design.md §4 "Notifications are actionable",
 * DESIGN_SYSTEM.md §4/§6). While a tab is open it polls the lightweight
 * /api/reminder/pending every 60s; when a slot is pending (fired/snoozed, not
 * yet filled/skipped) a subtle bottom toast springs in offering:
 *   - Log now  → opens the pre-filled form (/log?slot=…)
 *   - Snooze   → POST /api/reminder/snooze (re-fires in 30m)
 *   - Nothing to log → POST /api/reminder/skip
 * Dismissible (local-only; the slot stays pending until logged/skipped), and
 * prefers-reduced-motion safe (fades instead of springs). One toast at a time:
 * the earliest pending slot.
 */

const POLL_MS = 60_000;

interface PendingSlot {
  slot: string;
  status: "fired" | "snoozed";
}

/** Today's WIB work_date on the client (fixed +7h, no DST). */
function wibTodayClient(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

function slotLabel(slot: string): string {
  const [a, b] = slot.split("-");
  return `${a}:00–${b}:00`;
}

export function ReminderToast() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [pending, setPending] = useState<PendingSlot[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const workDateRef = useRef<string>(wibTodayClient());

  const poll = useCallback(async () => {
    workDateRef.current = wibTodayClient();
    try {
      const res = await fetch(`/api/reminder/pending?date=${workDateRef.current}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { pending: PendingSlot[] };
      setPending(Array.isArray(body.pending) ? body.pending : []);
    } catch {
      // Local-only; a transient fetch failure just means "poll again in 60s".
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // The earliest pending slot not locally dismissed.
  const active = pending.find((p) => !dismissed.has(p.slot)) ?? null;

  const act = useCallback(
    async (path: string, slot: string) => {
      setBusy(true);
      try {
        await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_date: workDateRef.current, slot }),
        });
        await poll();
      } finally {
        setBusy(false);
      }
    },
    [poll],
  );

  const initial = reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 };
  const animate = reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const exit = reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 };

  return (
    <div className="reminder-toast-region" aria-live="polite" aria-atomic="true">
      <AnimatePresence>
        {active ? (
          <motion.div
            key={active.slot}
            className="reminder-toast"
            role="status"
            initial={initial}
            animate={animate}
            exit={exit}
            transition={reduce ? { duration: 0.18 } : SPRING}
          >
            <div className="bezel reminder-toast-shell">
              <div className="bezel-core reminder-toast-core">
                <button
                  className="reminder-toast-dismiss"
                  aria-label="Dismiss reminder"
                  onClick={() => setDismissed((d) => new Set(d).add(active.slot))}
                >
                  <X size={14} weight="light" />
                </button>

                <div className="reminder-toast-head">
                  <span className="reminder-toast-icon" aria-hidden="true">
                    <BellRinging size={18} weight="light" color="var(--accent)" />
                  </span>
                  <div>
                    <p className="reminder-toast-title">
                      What did you do{" "}
                      <span className="mono">{slotLabel(active.slot)}</span>?
                    </p>
                    <p className="reminder-toast-sub mono">
                      {active.status === "snoozed" ? "snoozed · due now" : "reminder"}
                    </p>
                  </div>
                </div>

                <div className="reminder-toast-actions">
                  <button
                    className="btn-mini"
                    data-variant="accent"
                    disabled={busy}
                    onClick={() => router.push(`/log?slot=${active.slot}`)}
                  >
                    Log now
                  </button>
                  <button
                    className="btn-mini"
                    disabled={busy}
                    onClick={() => void act("/api/reminder/snooze", active.slot)}
                  >
                    Snooze
                  </button>
                  <button
                    className="btn-mini"
                    disabled={busy}
                    onClick={() => void act("/api/reminder/skip", active.slot)}
                  >
                    Nothing to log
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
