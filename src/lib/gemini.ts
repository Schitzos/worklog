import "server-only";

/**
 * Minimal Gemini client (REST, zero-dependency — Node 22 native fetch).
 *
 * Used to turn a compact, deterministic rollup of a day's work into a short
 * first-person prose summary suitable for a status report. Kept tiny on
 * purpose: one function, one model call, hard timeout, and a clear typed
 * outcome so callers can fall back to deterministic text when the key is
 * missing or the API errors.
 *
 * Key resolution: the user stores their key as GEMINI_KEY in .env; we also
 * accept the conventional GEMINI_API_KEY. The SAME single key is used across
 * dev/prod/test — there is no per-environment key.
 */

/** Default model — cheapest that fits a one-paragraph personal summary. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** The single Gemini key, from GEMINI_KEY (preferred) or GEMINI_API_KEY. */
export function geminiKey(): string | null {
  const k = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function hasGeminiKey(): boolean {
  return geminiKey() !== null;
}

export interface GeminiResult {
  ok: boolean;
  text: string;
  model: string;
  /** Set when ok=false, for logging/debug (never shown raw to the user). */
  error?: string;
}

/**
 * Ask Gemini to produce prose from a prompt. Resolves (never throws) with
 * ok=false on any failure so the caller can fall back. `signalTimeoutMs`
 * guards against a hung request stalling a cron/launchd run.
 */
export async function geminiGenerate(
  prompt: string,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<GeminiResult> {
  const model = opts.model || GEMINI_MODEL;
  const key = geminiKey();
  if (!key) {
    return { ok: false, text: "", model, error: "no_key" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await fetch(`${ENDPOINT(model)}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        text: "",
        model,
        error: `http_${res.status}: ${detail.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    if (!text) {
      return { ok: false, text: "", model, error: "empty_response" };
    }
    return { ok: true, text, model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", model, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
