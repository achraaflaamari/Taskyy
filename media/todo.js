/**
 * Sidebar TODO runtime: quick-add + filter + kind-grouped list.
 * Shared MascotController drives the mascot (faces + webview-local pointer gaze).
 *
 * Extension → webview: { type:'settings' } { type:'todo:list', tasks, summary }
 *                       { type:'todo:error', message } { type:'react', name, say }
 * Webview → extension: { type:'ready' } { type:'todo:add|update|toggle|move|remove|clearCompleted|promoteNext' }
 *                       { type:'openAnalytics' } { type:'openSettings' }
 *
 * Filter (All/Now/Next/Later) is webview-local only (vscode.setState); store stays unfiltered.
 * Add form uses two selects (bucket + kind) — filter switch no longer chooses the bucket.
 * List is grouped by kind (Feature/Fix/Improvement) + Done, not by bucket.
 */
(function () {
  'use strict';

  var characters = globalThis.MascotCharacters;
  var sprite = globalThis.MascotSprite;
  var reactions = globalThis.MascotReactions;
  var factory = globalThis.MascotController;
  if (!sprite || !reactions || !factory) { return; }

  var MASCOTS_ROOT = (document.body && document.body.dataset.mascotsRoot) || '';
  var vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  function post(type, extra) {
    if (!vscode) { return; }
    try { vscode.postMessage(Object.assign({ type: type }, extra || {})); }
    catch (e) { /* host unavailable */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getUi() {
    try {
      if (vscode && typeof vscode.getState === 'function') {
        var s = vscode.getState();
        if (s && typeof s === 'object') { return s; }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function setUi(patch) {
    try {
      if (vscode && typeof vscode.setState === 'function') {
        vscode.setState(Object.assign({}, getUi() || {}, patch));
      }
    } catch (e) { /* ignore */ }
  }

  // ---- mascot (faces + gaze) ----
  var mascotEl = document.getElementById('todo-mascot');
  var dirLayer = mascotEl ? mascotEl.querySelector('.mascot-directions') : null;
  var reactLayer = mascotEl ? mascotEl.querySelector('.mascot-reactions') : null;
  var squashEl = mascotEl ? mascotEl.querySelector('.mascot-squash') : null;

  function sheetUrl(id, kind) { return MASCOTS_ROOT + '/' + id + '-' + kind + '.webp'; }
  function setSheets(id) {
    if (dirLayer) { dirLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'directions') + '")'; }
    if (reactLayer) { reactLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'reactions') + '")'; }
  }

  var ctl = factory.create(
    {
      sprite: sprite, reactions: reactions, characters: characters,
      setSheets: setSheets,
      label: function (id) { return characters ? characters.label(id) : id; },
    },
    { mascotEl: mascotEl, dirLayer: dirLayer, reactLayer: reactLayer, squashEl: squashEl, bubbleEl: null, bubbleText: null },
  );

  if (mascotEl) {
    mascotEl.addEventListener('click', function (ev) { ev.preventDefault(); ctl.boop(); });
  }

  // Pointer-follow gaze (webview-local only; centers on leave).
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

  // ---- state ----
  var tasks = [];
  var editingId = null;
  var ui = getUi() || {};
  var filter = ui.filter || 'all';
  if (['all', 'session', 'next', 'someday', 'done'].indexOf(filter) === -1) { filter = 'all'; }
  var quickBucket = ui.bucket || 'session';
  var quickKind = ui.type || 'feature';
  var collapsed = Object.assign({ done: true }, (ui.collapsed || {}));
  if (['session', 'next', 'someday'].indexOf(quickBucket) === -1) { quickBucket = 'session'; }
  if (['feature', 'fix', 'improvement'].indexOf(quickKind) === -1) { quickKind = 'feature'; }

  var KIND_SECTIONS = [
    { id: 'feature', label: 'Feature' },
    { id: 'fix', label: 'Fix' },
    { id: 'improvement', label: 'Improvement' },
  ];
  var KIND_LABEL = { feature: 'FEATURE', fix: 'FIX', improvement: 'IMPR' };
  var KIND_CLASS = { feature: 'feat', fix: 'fix', improvement: 'impr' };

  var todayStr = '';
  try {
    var dd = new Date();
    todayStr = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
  } catch (e) { todayStr = ''; }

  var elOpen = document.getElementById('open');
  var elDoneN = document.getElementById('doneN');
  var elProg = document.getElementById('prog');
  var elInput = document.getElementById('in');
  var elBucketPick = document.getElementById('bucketPick');
  var elKindPick = document.getElementById('kindPick');
  var elAddBtn = document.getElementById('addBtn');
  var elSeg = document.getElementById('seg');
  var elError = document.getElementById('todo-error');
  var elList = document.getElementById('list');
  var elFull = document.getElementById('full');

  // restore picks
  if (elBucketPick) { elBucketPick.value = quickBucket; }
  if (elKindPick) { elKindPick.value = quickKind; }

  function showError(msg) {
    if (!elError) { return; }
    elError.textContent = msg;
    elError.hidden = false;
  }
  function clearError() {
    if (!elError) { return; }
    elError.hidden = true;
    elError.textContent = '';
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function syncFilter() {
    if (!elSeg) { return; }
    Array.prototype.forEach.call(elSeg.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-b') === filter ? 'true' : 'false');
    });
  }

  function doAdd() {
    if (!elInput) { return; }
    var title = elInput.value.trim();
    if (!title) { showError('Type a task title first.'); return; }
    clearError();
    var bucket = elBucketPick ? elBucketPick.value : quickBucket;
    var kind = elKindPick ? elKindPick.value : quickKind;
    post('todo:add', { title: title, bucket: bucket, kind: kind });
    elInput.value = '';
    elInput.focus();
  }

  if (elInput) {
    elInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { doAdd(); }
      else if (ev.key === 'Escape') { elInput.blur(); }
    });
  }
  if (elAddBtn) { elAddBtn.addEventListener('click', doAdd); }
  if (elBucketPick) {
    elBucketPick.addEventListener('change', function () {
      quickBucket = elBucketPick.value;
      setUi({ bucket: quickBucket });
    });
  }
  if (elKindPick) {
    elKindPick.addEventListener('change', function () {
      quickKind = elKindPick.value;
      setUi({ type: quickKind });
    });
  }
  if (elSeg) {
    elSeg.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!b || !b.getAttribute('data-b')) { return; }
      filter = b.getAttribute('data-b');
      setUi({ filter: filter });
      syncFilter();
      render();
    });
  }
  if (elFull) {
    elFull.addEventListener('click', function (ev) { ev.preventDefault(); post('openAnalytics'); });
  }

  function dueChip(t) {
    if (!t.deadline) { return null; }
    var s = el('span', (!t.done && t.deadline < todayStr) ? 'task-due overdue' : 'task-due', t.deadline.slice(5));
    s.title = 'Deadline ' + t.deadline;
    return s;
  }

  function editorNode(t) {
    var box = el('div', 'todo-editor');
    box.innerHTML = '<label>Notes<textarea data-f="notes" maxlength="2000" placeholder="Notes…">' + esc(t.notes || '') + '</textarea></label>'
      + '<div class="todo-editor-row">'
      + '<label>Deadline<input type="date" data-f="deadline" value="' + esc(t.deadline || '') + '" /></label>'
      + '<label>Bucket<select data-f="bucket">'
      + [{ id: 'session', label: 'Now' }, { id: 'next', label: 'Next' }, { id: 'someday', label: 'Later' }].map(function (s) {
        return '<option value="' + s.id + '"' + (t.bucket === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label>Type<select data-f="kind">'
      + ['feature', 'fix', 'improvement'].map(function (k) {
        return '<option value="' + k + '"' + (t.kind === k ? ' selected' : '') + '>' + esc(k) + '</option>';
      }).join('')
      + '</select></label>'
      + '</div>'
      + '<div class="todo-editor-actions">'
      + '<button type="button" data-act="cancel">Cancel</button>'
      + '<button type="button" data-act="save" class="primary">Save</button>'
      + '</div>';
    box.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!btn) { return; }
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') { editingId = null; render(); }
      else if (act === 'save') {
        var patch = {};
        box.querySelectorAll('[data-f]').forEach(function (input) {
          patch[input.getAttribute('data-f')] = input.value;
        });
        if (!patch.deadline) { patch.deadline = null; }
        post('todo:update', { id: t.id, patch: patch });
        editingId = null;
      }
    });
    return box;
  }

  function rowNode(t) {
    var wrap = el('div');
    var r = el('div', 'task' + (t.done ? ' done' : ''));
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!t.done;
    cb.setAttribute('aria-label', 'Complete: ' + (t.title || ''));
    cb.addEventListener('change', function () { post('todo:toggle', { id: t.id }); });
    var badge = el('span', 'badge ' + (KIND_CLASS[t.kind] || 'feat'), KIND_LABEL[t.kind] || t.kind);
    var txt = el('span', 'txt', t.title || '');
    txt.title = t.title || '';
    if ((t.notes || t.deadline) && !t.done) { txt.title += ' · click to edit notes/deadline'; }
    txt.addEventListener('click', function () {
      editingId = editingId === t.id ? null : t.id;
      render();
    });
    r.append(cb, badge, txt);
    var chip = dueChip(t);
    if (chip) { r.append(chip); }
    var acts = el('span', 'acts');
    if (!t.done) {
      var mv = el('button', 'iconbtn', '→');
      mv.title = 'Move to next list';
      mv.setAttribute('aria-label', 'Move to next list');
      mv.addEventListener('click', function () {
        var order = ['session', 'next', 'someday'];
        post('todo:move', { id: t.id, bucket: order[(order.indexOf(t.bucket) + 1) % order.length] });
      });
      acts.append(mv);
    }
    var del = el('button', 'iconbtn', '✕');
    del.title = 'Delete';
    del.setAttribute('aria-label', 'Delete task');
    del.addEventListener('click', function () { post('todo:remove', { id: t.id }); });
    acts.append(del);
    r.append(acts);
    wrap.append(r);
    if (editingId === t.id && !t.done) { wrap.append(editorNode(t)); }
    return wrap;
  }

  function render() {
    if (!elList) { return; }
    var openAll = tasks.filter(function (t) { return !t.done; });
    var doneAll = tasks.filter(function (t) { return !!t.done; });
    if (elOpen) { elOpen.textContent = String(openAll.length); }
    if (elDoneN) { elDoneN.textContent = String(doneAll.length); }
    if (elProg) { elProg.style.width = tasks.length ? (doneAll.length / tasks.length * 100) + '%' : '0'; }
    syncFilter();
    elList.textContent = '';

    // Done tab: shows only done tasks, clear button at top of the tab
    if (filter === 'done') {
      if (doneAll.length === 0) {
        elList.append(el('div', 'empty muted', 'No done tasks yet.'));
        return;
      }
      var top = el('div', 'done-top');
      var clearTop = el('button', 'link-btn', 'Clear done (' + doneAll.length + ')');
      clearTop.type = 'button';
      clearTop.addEventListener('click', function () { post('todo:clearCompleted'); });
      top.append(clearTop);
      elList.append(top);
      KIND_SECTIONS.forEach(function (sec) {
        var items = doneAll.filter(function (t) { return t.kind === sec.id; });
        if (!items.length) { return; }
        var h = el('h3');
        h.tabIndex = 0;
        var isCollapsed = !!collapsed['done_' + sec.id];
        h.append(el('span', '', isCollapsed ? '▸' : '▾'), el('span', '', sec.label), el('span', 'n', '(' + items.length + ')'));
        var flip = function () {
          collapsed['done_' + sec.id] = !isCollapsed;
          setUi({ collapsed: collapsed });
          render();
        };
        h.addEventListener('click', flip);
        h.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); }
        });
        elList.append(h);
        if (!isCollapsed) { items.forEach(function (t) { elList.append(rowNode(t)); }); }
      });
      return;
    }

    // Open tabs (All/Now/Next/Later): kind-grouped open tasks only
    var open = (function () {
      if (filter === 'all') { return openAll; }
      return openAll.filter(function (t) { return t.bucket === filter; });
    })();

    // promote button: visible only when Now empty and Next has open tasks (and not in Done tab)
    var nowOpen = openAll.filter(function (t) { return t.bucket === 'session'; });
    var nextOpen = openAll.filter(function (t) { return t.bucket === 'next'; });
    if (nowOpen.length === 0 && nextOpen.length > 0 && (filter === 'all' || filter === 'session')) {
      var promo = el('button', 'promote-btn', 'Move ' + nextOpen.length + ' from Next → Now');
      promo.type = 'button';
      promo.addEventListener('click', function () { post('todo:promoteNext'); });
      elList.append(promo);
    }

    if (!tasks.length) {
      elList.append(el('div', 'empty muted', 'Nothing yet. Type above and press Enter.'));
      return;
    }
    if (open.length === 0) {
      elList.append(el('div', 'empty muted', 'No tasks in this filter.'));
      return;
    }

    // group open tasks by kind (Feature/Fix/Improvement)
    KIND_SECTIONS.forEach(function (sec) {
      var items = open.filter(function (t) { return t.kind === sec.id; });
      if (!items.length) { return; }
      var h = el('h3');
      h.tabIndex = 0;
      var isCollapsed = !!collapsed[sec.id];
      h.append(el('span', '', isCollapsed ? '▸' : '▾'), el('span', '', sec.label), el('span', 'n', '(' + items.length + ')'));
      var flip = function () {
        collapsed[sec.id] = !isCollapsed;
        setUi({ collapsed: collapsed });
        render();
      };
      h.addEventListener('click', flip);
      h.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); }
      });
      elList.append(h);
      if (!isCollapsed) { items.forEach(function (t) { elList.append(rowNode(t)); }); }
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') { return; }
    if (msg.type === 'settings' && msg.settings) { ctl.setSettings(msg.settings); }
    else if (msg.type === 'todo:list') {
      tasks = Array.isArray(msg.tasks) ? msg.tasks : [];
      clearError();
      render();
    }
    else if (msg.type === 'todo:error' && msg.message) { showError(msg.message); }
    else if (msg.type === 'react') { ctl.mood(msg.name || 'base', msg.say); }
  });

  setSheets('fox');
  ctl.setSettings({ enabled: true, characterId: 'fox', size: 140, clickReaction: true, autoReaction: true, followPointer: true });
  ctl.paint();
  ctl.bindVisibility();
  ctl.startIdle();
  ctl.scheduleGreeting();
  syncFilter();

  post('ready');
})();
