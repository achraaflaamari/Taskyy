/**
 * Shared mascot controller — the single implementation for every surface.
 *
 * Used by the Explorer companion, the sidebar todo mini-mascot and the
 * dashboard header. Faces + bubbles + idle/sleep + boop + webview-local
 * pointer gaze. Gaze never watches typing, caret or focus — only the mouse
 * position inside the mascot's own webview (v0.5).
 *
 * Classic script (not a module) so VS Code webviews can load it with a
 * plain <script> tag under a strict CSP. UMD wrapper lets node --test
 * require() it too.
 *
 * Dependencies are injected so the file stays testable without a DOM:
 *   sprite     — globalThis.MascotSprite (positionOf, reactionIndex, CENTER)
 *   reactions  — globalThis.MascotReactions (planBoop, createIdlePlanner, …)
 *   characters — globalThis.MascotCharacters (optional, for aria labels)
 *
 * Usage:
 *   const ctl = MascotController.create({
 *     sprite, reactions, characters,
 *     sheetUrl: (id) => root + '/' + id + '-reactions.webp', // full setter below
 *     setSheets: (id) => { dirLayer.style…; reactLayer.style… },
 *   }, els);
 *   ctl.setSettings({ enabled, characterId, size, clickReaction, autoReaction });
 *   ctl.react('delighted', 900); ctl.say('Clean.'); ctl.boop(); ctl.sleep(); ctl.wake();
 */
(function (root, factory) {
  var sprite = root.MascotSprite;
  var reactions = root.MascotReactions;
  var characters = root.MascotCharacters;
  // Lazy-resolve at create() time too, so script order is forgiving.
  var api = factory();
  root.MascotController = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(globalThis, function () {
  'use strict';

  var SIGNAL_RULES = {
    errorsUp: { reaction: 'surprised', durationMs: 1200, say: null },
    errorsZero: { reaction: 'delighted', durationMs: 900, say: 'Clean.' },
    termFail: { reaction: 'surprised', durationMs: 1200, say: 'Command failed.' },
    termOk: { reaction: 'delighted', durationMs: 900, say: null },
    taskOk: { reaction: 'starstruck', durationMs: 1100, say: 'Task passed.' },
    gitCommit: {
      reaction: 'sparkle', durationMs: 1600, say: 'Committed.',
      timeline: [
        { at: 0, reaction: 'sparkle' },
        { at: 350, reaction: 'heart' },
        { at: 700, reaction: 'delighted' },
        { at: 1600, reaction: null },
      ],
    },
  };

  var NOTICE_REACTIONS = ['sparkle', 'delighted', 'surprised'];
  var AMBIENT_SMILES = ['delighted', 'heart', 'starstruck'];

  // ── Tuning (ms). Bigger = calmer. ───────────────────────────────
  var GAZE = {
    settleMs: 250,         // wait before the first turn
    holdMs: 900,           // min time on one direction before turning again
    centerSettleMs: 1400,  // pointer must rest in the centre zone this long before face-on
    leaveDelayMs: 1200,    // pointer left the webview -> return to face-on after this
    restAfterMs: 5000      // pointer stopped moving -> drift back to face-on (0 = never)
  };
  var BLINK_GAP = [4000, 9000];
  var AMBIENT_GAP = [20000, 45000];
  var AMBIENT_SMILE_CHANCE = 0.3;

  var SLEEP_AFTER_MS = 5 * 60 * 1000;
  var SLEEPY_AFTER_MS = 30 * 1000;

  function rand(min, max) { return min + Math.random() * (max - min); }

  var reducedMotionMq = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReducedMotion() { return !!(reducedMotionMq && reducedMotionMq.matches); }

  function nowMs() {
    if (typeof Date !== 'undefined' && Date.now) { return Date.now(); }
    return 0;
  }

  /**
   * @param {object} deps { sprite?, reactions?, characters?, setSheets?(id), label?(id) }
   * @param {object} els { mascotEl, dirLayer, reactLayer, squashEl, bubbleEl, bubbleText,
   *                       statusDot?, statusText?, metaLine?, offEl? }
   * @param {object} opts { onBoopWake?():void, getNow?():number }
   */
  function create(deps, els, opts) {
    deps = deps || {};
    els = els || {};
    opts = opts || {};
    var S = deps.sprite || (typeof globalThis !== 'undefined' && globalThis.MascotSprite);
    var R = deps.reactions || (typeof globalThis !== 'undefined' && globalThis.MascotReactions);
    var C = deps.characters || (typeof globalThis !== 'undefined' && globalThis.MascotCharacters);
    var setSheets = typeof deps.setSheets === 'function' ? deps.setSheets : null;
    var labelFn = typeof deps.label === 'function' ? deps.label
      : function (id) { return C && C.label ? C.label(id) : id; };
    var clock = typeof opts.getNow === 'function' ? opts.getNow : nowMs;

    var mascotEl = els.mascotEl || null;
    var dirLayer = els.dirLayer || null;
    var reactLayer = els.reactLayer || null;
    var squashEl = els.squashEl || null;
    var bubbleEl = els.bubbleEl || null;
    var bubbleText = els.bubbleText || null;
    var statusDot = els.statusDot || null;
    var statusText = els.statusText || null;
    var offEl = els.offEl || null;

    var settings = { enabled: true, characterId: 'fox', size: 140, clickReaction: true, autoReaction: true, followPointer: true };
    var gazeDirection = null;
    var lastGazeChange = 0;
    var gazeNext = null;
    var gazePending = false;

    var reaction = null;
    var reactionToken = 0;
    var sleeping = false;
    var autoVisible = false;
    var greeted = false;
    var destroyed = false;
    var lastActivityAt = clock();
    var lastBubbleAt = 0;
    var lastBubbleText = '';
    var errorCount = 0;
    var idlePlanner = R && R.createIdlePlanner ? R.createIdlePlanner() : null;
    var boopState = { count: 0, at: -Infinity };
    var idleTimer = null;
    var nextAmbientAt = 0;
    var nextBlinkAt = clock() + 3000;
    var timers = { boop: [], auto: [], greet: [], signal: [], bubble: [], gaze: [], gazeRest: [] };

    function later(group, ms, fn) {
      var id;
      var run = function () {
        var arr = timers[group];
        if (arr) {
          var i = arr.indexOf(id);
          if (i !== -1) { arr.splice(i, 1); }
        }
        if (!destroyed) { fn(); }
      };
      if (typeof window !== 'undefined' && window.setTimeout) {
        id = window.setTimeout(run, ms);
      } else {
        id = setTimeout(run, ms);
      }
      if (timers[group]) { timers[group].push(id); }
      return id;
    }
    function clearGroup(group) {
      var arr = timers[group] || [];
      arr.forEach(function (id) {
        if (typeof window !== 'undefined' && window.clearTimeout) { window.clearTimeout(id); }
        else { clearTimeout(id); }
      });
      timers[group] = [];
    }

    function noteActivity(at) {
      lastActivityAt = typeof at === 'number' ? at : clock();
      if (idlePlanner) { idlePlanner.noteActivity(lastActivityAt); }
      nextAmbientAt = lastActivityAt + rand(AMBIENT_GAP[0], AMBIENT_GAP[1]);
    }

    function paint() {
      if (!S) { return; }
      if (dirLayer) {
        try {
          var base = gazeDirection || S.CENTER;
          dirLayer.style.backgroundPosition = S.positionOf(S.directionIndex(base));
          dirLayer.style.opacity = reaction ? '0' : '1';
        } catch (e) { /* noop */ }
      }
      if (reactLayer) {
        try {
          reactLayer.style.backgroundPosition = S.positionOf(S.reactionIndex(reaction || 'blink'));
          reactLayer.style.opacity = reaction ? '1' : '0';
        } catch (e) { /* noop */ }
      }
    }

    function setReaction(next) {
      if (reaction === next) { return; }
      reaction = next;
      paint();
    }

    /** Show a face for `durationMs`, then return to base. Returns the token. */
    function react(next, durationMs, group) {
      setReaction(next);
      var token = (reactionToken += 1);
      later(group || 'auto', durationMs, function () {
        if (reactionToken === token) { setReaction(null); }
      });
      return token;
    }

    function commitGaze() {
      gazePending = false;
      if (gazeNext === gazeDirection) { return; }
      gazeDirection = gazeNext;
      lastGazeChange = clock();
      paint();
    }


    // Pointer stopped moving for a while -> drift back to face-on.
    function armRest() {
      clearGroup('gazeRest');
      if (!GAZE.restAfterMs) { return; }
      later('gazeRest', GAZE.restAfterMs, function () {
        if (gazeDirection === null) { return; }
        clearGroup('gaze');
        gazePending = false;
        gazeNext = null;
        gazeDirection = null;
        lastGazeChange = clock();
        paint();
      });
    }


    /** Pointer-follow gaze (webview-local only). Turning is throttled,
     *  returning to face-on is debounced, so the head never flickers. */
    function setGaze(direction) {
      if (!S || sleeping || !settings.enabled || settings.followPointer === false) { return; }
      if (prefersReducedMotion()) { return; }
      if (typeof direction !== 'string' || !S.isDirection(direction)) { return; }
      var next = direction === S.CENTER ? null : direction;


      armRest();
      if (next === gazeDirection) {            // came back to where we already look
        clearGroup('gaze');
        gazePending = false;
        return;
      }
      var toCenter = next === null;
      var wasCenterPending = gazePending && gazeNext === null;
      gazeNext = next;                          // always remember the latest target
      // Turn: keep the already-scheduled slot (throttle + trailing).
      if (gazePending && !toCenter && !wasCenterPending) { return; }
      // Face-on: restart the timer on every event (debounce).
      clearGroup('gaze');
      gazePending = true;
      var wait = toCenter
        ? GAZE.centerSettleMs
        : Math.max(GAZE.settleMs, lastGazeChange + GAZE.holdMs - clock());
      later('gaze', wait, commitGaze);
    }


    /** Pointer left the webview: return to face-on gently, not instantly. */
    function clearGaze(immediate) {
      clearGroup('gaze');
      clearGroup('gazeRest');
      gazePending = false;
      if (gazeDirection === null) { return; }
      if (immediate === true) {
        gazeDirection = null;
        gazeNext = null;
        paint();
        return;
      }
      gazeNext = null;
      gazePending = true;
      later('gaze', GAZE.leaveDelayMs, commitGaze);
    }

    function applySize(px) {
      if (!mascotEl) { return; }
      mascotEl.style.width = px + 'px';
      mascotEl.style.height = px + 'px';
      try { mascotEl.setAttribute('aria-label', 'Boop the ' + labelFn(settings.characterId)); } catch (e) { /* noop */ }
    }

    function setStatus(state, text) {
      if (statusDot) { try { statusDot.setAttribute('data-state', state); } catch (e) { /* noop */ } }
      if (statusText) { statusText.textContent = text; }
    }

    /** Rate-limited bubble: ≤1/30s, identical text ≤1/hour. */
    function say(text, ms) {
      if (!bubbleEl || !bubbleText || !text) { return false; }
      var at = clock();
      if (at - lastBubbleAt < 30000) { return false; }
      if (text === lastBubbleText && at - lastBubbleAt < 3600000) { return false; }
      lastBubbleAt = at;
      lastBubbleText = text;
      bubbleText.textContent = text;
      bubbleEl.hidden = false;
      clearGroup('bubble');
      later('bubble', ms || 4000, function () { bubbleEl.hidden = true; });
      return true;
    }

    function refreshMeta() {
      // Only the companion passes a metaLine; other surfaces pass null.
      if (!els.metaLine) { return; }
      if (errorCount > 0) {
        els.metaLine.textContent = errorCount + (errorCount === 1 ? ' error' : ' errors') + ' in workspace · click mascot to dismiss face';
      } else {
        els.metaLine.textContent = 'Event-driven · stays calm while you type';
      }
    }

    function cancelAuto() {
      if (!autoVisible) { return; }
      autoVisible = false;
      clearGroup('auto');
      setReaction(null);
    }

    function sleep() {
      if (sleeping) { return; }
      sleeping = true;
      autoVisible = false;
      clearGroup('auto');
      clearGroup('signal');
      clearGroup('gaze');
      clearGroup('gazeRest');
      gazePending = false;
      gazeNext = null;
      gazeDirection = null;
      reactionToken += 1;
      setReaction(R && R.IDLE ? R.IDLE.sleepyReaction : 'sleepy');
      paint();
      setStatus('sleep', 'Asleep — click to wake');
    }

    function wake() {
      if (!sleeping) { return; }
      sleeping = false;
      reactionToken += 1;
      setReaction(null);
      noteActivity(clock());
      setStatus('ok', 'Ready');
    }

    function tickIdle() {
      var at = clock();
      if (!settings.autoReaction || sleeping || destroyed) {
        if (!sleeping) { tickBlink(at); }
        return;
      }
      if (idlePlanner) {
        var plan = idlePlanner.tick(at);
        if (plan && plan.deep) { sleep(); return; }
        if (plan) {
          autoVisible = true;
          react(plan.reaction, plan.durationMs, 'auto');
          return;
        }
      } else if (at - lastActivityAt >= SLEEP_AFTER_MS) { sleep(); return; }
      tickAmbient(at);
      tickBlink(at);
    }

    function tickAmbient(at) {
      if (!settings.autoReaction || sleeping || destroyed) { return; }
      if (prefersReducedMotion()) { return; }
      if (at - lastActivityAt < 10000) { return; }
      if (reaction) { return; }
      if (gazeDirection !== null || gazePending) { return; }
      if (nextAmbientAt === 0) { nextAmbientAt = at + rand(AMBIENT_GAP[0], AMBIENT_GAP[1]); return; }
      if (at < nextAmbientAt) { return; }
      nextAmbientAt = at + rand(AMBIENT_GAP[0], AMBIENT_GAP[1]);
      if (Math.random() < AMBIENT_SMILE_CHANCE) {
        autoVisible = true;
        react(AMBIENT_SMILES[Math.floor(Math.random() * AMBIENT_SMILES.length)], 700, 'auto');
        later('auto', 720, function () { autoVisible = false; });
      } else {
        doBlink();
      }
    }

    function tickBlink(at) {
      if (!settings.enabled || sleeping || destroyed) { return; }
      if (prefersReducedMotion()) { return; }
      if (reaction) { nextBlinkAt = at + rand(BLINK_GAP[0], BLINK_GAP[1]); return; }
      if (at < nextBlinkAt) { return; }
      doBlink();
    }

    function doBlink() {
      nextBlinkAt = clock() + rand(BLINK_GAP[0], BLINK_GAP[1]);
      if (reaction || sleeping || !settings.enabled) { return; }
      autoVisible = true;
      react('blink', 150, 'auto');
      later('auto', 170, function () { autoVisible = false; });
    }

    function startIdle() {
      if (idleTimer !== null || !idlePlanner) { return; }
      if (typeof window === 'undefined' || !window.setInterval) { return; }
      noteActivity(clock());
      nextBlinkAt = clock() + 3000;
      idleTimer = window.setInterval(tickIdle, (R && R.IDLE && R.IDLE.tickMs) || 400);
    }

    function scheduleGreeting() {
      if (greeted || prefersReducedMotion()) { return; }
      greeted = true;
      later('greet', (R && R.GREET ? R.GREET.afterMs : 800), function () {
        react(R.GREET.reaction, R.GREET.durationMs, 'greet');
      });
    }

    function squash() {
      if (!squashEl || typeof squashEl.animate !== 'function' || prefersReducedMotion()) { return; }
      squashEl.animate(R.SQUASH, { duration: R.SQUASH_MS, easing: 'linear' });
    }

    function boop() {
      if (!settings.enabled || !mascotEl) { return; }
      if (sleeping) {
        wake();
        clearGroup('boop');
        clearGroup('greet');
        return;
      }
      if (!settings.clickReaction) { return; }
      clearGroup('boop');
      clearGroup('greet');
      cancelAuto();
      noteActivity(clock());
      var plan = R.planBoop(boopState, clock());
      boopState = plan.next;
      reactionToken += 1;
      var token = reactionToken;
      plan.steps.forEach(function (step) {
        if (step.at === 0) { setReaction(step.reaction); }
        else {
          later('boop', step.at, function () {
            if (reactionToken === token) { setReaction(step.reaction); }
          });
        }
      });
      squash();
    }

    function onSignal(msg) {
      if (!settings.enabled || sleeping) { return; }
      if (!settings.autoReaction) { return; }
      var rule = SIGNAL_RULES[msg.signal];
      if (!rule) { return; }
      if (typeof msg.errors === 'number') { errorCount = msg.errors; }
      if (msg.signal === 'errorsZero') { errorCount = 0; }
      refreshMeta();
      var at = clock();
      noteActivity(at);
      cancelAuto();
      setStatus(msg.signal === 'errorsUp' || msg.signal === 'termFail' ? 'warn' : 'ok',
        msg.signal === 'errorsUp' ? 'Errors need attention'
        : msg.signal === 'termFail' ? 'Last command failed'
        : msg.signal === 'gitCommit' ? 'Commit recorded'
        : 'Ready');
      autoVisible = true;
      if (rule.say) { say(rule.say, 4000); }
      if (rule.timeline && !prefersReducedMotion()) {
        reactionToken += 1;
        var token = reactionToken;
        rule.timeline.forEach(function (step) {
          later('signal', step.at, function () {
            if (reactionToken === token) {
              setReaction(step.reaction);
              if (!step.reaction) { autoVisible = false; }
            }
          });
        });
        return;
      }
      react(rule.reaction, rule.durationMs, 'signal');
      later('signal', rule.durationMs + 20, function () { autoVisible = false; });
    }

    function onNotice(msg) {
      if (!settings.enabled || sleeping || !settings.autoReaction) { return; }
      if (NOTICE_REACTIONS.indexOf(msg.reaction) === -1) { return; }
      noteActivity(clock());
      cancelAuto();
      autoVisible = true;
      react(msg.reaction, 900, 'auto');
    }

    /** Data-driven mood (analytics surfaces): face + optional one-line insight. */
    function mood(face, utterance) {
      if (!settings.enabled || sleeping || !settings.autoReaction) { return; }
      cancelAuto();
      noteActivity(clock());
      autoVisible = true;
      if (utterance) { say(utterance, 4000); }
      if (face && face !== 'base') {
        react(face, 900, 'auto');
        later('auto', 920, function () { autoVisible = false; });
      } else {
        later('auto', 400, function () { autoVisible = false; });
      }
    }

    function setSettings(next) {
      var prevId = settings.characterId;
      settings = {
        enabled: next.enabled !== false,
        characterId: next.characterId || 'fox',
        size: typeof next.size === 'number' ? next.size : 140,
        clickReaction: next.clickReaction !== false,
        autoReaction: next.autoReaction !== false,
        followPointer: next.followPointer !== false,
      };
      if (settings.followPointer === false) { gazeDirection = null; }
      try {
        if (typeof document !== 'undefined' && document.body) {
          document.body.classList.toggle('off', !settings.enabled);
        }
      } catch (e) { /* noop */ }
      if (mascotEl) { try { mascotEl.hidden = !settings.enabled; } catch (e) { /* noop */ } }
      if (offEl) { try { offEl.hidden = settings.enabled; } catch (e) { /* noop */ } }
      if (prevId !== settings.characterId && setSheets) {
        try { setSheets(settings.characterId); } catch (e) { /* noop */ }
      }
      applySize(settings.size);
      if (!settings.autoReaction && sleeping) { wake(); }
      paint();
    }

    function bindVisibility() {
      if (typeof document === 'undefined' || !idlePlanner) { return; }
      document.addEventListener('visibilitychange', function () {
        var hidden = document.visibilityState === 'hidden';
        idlePlanner.setHidden(hidden, clock());
        if (hidden) { cancelAuto(); }
        else { noteActivity(clock()); }
      });
    }

    function dispose() {
      destroyed = true;
      ['boop', 'auto', 'greet', 'signal', 'bubble', 'gaze', 'gazeRest'].forEach(clearGroup);
      if (idleTimer !== null && typeof window !== 'undefined') {
        window.clearInterval(idleTimer);
        idleTimer = null;
      }
    }

    return {
      SIGNAL_RULES: SIGNAL_RULES,
      get reaction() { return reaction; },
      get sleeping() { return sleeping; },
      get gaze() { return gazeDirection; },
      get settings() { return settings; },
      get errorCount() { return errorCount; },
      paint: paint,
      react: react,
      say: say,
      setGaze: setGaze,
      clearGaze: clearGaze,
      setSettings: setSettings,
      sleep: sleep,
      wake: wake,
      boop: boop,
      onSignal: onSignal,
      onNotice: onNotice,
      mood: mood,
      noteActivity: noteActivity,
      setStatus: setStatus,
      startIdle: startIdle,
      scheduleGreeting: scheduleGreeting,
      bindVisibility: bindVisibility,
      tickIdle: tickIdle,
      dispose: dispose,
    };
  }

  return {
    SIGNAL_RULES: SIGNAL_RULES,
    NOTICE_REACTIONS: NOTICE_REACTIONS,
    create: create,
  };
});
