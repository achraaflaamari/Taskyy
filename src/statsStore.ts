/**
 * statsStore.ts — persistence + aggregation. Sole owner of `stats:v1:*` keys.
 *
 * Storage: vscode.Memento (workspaceState). Keys `stats:v1:YYYY-MM-DD`
 * (local date) plus `stats:v1:meta`. Plain JSON, written at most every 30 s
 * and on deactivate.
 *
 * Pure functions (day keys, empty records, aggregation, pruning helpers) are
 * exported dependency-free so `node --test` can exercise them without vscode.
 */
import type { TodoTask } from './todoStore';

export type RangeKey = 'today' | '7d' | '30d' | 'all';

export interface DayRecord {
  date: string; // YYYY-MM-DD local
  activeMs: number;
  sessions: { start: number; end: number }[];
  byActivity: { coding: number; debugging: number; testing: number; git: number; terminal: number };
  files: Record<string, number>;
  folders: Record<string, number>;
  switches: number;
  errors: { seen: number; recoveries: number[] };
  tests: { runs: number; passed: number; failed: number };
  commits: number;
  hourly: number[]; // 24 buckets, ms
}

export interface Meta {
  firstActivity: number;
  milestones: { id: string; ts: number }[];
}

export interface StatsPayload {
  range: RangeKey;
  kpis: {
    activeMs: number; sessions: number; avgSessionMs: number;
    filesTouched: number; mostActiveFile: string | null;
    switches: number; errorsSeen: number; avgRecoveryMs: number | null;
    testRuns: number; passRate: number | null; commits: number;
    totalMs: number; activeDays: number;
  };
  trend: { date: string; ms: number }[];
  hourlyToday: number[];
  mix: { coding: number; debugging: number; testing: number; git: number; terminal: number };
  sessionsToday: { start: number; end: number }[];
  topFiles: { path: string; ms: number }[];
  folders: { name: string; ms: number }[];
  testsDaily: { date: string; passed: number; failed: number }[];
  errorsDaily: { date: string; seen: number }[];
  commitsDaily: { date: string; commits: number }[];
  tasksDaily: { date: string; created: number; completed: number }[];
  tasksOpen: number;
  tasksOverdue: number;
  spark7: number[];
  milestones: { id: string; label: string; ts: number | null }[];
  uncommitted: number | null;
  lastTest: { passed: boolean; label: string; ts: number } | null;
  estimated: true;
}

export const PREFIX = 'stats:v1:';
export const META_KEY = 'stats:v1:meta';
export const MAX_FILES_PER_DAY = 500;
export const MAX_RECOVERIES_PER_DAY = 100;

export const MILESTONE_IDS = [
  'first-session', 'first-commit', 'first-green-test', '10-commits',
  '100-commits', '10h', '50h', '100h', '7-day-streak',
] as const;

export const MILESTONE_LABELS: Record<string, string> = {
  'first-session': 'First session',
  'first-commit': 'First commit',
  'first-green-test': 'First passing test',
  '10-commits': '10 commits',
  '100-commits': '100 commits',
  '10h': '10 hours tracked',
  '50h': '50 hours tracked',
  '100h': '100 hours tracked',
  '7-day-streak': '7-day streak',
};

export function localDayKey(ts: number, d?: Date): string {
  const dt = d ?? new Date(ts);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(now = Date.now()): string {
  return localDayKey(now);
}

export function createEmptyDay(date: string): DayRecord {
  return {
    date,
    activeMs: 0,
    sessions: [],
    byActivity: { coding: 0, debugging: 0, testing: 0, git: 0, terminal: 0 },
    files: {},
    folders: {},
    switches: 0,
    errors: { seen: 0, recoveries: [] },
    tests: { runs: 0, passed: 0, failed: 0 },
    commits: 0,
    hourly: new Array(24).fill(0),
  };
}

export function createEmptyMeta(): Meta {
  return { firstActivity: 0, milestones: [] };
}

function dayKeyTs(dateStr: string): number {
  // Parse YYYY-MM-DD as local midnight for range ordering.
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

/** Sort day records oldest→newest by date string. */
export function sortDays(days: DayRecord[]): DayRecord[] {
  return [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Select the day records belonging to a range. `now` anchors today. */
export function selectRange(all: DayRecord[], range: RangeKey, now = Date.now()): DayRecord[] {
  const sorted = sortDays(all);
  if (range === 'all') { return sorted; }
  const tk = todayKey(now);
  if (range === 'today') { return sorted.filter((d) => d.date === tk); }
  const days = range === '7d' ? 7 : 30;
  const cutoff = dayKeyTs(tk) - (days - 1) * 86400000;
  return sorted.filter((d) => dayKeyTs(d.date) >= cutoff && d.date <= tk);
}

/** Build the last-7-days sparkline (oldest→newest), zero-filling gaps. */
export function buildSpark7(all: DayRecord[], now = Date.now()): number[] {
  const byDate = new Map(all.map((d) => [d.date, d.activeMs]));
  const out: number[] = [];
  const base = dayKeyTs(todayKey(now));
  for (let i = 6; i >= 0; i -= 1) {
    const key = localDayKey(base - i * 86400000);
    out.push(byDate.get(key) ?? 0);
  }
  return out;
}

/** Aggregate a range of days + full history into a StatsPayload. */
export function aggregate(
  all: DayRecord[],
  meta: Meta,
  range: RangeKey,
  now = Date.now(),
  uncommitted: number | null = null,
  lastTest: StatsPayload['lastTest'] = null,
  todos: TodoTask[] = [],
): StatsPayload {
  const inRange = selectRange(all, range, now);
  const sortedAll = sortDays(all);
  const tk = todayKey(now);
  const todayRec = sortedAll.find((d) => d.date === tk);

  let activeMs = 0;
  let sessions = 0;
  let sessionDur = 0;
  let switches = 0;
  let errorsSeen = 0;
  const recoveries: number[] = [];
  let testRuns = 0;
  let testPassed = 0;
  let commits = 0;
  const mix = { coding: 0, debugging: 0, testing: 0, git: 0, terminal: 0 };
  const fileTotals = new Map<string, number>();
  const folderTotals = new Map<string, number>();

  for (const d of inRange) {
    activeMs += d.activeMs;
    sessions += d.sessions.length;
    for (const s of d.sessions) { sessionDur += Math.max(0, s.end - s.start); }
    switches += d.switches;
    errorsSeen += d.errors.seen;
    for (const r of d.errors.recoveries) {
      if (recoveries.length < 100) { recoveries.push(r); }
    }
    testRuns += d.tests.runs;
    testPassed += d.tests.passed;
    commits += d.commits;
    (Object.keys(mix) as (keyof typeof mix)[]).forEach((k) => { mix[k] += d.byActivity[k] || 0; });
    for (const [p, ms] of Object.entries(d.files)) { fileTotals.set(p, (fileTotals.get(p) ?? 0) + ms); }
    for (const [f, ms] of Object.entries(d.folders)) { folderTotals.set(f, (folderTotals.get(f) ?? 0) + ms); }
  }

  const totalMs = sortedAll.reduce((a, d) => a + d.activeMs, 0);
  const activeDays = sortedAll.filter((d) => d.activeMs > 0).length;

  const topFiles = [...fileTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, ms]) => ({ path, ms }));
  const folders = [...folderTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => ({ name, ms }));

  const mostActiveFile = topFiles.length > 0 ? topFiles[0].path : null;
  const filesTouched = fileTotals.size;

  const achieved = new Map(meta.milestones.map((m) => [m.id, m.ts]));
  const milestones = (MILESTONE_IDS as readonly string[]).map((id) => ({
    id,
    label: MILESTONE_LABELS[id] ?? id,
    ts: achieved.get(id) ?? null,
  }));

  // ---- tasks (v0.5 todo list; titles/notes never enter the payload) ----
  const todayStr = localDayKey(now);
  const createdByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();
  let tasksOpen = 0;
  let tasksOverdue = 0;
  for (const t of todos) {
    createdByDay.set(localDayKey(t.createdAt), (createdByDay.get(localDayKey(t.createdAt)) ?? 0) + 1);
    if (t.completedAt !== null) {
      const d = localDayKey(t.completedAt);
      completedByDay.set(d, (completedByDay.get(d) ?? 0) + 1);
    }
    if (t.done) { continue; }
    tasksOpen += 1;
    if (t.deadline && t.deadline < todayStr) { tasksOverdue += 1; }
  }
  const tasksDaily = inRange.map((d) => ({
    date: d.date,
    created: createdByDay.get(d.date) ?? 0,
    completed: completedByDay.get(d.date) ?? 0,
  }));

  return {
    range,
    kpis: {
      activeMs,
      sessions,
      avgSessionMs: sessions > 0 ? Math.round(sessionDur / sessions) : 0,
      filesTouched,
      mostActiveFile,
      switches,
      errorsSeen,
      avgRecoveryMs: recoveries.length > 0
        ? Math.round(recoveries.reduce((a, b) => a + b, 0) / recoveries.length)
        : null,
      testRuns,
      passRate: testRuns > 0 ? testPassed / testRuns : null,
      commits,
      totalMs,
      activeDays,
    },
    trend: inRange.map((d) => ({ date: d.date, ms: d.activeMs })),
    hourlyToday: todayRec ? [...todayRec.hourly] : new Array(24).fill(0),
    mix,
    sessionsToday: todayRec ? todayRec.sessions.map((s) => ({ ...s })) : [],
    topFiles,
    folders,
    testsDaily: inRange.map((d) => ({ date: d.date, passed: d.tests.passed, failed: d.tests.failed })),
    errorsDaily: inRange.map((d) => ({ date: d.date, seen: d.errors.seen })),
    commitsDaily: inRange.map((d) => ({ date: d.date, commits: d.commits })),
    tasksDaily,
    tasksOpen,
    tasksOverdue,
    spark7: buildSpark7(sortedAll, now),
    milestones,
    uncommitted,
    lastTest,
    estimated: true as const,
  };
}

/** Keys older than retentionDays (local dates) should be pruned. */
export function keysToPrune(keys: string[], retentionDays: number, now = Date.now()): string[] {
  const cutoff = dayKeyTs(todayKey(now)) - retentionDays * 86400000;
  return keys.filter((k) => {
    if (!k.startsWith(PREFIX) || k === META_KEY) { return false; }
    const date = k.slice(PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { return false; }
    return dayKeyTs(date) < cutoff;
  });
}

/** Minimal memento shape (subset of vscode.Memento) for DI + tests. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void;
}

export class StatsStore {
  private cache = new Map<RangeKey, { at: number; payload: StatsPayload }>();
  private dirty = true;
  private lastTest: StatsPayload['lastTest'] = null;
  private uncommitted: number | null = null;
  private todos: TodoTask[] = [];

  constructor(private readonly state: MementoLike) {}

  invalidate(): void {
    this.dirty = true;
    this.cache.clear();
  }

  setLiveExtras(uncommitted: number | null, lastTest: StatsPayload['lastTest']): void {
    this.uncommitted = uncommitted;
    this.lastTest = lastTest;
    this.cache.clear();
  }

  /** Live todo list snapshot (v0.5) feeding section L. Invalidates the cache. */
  setTodoList(todos: TodoTask[]): void {
    this.todos = todos;
    this.cache.clear();
  }

  getDay(date: string): DayRecord {
    const got = this.state.get<DayRecord>(PREFIX + date);
    if (got && typeof got === 'object' && got.date === date) { return got; }
    return createEmptyDay(date);
  }

  saveDay(day: DayRecord): void {
    // Enforce caps before persisting.
    const files = Object.entries(day.files);
    if (files.length > MAX_FILES_PER_DAY) {
      // Least-recently-attributed eviction is approximated by keeping the
      // highest-ms entries (hot files stay, cold ones drop).
      files.sort((a, b) => b[1] - a[1]);
      day.files = Object.fromEntries(files.slice(0, MAX_FILES_PER_DAY));
    }
    if (day.errors.recoveries.length > MAX_RECOVERIES_PER_DAY) {
      day.errors.recoveries = day.errors.recoveries.slice(-MAX_RECOVERIES_PER_DAY);
    }
    if (day.hourly.length !== 24) {
      const fixed = new Array(24).fill(0);
      for (let i = 0; i < Math.min(24, day.hourly.length); i += 1) { fixed[i] = day.hourly[i]; }
      day.hourly = fixed;
    }
    void this.state.update(PREFIX + day.date, day);
    this.invalidate();
  }

  getMeta(): Meta {
    const got = this.state.get<Meta>(META_KEY);
    if (got && typeof got === 'object') {
      return { firstActivity: got.firstActivity || 0, milestones: Array.isArray(got.milestones) ? got.milestones : [] };
    }
    return createEmptyMeta();
  }

  saveMeta(meta: Meta): void {
    void this.state.update(META_KEY, meta);
    this.invalidate();
  }

  /** Write-once milestone. Returns true when newly achieved. */
  markMilestone(id: string, ts: number): boolean {
    const meta = this.getMeta();
    if (meta.milestones.some((m) => m.id === id)) { return false; }
    meta.milestones.push({ id, ts });
    this.saveMeta(meta);
    return true;
  }

  checkTimeMilestones(totalMs: number, ts: number): string[] {
    const fired: string[] = [];
    const hours = totalMs / 3600000;
    const table: Array<[string, number]> = [['10h', 10], ['50h', 50], ['100h', 100]];
    for (const [id, h] of table) {
      if (hours >= h && this.markMilestone(id, ts)) { fired.push(id); }
    }
    return fired;
  }

  checkCommitMilestones(totalCommits: number, ts: number): string[] {
    const fired: string[] = [];
    if (totalCommits >= 1 && this.markMilestone('first-commit', ts)) { fired.push('first-commit'); }
    if (totalCommits >= 10 && this.markMilestone('10-commits', ts)) { fired.push('10-commits'); }
    if (totalCommits >= 100 && this.markMilestone('100-commits', ts)) { fired.push('100-commits'); }
    return fired;
  }

  allDays(): DayRecord[] {
    // Memento has no key enumeration; callers that need it use VS Code's
    // `keys()` when available. Fall back to scanning a cached index.
    const idx = this.state.get<string[]>('stats:v1:index');
    const days: DayRecord[] = [];
    if (Array.isArray(idx)) {
      for (const date of idx) {
        const d = this.state.get<DayRecord>(PREFIX + date);
        if (d && d.date === date) { days.push(d); }
      }
    }
    return sortDays(days);
  }

  /** Register a day key in the index (Memento has no enumeration). */
  indexDay(date: string): void {
    const idx = this.state.get<string[]>('stats:v1:index');
    const list = Array.isArray(idx) ? [...idx] : [];
    if (!list.includes(date)) {
      list.push(date);
      list.sort();
      void this.state.update('stats:v1:index', list);
    }
  }

  query(range: RangeKey, now = Date.now()): StatsPayload {
    const cached = this.cache.get(range);
    if (cached && !this.dirty) { return cached.payload; }
    const all = this.allDays();
    const payload = aggregate(all, this.getMeta(), range, now, this.uncommitted, this.lastTest, this.todos);
    this.cache.set(range, { at: now, payload });
    this.dirty = false;
    return payload;
  }

  prune(retentionDays: number, now = Date.now()): string[] {
    const idx = this.state.get<string[]>('stats:v1:index');
    if (!Array.isArray(idx)) { return []; }
    const stale = keysToPrune(idx.map((d) => PREFIX + d), retentionDays, now);
    if (stale.length === 0) { return []; }
    const staleDates = new Set(stale.map((k) => k.slice(PREFIX.length)));
    const kept = idx.filter((d) => !staleDates.has(d));
    for (const k of stale) { void this.state.update(k, undefined); }
    void this.state.update('stats:v1:index', kept);
    this.invalidate();
    return stale;
  }

  async reset(): Promise<void> {
    const idx = this.state.get<string[]>('stats:v1:index');
    if (Array.isArray(idx)) {
      for (const d of idx) { await this.state.update(PREFIX + d, undefined); }
    }
    await this.state.update('stats:v1:index', undefined);
    await this.state.update(META_KEY, undefined);
    this.invalidate();
  }
}
