/**
 * Shared game constants.
 *
 * This file is imported by BOTH the server (physics) and the browser client
 * (rendering) — Bun bundles it into the frontend automatically through the
 * @FrontendController HTML import.
 */
export const FIELD = { width: 800, height: 500 } as const;

export const PADDLE = {
  width: 12,
  height: 90,
  margin: 24, // distance from the wall
  speed: 460, // px / second
} as const;

export const BALL = {
  size: 12,
  startSpeed: 380, // px / second
  maxSpeed: 1050,
  speedUp: 1.06, // multiplier on every paddle hit
  maxBounceAngle: Math.PI / 3, // 60°
} as const;

/** Server physics frequency. */
export const TICK_RATE = 60;
/** How often the authoritative state is pushed to clients. */
export const BROADCAST_EVERY_N_TICKS = 2; // → 30 Hz
/** Seconds of countdown before a serve. */
export const COUNTDOWN_SECONDS = 3;

export const DEFAULT_TARGET_SCORE = 7;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
