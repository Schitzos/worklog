import LogForm from "./LogForm";
import { isSlot } from "@/lib/time";

/**
 * /log — the quick-entry route. Reads ?slot=10-12 (etc) to pre-fill the entry
 * window. The sheet renders over a dimmed scrim; closing/saving routes to /.
 */
export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>;
}) {
  const { slot } = await searchParams;
  const validSlot = slot && isSlot(slot) ? slot : undefined;
  return <LogForm slot={validSlot} />;
}
