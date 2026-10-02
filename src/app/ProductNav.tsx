"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarBlank, CalendarDots, Clock, Export, ListChecks } from "@phosphor-icons/react";

/**
 * Product header (design.md §7 nav, DESIGN_SYSTEM.md §5). A quiet, clean
 * header rail — NOT a landing-page floating glass pill and NOT an edge-to-edge
 * sticky slab. Centered to the 1280px container, hairline underline, active
 * item takes the single teal accent. Icons are Phosphor Light.
 */

const LINKS = [
  { href: "/", label: "Today", icon: Clock },
  { href: "/recap/daily", label: "Daily", icon: ListChecks },
  { href: "/recap/weekly", label: "Weekly", icon: CalendarBlank },
  { href: "/recap/monthly", label: "Monthly", icon: CalendarDots },
  { href: "/export", label: "Export", icon: Export },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProductNav() {
  const pathname = usePathname() || "/";
  return (
    <header className="product-nav">
      <div className="product-nav-inner">
        <Link href="/" className="product-nav-brand" aria-label="Worklog home">
          <span className="product-nav-mark" aria-hidden="true" />
          <span className="product-nav-wordmark">Worklog</span>
        </Link>
        <nav className="product-nav-links" aria-label="Primary">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className="product-nav-link"
                data-active={active}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={16} weight="light" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
