'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyDay,
  localDayKey,
  selectRange,
  aggregate,
  keysToPrune,
  StatsStore,
  MAX_FILES_PER_DAY,
} = require('../out/statsStore');

function mem(initial = {}) {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    update: (k, v) => { if (v === undefined) { delete data[k]; } else { data[k] = v; } },
    _data: data,
  };
}
function day(date, patch = {}) {
  return { ...createEmptyDay(date), ...patch };
}

describe('statsStore: day keys + rollover', () => {
  it('localDayKey formats local YYYY-MM-DD', () => {
    const d = new Date(2026, 2, 4, 12, 0, 0); // 4 Mar 2026 local
    assert.equal(localDayKey(d.getTime(), d), '2026-03-04');
  });
  it('selectRange slices today/7d/30d/all', () => {
    const now = new Date(2026, 2, 10, 12).getTime();
    const days = [];
    for (let i = 0; i < 40; i += 1) {
      const ts = now - i * 86400000;
      days.push(day(localDayKey(ts), { activeMs: 1000 }));
    }
    assert.equal(selectRange(days, 'today', now).length, 1);
    assert.equal(selectRange(days, '7d', now).length, 7);
    assert.equal(selectRange(days, '30d', now).length, 30);
    assert.equal(selectRange(days, 'all', now).length, 40);
  });
});

describe('statsStore: range aggregation + null-safe averages', () => {
  it('sums kpis and nulls empty recovery/pass-rate', () => {
    const a = day('2026-03-09', {
      activeMs: 3600000, sessions: [{ start: 1, end: 61 }], switches: 2,
      errors: { seen: 3, recoveries: [] }, tests: { runs: 0, passed: 0, failed: 0 },
      commits: 1, byActivity: { coding: 3600000, debugging: 0, testing: 0, git: 0, terminal: 0 },
      files: { 'src/a.ts': 1000 }, folders: { src: 1000 }, hourly: new Array(24).fill(0),
    });
    const b = day('2026-03-10', {
      activeMs: 1800000, sessions: [{ start: 10, end: 70 }, { start: 80, end: 140 }], switches: 1,
      errors: { seen: 1, recoveries: [60000, 120000] }, tests: { runs: 4, passed: 3, failed: 1 },
      commits: 2, byActivity: { coding: 1000000, debugging: 800000, testing: 0, git: 0, terminal: 0 },
      files: { 'src/a.ts': 500, 'src/b.ts': 1500 }, folders: { src: 2000 }, hourly: new Array(24).fill(0),
    });
    const p = aggregate([a, b], { firstActivity: 1, milestones: [] }, 'all', new Date(2026, 2, 10, 12).getTime());
    assert.equal(p.kpis.activeMs, 5400000);
    assert.equal(p.kpis.sessions, 3);
    assert.equal(p.kpis.switches, 3);
    assert.equal(p.kpis.errorsSeen, 4);
    assert.equal(p.kpis.avgRecoveryMs, 90000);
    assert.equal(p.kpis.testRuns, 4);
    assert.equal(p.kpis.passRate, 0.75);
    assert.equal(p.kpis.commits, 3);
    assert.equal(p.kpis.filesTouched, 2);
    assert.equal(p.kpis.mostActiveFile, 'src/a.ts');
    assert.equal(p.topFiles.length, 2);
    assert.equal(p.estimated, true);
  });
  it('null-safe when empty', () => {
    const p = aggregate([], { firstActivity: 0, milestones: [] }, 'all');
    assert.equal(p.kpis.avgRecoveryMs, null);
    assert.equal(p.kpis.passRate, null);
    assert.equal(p.kpis.mostActiveFile, null);
    assert.equal(p.kpis.avgSessionMs, 0);
  });
});

describe('statsStore: prune / reset / caps', () => {
  it('keysToPrune drops keys older than retentionDays', () => {
    const now = new Date(2026, 2, 10, 12).getTime();
    const keys = ['stats:v1:2026-03-01', 'stats:v1:2026-03-09', 'stats:v1:2026-03-10', 'stats:v1:meta'];
    const pruned = keysToPrune(keys, 7, now);
    assert.deepEqual(pruned, ['stats:v1:2026-03-01']);
  });
  it('reset deletes all keys', async () => {
    const m = mem({
      'stats:v1:2026-03-10': day('2026-03-10'),
      'stats:v1:index': ['2026-03-10'],
      'stats:v1:meta': { firstActivity: 1, milestones: [] },
    });
    const s = new StatsStore(m);
    await s.reset();
    assert.equal(m._data['stats:v1:2026-03-10'], undefined);
    assert.equal(m._data['stats:v1:meta'], undefined);
  });
  it('caps files at 500/day keeping hottest', () => {
    const m = mem({});
    const s = new StatsStore(m);
    const d = createEmptyDay('2026-03-10');
    for (let i = 0; i < 600; i += 1) { d.files[`f${i}.ts`] = i; }
    s.saveDay(d);
    assert.equal(Object.keys(m._data['stats:v1:2026-03-10'].files).length, MAX_FILES_PER_DAY);
    assert.ok(m._data['stats:v1:2026-03-10'].files['f599.ts'] === 599);
  });
  it('recoveries capped at 100, oldest dropped', () => {
    const m = mem({});
    const s = new StatsStore(m);
    const d = createEmptyDay('2026-03-10');
    d.errors.recoveries = Array.from({ length: 150 }, (_, i) => i);
    s.saveDay(d);
    const saved = m._data['stats:v1:2026-03-10'].errors.recoveries;
    assert.equal(saved.length, 100);
    assert.equal(saved[0], 50);
  });
  it('milestones are write-once', () => {
    const m = mem({});
    const s = new StatsStore(m);
    assert.equal(s.markMilestone('first-session', 100), true);
    assert.equal(s.markMilestone('first-session', 200), false);
    assert.deepEqual(s.getMeta().milestones, [{ id: 'first-session', ts: 100 }]);
  });
});
