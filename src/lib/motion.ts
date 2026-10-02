/**
 * Shared motion presets — DESIGN_SYSTEM.md §6/§9.
 * Spring default: stiffness 100, damping 20. Timed transitions use the custom
 * cubic-bezier (0.32, 0.72, 0, 1). Animate transform/opacity only.
 */
import type { Transition, Variants } from "framer-motion";

export const SPRING: Transition = { type: "spring", stiffness: 100, damping: 20 };

export const SNAPPY_SPRING: Transition = { type: "spring", stiffness: 400, damping: 28 };

export const EASE_FLUID = [0.32, 0.72, 0, 1] as const;

/** Bottom sheet: springs up from below. */
export const sheetVariants: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: SPRING },
  exit: { y: "100%", transition: { duration: 0.2, ease: EASE_FLUID } },
};

/** Field stagger container — children reveal 40ms apart (§6). */
export const fieldsContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
};

/** Individual field reveal: fade + rise. */
export const fieldItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};
