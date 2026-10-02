import "server-only";
import type { NextRequest } from "next/server";

/**
 * Localhost-only guard (architecture.md §1 — the app binds 127.0.0.1 and must
 * never be reachable from outside). Used to gate the DEV/TEST manual fire route
 * so a notification can't be triggered by anything but the laptop itself.
 *
 * We accept a request only when its forwarded/host chain resolves to loopback.
 * Behind the local Next server there is no proxy, so host is 127.0.0.1:PORT and
 * x-forwarded-for is absent; a real remote hop would set x-forwarded-for.
 */
export function isLocalRequest(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const hostIsLocal =
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]") ||
    host.startsWith("::1");

  // If a proxy added x-forwarded-for, the real client is not the loopback.
  const xff = req.headers.get("x-forwarded-for");
  const forwardedIsLocal =
    !xff ||
    xff
      .split(",")
      .map((s) => s.trim())
      .every((ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");

  return hostIsLocal && forwardedIsLocal;
}
