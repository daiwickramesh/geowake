/**
 * Design tokens for GeoWake.
 *
 * The previous UI used one-off pixel values and 10-12px text, which read as
 * cramped and inconsistent. This module centralises a spacing scale, a type
 * scale and a few shared effects so every surface uses the same rhythm.
 */

export const SPACE = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Type scale. `body` is the default reading size; anything below 13px is
 * reserved for secondary metadata.
 */
export const TYPE = {
  display: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.5 },
  title: { fontSize: 19, fontWeight: "800" as const, letterSpacing: -0.2 },
  heading: { fontSize: 16, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "500" as const },
  label: { fontSize: 13, fontWeight: "700" as const },
  caption: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.2 },
} as const;

export const INK = {
  primary: "#f8fafc",
  secondary: "#a3b1c6",
  muted: "#64748b",
  onAccent: "#04121a",
  danger: "#ef4444",
  success: "#22c55e",
} as const;

/** Minimum comfortable tap target on touch devices. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TAP = 44;

export const GLASS_BORDER = "rgba(255, 255, 255, 0.12)";
export const GLASS_SURFACE = "rgba(8, 13, 24, 0.82)";
export const INPUT_SURFACE = "rgba(2, 6, 16, 0.55)";

/**
 * Shared transition for interactive surfaces. Kept in one place so hover/focus
 * behaves consistently instead of per-component guesswork.
 *
 * `cursor`, `userSelect`, `transition`, `boxShadow` and the long-form
 * `outline*` properties are web-only and are rejected by React Native's style
 * *types* (not by React Native Web's runtime validator), so the sheet that
 * consumes this token is created through a loosely typed `StyleSheet.create`.
 */
export const interactive = {
  transition:
    "background-color 140ms ease, border-color 140ms ease, transform 90ms ease, opacity 140ms ease",
  cursor: "pointer" as const,
  userSelect: "none" as const,
};

/**
 * Keyboard focus ring.
 *
 * Must use the long-form outline properties: React Native Web's style
 * validator rejects the `outline` shorthand and silently drops it.
 */
export const focusRing = (accent: string) => ({
  outlineStyle: "solid",
  outlineWidth: 2,
  outlineColor: accent,
  outlineOffset: 2,
});

/** Suppresses the platform default ring, e.g. on inputs that draw their own. */
export const noFocusRing = { outlineStyle: "none" as const };
