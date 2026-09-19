'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  TodoStore,
  normalizeInput,
  isBucket,
  isKind,
  isDeadline,
  isOverdue,
  summarize,
  completionsDaily,
} = require('../out/todoStore');

function mem(initial = {}) {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    update: (k, v) => { if (v === undefined) { delete data[k]; } else { data[k] = v; } },
    _data: data,
  };
}

describe('todoStore: validation', () => {
  it('rejects empty titles', () => {
    assert.throws(() => normalizeInput({ title: '   ' }, 1000), /Title is required/);
    assert.throws(() => normalizeInput({}, 1000), /Title is required/);
  });
  it('rejects overlong titles, trims + caps notes', () => {
    assert.throws(() => normalizeInput({ title: 'x'.repeat(201) }, 1000), /≤ 200/);
    const t = normalizeInput({ title: ' ok ', notes: 'y'.repeat(5000) }, 1000);
    assert.equal(t.title, 'ok');
    assert.equal(t.notes.length, 2000);
  });
  it('defaults bucket/kind, drops bad deadlines', () => {
    const t = normalizeInput({ title: 'a', bucket: 'nope', kind: 'nope', deadline: 'tomorrow' }, 1000);
    assert.equal(t.bucket, 'session');
    assert.equal(t.kind, 'feature');
    assert.equal(t.deadline, null);
  });
  it('accepts a real deadline, rejects impossible dates', () => {
    assert.equal(isDeadline('2026-03-04'), true);
    assert.equal(isDeadline('2026-02-30'), false);
    assert.equal(isDeadline('tomorrow'), false);
    assert.equal(isBucket('session'), true);
    assert.equal(isKind('fix'), true);
  });
});

describe('todoStore: CRUD + toggle timestamps', () => {
  it('add/update/move/remove round-trip', () => {
    const s = new TodoStore(mem({}));
    const a = s.add({ title: 'Ship it', bucket: 'session', kind: 'fix' }, 1000);
    assert.equal(a.done, false);
    assert.equal(a.completedAt, null);
    assert.equal(s.update(a.id, { title: 'Ship it now', notes: 'n', deadline: '2026-03-05' }).title, 'Ship it now');
    assert.equal(s.update(a.id, { title: '' }), null); // invalid patch rejected
    assert.equal(s.move(a.id, 'next').bucket, 'next');
    assert.equal(s.move(a.id, 'nope'), null);
    assert.equal(s.remove(a.id), true);
    assert.equal(s.remove(a.id), false);
  });
  it('toggle stamps completedAt, reopening clears it', () => {
    const s = new TodoStore(mem({}));
    const a = s.add({ title: 't' }, 1000);
    assert.equal(s.toggle(a.id, 2000).completedAt, 2000);
    const back = s.toggle(a.id, 3000);
    assert.equal(back.done, false);
    assert.equal(back.completedAt, null);
  });
  it('sanitizes corrupt storage', () => {
    const s = new TodoStore(mem({ 'todos:v1:list': [{ nope: 1 }, 'x', { id: '1', title: 'ok', bucket: 'session', kind: 'fix' }] }));
    assert.deepEqual(s.getAll().map((t) => t.id), ['1']);
  });
  it('migrates the legacy today bucket into this session', () => {
    const s = new TodoStore(mem({ 'todos:v1:list': [{ id: '1', title: 'old', bucket: 'today', kind: 'fix' }] }));
    const all = s.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].bucket, 'session');
  });
  it('clearCompleted removes only done tasks', () => {
    const s = new TodoStore(mem({}));
    const a = s.add({ title: 'a' }, 1);
    s.add({ title: 'b' }, 2);
    s.toggle(a.id, 3);
    assert.equal(s.clearCompleted(), 1);
    assert.deepEqual(s.getAll().map((t) => t.title), ['b']);
    assert.equal(s.clearCompleted(), 0);
  });
});

describe('todoStore: overdue + summary + daily completions', () => {
  it('flags past deadlines, ignores done/future', () => {
    const now = new Date(2026, 2, 10, 12).getTime();
    const s = new TodoStore(mem({}));
    const past = s.add({ title: 'late', deadline: '2026-03-01' }, 1);
    const future = s.add({ title: 'later', deadline: '2026-04-01' }, 2);
    const nodate = s.add({ title: 'any' }, 3);
    assert.equal(isOverdue(past, now), true);
    assert.equal(isOverdue(future, now), false);
    assert.equal(isOverdue(nodate, now), false);
    const doneLate = s.toggle(past.id, now);
    assert.equal(isOverdue(doneLate, now), false);
    const sum = summarize(s.getAll(), now);
    assert.equal(sum.open, 2);
    assert.equal(sum.done, 1);
    assert.equal(sum.overdue, 0);
  });
  it('completionsDaily buckets created/completed by local day', () => {
    const d1 = new Date(2026, 2, 9, 10).getTime();
    const d2 = new Date(2026, 2, 10, 10).getTime();
    const s = new TodoStore(mem({}));
    const a = s.add({ title: 'a' }, d1);
    s.add({ title: 'b' }, d2);
    s.toggle(a.id, d2);
    const rows = completionsDaily(s.getAll(), ['2026-03-09', '2026-03-10']);
    assert.deepEqual(rows, [
      { date: '2026-03-09', created: 1, completed: 0 },
      { date: '2026-03-10', created: 1, completed: 1 },
    ]);
  });
});
