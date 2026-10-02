"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy, DownloadSimple } from "@phosphor-icons/react";
import { SPRING } from "@/lib/motion";

const WIB_OFFSET_MS = 7 * 60 * 60_000;

function todayWib(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000).toISOString().slice(0, 10);
}
function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(date, -back);
}
function monthStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
/** First day of the calendar quarter containing `date`. */
function quarterStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const qFirstMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qFirstMonth).padStart(2, "0")}-01`;
}

type Preset = "week" | "month" | "quarter" | "custom";

export function ExportClient({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const reduce = useReducedMotion();
  const [preset, setPreset] = useState<Preset>("week");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [md, setMd] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply a preset → compute its range (relative to today-in-WIB).
  const applyPreset = useCallback((p: Preset) => {
    setPreset(p);
    const today = todayWib();
    if (p === "week") {
      setFrom(mondayOf(today));
      setTo(today);
    } else if (p === "month") {
      setFrom(monthStart(today));
      setTo(today);
    } else if (p === "quarter") {
      setFrom(quarterStart(today));
      setTo(today);
    }
    // custom: leave the fields for the user to edit.
  }, []);

  // Fetch the live Markdown preview whenever the range changes.
  const loadPreview = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recap/export?from=${f}&to=${t}&format=md`);
      if (res.ok) setMd(await res.text());
      else setMd(`_Could not build export (${res.status})._`);
    } catch {
      setMd("_Could not reach the export API._");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreview(from, to);
  }, [from, to, loadPreview]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied (e.g. insecure context) — select-all fallback is the
      // preview itself, which the user can copy manually.
    }
  }, [md]);

  // Build the .md Blob client-side from the API response and trigger a download.
  const onDownload = useCallback(async () => {
    const res = await fetch(`/api/recap/export?from=${from}&to=${to}&format=md`);
    const text = res.ok ? await res.text() : md;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worklog-${from}_to_${to}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [from, to, md]);

  const presets: { id: Preset; label: string }[] = useMemo(
    () => [
      { id: "week", label: "This week" },
      { id: "month", label: "This month" },
      { id: "quarter", label: "This quarter" },
      { id: "custom", label: "Custom" },
    ],
    [],
  );

  return (
    <main style={{ minHeight: "100dvh", maxWidth: "1280px", margin: "0 auto", padding: "var(--section-py) 1rem 5rem" }}>
      <header>
        <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Boss-ready export
        </h1>
        <p className="mono" style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
          {from} – {to} · WIB · Markdown
        </p>
      </header>

      <div className="export-grid">
        {/* Controls — Double-Bezel card */}
        <div className="bezel">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>Range</h3>
            <div className="preset-row" data-testid="preset-row">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  data-selected={preset === p.id}
                  data-preset={p.id}
                  onClick={() => applyPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="range-fields">
              <div>
                <label className="field-label" htmlFor="exp-from">From</label>
                <input
                  id="exp-from"
                  type="date"
                  className="input mono"
                  data-testid="export-from"
                  value={from}
                  max={to}
                  onChange={(e) => { setPreset("custom"); setFrom(e.target.value || from); }}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="exp-to">To</label>
                <input
                  id="exp-to"
                  type="date"
                  className="input mono"
                  data-testid="export-to"
                  value={to}
                  min={from}
                  max={todayWib()}
                  onChange={(e) => { setPreset("custom"); setTo(e.target.value || to); }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Live Markdown preview — Double-Bezel card + accent CTA */}
        <div className="bezel">
          <div className="bezel-core" style={{ padding: "1.1rem 1.2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
              <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>Preview</h3>
              <span className="mono" style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                {loading ? "building…" : "live"}
              </span>
            </div>

            {loading ? (
              <div aria-hidden="true">
                <div className="skeleton" style={{ height: 18, width: "55%", marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 12, width: "90%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: "80%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: "70%" }} />
              </div>
            ) : (
              <motion.pre
                className="export-preview"
                data-testid="export-preview"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING}
              >
                {md}
              </motion.pre>
            )}

            <div className="export-actions">
              <button
                type="button"
                className="pill-cta"
                data-testid="export-copy"
                onClick={onCopy}
                disabled={loading || !md}
              >
                {copied ? "Copied" : "Copy to clipboard"}
                <span className="icon-wrap" aria-hidden="true">
                  {copied ? <Check size={16} weight="light" /> : <Copy size={16} weight="light" />}
                </span>
              </button>
              <button
                type="button"
                className="btn-ghost"
                data-testid="export-download"
                onClick={onDownload}
                disabled={loading || !md}
              >
                <DownloadSimple size={16} weight="light" />
                Download .md
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
