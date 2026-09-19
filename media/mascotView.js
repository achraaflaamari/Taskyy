/**
 * VS Code webview runtime: event-only companion (thin wrapper).
 *
 * All mascot behaviour lives in media/shared/mascotController.js — the single
 * implementation shared with the sidebar todo mini-mascot and dashboard header.
 * This file only wires DOM ids + vscode messaging + pointer gaze to the controller.
 *
 * The mascot never follows typing, caret or focus. It follows the mouse
 * pointer inside its own view only (webview-local gaze), and reacts to
 * discrete workspace events (`signal`, `notice`) from the host, plus its
 * own idle/ambient life and boop.
 *
 * Host → webview: { type:'settings' } { type:'signal', signal }
 *                  { type:'notice', reaction } { type:'boop' }
 * Webview → host: { type:'openSettings' } { type:'openAnalytics' } { type:'boop' }
 */
(function () {
  'use strict';

  var characters = globalThis.MascotCharacters;
  var sprite = globalThis.MascotSprite;
  var reactions = globalThis.MascotReactions;
  var controllerFactory = globalThis.MascotController;

  if (!sprite || !reactions || !controllerFactory) { return; }

  var MASCOTS_ROOT = (document.body && document.body.dataset.mascotsRoot) || '';
  var vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  var mascotEl = document.getElementById('mascot');
  var dirLayer = mascotEl ? mascotEl.querySelector('.mascot-directions') : null;
  var reactLayer = mascotEl ? mascotEl.querySelector('.mascot-reactions') : null;
  var squashEl = mascotEl ? mascotEl.querySelector('.mascot-squash') : null;

  function sheetUrl(id, kind) { return MASCOTS_ROOT + '/' + id + '-' + kind + '.webp'; }
  function setSheets(id) {
    if (dirLayer) { dirLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'directions') + '")'; }
    if (reactLayer) { reactLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'reactions') + '")'; }
  }

  var ctl = controllerFactory.create(
    {
      sprite: sprite,
      reactions: reactions,
      characters: characters,
      setSheets: setSheets,
      label: function (id) { return characters ? characters.label(id) : id; },
    },
    {
      mascotEl: mascotEl,
      dirLayer: dirLayer,
      reactLayer: reactLayer,
      squashEl: squashEl,
      bubbleEl: document.getElementById('bubble'),
      bubbleText: document.getElementById('bubble-text'),
      offEl: document.getElementById('mascot-off'),
    },
  );

  // ---------------------------------------------------------- pointer-follow gaze
  // Webview-local only: follows the mouse inside this view, back to center
  // on leave. Never watches typing, caret or focus. Gated by the
  // followPointer setting inside the controller.
  var aimer = globalThis.MascotAim && globalThis.MascotAim.createAimer
    ? globalThis.MascotAim.createAimer()
    : null;
  if (aimer && mascotEl) {
    document.addEventListener('mousemove', function (ev) {
      try {
        var r = mascotEl.getBoundingClientRect();
        var res = aimer.update(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (res.changed) { ctl.setGaze(res.direction); }
      } catch (e) { /* best-effort */ }
    });
    document.addEventListener('mouseleave', function () {
      try { aimer.reset(); } catch (e) { /* ignore */ }
      ctl.clearGaze();
    });
  }

  if (mascotEl) {
    mascotEl.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      ctl.boop();
    });
  }

  // ---------------------------------------------------------- messages
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') { return; }
    if (msg.type === 'settings' && msg.settings) { ctl.setSettings(msg.settings); }
    else if (msg.type === 'signal') { ctl.onSignal(msg); }
    else if (msg.type === 'notice') { ctl.onNotice(msg); }
    else if (msg.type === 'boop') { ctl.boop(); }
    else if (msg.type === 'react') {
      // Data-driven mood from analytics (milestone / range mood). Faces only.
      ctl.mood(msg.name || 'base', msg.say);
    }
  });

  // ---------------------------------------------------------- init
  setSheets('fox');
  ctl.setSettings({ enabled: true, characterId: 'fox', size: 140, clickReaction: true, autoReaction: true });
  ctl.paint();
  ctl.setStatus('ok', 'Ready');
  ctl.bindVisibility();
  ctl.startIdle();
  ctl.scheduleGreeting();
})();
