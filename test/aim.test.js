'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const aim = require('../media/shared/aim');

describe('aim: dead zone settles to center', () => {
  it('offsets under 70px return center', () => {
    assert.deepEqual(aim.nextDirection(-1, 10, 10), { sector: -1, direction: 'center' });
    assert.deepEqual(aim.nextDirection(0, 0, 0), { sector: -1, direction: 'center' });
  });
  it('offsets beyond the dead zone pick a sector', () => {
    assert.equal(aim.nextDirection(-1, 200, 0).direction, 'right');
    assert.equal(aim.nextDirection(-1, 0, 200).direction, 'down');
    assert.equal(aim.nextDirection(-1, -200, 0).direction, 'left');
    assert.equal(aim.nextDirection(-1, 0, -200).direction, 'up');
  });
});

describe('aim: eight sectors + hysteresis', () => {
  it('covers all eight compass points', () => {
    const seen = new Set();
    const pts = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    for (const [x, y] of pts) { seen.add(aim.nextDirection(-1, x * 500, y * 500).direction); }
    assert.equal(seen.size, 8);
  });
  it('holds the previous sector near a boundary (no flicker)', () => {
    const first = aim.nextDirection(-1, 500, 5);
    const held = aim.nextDirection(first.sector, 500, 60);
    assert.equal(held.sector, first.sector);
  });
});

describe('aim: stateful aimer', () => {
  it('tracks, holds and resets', () => {
    const a = aim.createAimer();
    assert.equal(a.direction, 'center');
    a.update(300, 0);
    assert.equal(a.direction, 'right');
    a.update(5, 5);
    assert.equal(a.direction, 'center');
    a.update(-300, 0);
    assert.equal(a.direction, 'left');
    a.reset();
    assert.equal(a.direction, 'center');
  });
});
