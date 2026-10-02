import "server-only";
import path from "node:path";
import { getDb } from "./db";
import {
  coveredSlotForHour,
  markFired,
  slotResolved,
  snoozeSlot,
  type ReminderRow,
} from "./reminder";
import { slotStatus } from "./recap";
import { SLOTS, wibToday, type Slot } from "./time";

/**
 * Local, in-process reminder scheduler (architecture.md §3.1, design.md §4/§8).
 *
 * A single node-cron job fires at WIB 10:00/12:00/14:00/16:00 on weekdays. On
 * each fire it:
 *   - computes the WIB work_date + the 2h slot the notification asks about,
 *   - upserts reminder_log → 'fired' (skipping any slot already filled/skipped),
 *   - raises an OS desktop notification via node-notifier, whose click opens the
 *     pre-filled form at http://127.0.0.1:7070/log?slot=<slot>.
 *
 * NO web push, NO VAPID, NO cloud. Everything here runs in the Next server
 * process while the laptop is on. It is started exactly once from
 * instrumentation.ts (Next 15 register()), guarded by a global symbol because
 * Next imports modules repeatedly, and it must NEVER start during `next build`.
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT ?? "7070"}`;

// Our app icon for the desktop notification. terminal-notifier wants an absolute
// path to a raster image; icon-512.png ships in public/icons. Resolved from the
// server process cwd (the project root at runtime). `appIcon` tries to replace
// the sender (top-left) icon, `contentImage` shows it as the body thumbnail —
// we pass both so our teal time-ring brands the banner instead of the terminal.
const APP_ICON = path.join(process.cwd(), "public", "icons", "icon-512.png");

// Branded notifier bundle: a copy of terminal-notifier.app carrying OUR icon and
// bundle id (built in deploy/Worklog.app). macOS locks the notification's
// top-left SENDER icon to the signing bundle, so appIcon/contentImage alone
// cannot replace it — only sending THROUGH our own bundle does. We point
// node-notifier's NotificationCenter at this bundle's embedded binary via
// `customPath`. If the bundle is missing we fall back to the default notifier
// (banner still works, just terminal-branded top-left).
const BRANDED_NOTIFIER_BIN = path.join(
  process.cwd(),
  "deploy",
  "Worklog.app",
  "Contents",
  "MacOS",
  "terminal-notifier",
);

// How node-notifier behaved on this host, surfaced for the Phase-7 report.
export type NotifierMode = "native" | "fallback-log" | "disabled" | "unknown";

interface SchedulerState {
  started: boolean;
  task?: { stop: () => void };
  // Pending snooze re-fire timers, keyed `${workDate}:${slot}`.
  snoozeTimers: Map<string, NodeJS.Timeout>;
  notifierMode: NotifierMode;
  lastNotifierError?: string;
}

const STATE_KEY = Symbol.for("worklog.scheduler.state");

type SchedulerGlobal = typeof globalThis & {
  [STATE_KEY]?: SchedulerState;
};

function state(): SchedulerState {
  const g = globalThis as SchedulerGlobal;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      started: false,
      snoozeTimers: new Map(),
      notifierMode: "unknown",
    };
  }
  return g[STATE_KEY]!;
}

/** True when we are inside `next build` (phase-production-build) — never schedule then. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[worklog:scheduler] ${msg}`);
}

/** Notification copy per design.md §4. slot=null is the 10:00 day-start prompt. */
function notificationCopy(slot: Slot | null, workDate: string): { title: string; message: string } {
  if (slot === null) {
    return {
      title: "Worklog — new day",
      message: "I'll check in every 2h. Anything from earlier to log?",
    };
  }
  const [a, b] = slot.split("-");
  const base = `What did you do ${a}:00–${b}:00?`;
  if (slot === "14-16") {
    // End-of-day fire: append the empty-slot recap (design.md §4).
    const empties = slotStatus(workDate)
      .filter((s) => s.status === "empty")
      .map((s) => {
        const [x, y] = s.slot.split("-");
        return `${x}:00–${y}:00`;
      });
    const tail = empties.length
      ? ` End of day — still empty: ${empties.join(", ")}.`
      : " End of day — nice, nothing left empty.";
    return { title: "Worklog — 14:00–16:00", message: base + tail };
  }
  return { title: `Worklog — ${a}:00–${b}:00`, message: base };
}

/**
 * Raise an OS desktop notification. Degrades gracefully: if node-notifier cannot
 * load or the platform notifier is unavailable, we LOG the prompt (so the user
 * still gets it via the terminal / server log and the in-app toast) and record
 * the fallback mode for the Phase-7 report. Clicking the native notification
 * opens the deep link; the fallback mode relies on the in-app toast's buttons.
 */
async function raiseNotification(slot: Slot | null, workDate: string): Promise<void> {
  const { title, message } = notificationCopy(slot, workDate);
  const url = slot ? `${BASE_URL}/log?slot=${slot}` : `${BASE_URL}/`;

  let notifier: typeof import("node-notifier") | null = null;
  try {
    notifier = (await import("node-notifier")).default ?? (await import("node-notifier"));
  } catch (err) {
    state().notifierMode = "disabled";
    state().lastNotifierError = err instanceof Error ? err.message : String(err);
    log(`node-notifier unavailable (${state().lastNotifierError}); FALLBACK log → ${title}: ${message} (${url})`);
    return;
  }

  // Prefer our branded bundle (our icon in the top-left) when it exists; else
  // use the default notifier. NotificationCenter is the macOS backend.
  let sink: { notify: (opts: Record<string, unknown>, cb?: (err: Error | null, response?: unknown, metadata?: unknown) => void) => void } =
    notifier as unknown as typeof sink;
  try {
    const fs = await import("node:fs");
    if (fs.existsSync(BRANDED_NOTIFIER_BIN)) {
      const NodeNotifier = (await import("node-notifier")) as unknown as {
        NotificationCenter: new (opts: { customPath: string }) => typeof sink;
      };
      sink = new NodeNotifier.NotificationCenter({ customPath: BRANDED_NOTIFIER_BIN });
    } else {
      log(`branded notifier bundle not found at ${BRANDED_NOTIFIER_BIN}; using default notifier`);
    }
  } catch (err) {
    log(`branded notifier init failed (${err instanceof Error ? err.message : String(err)}); using default notifier`);
  }

  try {
    sink.notify(
      {
        title,
        message,
        // `open` makes the whole notification click open the URL on macOS.
        open: url,
        // Brand the banner with our app icon instead of the terminal icon.
        appIcon: APP_ICON,
        contentImage: APP_ICON,
        wait: true,
        timeout: 20,
        // Action buttons where the platform supports them (macOS reply/actions).
        actions: slot ? ["Log now", "Snooze 30m", "Nothing to log"] : ["Open"],
        closeLabel: "Dismiss",
      },
      (err, _response, metadata) => {
        if (err) {
          state().notifierMode = "fallback-log";
          state().lastNotifierError = err.message;
          log(`notify error (${err.message}); prompt was → ${title}: ${message} (${url})`);
          return;
        }
        // A result means the native notifier answered → native mode confirmed.
        if (state().notifierMode === "unknown") state().notifierMode = "native";
        handleNotificationResponse(workDate, slot, metadata, url);
      },
    );
    // The callback above may fire asynchronously; optimistically mark native.
    if (state().notifierMode === "unknown") state().notifierMode = "native";
    log(`raised desktop notification → ${title} (${url})`);
  } catch (err) {
    state().notifierMode = "fallback-log";
    state().lastNotifierError = err instanceof Error ? err.message : String(err);
    log(`notify threw (${state().lastNotifierError}); FALLBACK log → ${title}: ${message} (${url})`);
  }
}

/** Map a native notification action/click to the matching in-app behavior. */
function handleNotificationResponse(
  workDate: string,
  slot: Slot | null,
  metadata: unknown,
  url: string,
): void {
  if (!slot) return;
  const activation =
    (metadata as { activationValue?: string; activationType?: string } | undefined) ?? {};
  const choice = (activation.activationValue ?? "").toLowerCase();
  if (choice.includes("snooze")) {
    snooze(workDate, slot);
  } else if (choice.includes("nothing")) {
    // Delegated to the API/skip path by the user via the opened page; the native
    // "Nothing to log" button just records intent — we open the page so the user
    // confirms, keeping skip an explicit app action (design.md §4).
    log(`notification "Nothing to log" for ${slot}; open ${url} to confirm skip`);
  } else {
    log(`notification activated for ${slot} → ${url}`);
  }
}

/**
 * Fire a single slot: upsert reminder_log → 'fired' (unless already resolved) and
 * raise the notification. Exported for tests (manual trigger). `firedHour` lets
 * the 10:00 day-start prompt differ from the slot-covering fires; when omitted it
 * is inferred from the slot (slot-covering fire).
 */
export async function fireSlot(
  workDate: string,
  slot: Slot | null,
  opts: { dayStart?: boolean } = {},
): Promise<ReminderRow | null> {
  // Day-start prompt (10:00): no slot row to write, just the notification.
  if (slot === null || opts.dayStart) {
    await raiseNotification(null, workDate);
    return null;
  }

  const row = markFired(workDate, slot);
  if (!row) {
    log(`slot ${slot} on ${workDate} already resolved — not firing`);
    return null;
  }
  await raiseNotification(slot, workDate);
  return row;
}

/** The cron tick: resolve the WIB hour → slot and fire. */
async function onCronFire(now: Date = new Date()): Promise<void> {
  // The cron is timezone:'Asia/Jakarta', so `now`'s WIB hour is what we want.
  // Derive WIB hour independent of host TZ to stay correct everywhere.
  const wib = new Date(now.getTime() + 7 * 60 * 60_000);
  const hour = wib.getUTCHours();
  const workDate = wibToday(now);

  if (hour === 10) {
    await fireSlot(workDate, null, { dayStart: true });
    return;
  }
  const slot = coveredSlotForHour(hour);
  if (slot) await fireSlot(workDate, slot);
}

/**
 * Snooze a slot 30 minutes: write reminder_log and arm an in-process setTimeout
 * that re-fires the slot once the snooze elapses — but only if it is still
 * unresolved then. Replaces any existing timer for that slot. Returns the ISO
 * re-fire time (or null if the slot was already resolved).
 */
export function snooze(workDate: string, slot: Slot, minutes = 30): string | null {
  const until = snoozeSlot(workDate, slot, minutes);
  if (!until) return null;

  const key = `${workDate}:${slot}`;
  const existing = state().snoozeTimers.get(key);
  if (existing) clearTimeout(existing);

  const delayMs = Math.max(0, new Date(until).getTime() - Date.now());
  const timer = setTimeout(() => {
    state().snoozeTimers.delete(key);
    if (!slotResolved(workDate, slot)) {
      void fireSlot(workDate, slot);
    }
  }, delayMs);
  // Don't keep the process alive just for a snooze timer.
  if (typeof timer.unref === "function") timer.unref();
  state().snoozeTimers.set(key, timer);
  log(`snoozed ${slot} on ${workDate} until ${until}`);
  return until;
}

/** Cancel a pending snooze re-fire timer (e.g. the user skipped/logged the slot). */
export function cancelSnoozeTimer(workDate: string, slot: Slot): void {
  const key = `${workDate}:${slot}`;
  const timer = state().snoozeTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    state().snoozeTimers.delete(key);
    log(`cancelled snooze timer for ${slot} on ${workDate}`);
  }
}

/** Report how node-notifier behaved on this host (for the Phase-7 environment note). */
export function notifierReport(): { mode: NotifierMode; lastError?: string } {
  return { mode: state().notifierMode, lastError: state().lastNotifierError };
}

/**
 * Start the scheduler exactly once. Guarded by a global symbol (Next re-imports
 * modules), skipped entirely during `next build`, and a no-op when already
 * started. Called from instrumentation.ts register() on the Node runtime only.
 */
export async function startScheduler(): Promise<void> {
  if (isBuildPhase()) {
    log("build phase — scheduler NOT started");
    return;
  }
  const s = state();
  if (s.started) return;
  s.started = true;

  // Touch the DB once so migrations run before the first fire.
  getDb();

  let cron: typeof import("node-cron");
  try {
    cron = await import("node-cron");
  } catch (err) {
    log(`node-cron unavailable (${err instanceof Error ? err.message : String(err)}); scheduler disabled`);
    s.started = false;
    return;
  }

  const schedule = cron.schedule ?? (cron as unknown as { default: typeof import("node-cron") }).default?.schedule;
  const task = schedule(
    "0 10,12,14,16 * * 1-5",
    () => {
      void onCronFire();
    },
    { timezone: "Asia/Jakarta" },
  );
  s.task = task as unknown as { stop: () => void };
  log(
    `started — cron "0 10,12,14,16 * * 1-5" @ Asia/Jakarta; slots ${SLOTS.join(", ")}; base ${BASE_URL}`,
  );
}

/** Stop the scheduler + clear timers (used by tests / graceful shutdown). */
export function stopScheduler(): void {
  const s = state();
  if (s.task) {
    s.task.stop();
    s.task = undefined;
  }
  for (const timer of s.snoozeTimers.values()) clearTimeout(timer);
  s.snoozeTimers.clear();
  s.started = false;
  log("stopped");
}
