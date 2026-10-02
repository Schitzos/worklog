"use client";

/**
 * Read-only "Daily notes" section for weekly/monthly recaps. Lists only the
 * days in the range that actually have a note (sparse ranges stay short).
 * Editing happens on the daily recap page — this is a scan/review view.
 *
 * `notes` is the { 'YYYY-MM-DD' -> note } map the recap payload carries.
 */
export function NotesSection({
  notes,
  title = "Daily notes",
}: {
  notes: Record<string, string>;
  title?: string;
}) {
  const dates = Object.keys(notes).sort();

  return (
    <div className="bezel bento-notes" data-testid="recap-notes">
      <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>{title}</h3>
        {dates.length === 0 ? (
          <p className="mono" style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
            No notes in this range.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.7rem" }}>
            {dates.map((d) => (
              <li
                key={d}
                style={{
                  display: "grid",
                  gap: "0.2rem",
                  borderTop: "1px solid var(--hairline)",
                  paddingTop: "0.55rem",
                }}
              >
                <span className="mono" style={{ fontSize: "0.72rem", color: "var(--accent)" }}>
                  {weekdayLabel(d)} · {d}
                </span>
                <span style={{ fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {notes[d]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 'YYYY-MM-DD' (WIB day) -> 'Mon' etc. Noon UTC avoids DST edge flips. */
function weekdayLabel(workDate: string): string {
  const [y, m, d] = workDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow];
}
