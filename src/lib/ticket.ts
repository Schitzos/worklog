/**
 * Ticket / backlog ID auto-detection (design.md §5). Scans a description for the
 * first recognizable issue reference and returns it, so the form can pre-fill the
 * ticket field. Editable afterwards — this is a convenience, not a constraint.
 *
 * Patterns:
 *   - JIRA-style project keys:  JIRA-123, TSEL-99, ABC-4567  (2+ letters, dash, digits)
 *   - Hash issue refs:          #456
 *
 * Returned casing is normalized to upper for the project-key form (so "jira-123"
 * -> "JIRA-123"); hash refs are returned verbatim ("#456").
 */

const PROJECT_KEY = /\b([A-Za-z]{2,10})-(\d{1,7})\b/;
const HASH_REF = /(?:^|\s)(#\d{1,7})\b/;

export function detectTicket(description: string): string | null {
  if (!description) return null;

  const key = PROJECT_KEY.exec(description);
  const hash = HASH_REF.exec(description);

  // Prefer whichever appears first in the text; project keys win ties.
  const keyIdx = key ? key.index : Infinity;
  const hashIdx = hash ? hash.index : Infinity;

  if (keyIdx <= hashIdx && key) {
    return `${key[1].toUpperCase()}-${key[2]}`;
  }
  if (hash) {
    return hash[1];
  }
  return null;
}
