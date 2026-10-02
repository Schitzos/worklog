# Design System: Worklog Reminder

> **Status:** v1 design authority — the single source of truth for visual + motion.
> **Companion docs:** [`design.md`](./design.md) · [`schema.md`](./schema.md) · [`architecture.md`](./architecture.md)
> **Derived from installed taste skills** (`~/.kiro/crew/skills/skillsh/`):
> `high-end-visual-design`, `stitch-design-taste`, `design-taste-frontend`,
> `anthropics-skills-frontend-design`.
> **Scope note:** Worklog is a **product/dashboard UI**, not a marketing landing
> page. The skills' *landing-page-only* techniques (centered glass heroes,
> inline-image headline typography, cinematic full-page scroll stories, "scroll to
> explore" affordances) are **deliberately NOT applied**. The dashboard-correct
> subset below is applied in full. Every component in the build must pass §8.

---

## 1. Visual theme & atmosphere

A calm, confident **"daily app"** interface — a well-lit architecture studio, not a
neon cockpit. Clinical precision warmed by soft, diffused depth. Content breathes;
nothing screams. The multitasking timeline and the recap charts are the heroes —
the chrome stays quiet so the data reads instantly.

Taste dials (per `stitch-design-taste`):
- **Density:** 5 — *Daily App Balanced*. Enough air to feel premium, dense enough
  to log fast.
- **Variance:** 5 — *Offset Asymmetric*. Intentional asymmetry (bento recap grid,
  split today view), but no chaos — it's a tool used every day.
- **Motion:** 6 — *Fluid, spring-physics*. Choreographed and tactile, never
  cinematic-heavy; motion must never slow the <10s entry.

---

## 2. Color palette & roles

Absolute-neutral **Zinc** base + **one** accent. Saturation < 80%. No purple/neon,
no pure black. Light + dark both defined (PWA respects system theme).

### Light
- **Canvas** `#FAFAFA` (Zinc-50) — app background
- **Surface** `#FFFFFF` — card / container fill
- **Ink** `#18181B` (Zinc-900) — primary text
- **Muted** `#71717A` (Zinc-500) — secondary text, metadata, timestamps
- **Hairline** `rgba(228,228,231,0.7)` (Zinc-200 @70%) — borders, dividers
- **Accent — Tsel Teal** `#0F766E` (Teal-700, sat ~79%) — CTAs, active slot, focus ring, "now" line

### Dark
- **Canvas** `#09090B` (Zinc-950, *not* `#000`) — app background
- **Surface** `#18181B` (Zinc-900) — card fill
- **Ink** `#FAFAFA` — primary text
- **Muted** `#A1A1AA` (Zinc-400) — secondary text
- **Hairline** `rgba(255,255,255,0.08)` — borders
- **Accent — Tsel Teal** `#2DD4BF` (Teal-400) — accent on dark

### Semantic
- **Filled slot** — accent
- **Skipped slot** — Muted (intentionally quiet — it's a non-event)
- **Gap / untracked** — **Amber** `#D97706` (warn only; the one color that pulses)
- **Tag chips** — Zinc neutral fill + Ink text; the *active* filter tag takes accent

> One palette throughout. No warm/cool gray drift. Amber appears **only** on the
> untracked-time warning, nowhere else.

---

## 3. Typography

Sans-only (dashboard rule — serif is banned in product UIs). Weight + color drive
hierarchy, not giant sizes.

- **Display / headings:** **Geist** — track-tight (`-0.02em`), controlled scale.
- **Body / UI:** **Geist** — relaxed leading, body ≥ `1rem` (16px), max line ~65ch.
- **Mono:** **Geist Mono** — all **durations, times, ticket IDs, slot labels, and
  recap numbers**. (Density-5 numbers read best monospaced and align in tables.)
- **Scale:** `clamp()` for headings; e.g. page title `clamp(1.5rem, 3vw, 2rem)`.

**Banned:** Inter, Roboto, Arial, Open Sans, Helvetica; any serif; all-caps labels
as decoration; accenting a single word in a heading; typographic eyebrow labels
stacked above content "just because".

---

## 4. Components

### Cards — "Double-Bezel" (nested architecture)
Major containers (today timeline, each recap panel, the entry form sheet) are not
flat rectangles on the canvas. They use a nested shell:
- **Outer shell:** subtle fill (`bg-black/[0.03]` light / `bg-white/[0.04]` dark),
  hairline ring (`ring-1 ring-black/5` / `ring-white/10`), `p-1.5`, `rounded-[1.75rem]`.
- **Inner core:** Surface fill, inner highlight `shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]`,
  concentric radius `rounded-[calc(1.75rem-0.375rem)]`.
- Shadows are **diffused + tinted to the canvas hue** — never `shadow-md`, never
  `rgba(0,0,0,0.3)`. High-density sub-rows inside a card use **border-top dividers**,
  not nested cards.

### Buttons / CTAs
- Primary = accent-filled **pill** (`rounded-full`, `px-6 py-3`). Tactile
  `active:scale-[0.98]`. **No outer glow.**
- Secondary = ghost/outline, hairline ring.
- **Button-in-button trailing icon:** an arrow/action icon sits inside its own
  circular wrapper (`w-8 h-8 rounded-full bg-black/5 dark:bg-white/10`), flush
  right — never a naked icon beside text. On hover the inner circle translates
  diagonally + scales `105%` (kinetic tension).

### Duration chips & tag chips
- Rounded-full, `44px` min tap target. Selected chip **scales + fills accent**.
- Tag autocomplete suggestions are chips that fade/slide in; selected tag pops.

### Inputs / form
- Label above, helper optional, **error below**. Focus ring = accent. No floating
  labels, no custom cursor.
- The entry form opens as a **bottom sheet** (mobile-friendly, thumb-reachable).

### Loading / empty / error
- **Loaders:** skeletal shimmer matching the real layout dimensions — **no circular
  spinners**.
- **Empty states:** composed illustration + the single action that populates it
  (e.g. "No entries for this slot yet → Log the first one"). **No bare "No data".**
- **Errors:** inline, specific, calm.

### Icons
- Ultra-light line icons only (**Phosphor Light** / Remix Line). No thick Lucide /
  FontAwesome / Material defaults.

---

## 5. Layout

- **CSS Grid first**, no `calc()` percentage hacks. Max-width container ~`1280px`
  centered; generous internal padding.
- **Today view:** asymmetric split — timeline column (overlapping blocks render
  side-by-side like a calendar) + a quick-add / untracked-status rail.
- **Recap views:** **asymmetric bento grid** — effort-per-tag, totals, streak,
  heatmap in varying card sizes. **No 3-equal-column feature row.**
- Full-height sections use `min-h-[100dvh]`, never `h-screen`.
- Elements never overlap into the same spatial zone (except the *intended*
  timeline overlap, which is the feature).

---

## 6. Motion & interaction

Framer Motion is the engine. **Spring physics default: `stiffness: 100, damping: 20`.**
No `linear` / `ease-in-out`; custom cubic-bezier `cubic-bezier(0.32, 0.72, 0, 1)`
for timed transitions.

| Moment | Motion | Spec |
|--------|--------|------|
| Form open (from notif / +) | Bottom sheet springs up, fields **stagger** in | spring; `delay 40ms` per field |
| Save entry | Entry **flies into** timeline; slot chip flips empty→filled | spring; shared-layout transition |
| Tag suggestions | fade + slide `translate-y-2 → 0` | 180ms |
| Duration/tag chip select | scale `1 → 1.04` + accent fill | spring, snappy |
| Recap mount | bars **grow from 0**, totals **count up**, tags **stagger** | once on `whileInView`, cascade `60ms` |
| Timeline blocks | **grow from their start-time edge** on enter | spring |
| "Now" line | subtle **perpetual pulse** | infinite, opacity only |
| Untracked gap | **amber pulse** | infinite, opacity only |
| Streak milestone | Lottie flame/confetti (one orchestrated moment) | on new-streak event only |
| Button hover | inner icon-circle translate + scale `105%`; `active:scale-0.98` | spring |

**Reveals:** use Framer Motion `whileInView` / `IntersectionObserver` — **never**
`window.addEventListener('scroll')`. Each element enters once; nothing re-animates
on re-render.

**Restraint (the critical rule):** motion is `150–300ms` for UI feedback; the
**save path never waits on animation** — the entry is persisted immediately and the
animation plays over the already-committed state. One orchestrated moment beats
scattered fade-ups on every element.

---

## 7. Performance guardrails

- Animate **only `transform` + `opacity`**. Never `top/left/width/height`.
- `will-change: transform` only on elements actively animating.
- `backdrop-blur` only on fixed/sticky layers (bottom sheet scrim, sticky header) —
  never on scrolling content.
- CPU-heavy animations isolated into their own Client Components.
- Charts animate **once on view**, not on every render.

---

## 8. Anti-pattern checklist (the last filter — every screen must pass)

- [ ] No banned fonts (Inter/Roboto/Arial/Open Sans/Helvetica); no serif anywhere.
- [ ] No pure black `#000000`; dark canvas is Zinc-950.
- [ ] Exactly **one** accent; saturation < 80%; no purple/neon; no outer-glow shadows.
- [ ] No generic `shadow-md` / `rgba(0,0,0,0.3)`; shadows diffused + canvas-tinted.
- [ ] Major cards use the Double-Bezel nested architecture.
- [ ] CTAs use the button-in-button trailing-icon pattern where an action icon applies.
- [ ] No 3-equal-column card grid; recap uses asymmetric bento.
- [ ] All transitions use spring / custom cubic-bezier — no `linear`/`ease-in-out`.
- [ ] All animation is `transform`/`opacity` only; `backdrop-blur` only on fixed layers.
- [ ] `prefers-reduced-motion` disables non-essential motion (accessibility).
- [ ] Loaders are skeletal (no spinners); empty states are composed, not "No data".
- [ ] Touch targets ≥ `44px`; mobile collapses to single column; no horizontal scroll.
- [ ] No emojis in the product UI; no AI copy clichés ("Elevate/Seamless/Unleash");
      no fake round numbers; no "scroll to explore" filler.
- [ ] The save path is never blocked by an animation.
- [ ] Reads as a crafted product, not "a template with nice fonts".

---

## 9. Concrete v1 tokens (starting point for the build)

```
Fonts:   Geist (display+body), Geist Mono (numbers/time/ids)
Icons:   @phosphor-icons/react  (weight="light")
Motion:  framer-motion  (spring: { stiffness: 100, damping: 20 })
Delight: lottie-react   (streak celebration, day-complete check)
Radius:  --r-card: 1.75rem;  --r-inner: calc(1.75rem - 0.375rem);  --r-pill: 9999px
Accent:  --accent: #0F766E (light) / #2DD4BF (dark)
Warn:    --warn:   #D97706  (untracked only)
Space:   section py: clamp(2rem, 5vw, 3.5rem)  (dashboard — not landing-page py-24+)
Easing:  --ease-fluid: cubic-bezier(0.32, 0.72, 0, 1)
```
