/**
 * Next 15 instrumentation hook (architecture.md §3.1, design.md §8).
 *
 * register() runs once when the server process boots. We start the in-process
 * reminder scheduler here, but ONLY on the Node.js runtime (never Edge — the
 * scheduler uses better-sqlite3 + node-cron + node-notifier, all native/Node),
 * and the scheduler itself refuses to arm during `next build`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startScheduler } = await import("./lib/scheduler");
  await startScheduler();
}
