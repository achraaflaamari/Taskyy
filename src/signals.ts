/**
 * Signal → Reaction registry (event-only).
 *
 * The mascot never follows typing, caret or focus. It reacts only to discrete
 * workspace events (errors, terminal/task exits, git commits, save/debug
 * milestones). Adding a new signal = add one row + one host listener that
 * calls `provider.postSignal(...)`.
 *
 * NOTE on art: the bundled 3×3 reaction atlas only contains
 * blink/heart/sparkle/surprised/starstruck/bashful/sleepy/dizzy/delighted.
 * Intents map to the closest existing cell (see Reaction column).
 */

export type SignalType =
  | 'errorsUp'
  | 'errorsZero'
  | 'termFail'
  | 'termOk'
  | 'taskOk'
  | 'gitCommit';

export type ReactionName =
  | 'blink' | 'heart' | 'sparkle' | 'surprised'
  | 'starstruck' | 'bashful' | 'sleepy' | 'dizzy' | 'delighted';

export interface ReactionRule {
  /** Stable id — also the `type` sent over the bridge. */
  signal: SignalType;
  /** Face cell to show (must exist in the atlas). */
  reaction: ReactionName;
  /** How long to hold it (ms). */
  durationMs: number;
  /** Higher wins when two signals arrive together. */
  priority: number;
  /** Minimum gap between two firings of the same signal. */
  cooldownMs: number;
  /** Human intent (documents the fallback, e.g. worried → surprised). */
  intent: string;
  /** Short bubble line shown under the mascot. Omit for silent reactions. */
  say?: string;
  /** Optional multi-step timeline (e.g. celebrate = sparkle→heart→delighted). */
  timeline?: Array<{ at: number; reaction: ReactionName | null }>;
}

/** Idle / sleep / ambient tuning — also centralized for future edits. */
export const TIMING = {
  /** 5 minutes of no activity → sticky sleep (only a direct click wakes). */
  sleepAfterMs: 5 * 60 * 1000,
  /** Drowsy face starts at 30s (sticky-ish, repeats every sleepyGapMs). */
  sleepyAfterMs: 30 * 1000,
  sleepyGapMs: 10 * 1000,
  /** Ambient life (random looks/smiles) starts after 6s quiet. */
  ambientAfterMs: 6 * 1000,
  ambientMinGapMs: 4 * 1000,
  ambientMaxGapMs: 8 * 1000,
  /** Blink overlay runs very often, independent of ambient faces. */
  blinkMinGapMs: 2500,
  blinkMaxGapMs: 5500,
  blinkDurationMs: 150,
  /** Glance hold refreshed by repeated cursor/terminal messages. */
  glanceHoldMs: 1500,
} as const;

/** Thresholds for host-side detectors (kept minimal; typing detectors removed). */
export const DETECTORS = {} as const;

export const DEFAULT_RULES: Record<SignalType, ReactionRule> = {
  errorsUp: {
    signal: 'errorsUp', reaction: 'surprised', durationMs: 1200,
    priority: 80, cooldownMs: 5000,
    intent: 'worried — errors appeared',
  },
  errorsZero: {
    signal: 'errorsZero', reaction: 'delighted', durationMs: 900,
    priority: 60, cooldownMs: 5000,
    intent: 'happy — errors reached 0',
    say: 'Clean.',
  },
  termFail: {
    signal: 'termFail', reaction: 'surprised', durationMs: 1200,
    priority: 80, cooldownMs: 3000,
    intent: 'worried — command exit ≠ 0',
    say: 'Command failed.',
  },
  termOk: {
    signal: 'termOk', reaction: 'delighted', durationMs: 900,
    priority: 60, cooldownMs: 8000,
    intent: 'happy — command exit = 0 (quiet, no bubble)',
  },
  taskOk: {
    signal: 'taskOk', reaction: 'starstruck', durationMs: 1100,
    priority: 70, cooldownMs: 5000,
    intent: 'thumbs-up fallback — starstruck (no such cell in atlas)',
    say: 'Task passed.',
  },
  gitCommit: {
    signal: 'gitCommit', reaction: 'sparkle', durationMs: 1600,
    priority: 75, cooldownMs: 5000,
    intent: 'celebrate fallback — sparkle→heart→delighted timeline',
    say: 'Committed.',
    timeline: [
      { at: 0, reaction: 'sparkle' },
      { at: 350, reaction: 'heart' },
      { at: 700, reaction: 'delighted' },
      { at: 1600, reaction: null },
    ],
  },
};

/** Cooldown gate — host keeps one `lastFiredAt` map and consults this. */
export function cooldownOk(
  signal: SignalType,
  now: number,
  lastFiredAt: Partial<Record<SignalType, number>>,
): boolean {
  const rule = DEFAULT_RULES[signal];
  const last = lastFiredAt[signal];
  if (typeof last !== 'number') { return true; }
  return now - last >= rule.cooldownMs;
}
