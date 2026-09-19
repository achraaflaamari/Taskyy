/**
 * tracker.ts — 5 s tick, idle/session accounting, activity classification,
 * file/folder/hourly attribution.
 *
 * Pure helpers (classify, isTestCommand, credit math) are vscode-free so
 * `node --test` can prove idle/session/classification without the editor.
 */

import { StatsStore, createEmptyDay, localDayKey } from './statsStore';

export type ActivityKind = 'coding' | 'debugging' | 'testing' | 'git' | 'terminal';
export type SilentKind = 'typing' | 'selection' | 'focus';

export interface TrackerOptions {
  enabled: boolean;
  idleSeconds: number;
  trackFiles: boolean;
  getNow?: () => number;
}

export interface TickAttribution {
  fileRel?: string;
  folder?: string;
}

/** Test-command detection (§4.2). Command-level only, never per-test parsing. */
const TEST_RE =
  /\b(jest|vitest|mocha|pytest|go test|cargo test|dotnet test|phpunit|npm( run)? test|pnpm test|yarn test)\b/;

export function isTestCommand(line: string): boolean {
  return TEST_RE.test(line || '');
}

export function isTestTaskGroup(group: unknown): boolean {
  if (!group) { return false; }
  if (typeof group === 'string') { return group === 'Test'; }
  if (typeof group === 'object') {
    const g = group as { id?: unknown; label?: unknown; isDefault?: unknown };
    // vscode.TaskGroup.Test has id 'test'; tolerate label matching too.
    if (g.id === 'test' || g.id === 'Test') { return true; }
    if (typeof g.label === 'string' && /test/i.test(g.label)) { return true; }
  }
  return false;
}

export interface ClassifyState {
  testRunning: boolean;
  debugActive: boolean;
  lastGitTs: number;
  lastTerminalTs: number;
}

/** Classification precedence (§4.1): test > debug > git > terminal > coding. */
export function classify(s: ClassifyState, now: number): ActivityKind {
  if (s.testRunning) { return 'testing'; }
  if (s.debugActive) { return 'debugging'; }
  if (now - s.lastGitTs < 60_000) { return 'git'; }
  if (now - s.lastTerminalTs < 30_000) { return 'terminal'; }
  return 'coding';
}

const IGNORED_SEGMENTS = ['node_modules', '.git', 'out', 'dist', '.vscode-test'];

export function isIgnoredPath(rel: string): boolean {
  const parts = (rel || '').split(/[\\/]/);
  return parts.some((p) => IGNORED_SEGMENTS.includes(p));
}

export function topFolder(rel: string | undefined, workspaceName?: string): string {
  if (!rel) { return workspaceName || 'workspace'; }
  const first = rel.split(/[\\/]/)[0];
  if (!first || rel.split(/[\\/]/).length === 1) { return workspaceName || 'workspace'; }
  return first;
}

export interface TrackerEvents {
  onMilestone?: (id: string, ts: number) => void;
}

/**
 * Totally vscode-free tracker core. The activityHub feeds it; the extension
 * wires persistence (StatsStore) + wall clock.
 */
export class Tracker {
  private lastActivityTs = 0;
  private lastTick = 0;
  private sessionStart: number | null = null;
  private testRunning = false;
  private debugActive = false;
  private lastGitTs = -Infinity;
  private lastTerminalTs = -Infinity;
  private errorStartTs: number | null = null;
  private lastPersist = 0;
  private dirtyDay: string | null = null;

  constructor(
    private readonly store: StatsStore,
    private opts: TrackerOptions,
    private readonly events: TrackerEvents = {},
  ) {}

  get idleSeconds(): number { return Math.max(30, this.opts.idleSeconds || 120); }

  configure(opts: Partial<TrackerOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  private now(): number {
    return this.opts.getNow ? this.opts.getNow() : Date.now();
  }

  /** Advance lastActivityTs. Called by the hub for every §4 activity source. */
  noteActivity(kind: SilentKind, ts = this.now(), meta?: { switches?: boolean }): void {
    void kind;
    if (this.opts.enabled === false) { return; }
    if (this.lastActivityTs === 0) {
      // First-ever activity opens the first session + milestone.
      this.sessionStart = ts;
      const meta0 = this.store.getMeta();
      if (!meta0.firstActivity) {
        meta0.firstActivity = ts;
        this.store.saveMeta(meta0);
      }
      if (this.store.markMilestone('first-session', ts)) {
        this.events.onMilestone?.('first-session', ts);
      }
    } else if (ts - this.lastActivityTs > this.idleSeconds * 1000) {
      // Idle gap → previous session closed at lastActivityTs; new one opens.
      this.closeSession(this.lastActivityTs);
      this.sessionStart = ts;
    }
    if (meta?.switches) {
      const key = localDayKey(ts);
      const day = this.store.getDay(key);
      day.switches += 1;
      this.store.saveDay(day);
      this.store.indexDay(key);
    }
    this.lastActivityTs = ts;
  }

  setTestRunning(running: boolean): void { this.testRunning = running; }
  setDebugActive(active: boolean): void { this.debugActive = active; }
  noteGit(ts = this.now()): void { this.lastGitTs = ts; }
  noteTerminal(ts = this.now()): void { this.lastTerminalTs = ts; }

  noteCommit(ts = this.now()): void {
    if (this.opts.enabled === false) { return; }    const key = localDayKey(ts);
    const day = this.store.getDay(key);
    day.commits += 1;
    this.store.saveDay(day);
    this.store.indexDay(key);
    const total = this.store.allDays().reduce((a, d) => a + d.commits, 0);
    for (const id of this.store.checkCommitMilestones(total, ts)) {
      this.events.onMilestone?.(id, ts);
    }
    this.noteGit(ts);
  }

  /** Test-run result (command-level). `label` is the matched command text. */
  noteTestResult(passed: boolean, label: string, ts = this.now()): void {
    if (this.opts.enabled === false) { return; }    const key = localDayKey(ts);
    const day = this.store.getDay(key);
    day.tests.runs += 1;
    if (passed) { day.tests.passed += 1; } else { day.tests.failed += 1; }
    this.store.saveDay(day);
    this.store.indexDay(key);
    if (passed && this.store.markMilestone('first-green-test', ts)) {
      this.events.onMilestone?.('first-green-test', ts);
    }
    void label;
  }

  /** Workspace error-total transitions (§4.3). */
  noteErrors(totalNow: number, ts = this.now()): void {
    if (this.opts.enabled === false) { return; }    const key = localDayKey(ts);
    const day = this.store.getDay(key);
    const before = this.errorStartTs !== null ? true : (day as unknown as { __errOpen?: boolean }).__errOpen;
    void before;
    // Track via a lightweight in-memory open flag persisted on the day object
    // is avoided; instead use errorStartTs across ticks (single-workspace).
    const prevTotal = (this as unknown as { __lastErrTotal?: number }).__lastErrTotal ?? 0;
    if (totalNow > prevTotal) {
      day.errors.seen += totalNow - prevTotal;
      if (this.errorStartTs === null) { this.errorStartTs = ts; }
      this.store.saveDay(day);
      this.store.indexDay(key);
    } else if (totalNow === 0 && prevTotal > 0 && this.errorStartTs !== null) {
      day.errors.recoveries.push(ts - this.errorStartTs);
      this.errorStartTs = null;
      this.store.saveDay(day);
      this.store.indexDay(key);
    } else if (totalNow === 0 && prevTotal > 0) {
      // Recovery with no recorded start — still persist seen counts.
      this.store.saveDay(day);
    }
    (this as unknown as { __lastErrTotal?: number }).__lastErrTotal = totalNow;
  }

  /**
   * 5 s tick (§4). Credits min(5s, now-lastTick) when idle < idleSeconds.
   * Returns credited ms (0 when idle).
   */
  tick(ts = this.now(), attr: TickAttribution = {}, wsName?: string): number {
    if (this.opts.enabled === false) { return 0; }    const lastTick = this.lastTick || ts - 5000;
    const quantum = Math.min(5000, Math.max(0, ts - lastTick));
    this.lastTick = ts;
    if (!this.lastActivityTs) { return 0; }
    const idle = ts - this.lastActivityTs;
    if (idle >= this.idleSeconds * 1000) {
      // Close the session at the last activity; next activity opens a new one.
      this.closeSession(this.lastActivityTs);
      return 0;
    }
    const kind = classify(
      { testRunning: this.testRunning, debugActive: this.debugActive, lastGitTs: this.lastGitTs, lastTerminalTs: this.lastTerminalTs },
      ts,
    );
    const key = localDayKey(ts);
    // Midnight split: if the tick's day differs from the open session's day,
    // close the old session at midnight and open a new one.
    if (this.sessionStart !== null && localDayKey(this.sessionStart) !== key) {
      const midnight = new Date(ts);
      midnight.setHours(0, 0, 0, 0);
      this.closeSession(midnight.getTime(), this.sessionStart);
      this.sessionStart = midnight.getTime();
    }
    const day = this.store.getDay(key);
    day.activeMs += quantum;
    day.byActivity[kind] += quantum;
    const hour = new Date(ts).getHours();
    day.hourly[hour] = (day.hourly[hour] || 0) + quantum;
    if (attr.fileRel && !isIgnoredPath(attr.fileRel)) {
      if (this.opts.trackFiles !== false) {
        day.files[attr.fileRel] = (day.files[attr.fileRel] || 0) + quantum;
      }
      const top = attr.folder || topFolder(attr.fileRel, wsName);
      day.folders[top] = (day.folders[top] || 0) + quantum;
    } else if (attr.folder) {
      day.folders[attr.folder] = (day.folders[attr.folder] || 0) + quantum;
    }
    this.store.saveDay(day);
    this.store.indexDay(key);
    this.dirtyDay = key;

    // Time milestones + streak check on a cheap cadence.
    const total = this.store.allDays().reduce((a, d) => a + d.activeMs, 0);
    for (const id of this.store.checkTimeMilestones(total, ts)) {
      this.events.onMilestone?.(id, ts);
    }
    this.checkStreak(ts);

    if (ts - this.lastPersist > 30_000) {
      this.lastPersist = ts;
      this.dirtyDay = null;
    }
    return quantum;
  }

  /** Persist pending day (called on deactivate + every 30 s by the host). */
  flush(): void {
    this.dirtyDay = null;
    this.lastPersist = this.now();
  }

  private closeSession(endTs: number, startOverride?: number): void {
    const start = startOverride ?? this.sessionStart;
    if (start === null) { return; }
    const end = Math.max(start, endTs);
    // Attribute the session to the day of its start (midnight split handled
    // by the caller for cross-midnight sessions).
    const key = localDayKey(start);
    const day = this.store.getDay(key);
    // Merge with the last session if contiguous (same tick closing twice).
    const last = day.sessions[day.sessions.length - 1];
    if (last && last.end === start && endTs === this.lastActivityTs) {
      last.end = end;
    } else {
      day.sessions.push({ start, end });
    }
    this.store.saveDay(day);
    this.store.indexDay(key);
    this.sessionStart = null;
  }

  private checkStreak(ts: number): void {
    const days = this.store.allDays();
    if (days.length < 7) { return; }
    // Last 7 local dates (including today) all have activeMs > 0.
    const base = new Date(ts);
    base.setHours(0, 0, 0, 0);
    const byDate = new Map(days.map((d) => [d.date, d.activeMs]));
    for (let i = 0; i < 7; i += 1) {
      const key = localDayKey(base.getTime() - i * 86400000);
      if (!(byDate.get(key) ?? 0)) { return; }
    }
    if (this.store.markMilestone('7-day-streak', ts)) {
      this.events.onMilestone?.('7-day-streak', ts);
    }
  }

  // ---- introspection for tests ----
  getState(): { lastActivityTs: number; sessionStart: number | null; lastTick: number } {
    return { lastActivityTs: this.lastActivityTs, sessionStart: this.sessionStart, lastTick: this.lastTick };
  }
}
