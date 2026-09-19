/**
 * charts.js — hand-written SVG chart functions (no libraries, zero network).
 * Pure functions returning SVG strings — no DOM writes inside.
 *
 * Contract (§9.1): theme colours from --vscode-charts-* with hardcoded
 * fallbacks; 11 px axis labels in --vscode-descriptionForeground; every chart
 * role="img" + aria-label; every datum a <title> tooltip; empty state is a
 * dashed-border box reading "No data yet. Keep coding.";
 * prefers-reduced-motion disables transitions; shared fmtDuration.
 *
 * UMD wrapper so node --test can snapshot the strings.
 */
(function (root, factory) {
  var api = factory();
  root.MascotCharts = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(globalThis, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** m/h, 1-decimal hours shared formatter. */
  function fmtDuration(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 60) { return mins + 'm'; }
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h < 100) { return h + 'h ' + m + 'm'; }
    return h + 'h';
  }

  function fmtHours(ms) {
    return (ms / 3600000).toFixed(1) + 'h';
  }

  function emptyBox(label) {
    return '<div class="chart-empty" role="img" aria-label="' + esc(label || 'No data') + '">'
      + 'No data yet. Keep coding.</div>';
  }

  function cssVar(name, fallback) {
    // Runtime resolution happens in CSS; SVG uses var() directly so themes
    // (light/dark/high-contrast) apply without JS.
    return 'var(' + name + ', ' + fallback + ')';
  }

  var BLUE = cssVar('--vscode-charts-blue', '#4f6bed');
  var GREEN = cssVar('--vscode-charts-green', '#4caf50');
  var RED = cssVar('--vscode-charts-red', '#e51400');
  var ORANGE = cssVar('--vscode-charts-orange', '#d67e2c');
  var MUTED = cssVar('--vscode-descriptionForeground', '#6b7280');
  var GRID = cssVar('--vscode-editorWidget-border', 'rgba(127,127,127,0.28)');

  function hasData(values) {
    return Array.isArray(values) && values.some(function (v) {
      if (typeof v === 'number') { return v > 0; }
      if (v && typeof v === 'object') {
        return Object.keys(v).some(function (k) {
          if (k === 'date' || k === 'label' || k === 'path' || k === 'name') { return false; }
          return (v[k] | 0) > 0;
        });
      }
      return false;
    });
  }

  /** Vertical bars: trend (day → ms) or hourly (hour → ms). */
  function barChart(items, opts) {
    opts = opts || {};
    var W = opts.width || 560;
    var H = opts.height || 160;
    var padL = 34;
    var padB = 20;
    var padT = 8;
    var max = Math.max.apply(null, items.map(function (d) { return d.ms || d.value || 0; }).concat([1]));
    if (!hasData(items.map(function (d) { return d.ms || d.value || 0; }))) { return emptyBox(opts.label || 'Trend'); }
    var n = Math.max(1, items.length);
    var slot = (W - padL - 4) / n;
    var bw = Math.max(2, Math.min(26, slot * 0.62));
    var innerH = H - padT - padB;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || ('Trend, ' + n + ' bars')) + '">';
    out += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="' + GRID + '" stroke-width="1"/>';
    items.forEach(function (d, i) {
      var v = d.ms || d.value || 0;
      var h = Math.max(v > 0 ? 2 : 0, (v / max) * innerH);
      var x = padL + i * slot + (slot - bw) / 2;
      var y = H - padB - h;
      var tip = esc((d.tip || d.date || d.hour || ('bar ' + i)) + ' · ' + fmtHours(v));
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1)
        + '" rx="2" fill="' + BLUE + '"><title>' + tip + '</title></rect>';
      if (opts.showX && (n <= 12 || i % Math.ceil(n / 12) === 0)) {
        out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" font-size="11" fill="' + MUTED
          + '" text-anchor="middle">' + esc(d.xLabel || d.date || '') + '</text>';
      }
    });
    out += '<text x="2" y="' + (padT + 8) + '" font-size="11" fill="' + MUTED + '">' + fmtHours(max) + '</text>';
    out += '</svg>';
    return out;
  }

  /** Horizontal bars: [{ label, ms, pct?, title? }]. */
  function hBarChart(rows, opts) {
    opts = opts || {};
    if (!rows || rows.length === 0 || !rows.some(function (r) { return (r.ms || r.value || 0) > 0; })) {
      return emptyBox(opts.label || 'Breakdown');
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.ms || r.value || 0; }).concat([1]));
    var W = opts.width || 420;
    var rowH = opts.rowH || 26;
    var H = rows.length * rowH + 4;
    var labelW = opts.labelW || 110;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || (rows.length + ' categories')) + '">';
    rows.forEach(function (r, i) {
      var v = r.ms || r.value || 0;
      var y = i * rowH + 4;
      var w = Math.max(v > 0 ? 3 : 0, ((W - labelW - 86) * v) / max);
      var color = r.color || BLUE;
      var tip = esc((r.title || r.label) + ' · ' + fmtDuration(v) + (typeof r.pct === 'number' ? ' · ' + r.pct.toFixed(0) + '%' : ''));
      out += '<text x="0" y="' + (y + 14) + '" font-size="11" fill="' + MUTED + '">' + esc(String(r.label).slice(0, 22)) + '<title>' + esc(r.title || r.label) + '</title></text>';
      out += '<rect x="' + labelW + '" y="' + y + '" width="' + w.toFixed(1) + '" height="14" rx="3" fill="' + color + '"><title>' + tip + '</title></rect>';
      out += '<text x="' + (labelW + w + 6).toFixed(1) + '" y="' + (y + 12) + '" font-size="11" fill="' + MUTED + '">' + esc(r.valueLabel || fmtDuration(v)) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  /** Stacked pass/fail per day: [{ date, passed, failed }]. */
  function stackedBar(days, opts) {
    opts = opts || {};
    var W = opts.width || 560;
    var H = opts.height || 150;
    var padB = 20;
    var innerH = H - 8 - padB;
    var max = Math.max.apply(null, days.map(function (d) { return (d.passed || 0) + (d.failed || 0); }).concat([1]));
    if (!hasData(days.map(function (d) { return (d.passed || 0) + (d.failed || 0); }))) { return emptyBox(opts.label || 'Tests'); }
    var n = Math.max(1, days.length);
    var slot = (W - 8) / n;
    var bw = Math.max(4, Math.min(30, slot * 0.6));
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Pass/fail per day') + '">';
    days.forEach(function (d, i) {
      var p = d.passed || 0;
      var f = d.failed || 0;
      var total = p + f;
      var h = Math.max(total > 0 ? 3 : 0, (total / max) * innerH);
      var ph = total > 0 ? (p / total) * h : 0;
      var fh = h - ph;
      var x = 4 + i * slot + (slot - bw) / 2;
      var yTop = H - padB - h;
      var tip = esc(d.date + ' · ' + p + ' passed · ' + f + ' failed');
      out += '<g><title>' + tip + '</title>'
        + '<rect x="' + x.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + fh.toFixed(1) + '" fill="' + RED + '"/>'
        + '<rect x="' + x.toFixed(1) + '" y="' + (yTop + fh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + ph.toFixed(1) + '" fill="' + GREEN + '"/></g>';
    });
    out += '</svg>';
    return out;
  }

  /** Line chart: values[] with optional labels (switches/day, errors/day). */
  function lineChart(values, opts) {
    opts = opts || {};
    var W = opts.width || 420;
    var H = opts.height || 120;
    var pad = 6;
    if (!hasData(values)) { return emptyBox(opts.label || 'Trend line'); }
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var pts = values.map(function (v, i) {
      var x = n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1);
      var y = H - pad - ((v / max) * (H - pad * 2));
      return { x: x, y: y, v: v, label: (opts.labels && opts.labels[i]) || ('point ' + i) };
    });
    var d = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Line chart') + '">';
    out += '<path d="' + d + '" fill="none" stroke="' + (opts.color || BLUE) + '" stroke-width="2" stroke-linecap="round"/>';
    pts.forEach(function (p) {
      out += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="' + (opts.color || BLUE) + '"><title>' + esc(p.label + ' · ' + p.v) + '</title></circle>';
    });
    out += '</svg>';
    return out;
  }

  /** 24 h strip: rect per session with hover "09:12–10:03 · 51m". */
  function timelineStrip(sessions, opts) {
    opts = opts || {};
    var W = opts.width || 560;
    var H = opts.height || 44;
    if (!sessions || sessions.length === 0) { return emptyBox(opts.label || 'Sessions today'); }
    var dayMs = 86400000;
    function fmtT(ts) {
      var d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || (sessions.length + ' sessions today')) + '">';
    out += '<rect x="0" y="10" width="' + W + '" height="14" rx="7" fill="' + GRID + '" opacity="0.45"/>';
    sessions.forEach(function (s) {
      var d0 = new Date(s.start);
      d0.setHours(0, 0, 0, 0);
      var a = Math.max(0, Math.min(dayMs, s.start - d00(d0)));
      var b = Math.max(0, Math.min(dayMs, s.end - d00(d0)));
      function d00(x) { return x.getTime(); }
      var x = (a / dayMs) * W;
      var w = Math.max(3, ((b - a) / dayMs) * W);
      var tip = esc(fmtT(s.start) + '–' + fmtT(s.end) + ' · ' + fmtDuration(Math.max(0, s.end - s.start)));
      out += '<rect x="' + x.toFixed(1) + '" y="8" width="' + w.toFixed(1) + '" height="18" rx="5" fill="' + BLUE + '"><title>' + tip + '</title></rect>';
    });
    out += '<text x="0" y="' + (H - 2) + '" font-size="11" fill="' + MUTED + '">00</text>';
    out += '<text x="' + (W - 14) + '" y="' + (H - 2) + '" font-size="11" fill="' + MUTED + '">24</text>';
    out += '</svg>';
    return out;
  }

  /** Tiny inline sparkline (summary reuses the ▁▂▅ glyph version; this is the SVG one). */
  function sparkline(values, opts) {
    opts = opts || {};
    return lineChart(values, { width: 180, height: 36, label: opts.label || '7-day activity', color: BLUE });
  }

  return {
    fmtDuration: fmtDuration,
    fmtHours: fmtHours,
    emptyBox: emptyBox,
    barChart: barChart,
    hBarChart: hBarChart,
    stackedBar: stackedBar,
    lineChart: lineChart,
    timelineStrip: timelineStrip,
    sparkline: sparkline,
    COLORS: { BLUE: BLUE, GREEN: GREEN, RED: RED, ORANGE: ORANGE },
  };
});
