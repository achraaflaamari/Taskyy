/**
 * Dashboard runtime (Phase 4: sections A–D + header + range).
 * Sections E–K land in Phase 5. Shared MascotController drives the header
 * mascot (faces + webview-local pointer gaze — never typing/caret/focus).
 *
 * Extension → webview: settings / stats / liveTick / react
 * Webview → extension: ready / setRange / openFile / command / openAnalytics
 */
(function () {
  'use strict';

  var charts = globalThis.MascotCharts;
  var sprite = globalThis.MascotSprite;
  var reactions = globalThis.MascotReactions;
  var factory = globalThis.MascotController;
  var vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  function post(type, extra) {
    if (!vscode) { return; }
    try { vscode.postMessage(Object.assign({ type: type }, extra || {})); }
    catch (e) { /* ignore */ }
  }

  var MASCOTS_ROOT = (document.body && document.body.dataset.mascotsRoot) || '';

  // ---- header mascot ----
  var mascotEl = document.getElementById('dash-mascot');
  var dirLayer = mascotEl ? mascotEl.querySelector('.mascot-directions') : null;
  var reactLayer = mascotEl ? mascotEl.querySelector('.mascot-reactions') : null;
  var squashEl = mascotEl ? mascotEl.querySelector('.mascot-squash') : null;
  function sheetUrl(id, kind) { return MASCOTS_ROOT + '/' + id + '-' + kind + '.webp'; }
  function setSheets(id) {
    if (dirLayer) { dirLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'directions') + '")'; }
    if (reactLayer) { reactLayer.style.backgroundImage = 'url("' + sheetUrl(id, 'reactions') + '")'; }
  }

  var ctl = factory ? factory.create(
    {
      sprite: sprite, reactions: reactions, characters: globalThis.MascotCharacters,
      setSheets: setSheets,
      label: function (id) { return (globalThis.MascotCharacters || { label: function (x) { return x; } }).label(id); },
    },
    { mascotEl: mascotEl, dirLayer: dirLayer, reactLayer: reactLayer, squashEl: squashEl, bubbleEl: null, bubbleText: document.getElementById('dash-say') },
  ) : null;

  if (mascotEl && ctl) { mascotEl.addEventListener('click', function (ev) { ev.preventDefault(); ctl.boop(); }); }

  // Pointer-follow gaze (webview-local only; centers on leave).
  var aimer = globalThis.MascotAim && globalThis.MascotAim.createAimer
    ? globalThis.MascotAim.createAimer()
    : null;
  if (aimer && mascotEl && ctl) {
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
  var range = 'today';
  var payload = null;
  var liveErrors = 0;

  function fmtDuration(ms) {
    if (charts && charts.fmtDuration) { return charts.fmtDuration(ms); }
    var mins = Math.round(ms / 60000);
    if (mins < 60) { return mins + 'm'; }
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }
  function fmtPct(x) { return x === null || x === undefined ? '—' : Math.round(x * 100) + '%'; }
  function fmtMsOrDash(ms) { return ms === null || ms === undefined ? '—' : fmtDuration(ms); }

  function $(id) { return document.getElementById(id); }

  // ---- headline insight (§9 precedence) ----
  function headline(p) {
    if (!p || !p.kpis || p.kpis.activeMs === 0) { return 'No data yet for this range.'; }
    // Week-over-week delta when range spans enough trend data.
    try {
      var trend = p.trend || [];
      if (trend.length >= 14) {
        var last7 = trend.slice(-7).reduce(function (a, d) { return a + d.ms; }, 0);
        var prev7 = trend.slice(-14, -7).reduce(function (a, d) { return a + d.ms; }, 0);
        if (prev7 > 0) {
          var delta = Math.round(((last7 - prev7) / prev7) * 100);
          return (delta >= 0 ? '+' : '') + delta + '% vs last 7 days';
        }
      }
    } catch (e) { /* fall through */ }
    var msToday = (p.hourlyToday || []).reduce(function (a, b) { return a + b; }, 0);
    var sessionsToday = (p.sessionsToday || []).length;
    if (msToday > 0) { return fmtDuration(msToday) + ' today across ' + sessionsToday + (sessionsToday === 1 ? ' session' : ' sessions'); }
    var achieved = (p.milestones || []).filter(function (m) { return m.ts; }).pop();
    if (achieved) { return fmtDuration(p.kpis.totalMs) + ' total — milestone reached: ' + achieved.label; }
    return fmtDuration(p.kpis.activeMs) + ' in this range across ' + p.kpis.sessions + ' sessions.';
  }

  function renderHeader() {
    var insight = $('headline');
    if (insight && payload) { insight.textContent = headline(payload); }
  }

  // ---- A. KPI row (6 cards) ----
  function renderKpis() {
    var host = $('kpi');
    if (!host || !payload) { return; }
    var k = payload.kpis;
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function card(value, label, sub, title) {
      return '<div class="kpi"><div class="kpi-value"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(value) + '</div>'
        + '<div class="kpi-label">' + esc(label) + '</div><div class="kpi-sub"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(sub) + '</div></div>';
    }
    function shortPath(p, max) {
      max = max || 28;
      if (!p || p.length <= max) { return p || '—'; }
      var keep = Math.floor((max - 1) / 2);
      return p.slice(0, keep) + '…' + p.slice(p.length - keep);
    }
    var avgRec = k.avgRecoveryMs === null
      ? card('—', 'Errors', 'recovery —', 'No recoveries recorded in this range')
      : card(String(k.errorsSeen), 'Errors', 'recovery ' + fmtDuration(k.avgRecoveryMs), null);
    var filesSub = k.mostActiveFile ? shortPath(k.mostActiveFile) : 'No files tracked';
    var filesTitle = k.mostActiveFile ? 'Most active: ' + k.mostActiveFile : 'No files tracked in this range';
    host.innerHTML =
      card(fmtDuration(k.activeMs), 'Active time', 'total ' + fmtDuration(k.totalMs), null)
      + card(String(k.sessions), 'Sessions', 'avg ' + fmtDuration(k.avgSessionMs), k.sessions ? null : 'No sessions in this range')
      + card(String(k.filesTouched), 'Files touched', filesSub, filesTitle)
      + avgRec
      + card(String(k.testRuns), 'Test runs', 'pass ' + fmtPct(k.passRate), k.testRuns ? null : 'No test runs detected')
      + card(String(k.commits), 'Commits', (payload.uncommitted === null ? '— uncommitted' : payload.uncommitted + ' uncommitted'), null);
  }

  function dayLabel(dateStr) {
    try {
      var parts = dateStr.split('-').map(Number);
      var d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    } catch (e) { return dateStr; }
  }

  // ---- B. Trend ----
  function renderTrend() {
    var host = $('trend-chart');
    var text = $('trend-text');
    if (!host || !payload || !charts) { return; }
    if (range === 'today') {
      var hours = (payload.hourlyToday || []).map(function (ms, h) {
        return { hour: String(h).padStart(2, '0') + ':00', ms: ms, tip: String(h).padStart(2, '0') + ':00 · ' + charts.fmtHours(ms), xLabel: h % 4 === 0 ? String(h) : '' };
      });
      host.innerHTML = charts.barChart(hours, { label: 'Coding hours by hour today', showX: false });
      if (text) { text.textContent = 'Hourly bars, 00–24. Hover a bar for the exact value.'; }
    } else {
      var items = (payload.trend || []).map(function (d) {
        return { date: dayLabel(d.date), ms: d.ms, tip: charts.fmtHours(d.ms) + ' · ' + d.date };
      });
      host.innerHTML = charts.barChart(items, { label: 'Active time per day', showX: true });
      if (text) { text.textContent = 'Y in hours (1 decimal). Hover a bar for the exact value.'; }
    }
  }

  // ---- C. Activity mix (estimated) ----
  function renderMix() {
    var host = $('mix-chart');
    if (!host || !payload || !charts) { return; }
    var mix = payload.mix || {};
    var total = ['coding', 'debugging', 'testing', 'git', 'terminal'].reduce(function (a, k) { return a + (mix[k] || 0); }, 0);
    var rows = ['coding', 'debugging', 'testing', 'git', 'terminal'].map(function (k) {
      var v = mix[k] || 0;
      return {
        label: k.charAt(0).toUpperCase() + k.slice(1), title: k, ms: v,
        pct: total > 0 ? (v / total) * 100 : 0,
        valueLabel: fmtDuration(v) + ' · ' + (total > 0 ? Math.round((v / total) * 100) + '%' : '—'),
      };
    });
    host.innerHTML = charts.hBarChart(rows, { label: 'Activity mix, estimated' });
  }

  // ---- D. Today timeline ----
  function renderTimeline() {
    var host = $('timeline-chart');
    var text = $('timeline-text');
    if (!host || !payload || !charts) { return; }
    host.innerHTML = charts.timelineStrip(payload.sessionsToday || [], { label: 'Sessions today' });
    var n = (payload.sessionsToday || []).length;
    if (text) { text.textContent = n === 0 ? 'No sessions today yet.' : n + (n === 1 ? ' session' : ' sessions') + ' today. Hover a block for exact times.'; }
  }

  function truncateMiddle(p, max) {
    max = max || 42;
    if (p.length <= max) { return p; }
    var keep = Math.floor((max - 1) / 2);
    return p.slice(0, keep) + '…' + p.slice(p.length - keep);
  }

  // ---- E. Focus ----
  function renderFocus() {
    var host = $('focus-chart');
    var text = $('focus-text');
    if (!host || !payload || !charts) { return; }
    var days = payload.trend || [];
    // Switches per day is not in the payload; derive zeros + total note.
    // Use errorsDaily length to size the series; values come from kpis when
    // the range is a single day, else spread evenly for the line shape.
    var k = payload.kpis;
    var n = Math.max(1, days.length);
    var per = k.switches / n;
    var values = days.map(function () { return Math.round(per); });
    if (n === 1) { values = [k.switches]; }
    host.innerHTML = charts.lineChart(values, {
      label: 'Context switches per day',
      labels: days.map(function (d) { return d.date; }),
    });
    if (text) {
      text.textContent = 'avg session ' + fmtDuration(k.avgSessionMs) + ' · ' + k.switches + ' switches. '
        + 'Lower switching often means longer focus blocks.';
    }
  }

  // ---- F. Top files (click = open) ----
  function renderFiles() {
    var host = $('files-chart');
    var text = $('files-text');
    if (!host || !payload || !charts) { return; }
    var top = payload.topFiles || [];
    if (top.length === 0) {
      var off = payload.kpis && payload.kpis.filesTouched === 0 && (payload.folders || []).length > 0;
      host.innerHTML = charts.emptyBox('Top files');
      if (text) { text.textContent = off ? 'File tracking is off — folder hotspots still work.' : ''; }
      return;
    }
    if (text) { text.textContent = ''; }
    host.innerHTML = '';
    var max = Math.max.apply(null, top.map(function (f) { return f.ms; }).concat([1]));
    top.forEach(function (f) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-row';
      btn.setAttribute('title', f.path + ' · ' + fmtDuration(f.ms));
      var pct = Math.max(f.ms > 0 ? 2 : 0, (f.ms / max) * 100);
      btn.innerHTML = '<span style="display:flex;align-items:center;gap:8px;font-size:12px;">'
        + '<span style="flex:0 0 220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-editor-foreground)">' + truncateMiddle(f.path).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'
        + '<span style="flex:1;height:12px;background:transparent;position:relative;">'
        + '<span style="display:block;height:12px;border-radius:3px;background:var(--vscode-charts-blue,#4f6bed);width:' + pct.toFixed(1) + '%"></span></span>'
        + '<span style="color:var(--vscode-descriptionForeground)" >' + fmtDuration(f.ms) + '</span></span>';
      btn.addEventListener('click', function () { post('openFile', { relPath: f.path }); });
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { post('openFile', { relPath: f.path }); }
      });
      host.appendChild(btn);
    });
  }

  // ---- G. Hotspots ----
  function renderHotspots() {
    var host = $('hotspots-chart');
    if (!host || !payload || !charts) { return; }
    var folders = payload.folders || [];
    var total = folders.reduce(function (a, f) { return a + f.ms; }, 0);
    var rows = folders.slice(0, 10).map(function (f) {
      return {
        label: f.name, title: f.name, ms: f.ms,
        pct: total > 0 ? (f.ms / total) * 100 : 0,
        valueLabel: total > 0 ? Math.round((f.ms / total) * 100) + '%' : '—',
      };
    });
    host.innerHTML = charts.hBarChart(rows, { label: 'Folder share of total' });
  }

  // ---- H. Tests ----
  function renderTests() {
    var host = $('tests-chart');
    var text = $('tests-text');
    if (!host || !payload || !charts) { return; }
    host.innerHTML = charts.stackedBar(payload.testsDaily || [], { label: 'Pass/fail per day' });
    if (text) {
      var lt = payload.lastTest;
      var k = payload.kpis;
      var base = k.testRuns + (k.testRuns === 1 ? ' run' : ' runs') + ' · pass ' + (k.passRate === null ? '—' : Math.round(k.passRate * 100) + '%');
      if (lt) {
        var d = new Date(lt.ts);
        var hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        text.textContent = base + ' · Last run: ' + (lt.passed ? 'passed' : 'failed') + ' · ' + lt.label + ' · ' + hh;
      } else {
        text.textContent = base;
      }
    }
  }

  // ---- I. Errors ----
  function renderErrors() {
    var host = $('errors-chart');
    var text = $('errors-text');
    if (!host || !payload || !charts) { return; }
    var days = payload.errorsDaily || [];
    host.innerHTML = charts.lineChart(days.map(function (d) { return d.seen; }), {
      label: 'Errors seen per day',
      labels: days.map(function (d) { return d.date; }),
      color: 'var(--vscode-charts-red, #e51400)',
    });
    if (text) {
      var avg = payload.kpis.avgRecoveryMs;
      text.textContent = 'avg recovery ' + (avg === null ? '—' : fmtDuration(avg))
        + ' · ' + liveErrors + ' open now.';
    }
  }

  // ---- J. Commits ----
  function renderCommits() {
    var host = $('commits-chart');
    var text = $('commits-text');
    if (!host || !payload || !charts) { return; }
    var days = payload.commitsDaily || [];
    host.innerHTML = charts.barChart(days.map(function (d) {
      return { date: dayLabel(d.date), ms: Math.max(d.commits * 3600000, d.commits > 0 ? 1 : 0), value: d.commits, tip: d.commits + (d.commits === 1 ? ' commit' : ' commits') + ' · ' + d.date };
    }), { label: 'Commits per day' });
    if (text) {
      text.textContent = payload.uncommitted === null
        ? '— uncommitted changes (git API unavailable)'
        : payload.uncommitted + ' uncommitted changes';
    }
  }

  // ---- K. Milestones ----
  function renderMilestones() {
    var host = $('milestones-list');
    if (!host || !payload) { return; }
    host.innerHTML = '';
    (payload.milestones || []).forEach(function (m) {
      var div = document.createElement('div');
      div.className = 'mstone' + (m.ts ? ' done' : '');
      var label = document.createElement('span');
      label.textContent = m.label;
      div.appendChild(label);
      if (m.ts) {
        var d = document.createElement('span');
        d.className = 'mdate';
        try { d.textContent = new Date(m.ts).toLocaleDateString(); }
        catch (e) { d.textContent = ''; }
        div.appendChild(d);
      }
      div.setAttribute('role', 'listitem');
      div.setAttribute('aria-label', m.label + (m.ts ? ', achieved' : ', pending'));
      host.appendChild(div);
    });
  }

  // ---- data-driven moods (§10, faces only — never gaze) ----
  var knownMilestones = {};
  var milestonesPrimed = false;
  var rangeJustChanged = false;

  function kpiMood(p) {
    try {
      var trend = p.trend || [];
      if (trend.length >= 14) {
        var last7 = trend.slice(-7).reduce(function (a, d) { return a + d.ms; }, 0);
        var prev7 = trend.slice(-14, -7).reduce(function (a, d) { return a + d.ms; }, 0);
        if (prev7 > 0 && last7 < prev7) { return 'bashful'; }
      }
    } catch (e) { /* base */ }
    return 'base';
  }
  function testsMood(p) {
    var k = p.kpis || {};
    if (!k.testRuns) { return 'base'; }
    if (k.passRate !== null && k.passRate >= 0.9) { return 'delighted'; }
    if (k.passRate !== null && k.passRate < 0.7) { return 'surprised'; }
    return 'base';
  }
  function errorsMood(p) {
    var days = p.errorsDaily || [];
    var total = days.reduce(function (a, d) { return a + d.seen; }, 0);
    if (total === 0) { return 'delighted'; }
    if (days.length >= 2) {
      var half = Math.floor(days.length / 2);
      var first = days.slice(0, half).reduce(function (a, d) { return a + d.seen; }, 0);
      var second = days.slice(half).reduce(function (a, d) { return a + d.seen; }, 0);
      if (second > first) { return 'surprised'; }
    }
    return 'base';
  }
  function commitsMood(p) {
    var today = (p.commitsDaily || []).slice(-1)[0];
    if (today && today.commits > 0) { return 'heart'; }
    return 'base';
  }
  function overallMood(p) {
    if (!p || !p.kpis) { return 'base'; }
    if (liveErrors > 0) { return 'surprised'; }
    var t = testsMood(p);
    if (t !== 'base') { return t; }
    var e = errorsMood(p);
    if (e !== 'base' && p.kpis.errorsSeen > 0) { return e; }
    return commitsMood(p);
  }
  function checkMilestones(p) {
    if (!ctl) { return; }
    var achieved = {};
    (p.milestones || []).forEach(function (m) { if (m.ts) { achieved[m.id] = m; } });
    if (!milestonesPrimed) {
      knownMilestones = achieved;
      milestonesPrimed = true;
      return;
    }
    Object.keys(achieved).forEach(function (id) {
      if (!knownMilestones[id]) {
        ctl.mood('starstruck', achieved[id].label);
      }
    });
    knownMilestones = achieved;
  }
  function moodForSection(sec) {
    if (!payload) { return 'base'; }
    if (sec === 'sec-kpi') { return kpiMood(payload); }
    if (sec === 'sec-trend') { return 'base'; } // sparkle only on range change
    if (sec === 'sec-tests') { return testsMood(payload); }
    if (sec === 'sec-errors') { return errorsMood(payload); }
    if (sec === 'sec-commits') { return commitsMood(payload); }
    return 'base';
  }
  function observeSections() {
    if (typeof IntersectionObserver !== 'function' || !ctl) { return; }
    try {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.intersectionRatio >= 0.6 && payload) {
            var id = en.target.id;
            if (id === 'sec-milestones') {
              // Milestone celebrations are handled by checkMilestones on stats.
              return;
            }
            var face = moodForSection(id);
            if (face && face !== 'base') { ctl.mood(face, null); }
          }
        });
      }, { threshold: [0.6] });
      ['sec-kpi', 'sec-trend', 'sec-distribution', 'sec-files', 'sec-hotspots',
       'sec-tests', 'sec-errors', 'sec-commits', 'sec-milestones'].forEach(function (id) {
        var el = $(id);
        if (el) { obs.observe(el); }
      });
    } catch (e) { /* Observer is progressive enhancement */ }
  }

  // ---- L. Tasks (v0.5 todo list) ----
  function renderTasks() {
    var host = $('tasks-chart');
    var text = $('tasks-text');
    if (!host || !payload || !charts) { return; }
    var days = payload.tasksDaily || [];
    host.innerHTML = charts.barChart(days.map(function (d) {
      return { date: dayLabel(d.date), ms: Math.max(d.completed * 3600000, d.completed > 0 ? 1 : 0), value: d.completed, tip: d.completed + (d.completed === 1 ? ' task done' : ' tasks done') + ' · ' + d.created + ' created · ' + d.date };
    }), { label: 'Tasks completed per day' });
    if (text) {
      var done = days.reduce(function (a, d) { return a + d.completed; }, 0);
      text.textContent = payload.tasksOpen + ' open · ' + payload.tasksOverdue + ' overdue · ' + done + ' done in range.';
    }
  }

  function renderAll() {
    renderHeader();
    renderKpis();
    renderTrend();
    renderMix();
    renderTimeline();
    renderFocus();
    renderFiles();
    renderHotspots();
    renderTests();
    renderErrors();
    renderCommits();
    renderMilestones();
    renderTasks();
    if (ctl && payload) {
      checkMilestones(payload);
      if (rangeJustChanged) {
        rangeJustChanged = false;
        ctl.react('sparkle', 700); // trend acknowledge, then range mood
        ctl.mood(overallMood(payload), headline(payload));
      } else {
        ctl.mood(overallMood(payload), headline(payload));
      }
    }
  }

  // ---- range tabs ----
  var tabs = document.querySelectorAll('.range-tabs button');
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = btn.getAttribute('data-range');
      if (!next || next === range) { return; }
      range = next;
      rangeJustChanged = true;
      tabs.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      if (ctl) { ctl.react('surprised', 600); }
      post('setRange', { range: range });
    });
  });

  // ---- header shrink (layout only, never gaze) ----
  var head = document.querySelector('.dash-head');
  document.addEventListener('scroll', function () {
    if (!head) { return; }
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    head.classList.toggle('shrink', y > 80);
  }, { passive: true });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') { return; }
    if (msg.type === 'settings' && msg.settings && ctl) { ctl.setSettings(msg.settings); }
    else if (msg.type === 'stats' && msg.data) {
      if (msg.range) { range = msg.range; }
      payload = msg.data;
      renderAll();
    }
    else if (msg.type === 'liveTick') {
      liveErrors = msg.errorsNow || 0;
      void liveErrors;
      // Live error spike: face only, no bubble spam (Phase 6 behaviour preview).
      if (ctl && msg.errorsNow > 0) { ctl.react('surprised', 600); }
    }
    else if (msg.type === 'react' && ctl) { ctl.mood(msg.name || 'base', msg.say); }
    else if (msg.type === 'state' && msg.kind) {
      var insight = $('headline');
      if (insight) {
        insight.textContent = msg.kind === 'no-workspace'
          ? 'Open a folder to start tracking.'
          : 'Tracking is off — enable mascot.analytics.enabled in Settings.';
      }
    }
  });

  setSheets('fox');
  if (ctl) {
    ctl.setSettings({ enabled: true, characterId: 'fox', size: 96, clickReaction: true, autoReaction: true });
    ctl.paint();
    ctl.bindVisibility();
    ctl.startIdle();
    ctl.scheduleGreeting();
  }
  observeSections();

  post('ready');
})();
