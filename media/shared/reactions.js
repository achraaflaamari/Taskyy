/**
 * When the mascot pulls a face.
 *
 * Three cases, all decided here as pure functions so they can be tested
 * without a browser:
 *
 * 1. a boop (click)  -> planBoop, mirrors the upstream click sequence
 * 2. an idle moment  -> createIdlePlanner, our own "reacts on its own" mode
 * 3. the greeting    -> GREET, played once shortly after the mascot appears
 */
(function (root, factory) {
  const sprite = typeof require === 'function' ? require('../shared/sprite.js') : root.MascotSprite
  const api = factory(sprite)
  root.MascotReactions = api
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
})(globalThis, function (sprite) {
  'use strict'

  /** Upstream timing, in milliseconds, from the click to the face settling back. */
  const BOOP_PAYOFF = 120
  const BOOP_END = 560
  const DIZZY_AFTER = 4
  const DIZZY_WINDOW = 1600
  const DIZZY_END = 1100

  /** Which expression a single boop lands on, cycled so repeated boops vary. */
  const PAYOFFS = ['heart', 'sparkle', 'delighted']

  const SQUASH_MS = 420

  /**
   * Per-keyframe easing with a linear effect: an easing on the effect itself
   * would reinterpret every offset and front-load the bounce.
   */
  const SQUASH = [
    { transform: 'scale(1, 1)', easing: 'ease-in' },
    { transform: 'scale(1.10, 0.86)', offset: 0.18, easing: 'ease-out' },
    { transform: 'scale(0.95, 1.08)', offset: 0.45, easing: 'ease-in-out' },
    { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
    { transform: 'scale(1, 1)' },
  ]

  /** Expressions the idle planner can pick from, and how long each is held. */
  const AWAKE = ['heart', 'sparkle', 'delighted', 'starstruck', 'bashful', 'surprised']

  const IDLE = {
    /** Silence after the last pointer move before the mascot starts reacting. */
    idleAfterMs: 6000,
    /** Gap between two idle reactions, picked at random inside this range. */
    minGapMs: 6000,
    maxGapMs: 12000,
    durationMs: 700,
    /** Once the page has been quiet this long, it drifts off instead. */
    sleepyAfterMs: 30000,
    sleepyReaction: 'sleepy',
    sleepyDurationMs: 1100,
    sleepyGapMs: 10000,
    /**
     * Five minutes of quiet is a deep sleep: a sticky `sleepy` face
     * (durationMs 0 = never auto-clears) that only direct interaction
     * (click, drag, keyboard nudge) wakes. Pointer movement does not.
     */
    deepSleepAfterMs: 5 * 60 * 1000,
    /** How often the mascot checks the clock. */
    tickMs: 400,
  }

  const GREET = { reaction: 'delighted', afterMs: 800, durationMs: 900 }

  /**
   * Study focus choreography (additive: never alters boop/idle/greeting).
   *
   * Every GLANCE_EVERY_MS of focus the mascot checks the timer below it and
   * looks back at the camera, three times, then smiles. While the cycle waits
   * for the user (`awaitBreak` / `awaitNext`) the mascot holds a dizzy face
   * until the click lands. All timelines are pure data; the mascot only
   * schedules them.
   */
  const STUDY_GLANCE = {
    everyMs: 5 * 60 * 1000,
    /** How long the head holds on the timer (down) and on the camera. */
    downMs: 450,
    cameraMs: 450,
    repeats: 3,
    smile: 'delighted',
    smileMs: 900,
  }

  /**
   * Head + face timeline for one glance: alternate `down` (the timer) and
   * `center` (the camera), then smile. Offsets are ms from sequence start.
   */
  function glanceTimeline() {
    const steps = []
    const stride = STUDY_GLANCE.downMs + STUDY_GLANCE.cameraMs
    for (let i = 0; i < STUDY_GLANCE.repeats; i += 1) {
      steps.push({ at: i * stride, direction: 'down' })
      steps.push({ at: i * stride + STUDY_GLANCE.downMs, direction: 'center' })
    }
    const smileAt = STUDY_GLANCE.repeats * stride
    steps.push({ at: smileAt, reaction: STUDY_GLANCE.smile })
    steps.push({ at: smileAt + STUDY_GLANCE.smileMs, reaction: null })
    return steps
  }

  function glanceDurationMs() {
    const last = glanceTimeline().pop()
    return last.at
  }

  /** Celebration when the whole cycle completes: sparkle -> heart -> delighted. */
  function celebrationTimeline() {
    return [
      { at: 0, reaction: 'sparkle' },
      { at: 350, reaction: 'heart' },
      { at: 700, reaction: 'delighted' },
      { at: 1600, reaction: null },
    ]
  }

  const EMPTY_BOOP_STATE = { count: 0, at: -Infinity }

  /**
   * The click sequence. Returns the new counter state plus the expression
   * timeline as offsets from the click, so the caller only schedules timers.
   *
   * @param {{count: number, at: number}} state previous state (see EMPTY_BOOP_STATE)
   * @param {number} now Date.now() of this boop
   */
  function planBoop(state, now) {
    const previous = state && typeof state.count === 'number' ? state : EMPTY_BOOP_STATE
    const rapid = now - previous.at < DIZZY_WINDOW
    const count = rapid ? previous.count + 1 : 1

    if (count >= DIZZY_AFTER) {
      return {
        next: { count: 0, at: now },
        dizzy: true,
        steps: [
          { at: 0, reaction: 'dizzy' },
          { at: DIZZY_END, reaction: null },
        ],
      }
    }

    return {
      next: { count: count, at: now },
      dizzy: false,
      steps: [
        { at: 0, reaction: 'blink' },
        { at: BOOP_PAYOFF, reaction: PAYOFFS[(count - 1) % PAYOFFS.length] },
        { at: BOOP_END, reaction: null },
      ],
    }
  }

  /**
   * The idle scheduler. It is driven by `tick(now)` calls rather than its own
   * timers, so there is nothing to leak and tests can fast-forward freely.
   *
   * @param {{config?: object, random?: () => number}} [options]
   */
  function createIdlePlanner(options) {
    const supplied = options || {}
    const config = Object.assign({}, IDLE, supplied.config)
    const random = supplied.random || Math.random

    let lastActivity = null
    let nextAt = null
    let armed = false
    let hidden = false

    function gap() {
      return config.minGapMs + random() * (config.maxGapMs - config.minGapMs)
    }

    return {
      get config() {
        return config
      },
      get state() {
        return { lastActivity: lastActivity, nextAt: nextAt, armed: armed, hidden: hidden }
      },
      /** Any real pointer movement: push the next reaction back. */
      noteActivity: function (now) {
        lastActivity = now
        nextAt = null
        armed = false
      },
      /**
       * Tab visibility. Coming back to a tab starts a fresh idle window so the
       * mascot does not fire the moment the page is shown again.
       */
      setHidden: function (value, now) {
        hidden = value === true
        nextAt = null
        armed = false
        if (!hidden && typeof now === 'number') lastActivity = now
      },
      /**
       * @returns {null | {reaction: string, durationMs: number, sleepy: boolean, deep?: boolean}}
       */
      tick: function (now) {
        if (lastActivity === null) {
          lastActivity = now
          return null
        }
        if (hidden) return null

        const idleFor = now - lastActivity
        if (idleFor < config.idleAfterMs) {
          armed = false
          nextAt = null
          return null
        }

        // Deep sleep runs on its own clock, never gated by a drowsy gap:
        // the five-minute boundary puts it to sleep even mid-schedule.
        if (idleFor >= config.deepSleepAfterMs) {
          // Sticky: the caller shows it with no auto-clear timer. Repeats are
          // harmless (the mascot ignores them while already asleep), so no
          // nextAt gating here.
          return {
            reaction: config.sleepyReaction,
            durationMs: 0,
            sleepy: true,
            deep: true,
          }
        }

        if (!armed) {
          armed = true
          nextAt = lastActivity + config.idleAfterMs
          if (now < nextAt) return null
        } else if (nextAt !== null && now < nextAt) {
          return null
        }

        const sleepy = idleFor >= config.sleepyAfterMs
        const index = Math.min(AWAKE.length - 1, Math.floor(random() * AWAKE.length))
        nextAt = now + (sleepy ? config.sleepyGapMs : gap())
        return {
          reaction: sleepy ? config.sleepyReaction : AWAKE[index],
          durationMs: sleepy ? config.sleepyDurationMs : config.durationMs,
          sleepy: sleepy,
        }
      },
    }
  }

  return {
    BOOP_PAYOFF: BOOP_PAYOFF,
    BOOP_END: BOOP_END,
    DIZZY_AFTER: DIZZY_AFTER,
    DIZZY_WINDOW: DIZZY_WINDOW,
    DIZZY_END: DIZZY_END,
    PAYOFFS: PAYOFFS,
    AWAKE: AWAKE,
    IDLE: IDLE,
    GREET: GREET,
    SQUASH: SQUASH,
    SQUASH_MS: SQUASH_MS,
    EMPTY_BOOP_STATE: EMPTY_BOOP_STATE,
    STUDY_GLANCE: STUDY_GLANCE,
    planBoop: planBoop,
    createIdlePlanner: createIdlePlanner,
    glanceTimeline: glanceTimeline,
    glanceDurationMs: glanceDurationMs,
    celebrationTimeline: celebrationTimeline,
  }
})