import { mondayOf, wibToday, workWeekDates } from "@/lib/time";
import { ExportClient } from "./ExportClient";

/**
 * /export — the headline boss-ready export (design.md §7 "Boss-ready export").
 * Range picker with quick presets, a live Markdown preview, Copy + Download .md.
 * Server computes a sensible default range (the current WIB work-week); the
 * client owns presets, live preview fetch, and the two actions.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function ExportPage() {
  const today = wibToday();
  const week = workWeekDates(mondayOf(today));
  const from = week[0];
  const to = today; // default: this week so far (Monday → today)
  return <ExportClient defaultFrom={from} defaultTo={to} />;
}
