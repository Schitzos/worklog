"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, ArrowRight } from "@phosphor-icons/react";
import { detectTicket } from "@/lib/ticket";
import {
  fieldItem,
  fieldsContainer,
  sheetVariants,
  SNAPPY_SPRING,
} from "@/lib/motion";
import { slotWindowUtc, wibToday } from "@/lib/time";

interface TagSuggestion {
  label: string;
  usage_count: number;
}

const DURATION_PRESETS: { label: string; min: number }[] = [
  { label: "15m", min: 15 },
  { label: "30m", min: 30 },
  { label: "1h", min: 60 },
  { label: "2h", min: 120 },
];

/** Convert a UTC ISO instant to the value a <input type="datetime-local"> wants,
 *  rendered in WIB wall-clock so the user edits in their own timezone. */
function utcIsoToWibLocalInput(iso: string): string {
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 60 * 60_000);
  // YYYY-MM-DDTHH:mm from the shifted UTC parts.
  return wib.toISOString().slice(0, 16);
}

/** Convert a WIB datetime-local value back to a UTC ISO instant. */
function wibLocalInputToUtcIso(local: string): string {
  // local is "YYYY-MM-DDTHH:mm" interpreted as WIB wall-clock.
  const asUtc = new Date(`${local}:00Z`).getTime(); // parse parts as if UTC
  return new Date(asUtc - 7 * 60 * 60_000).toISOString(); // shift back to real UTC
}

export default function LogForm({ slot }: { slot?: string }) {
  const router = useRouter();

  // Default window: the passed slot's window on today's WIB date, else 10-12.
  const defaults = useMemo(() => {
    const today = wibToday();
    const win = slotWindowUtc(today, slot ?? "10-12") ?? slotWindowUtc(today, "10-12")!;
    return win;
  }, [slot]);

  const [description, setDescription] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [ticketTouched, setTicketTouched] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [startLocal, setStartLocal] = useState(() => utcIsoToWibLocalInput(defaults.startAt));
  const [endLocal, setEndLocal] = useState(() => utcIsoToWibLocalInput(defaults.endAt));
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  // Auto-detect ticket from description until the user edits the field manually.
  useEffect(() => {
    if (ticketTouched) return;
    const detected = detectTicket(description);
    setTicketId(detected ?? "");
  }, [description, ticketTouched]);

  // Fetch tag suggestions (debounced) when the tag input focus/value changes.
  useEffect(() => {
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(tagInput)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { tags: TagSuggestion[] };
        if (active) {
          const picked = new Set(tags.map((t) => t.toLowerCase()));
          setSuggestions(data.tags.filter((s) => !picked.has(s.label.toLowerCase())));
        }
      } catch {
        /* local-only; ignore transient fetch errors */
      }
    }, 120);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [tagInput, tags, showSuggestions]);

  const addTag = useCallback(
    (raw: string) => {
      const label = raw.trim();
      if (!label) return;
      setTags((prev) =>
        prev.some((t) => t.toLowerCase() === label.toLowerCase()) ? prev : [...prev, label],
      );
      setTagInput("");
    },
    [],
  );

  const removeTag = useCallback((label: string) => {
    setTags((prev) => prev.filter((t) => t !== label));
  }, []);

  const applyDurationPreset = useCallback(
    (min: number) => {
      // Keep start fixed; move end to start + preset.
      const startUtc = wibLocalInputToUtcIso(startLocal);
      const endUtc = new Date(new Date(startUtc).getTime() + min * 60_000).toISOString();
      setEndLocal(utcIsoToWibLocalInput(endUtc));
    },
    [startLocal],
  );

  const selectedPreset = useMemo(() => {
    const startUtc = new Date(wibLocalInputToUtcIso(startLocal)).getTime();
    const endUtc = new Date(wibLocalInputToUtcIso(endLocal)).getTime();
    const diffMin = Math.round((endUtc - startUtc) / 60_000);
    return DURATION_PRESETS.find((p) => p.min === diffMin)?.min ?? null;
  }, [startLocal, endLocal]);

  const close = useCallback(() => {
    router.push("/");
  }, [router]);

  async function handleSave() {
    setError(null);
    if (!description.trim()) {
      setError("Add a short description of what you did.");
      descRef.current?.focus();
      return;
    }
    const start_at = wibLocalInputToUtcIso(startLocal);
    const end_at = wibLocalInputToUtcIso(endLocal);
    if (new Date(end_at).getTime() < new Date(start_at).getTime()) {
      setError("End time can't be before start time.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          tags,
          ticket_id: ticketId.trim() || null,
          start_at,
          end_at,
          summary: summary.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      // Save path is not blocked by animation — navigate straight home.
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
        aria-hidden="true"
      />
      <motion.section
        className="sheet"
        role="dialog"
        aria-label="Log an entry"
        aria-modal="true"
        variants={sheetVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="bezel">
          <div className="bezel-core" style={{ padding: "1.25rem" }}>
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: "1.125rem", letterSpacing: "-0.02em" }}>
                  Log an entry
                </h2>
                {slot ? (
                  <p className="mono" style={{ margin: "0.15rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
                    slot {slot}
                  </p>
                ) : null}
              </div>
              <button className="btn-ghost" onClick={close} aria-label="Close" style={{ padding: "0.5rem" }}>
                <X size={18} weight="light" />
              </button>
            </header>

            <motion.div variants={fieldsContainer} initial="hidden" animate="visible">
              {/* Description */}
              <motion.div variants={fieldItem} style={{ marginBottom: "0.9rem" }}>
                <label className="field-label" htmlFor="description">
                  What did you do?
                </label>
                <textarea
                  id="description"
                  ref={descRef}
                  className="textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Fixed login bug JIRA-123, reviewed PR"
                  rows={2}
                />
              </motion.div>

              {/* Tags */}
              <motion.div variants={fieldItem} style={{ marginBottom: "0.9rem" }}>
                <label className="field-label" htmlFor="tag-input">
                  Tags
                </label>
                {tags.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                    {tags.map((t) => (
                      <motion.span
                        key={t}
                        className="tag-pill"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={SNAPPY_SPRING}
                      >
                        {t}
                        <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>
                          <X size={13} weight="light" />
                        </button>
                      </motion.span>
                    ))}
                  </div>
                ) : null}
                <input
                  id="tag-input"
                  className="input"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(tagInput);
                    } else if (e.key === "Backspace" && !tagInput && tags.length) {
                      removeTag(tags[tags.length - 1]);
                    }
                  }}
                  placeholder="Add a tag and press Enter"
                  autoComplete="off"
                />
                <AnimatePresence>
                  {showSuggestions && suggestions.length > 0 ? (
                    <motion.ul
                      className="suggestions"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.18 }}
                    >
                      {suggestions.slice(0, 6).map((s) => (
                        <li key={s.label} onClick={() => addTag(s.label)}>
                          <span>{s.label}</span>
                          <span className="mono" style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                            {s.usage_count}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  ) : null}
                </AnimatePresence>
              </motion.div>

              {/* Ticket */}
              <motion.div variants={fieldItem} style={{ marginBottom: "0.9rem" }}>
                <label className="field-label" htmlFor="ticket">
                  Ticket / backlog ID
                </label>
                <input
                  id="ticket"
                  className="input mono"
                  value={ticketId}
                  onChange={(e) => {
                    setTicketTouched(true);
                    setTicketId(e.target.value);
                  }}
                  placeholder="auto-detected from description"
                  autoComplete="off"
                />
              </motion.div>

              {/* Times */}
              <motion.div
                variants={fieldItem}
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.9rem" }}
              >
                <div>
                  <label className="field-label" htmlFor="start">
                    Start (WIB)
                  </label>
                  <input
                    id="start"
                    type="datetime-local"
                    className="input mono"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="end">
                    End (WIB)
                  </label>
                  <input
                    id="end"
                    type="datetime-local"
                    className="input mono"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </div>
              </motion.div>

              {/* Duration presets */}
              <motion.div variants={fieldItem} style={{ marginBottom: "0.9rem" }}>
                <label className="field-label">Duration</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {DURATION_PRESETS.map((p) => (
                    <button
                      key={p.min}
                      type="button"
                      className="chip mono"
                      data-selected={selectedPreset === p.min}
                      onClick={() => applyDurationPreset(p.min)}
                    >
                      {p.label}
                    </button>
                  ))}
                  <span className="mono" style={{ alignSelf: "center", color: "var(--muted)", fontSize: "0.8125rem" }}>
                    {selectedPreset == null ? "custom" : ""}
                  </span>
                </div>
              </motion.div>

              {/* Summary */}
              <motion.div variants={fieldItem} style={{ marginBottom: "1.1rem" }}>
                <label className="field-label" htmlFor="summary">
                  Summary (optional)
                </label>
                <textarea
                  id="summary"
                  className="textarea"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Outcome, links, longer note"
                  rows={2}
                />
              </motion.div>

              {error ? (
                <p role="alert" style={{ color: "var(--warn)", fontSize: "0.875rem", margin: "0 0 0.75rem" }}>
                  {error}
                </p>
              ) : null}

              <motion.div variants={fieldItem} style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="pill-cta"
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="save-entry"
                >
                  {saving ? "Saving…" : "Save entry"}
                  <span className="icon-wrap">
                    <ArrowRight size={18} weight="light" color="#fafafa" />
                  </span>
                </button>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

export { Plus };
