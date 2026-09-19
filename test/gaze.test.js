'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const controller = require('../media/shared/mascotController');

const fakeSprite = {
  CENTER: 'center',
  directionIndex: () => 0,
  positionOf: () => '0% 0%',
  isDirection: (d) => typeof d === 'string' && d.length > 0,
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setup() {
  // Use real clock (Date.now) so settle/hold timings reflect actual elapsed time.
  const ctl = controller.create(
    { sprite: fakeSprite, reactions: {}, characters: null },
    {},
  );
  ctl.setSettings({ enabled: true, characterId: 'fox', size: 72, clickReaction: true, autoReaction: true, followPointer: true });
  return ctl;
}

describe('gaze: calmer schedule (throttle + debounce)', () => {
  it('turns after settleMs, not instantly', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    assert.equal(ctl.gaze, null); // not yet, throttled
    await delay(320);
    assert.equal(ctl.gaze, 'right');
    ctl.dispose();
  });

  it('throttles rapid turns (trailing target wins)', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    // quickly retarget before the first turn fires
    await delay(50);
    ctl.setGaze('left');
    await delay(320);
    // trailing wins: the late 'left' was remembered
    assert.equal(ctl.gaze, 'left');
    ctl.dispose();
  });

  it('holds one direction for at least holdMs before the next turn', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    await delay(320);
    assert.equal(ctl.gaze, 'right');
    // second turn requested immediately after first committed — must wait holdMs
    ctl.setGaze('left');
    assert.equal(ctl.gaze, 'right'); // still held
    await delay(600);
    assert.equal(ctl.gaze, 'right'); // hold not elapsed yet (900ms from first commit)
    await delay(400);
    assert.equal(ctl.gaze, 'left');
    ctl.dispose();
  });

  it('debounces returning to face-on (centerSettleMs)', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    await delay(320);
    assert.equal(ctl.gaze, 'right');
    ctl.setGaze('center');
    assert.equal(ctl.gaze, 'right'); // debounce: still looking away
    await delay(800);
    assert.equal(ctl.gaze, 'right');
    await delay(800);
    assert.equal(ctl.gaze, null);
    ctl.dispose();
  });

  it('mouseleave returns to face-on after leaveDelayMs', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    await delay(320);
    assert.equal(ctl.gaze, 'right');
    ctl.clearGaze(); // mouseleave, gently
    assert.equal(ctl.gaze, 'right');
    await delay(1300);
    assert.equal(ctl.gaze, null);
    ctl.dispose();
  });

  it('immediate clear is still immediate', async () => {
    const ctl = setup();
    ctl.setGaze('right');
    await delay(320);
    ctl.clearGaze(true);
    assert.equal(ctl.gaze, null);
    ctl.dispose();
  });

  it('followPointer=false ignores gaze', () => {
    const ctl = setup();
    ctl.setSettings({ enabled: true, characterId: 'fox', size: 72, followPointer: false });
    ctl.setGaze('right');
    assert.equal(ctl.gaze, null);
    ctl.dispose();
  });
});
