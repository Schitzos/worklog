import { dailyRecap } from "@/lib/recap";
import { wibToday } from "@/lib/time";
import { RecapDailyClient } from "./RecapDailyClient";

/**
 * /recap/daily — one-day recap (design.md §7 "Daily recap"). Reads ?date=
 * (defaults to today-in-WIB), aggregates server-side, hands the payload to the
 * client component which owns the date picker, re-fetch, and view motion.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RecapDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const workDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : wibToday();
  const initial = dailyRecap(workDate);
  return <RecapDailyClient initial={initial} />;
}
