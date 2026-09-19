/**
 * todoStore.ts — workspace TODO list (v0.5).
 *
 * Buckets: today | session | next | someday.
 * Kinds: feature | fix | improvement.
 *
 * Pure list ops are vscode-free so `node --test` can exercise CRUD,
 * validation and completion timestamps without the editor. `TodoStore`
 * persists the list under `todos:v1:list` in workspaceState (per-project).
 */
import type { MementoLike } from './statsStore';

export type TodoBucket = 'session' | 'next' | 'someday';
export type TodoKind = 'feature' | 'fix' | 'improvement';

export interface TodoTask {
  id: string;
  title: string;
  bucket: TodoBucket;
  kind: TodoKind;
  notes: string;
  deadline: string | null; // YYYY-MM-DD local or null
  done: boolean;
  createdAt: number;
  completedAt: number | null;
}

export const TODO_KEY = 'todos:v1:list';
export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;

export const BUCKETS: Array<{ id: TodoBucket; label: string }> = [
  { id: 'session', label: 'This session' },
  { id: 'next', label: 'Next up' },
  { id: 'someday', label: 'Someday' },
];

export const KINDS: Array<{ id: TodoKind; label: string; badge: string }> = [
  { id: 'feature', label: 'Feature', badge: 'FEAT' },
  { id: 'fix', label: 'Fix', badge: 'FIX' },
  { id: 'improvement', label: 'Improvement', badge: 'IMPR' },
];

export function isBucket(v: unknown): v is TodoBucket {
  return v === 'session' || v === 'next' || v === 'someday';
}

export function isKind(v: unknown): v is TodoKind {
  return v === 'feature' || v === 'fix' || v === 'improvement';
}

export function isDeadline(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) { return false; }
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function localDayKey(ts: number): string {
  const dt = new Date(ts);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function makeId(now: number, rand: () => number = Math.random): string {
  return `${now.toString(36)}-${Math.floor(rand() * 0xffffffff).toString(36)}`;
}

export interface TodoInput {
  title: unknown;
  bucket?: unknown;
  kind?: unknown;
  notes?: unknown;
  deadline?: unknown;
}

/** Normalize + validate webview input. Throws on invalid title. */
export function normalizeInput(input: TodoInput, now: number, rand?: () => number): TodoTask {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) { throw new Error('Title is required.'); }
  if (title.length > MAX_TITLE) { throw new Error(`Title must be ≤ ${MAX_TITLE} characters.`); }
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, MAX_NOTES) : '';
  const deadline = isDeadline(input.deadline) ? (input.deadline as string) : null;
  return {
    id: makeId(now, rand),
    title,
    bucket: isBucket(input.bucket) ? input.bucket : 'session',
    kind: isKind(input.kind) ? input.kind : 'feature',
    notes,
    deadline,
    done: false,
    createdAt: now,
    completedAt: null,
  };
}

export interface TodoPatch {
  title?: unknown;
  bucket?: unknown;
  kind?: unknown;
  notes?: unknown;
  deadline?: unknown;
}

function applyPatch(task: TodoTask, patch: TodoPatch): TodoTask | null {
  let changed = false;
  const next = { ...task };
  if (patch.title !== undefined) {
    const t = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (!t || t.length > MAX_TITLE) { return null; }
    if (t !== next.title) { next.title = t; changed = true; }
  }
  if (patch.bucket !== undefined) {
    if (!isBucket(patch.bucket)) { return null; }
    if (patch.bucket !== next.bucket) { next.bucket = patch.bucket; changed = true; }
  }
  if (patch.kind !== undefined) {
    if (!isKind(patch.kind)) { return null; }
    if (patch.kind !== next.kind) { next.kind = patch.kind; changed = true; }
  }
  if (patch.notes !== undefined) {
    const n = typeof patch.notes === 'string' ? patch.notes.trim().slice(0, MAX_NOTES) : '';
    if (n !== next.notes) { next.notes = n; changed = true; }
  }
  if (patch.deadline !== undefined) {
    if (patch.deadline !== null && !isDeadline(patch.deadline)) { return null; }
    const d = (patch.deadline as string) ?? null;
    if (d !== next.deadline) { next.deadline = d; changed = true; }
  }
  void changed;
  return next;
}

function sanitize(raw: unknown): TodoTask[] {
  if (!Array.isArray(raw)) { return []; }
  const out: TodoTask[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') { continue; }
    const r = t as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || typeof r['title'] !== 'string') { continue; }
    // v0.5 migration: legacy 'today' bucket merges into 'session'.
    const bucket = r['bucket'] === 'today' ? 'session' : r['bucket'];
    if (!isBucket(bucket) || !isKind(r['kind'])) { continue; }
    out.push({
      id: r['id'] as string,
      title: (r['title'] as string).slice(0, MAX_TITLE),
      bucket: bucket as TodoBucket,
      kind: r['kind'] as TodoKind,
      notes: typeof r['notes'] === 'string' ? (r['notes'] as string).slice(0, MAX_NOTES) : '',
      deadline: isDeadline(r['deadline']) ? (r['deadline'] as string) : null,
      done: r['done'] === true,
      createdAt: typeof r['createdAt'] === 'number' ? r['createdAt'] as number : 0,
      completedAt: typeof r['completedAt'] === 'number' ? r['completedAt'] as number : null,
    });
  }
  return out;
}

export function isOverdue(task: TodoTask, now: number): boolean {
  if (task.done || !task.deadline) { return false; }
  return task.deadline < localDayKey(now);
}

export interface TodoSummary {
  open: number;
  done: number;
  overdue: number;
  byBucket: Record<TodoBucket, number>;
}

export function summarize(list: TodoTask[], now: number): TodoSummary {
  const byBucket: Record<TodoBucket, number> = { session: 0, next: 0, someday: 0 };
  let open = 0;
  let done = 0;
  let overdue = 0;
  for (const t of list) {
    byBucket[t.bucket] += 1;
    if (t.done) { done += 1; } else { open += 1; }
    if (isOverdue(t, now)) { overdue += 1; }
  }
  return { open, done, overdue, byBucket };
}

/** Per-day created/completed counts for a fixed date axis (dashboard L). */
export function completionsDaily(list: TodoTask[], dates: string[]): Array<{ date: string; created: number; completed: number }> {
  const created = new Map<string, number>();
  const completed = new Map<string, number>();
  for (const t of list) {
    const c = localDayKey(t.createdAt);
    created.set(c, (created.get(c) ?? 0) + 1);
    if (t.completedAt !== null) {
      const d = localDayKey(t.completedAt);
      completed.set(d, (completed.get(d) ?? 0) + 1);
    }
  }
  return dates.map((date) => ({
    date,
    created: created.get(date) ?? 0,
    completed: completed.get(date) ?? 0,
  }));
}

export class TodoStore {
  constructor(
    private readonly state: MementoLike,
    private readonly onChange: () => void = () => undefined,
  ) {}

  getAll(): TodoTask[] {
    return sanitize(this.state.get<unknown>(TODO_KEY));
  }

  private persist(list: TodoTask[]): void {
    void this.state.update(TODO_KEY, list);
    try { this.onChange(); } catch { /* listeners are best-effort */ }
  }

  add(input: TodoInput, now = Date.now()): TodoTask {
    const task = normalizeInput(input, now);
    const list = this.getAll();
    list.unshift(task);
    this.persist(list);
    return task;
  }

  update(id: string, patch: TodoPatch): TodoTask | null {
    const list = this.getAll();
    const i = list.findIndex((t) => t.id === id);
    if (i === -1) { return null; }
    const next = applyPatch(list[i], patch);
    if (!next) { return null; }
    list[i] = next;
    this.persist(list);
    return next;
  }

  toggle(id: string, now = Date.now()): TodoTask | null {
    const list = this.getAll();
    const i = list.findIndex((t) => t.id === id);
    if (i === -1) { return null; }
    const next = { ...list[i], done: !list[i].done };
    next.completedAt = next.done ? now : null;
    list[i] = next;
    this.persist(list);
    return next;
  }

  move(id: string, bucket: unknown): TodoTask | null {
    if (!isBucket(bucket)) { return null; }
    return this.update(id, { bucket });
  }

  remove(id: string): boolean {
    const list = this.getAll();
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) { return false; }
    this.persist(next);
    return true;
  }

  /** Delete all completed tasks. Returns the removed count. */
  clearCompleted(): number {
    const list = this.getAll();
    const next = list.filter((t) => !t.done);
    const removed = list.length - next.length;
    if (removed > 0) { this.persist(next); }
    return removed;
  }
}
