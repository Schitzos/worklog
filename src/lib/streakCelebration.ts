/**
 * A tiny, self-contained Lottie animation for the streak-milestone celebration
 * (design.md §10, DESIGN_SYSTEM §6). Hand-authored so NOTHING is fetched
 * remotely (task constraint). It is a short accent-tinted "burst": a ring that
 * scales up and fades, plus a dot that pops — one orchestrated ~1s moment.
 *
 * Kept intentionally minimal (two shape layers, transform/opacity only) to obey
 * the perf guardrail. Colour is the teal accent in normalized RGB.
 */

// Teal accent #0F766E → normalized RGB.
const TEAL: [number, number, number] = [15 / 255, 118 / 255, 110 / 255];

export const streakCelebration = {
  v: "5.7.4",
  fr: 60,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  nm: "streak-burst",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "ring",
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 0, s: [90], h: 0, i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } },
            { t: 50, s: [0] },
          ],
        },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [20, 20, 100], h: 0, i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] }, o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] } },
            { t: 50, s: [160, 160, 100] },
          ],
        },
      },
      shapes: [
        {
          ty: "el",
          d: 1,
          s: { a: 0, k: [80, 80] },
          p: { a: 0, k: [0, 0] },
          nm: "ring-ellipse",
        },
        {
          ty: "st",
          c: { a: 0, k: [...TEAL, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 8 },
          lc: 2,
          lj: 1,
          nm: "ring-stroke",
        },
        {
          ty: "tr",
          p: { a: 0, k: [0, 0] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
          nm: "ring-tr",
        },
      ],
      ao: 0,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: "dot",
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 0, s: [0], h: 0, i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } },
            { t: 10, s: [100], h: 0, i: { x: [0.3], y: [1] }, o: { x: [0.7], y: [0] } },
            { t: 45, s: [0] },
          ],
        },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [0, 0, 100], h: 0, i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] }, o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] } },
            { t: 14, s: [120, 120, 100], h: 0, i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] }, o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] } },
            { t: 45, s: [60, 60, 100] },
          ],
        },
      },
      shapes: [
        {
          ty: "el",
          d: 1,
          s: { a: 0, k: [34, 34] },
          p: { a: 0, k: [0, 0] },
          nm: "dot-ellipse",
        },
        {
          ty: "fl",
          c: { a: 0, k: [...TEAL, 1] },
          o: { a: 0, k: 100 },
          nm: "dot-fill",
        },
        {
          ty: "tr",
          p: { a: 0, k: [0, 0] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
          nm: "dot-tr",
        },
      ],
      ao: 0,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    },
  ],
  markers: [],
} as const;

export default streakCelebration;
