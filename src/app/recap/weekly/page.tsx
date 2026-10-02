import { weeklyRecap } from "@/lib/recap";
import { mondayOf, wibToday } from "@/lib/time";
import { RecapWeeklyClient } from "./RecapWeeklyClient";

/**
 * /recap/weekly — Mon–Fri rollup (design.md §7). Reads ?monday= (any date in
 * the week; snapped to Monday), defaults to the current WIB week. Aggregates
 * server-side; the client owns the week picker, re-fetch, and bento motion.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RecapWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ monday?: string }>;
}) {
  const { monday } = await searchParams;
  const seed = monday && /^\d{4}-\d{2}-\d{2}$/.test(monday) ? monday : wibToday();
  const initial = weeklyRecap(mondayOf(seed));
  return <RecapWeeklyClient initial={initial} />;
}
