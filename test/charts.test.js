'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const charts = require('../media/analytics/charts');

describe('charts: svg contract', () => {
  it('barChart has role=img + title tooltips', () => {
    const svg = charts.barChart(
      [{ date: '4 Mar', ms: 3600000, tip: '3.6h · Tue 4 Mar' }, { date: '5 Mar', ms: 1800000 }],
      { label: 'Trend' },
    );
    assert.ok(svg.includes('role="img"'));
    assert.ok(svg.includes('<title>'));
    assert.ok(svg.includes('aria-label'));
  });
  it('hBarChart renders rows with tooltips', () => {
    const svg = charts.hBarChart([{ label: 'Coding', ms: 1000, pct: 50 }], { label: 'Mix' });
    assert.ok(svg.includes('role="img"') && svg.includes('<title>'));
  });
  it('stackedBar renders pass/fail groups', () => {
    const svg = charts.stackedBar([{ date: '2026-03-10', passed: 3, failed: 1 }], { label: 'Tests' });
    assert.ok(svg.includes('<title>2026-03-10'));
  });
  it('lineChart has circles + labels', () => {
    const svg = charts.lineChart([1, 4, 2], { label: 'Switches', labels: ['a', 'b', 'c'] });
    assert.ok(svg.includes('<circle') && svg.includes('aria-label="Switches"'));
  });
  it('timelineStrip tooltips show times', () => {
    const t0 = new Date(2026, 2, 10, 9, 12).getTime();
    const svg = charts.timelineStrip([{ start: t0, end: t0 + 51 * 60000 }], { label: 'Sessions' });
    assert.ok(svg.includes('09:12'));
  });
  it('empty state is a dashed box, never a takeover', () => {
    for (const fn of [() => charts.barChart([], {}), () => charts.hBarChart([], {}),
      () => charts.stackedBar([], {}), () => charts.lineChart([0, 0], {}),
      () => charts.timelineStrip([], {})]) {
      const out = fn();
      assert.ok(out.includes('No data yet. Keep coding.'));
    }
  });
  it('fmtDuration shared formatter', () => {
    assert.equal(charts.fmtDuration(42 * 60000), '42m');
    assert.equal(charts.fmtDuration(3 * 3600000 + 42 * 60000), '3h 42m');
  });
});
