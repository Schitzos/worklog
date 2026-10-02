import { monthlyRecap } from "@/lib/recap";
import { monthEnd, monthStart, wibToday } from "@/lib/time";
import { RecapMonthlyClient } from "./RecapMonthlyClient";

/**
 * /recap/monthly — per-tag totals, top tickets, per-day trend (design.md §7,
 * schema.md §3.4). Reads ?from=&to= (defaults to the whole current WIB month).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RecapMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const { from, to } = await searchParams;
  const today = wibToday();
  const f = from && re.test(from) ? from : monthStart(today);
  const t = to && re.test(to) ? to : monthEnd(today);
  const initial = monthlyRecap(f, t);
  return <RecapMonthlyClient initial={initial} />;
}
