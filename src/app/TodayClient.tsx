"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Clock, Tag } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";

export interface EntryView {
  id: string;
  description: string;
  ticket_id: string | null;
  summary: string | null;
  start_at: string;
  end_at: string;
  duration_min: number;
  tags: string[];
}

/** HH:mm in WIB for a UTC ISO instant. */
function wibTime(iso: string): string {
  const wib = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return wib.toISOString().slice(11, 16);
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function Fab() {
  const router = useRouter();
  return (
    <button className="fab" aria-label="Log an entry" onClick={() => router.push("/log")}>
      <Plus size={26} weight="light" color="#fafafa" />
    </button>
  );
}

export function TodayList({ entries }: { entries: EntryView[] }) {
  if (entries.length === 0) {
    return (
      <div className="bezel" style={{ marginTop: "1.25rem" }}>
        <div
          className="bezel-core"
          style={{ padding: "2.5rem 1.5rem", textAlign: "center" }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 0.9rem",
              borderRadius: "9999px",
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            }}
          >
            <Clock size={24} weight="light" color="var(--accent)" />
          </div>
          <p style={{ margin: "0 0 0.3rem", fontWeight: 600 }}>Nothing logged yet today</p>
          <p className="mono" style={{ margin: 0, color: "var(--muted)", fontSize: "0.8125rem" }}>
            tap + to log the first entry
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "1.25rem 0 0", display: "grid", gap: "0.75rem" }}>
      {entries.map((e, i) => (
        <motion.li
          key={e.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: Math.min(i * 0.05, 0.4) }}
          className="bezel"
        >
          <div className="bezel-core" style={{ padding: "0.9rem 1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <span style={{ fontWeight: 600, lineHeight: 1.35 }}>{e.description}</span>
              <span className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", whiteSpace: "nowrap" }}>
                {fmtDuration(e.duration_min)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
              }}
            >
              <span className="mono" style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                {wibTime(e.start_at)}–{wibTime(e.end_at)}
              </span>
              {e.ticket_id ? (
                <span className="mono" style={{ color: "var(--accent)", fontSize: "0.78rem" }}>
                  {e.ticket_id}
                </span>
              ) : null}
              {e.tags.map((t) => (
                <span key={t} className="tag-pill">
                  <Tag size={12} weight="light" />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}
