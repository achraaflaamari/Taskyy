'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Tracker } = require('../out/tracker');
const { StatsStore, createEmptyDay } = require('../out/statsStore');

function setup(nowRef = { t: 1_000_000 }, opts = {}) {
  const data = {};
  const memento = {
    get: (k) => data[k],
    update: (k, v) => { if (v === undefined) { delete data[k]; } else { data[k] = v; } },
  };
  const store = new StatsStore(memento);
  const milestones = [];
  const tracker = new Tracker(store, {
    enabled: true,
    idleSeconds: 120,
    trackFiles: true,
    getNow: () => nowRef.t,
    ...opts,
  }, { onMilestone: (id, ts) => milestones.push({ id, ts }) });
  return { tracker, store, data, milestones, nowRef };
}

describe('tracker: idle stops credit', () => {
  it('credits when active, nothing when past idleSeconds', () => {
    const { tracker, store } = setup();
    let t = 1_000_000;
    tracker.noteActivity('typing', t);
    // 5 s later, still active → credit ~5000
    t += 5000;
    const got = tracker.tick(t, { fileRel: 'src/a.ts' });
    assert.equal(got, 5000);
    const day = store.getDay('1970-01-01');
    void day;
    assert.ok(store.allDays().reduce((a, d) => a + d.activeMs, 0) === 5000);
    // 10 minutes later → idle, credits nothing
    t += 600_000;
    const got2 = tracker.tick(t, { fileRel: 'src/a.ts' });
    assert.equal(got2, 0);
    assert.ok(store.allDays().reduce((a, d) => a + d.activeMs, 0) === 5000);
  });
  it('quantum is min(5s, now-lastTick)', () => {
    const { tracker } = setup();
    let t = 2_000_000;
    tracker.noteActivity('typing', t);
    tracker.tick(t + 5000); // seed lastTick
    assert.equal(tracker.tick(t + 5000 + 2000), 2000);
  });
});

describe('tracker: session split on idleSeconds', () => {
  it('closes session at lastActivityTs and opens a new one after gap', () => {
    const { tracker, store } = setup();
    const t0 = 5_000_000;
    tracker.noteActivity('typing', t0);
    tracker.tick(t0 + 5000);
    // Gap > idleSeconds: tick closes the session
    tracker.tick(t0 + 5000 + 200_000);
    // New activity opens a second session
    tracker.noteActivity('typing', t0 + 5000 + 200_001);
    tracker.tick(t0 + 5000 + 200_001 + 5000);
    // Force-close the open session with an idle tick
    tracker.tick(t0 + 5000 + 200_001 + 5000 + 200_000);
    const days = store.allDays();
    const sessions = days.flatMap((d) => d.sessions);
    assert.equal(sessions.length, 2);
    assert.ok(sessions[0].end <= sessions[1].start);
  });
  it('short sessions (<60s) are still recorded', () => {
    const { tracker, store } = setup();
    const t0 = 9_000_000;
    tracker.noteActivity('typing', t0);
    tracker.tick(t0 + 130_000); // forces close at t0
    const sessions = store.allDays().flatMap((d) => d.sessions);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].end - sessions[0].start, 0);
  });
});

describe('tracker: attribution to files/folders/hourly', () => {
  it('attributes ms to file + folder + hour', () => {
    const { tracker, store } = setup();
    const t0 = new Date(2026, 2, 10, 9, 30).getTime();
    tracker.noteActivity('typing', t0);
    tracker.tick(t0 + 5000, { fileRel: 'src/app.ts' });
    const days = store.allDays();
    assert.equal(days.length, 1);
    assert.equal(days[0].files['src/app.ts'], 5000);
    assert.equal(days[0].folders['src'], 5000);
    assert.equal(days[0].hourly[9], 5000);
  });
  it('skips attribution for ignored paths but still counts time', () => {
    const { tracker, store } = setup();
    const t0 = new Date(2026, 2, 10, 10).getTime();
    tracker.noteActivity('typing', t0);
    tracker.tick(t0 + 5000, { fileRel: 'node_modules/x.js' });
    const days = store.allDays();
    assert.equal(days[0].activeMs, 5000);
    assert.deepEqual(days[0].files, {});
  });
  it('trackFiles=false keeps folders only', () => {
    const { tracker, store } = setup({ t: 1_000_000 }, { trackFiles: false });
    const t0 = 3_000_000;
    tracker.noteActivity('typing', t0);
    tracker.tick(t0 + 5000, { fileRel: 'src/app.ts' });
    const days = store.allDays();
    assert.deepEqual(days[0].files, {});
    assert.equal(days[0].folders['src'], 5000);
  });
});

describe('tracker: errors + tests + midnight split', () => {
  it('seen grows by positive delta; recovery pushed on →0', () => {
    const { tracker, store } = setup();
    const t0 = 20_000_000;
    tracker.noteErrors(0, t0);
    tracker.noteErrors(3, t0 + 1000);
    tracker.noteErrors(5, t0 + 2000);
    tracker.noteErrors(0, t0 + 62000);
    const days = store.allDays();
    const seen = days.reduce((a, d) => a + d.errors.seen, 0);
    assert.equal(seen, 5);
    const recs = days.flatMap((d) => d.errors.recoveries);
    assert.equal(recs.length, 1);
    assert.ok(recs[0] >= 60000);
  });
  it('midnight sessions split at 00:00', () => {
    const { tracker, store } = setup();
    // 23:59:55 activity, tick at 00:00:05 next day
    const d1 = new Date(2026, 2, 10, 23, 59, 55).getTime();
    tracker.noteActivity('typing', d1);
    tracker.tick(d1 + 10_000, { fileRel: 'src/a.ts' });
    const days = store.allDays();
    assert.ok(days.length >= 1);
    const total = days.reduce((a, d) => a + d.activeMs, 0);
    assert.equal(total, 5000);
  });
});

describe('tracker: analytics.enabled=false writes nothing', () => {
  it('drops activity, ticks, commits, tests and errors', () => {
    const { tracker, store } = setup({ t: 1_000_000 }, { enabled: false });
    tracker.noteActivity('typing', 1_000_000);
    assert.equal(tracker.tick(1_005_000, { fileRel: 'src/a.ts' }), 0);
    tracker.noteCommit(1_006_000);
    tracker.noteTestResult(true, 'npm test', 1_007_000);
    tracker.noteErrors(3, 1_008_000);
    assert.deepEqual(store.allDays(), []);
  });
});
