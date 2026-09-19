# Mascot Analytics — Professional Build Plan (v2)

> Status: planning. Companion is at v0.3 (event-only). This document is the
> single source of truth for the analytics build and **supersedes DOCS.md v1
> §§3, 4, 7, 11, 12** where they describe gaze/cursor-follow behaviour.
> Nothing here is simplified: every module, message, setting, chart, state
> and acceptance check is specified before code is written.

## 0. Where we stand (v0.3, verified)

- Extension compiles clean (`npm run compile`, `node --check` on the webview).
- Companion is **event-only**: no typing reaction, no caret follow, no
  terminal/focus gaze, no `trackPointer`, no `fastTyping` / `pasteLarge`.
  Six signals remain: `errorsUp, errorsZero, termFail, termOk, taskOk,
  gitCommit` + save/debug notices. Base face is the fixed `center` cell;
  reactions overlay it. Bubbles are rate-limited (1/30 s).
- Explorer view is a professional card: header (status dot + text), icon
  toolbar (analytics / boop / settings), one-line bubble, mascot stage,
  footer meta line. Styling uses `--vscode-*` tokens only.
- `noteSilentActivity('typing'|'selection'|'focus')` stub exists in
  `extension.ts` — the seam analytics will subscribe to. Nothing is
  forwarded to the view.
- `mascot.openAnalytics` exists as an info-message stub so the toolbar
  never hits "command not found".

## 1. Vision and non-negotiable principles

1. **Calm companion, honest data.** The mascot never watches typing or
   cursor movement. It reacts to discrete workspace events and to
   aggregate data (moods from stats). The dashboard never pretends to know
   more than it measured — heuristics are labelled "estimated".
2. **Local-first, zero network.** No CDN, no remote fonts, no chart
   libraries, no telemetry. All persistence is `workspaceState`. No file
   contents or code are ever stored — only relative paths and timings.
3. **Native before custom.** Layout, spacing, typography and iconography
   follow VS Code conventions (`--vscode-*` tokens, 11–13 px type,
   6–8 px radii, codicon-style 15 px line icons). No gradientAI look:
   no purple glows, no glassmorphism, no marketing hero sections.
4. **Professional information density.** Summary fits 250–350 px. Dashboard
   caps at 1100 px, collapses to one column under 700 px. Every number has
   a unit and a time window. Every chart has an accessible text equivalent.
5. **No regressions.** The companion keeps working byte-for-byte through
   every phase. Each phase ends with `npm run compile` + manual F5 check.

## 2. Architecture

```
┌─ VS Code events ───────────────────────────────────────────┐
│ text/selection/editor │ terminal/shell │ tasks │ debug │   │
│ diagnostics │ git (vscode.git + .git/logs fallback) │ window│
└───────────────┬────────────────────────────────────────────┘
                ▼
       activityHub.ts  (normalize + debounce + classify inputs)
         ├─► tracker.ts ──► statsStore.ts (workspaceState)
         │                        │  ▲
         │                        ▼  │ query(range)
         │              summaryProvider ◄──┐
         │              analyticsPanel ◄───┘
         └─► signal bus ──► companionProvider (signals + notices only)
```

- `activityHub.ts` (new): the **only** place that subscribes to VS Code
  events. Emits two disjoint streams:
  - `activity(kind, ts, meta)` → tracker (silent, high frequency).
  - `signal(name, extra)` / `notice(reaction)` → companion (rare, gated).
- `tracker.ts` (new): 5 s tick, idle/session accounting, activity
  classification, file/folder/hourly attribution.
- `statsStore.ts` (new): persistence + aggregation. Sole owner of
  `stats:v1:*` keys. Cached queries, pruning, reset.
- `gitStats.ts` (new): git API wrapper (HEAD hash watch, commit counting,
  uncommitted count). No CLI spawns except `repo.exec('rev-list')` when
  available.
- `summaryProvider.ts` (new): sidebar view in the Activity Bar container.
- `analyticsPanel.ts` (new): singleton `WebviewPanel` dashboard.
- `companionProvider.ts` = current `mascotViewProvider.ts` (rename
  optional; keep the view id `mascotExplorerView` stable).
- `media/shared/mascotController.js` (new): extracted reusable controller
  (`react/say/setSettings/sleep/wake`, **no `aimAt`** — gaze was deleted
  project-wide). Used by companion, summary mini-mascot and dashboard
  header from one implementation.
- `media/analytics/{analytics.js, analytics.css, charts.js}` (new):
  dashboard runtime, styles and hand-written SVG chart functions.
- `media/activity-icon.svg` (new): 24×24 monochrome `currentColor` icon.

## 3. Data model (exact)

Storage: `context.workspaceState`. Keys `stats:v1:YYYY-MM-DD` (local date)
plus `stats:v1:meta`. Values are plain JSON, written at most every 30 s
and on deactivate.

```ts
interface DayRecord {
  date: string; // YYYY-MM-DD local
  activeMs: number;
  sessions: { start: number; end: number }[];
  byActivity: { coding: number; debugging: number; testing: number; git: number; terminal: number };
  files: Record<string, number>;   // workspace-relative path -> ms
  folders: Record<string, number>; // top-level folder -> ms
  switches: number;                // active-editor changes while active
  errors: { seen: number; recoveries: number[] };
  tests: { runs: number; passed: number; failed: number }; // command-level
  commits: number;
  hourly: number[]; // 24 buckets, ms
}
interface Meta {
  firstActivity: number;
  milestones: { id: string; ts: number }[];
}
```

Rules:

- Never store absolute paths, file contents, terminal output, or code.
- `files` keys are workspace-relative, capped (e.g. 500 entries/day,
  least-recently-attributed evicted first). When
  `analytics.trackFiles === false`, skip `files` and keep `folders` only.
- Ignore `node_modules`, `.git`, `out`, `dist`, `.vscode-test` for
  file/folder attribution (attribution skipped, time still counted).
- Prune keys older than `retentionDays` on activation.
- `resetStats` deletes all `stats:v1:*` after a modal confirmation.

Milestones (write-once into `meta.milestones`):
`first-session`, `first-commit`, `first-green-test`, `10-commits`,
`100-commits`, `10h`, `50h`, `100h`, `7-day-streak`.

Derived metrics (MVP 12, all range-parameterised): active time, session
count, avg session, files touched, most active file, context switches,
errors seen, avg error recovery, test runs, pass rate, commits, project
total time. Focus score is v2.1 (optional):
`1 - min(1, switches / max(1, activeMinutes * 0.5))`.

## 4. Tracking rules (exact)

**Active time.** Tick every 5 s. Let `idle = now - lastActivityTs`. If
`idle < idleSeconds`, credit 5 s (or `now - lastTick`, whichever is
smaller) to: `activeMs`, current activity bucket (§4.1), `files[activeFile]`
+ `folders[top]`, `hourly[localHour]`. Otherwise the tick credits nothing
and the current session is closed at `lastActivityTs`.

**Sessions.** A session opens on the first activity after an idle gap
`> idleSeconds` and closes at the last activity before the next such gap.
Sessions shorter than 60 s are still recorded (no minimum-length filter —
honesty over vanity).

**Activity sources.** `lastActivityTs` advances on: text change, selection
change, active editor change, terminal shell start/end, task start/end,
debug start/stop/breakpoint change, window focus, SCM change. It does
**not** advance on the tracker's own tick or on webview messages.

### 4.1 Classification (priority order, first match wins)

1. A test command/task is running → `testing`.
2. A debug session is active → `debugging`.
3. HEAD changed or SCM event within last 60 s → `git`.
4. Terminal shell activity or focus within last 30 s → `terminal`.
5. Else → `coding`.

Label the dashboard distribution "Activity mix (estimated)".

### 4.2 Test detection

A shell execution or task end counts as a test run when the executed line
matches
`/\b(jest|vitest|mocha|pytest|go test|cargo test|dotnet test|phpunit|npm( run)? test|pnpm test|yarn test)\b/`
or the task group is `Test`. Pass = exit code 0, fail = any other code.
Store command-level counts only (never per-test-case parsing).

### 4.3 Errors

Debounce `onDidChangeDiagnostics` by 500 ms. Count `Error` severity across
all files in the workspace. Track transitions of the **workspace total**:
0→>0 opens `errorStartTs`; >0→0 pushes `now - errorStartTs` into
`recoveries`; `seen` increases by the positive delta only. Average recovery
= mean of `recoveries` in range (null when empty — UI shows "—").

### 4.4 Commits

Primary: `vscode.git` API — watch each repo's `HEAD.commit`; on change,
`commits++` for today and record `lastGitTs`. Uncommitted count = staged +
unstaged change count via the API when exposed, else "—". Total-history
counts via `rev-list --count HEAD` only if `repo.exec` exists; otherwise
observed-only (label "since install").

## 5. Messaging protocol (extension ↔ webview)

Extension → webview:

```ts
{ type: 'settings'; settings }                       // all three surfaces
{ type: 'react'; name; say? }                        // name ∈ reactions.js (dashboard + summary moods)
{ type: 'stats'; range: 'today'|'7d'|'30d'|'all'; data: StatsPayload }
{ type: 'liveTick'; activeMsToday: number; errorsNow: number }
```

Webview → extension:

```ts
{ type: 'ready' }
{ type: 'setRange'; range: 'today'|'7d'|'30d'|'all' }
{ type: 'openAnalytics' }                            // summary button
{ type: 'openFile'; relPath: string }                // top-files bars
{ type: 'command'; id: 'problems' | 'nextError' }    // whitelist only
```

Rules: whitelist `command` ids and validate `relPath` stays inside the
workspace; ignore anything else. No `aim` / `editorActivity` messages exist
anymore — any such message is ignored and logged once in dev mode.

`StatsPayload` (single shape for summary + dashboard; dashboard ignores
fields it does not render):

```ts
interface StatsPayload {
  range: RangeKey;
  kpis: { activeMs: number; sessions: number; avgSessionMs: number;
          filesTouched: number; mostActiveFile: string | null;
          switches: number; errorsSeen: number; avgRecoveryMs: number | null;
          testRuns: number; passRate: number | null; commits: number;
          totalMs: number; activeDays: number };
  trend: { date: string; ms: number }[];
  hourlyToday: number[];
  mix: { coding: number; debugging: number; testing: number; git: number; terminal: number };
  sessionsToday: { start: number; end: number }[];
  topFiles: { path: string; ms: number }[];   // max 10
  folders: { name: string; ms: number }[];
  testsDaily: { date: string; passed: number; failed: number }[];
  errorsDaily: { date: string; seen: number }[];
  commitsDaily: { date: string; commits: number }[];
  spark7: number[];                            // 7-day activeMs, oldest→newest
  milestones: { id: string; label: string; ts: number | null }[];
  uncommitted: number | null;
  estimated: true;                             // classification disclaimer flag
}
```

## 6. package.json contributions (exact deltas)

```jsonc
"viewsContainers": { "activitybar": [
  { "id": "mascotAnalytics", "title": "Mascot Analytics", "icon": "media/activity-icon.svg" }
]},
"views": {
  "explorer": [ { "id": "mascotExplorerView", "name": "Mascot", "type": "webview" } ],
  "mascotAnalytics": [ { "id": "mascotSummaryView", "name": "Project Summary", "type": "webview" } ]
},
"commands": [
  { "command": "mascot.openAnalytics", "title": "Mascot: Open Analytics" }, // promote stub → real panel
  { "command": "mascot.resetStats", "title": "Mascot: Reset Project Stats" }
],
"activationEvents": [ "+onView:mascotSummaryView", "+onCommand:mascot.openAnalytics", "+onCommand:mascot.resetStats" ]
```

Settings (all under `mascot.`, existing five unchanged):

- `analytics.enabled` (boolean, true) — master switch.
- `analytics.idleSeconds` (number, 120, minimum 30) — idle threshold.
- `analytics.trackFiles` (boolean, true) — false stores folders only.
- `analytics.retentionDays` (number, 365, minimum 7) — pruning window.
- `reactToErrors` (boolean, true) — companion error reactions.
- `reactToTerminal` (boolean, true) — companion terminal reactions.
- `breakReminderMinutes` (number, 0 = off, minimum 0) — companion nudge.

When `analytics.enabled === false`: no listeners write to the store, no
`liveTick` is emitted, the Activity Bar container is hidden
(`when: mascot.analytics.enabled` via `viewsWelcome` guard or programmatic
`executeCommand('setContext')`), and the dashboard command shows an
informational message instead of a panel.

## 7. Explorer companion (v0.3, frozen + one addition)

Layout stays exactly as shipped: header / toolbar / bubble / stage /
footer. The **only** companion change in the analytics build is the
toolbar 📊 button switching from the info-message stub to revealing the
real dashboard singleton.

Reaction table (final, event-only — no gaze, no aim):

| Signal | Face | Bubble | Notes |
|---|---|---|---|
| Errors 0→>0 | `surprised` | none | honour `reactToErrors=false` → silent |
| Errors →0 | `delighted` 900 ms | "Clean." | |
| Terminal exit ≠0 | `surprised` 1200 ms | "Command failed." | honour `reactToTerminal=false` → silent |
| Terminal exit 0 | `delighted` 900 ms | none | quiet by design |
| Task exit 0 | `starstruck` 1100 ms | "Task passed." | |
| Save / debug start/stop | `sparkle`/`surprised`/`delighted` 900 ms | none | never wakes sleep |
| Commit | `sparkle→heart→delighted` 1600 ms | "Committed." | |
| Milestone | `delighted` + timeline | milestone name | via `react` message, not `signal` |
| Break reminder | `sleepy` | "N min without a break" | once/hour max, click snoozes, off when 0 |
| Boop | `blink→payoff→null` 560 ms | none | wakes sleep instead of reacting |

Global rules: bubbles ≤1/30 s; identical text ≤1/hour; failures of
critical events also `showWarningMessage` when the Explorer view is not
visible.

## 8. Sidebar summary (Activity Bar view)

Width 250–350 px. One sparkline max — no other charts. Mini mascot 72 px
top-left, driven by the shared controller (faces only).

```
┌────────────────────────────┐
│ [mascot 72]  project-name  │
│              N active days │
├────────────────────────────┤
│ TODAY                      │
│  3h 42m           active   │
│  18 files · 47 tests       │
│  6 errors · 4 sessions     │
├────────────────────────────┤
│ ▁▂▅▇▃▂▆  last 7 days      │
├────────────────────────────┤
│ PROJECT                    │
│  84h 21m · 23 days · 147c  │
├────────────────────────────┤
│ [ Open full analytics → ]  │
└────────────────────────────┘
```

Behaviour: requests `stats` on `ready`, re-renders on `stats` + `liveTick`
(5 s). Numbers render within 1 s of opening (cached payload first, fresh
payload immediately after). Button posts `openAnalytics`. When there is no
workspace folder, show "Open a folder to start tracking." When tracking is
disabled, show the disabled state with a link to settings. Time formatting:
`<1h` → "42m", `<100h` → "3h 42m", else "128h". Null pass-rate/recovery →
"—".

## 9. Full dashboard (WebviewPanel, editor tab)

Title `Mascot Analytics`. `retainContextWhenHidden: true`. Singleton:
second invocation reveals the existing panel and re-applies the current
range. Max content width 1100 px, centred, 16 px gutters; grid collapses
to one column under 700 px. Sticky header (`position: sticky; top: 0;
z-index: 10`) with theme-aware blur/background.

```
┌─ STICKY HEADER ────────────────────────────────────────────────────┐
│ [MASCOT 96→64px past 80px]  headline insight   [Today|7d|30d|All]  │
├────────────────────────────────────────────────────────────────────┤
│ A. KPI ROW — 6 cards (grid auto-fit minmax(160px,1fr))             │
│    Active time · Sessions (avg) · Files touched · Errors (recovery)│
│    Test runs (pass %) · Commits                                    │
├────────────────────────────────────────────────────────────────────┤
│ B. TIME TREND — bar/day (7d/30d/all aggregated); today = 24 hourly │
├──────────────────────────────┬─────────────────────────────────────┤
│ C. ACTIVITY MIX (est.)       │ D. TODAY TIMELINE                   │
│    5-way horizontal bars     │ 24h strip, rect per session + hover │
├──────────────────────────────┴─────────────────────────────────────┤
│ E. FOCUS — switches/day line + avg session + focus note            │
├──────────────────────────────┬─────────────────────────────────────┤
│ F. TOP FILES (10, click=open)│ G. HOTSPOTS (folders, % of total)   │
├──────────────────────────────┴─────────────────────────────────────┤
│ H. TESTS — stacked pass/fail per day + last-run line               │
├──────────────────────────────┬─────────────────────────────────────┤
│ I. ERRORS — seen/day + avg   │ J. COMMITS — bars/day + uncommitted │
│    recovery                  │    count line                       │
├──────────────────────────────┴─────────────────────────────────────┤
│ K. MILESTONES — vertical timeline, filled dot + date when achieved │
└────────────────────────────────────────────────────────────────────┘
```

Section ids (stable for deep-linking/tests):
`kpi, trend, distribution, timeline, focus, files, hotspots, tests,
errors, commits, milestones`.

Per-section contract:

- **A. KPI row.** Six cards: value (17 px semibold) + label (11 px muted)
  + sub-line (range-aware, e.g. "avg 38m", "pass 92%", "recovery 4m").
  Null-safe ("—" with `title` explaining why).
- **B. Trend.** Y in hours (1 decimal), x = day label (`d MMM`). Today
  range swaps to 24 hourly bars. Bar max ≥1 to avoid zero-height
  ambiguity. Hover `<title>` shows exact "3.7h · Tue 4 Mar".
- **C. Mix.** Five horizontal bars with ms + % labels; header carries the
  "(estimated)" qualifier with a `title` tooltip describing the heuristic.
- **D. Timeline.** 24 h strip 00–24; each session a rounded rect; hover
  shows "09:12–10:03 · 51m". Overlapping midnight sessions split at 00:00.
- **E. Focus.** Switches/day line + two numbers (avg session, focus note).
  No judgemental copy — "Lower switching often means longer focus blocks."
- **F. Top files.** 10 horizontal bars, path truncated middle (`…`) with
  full path in `<title>`; click posts `openFile`. Respects `trackFiles=false`
  → section shows "File tracking is off — folder hotspots still work."
- **G. Hotspots.** Folder share-of-total bars with % labels.
- **H. Tests.** Stacked pass (green) / fail (red-orange) per day + footer
  "Last run: passed · npm test · 12:04".
- **I. Errors.** Seen/day line + "avg recovery Nm" + current open errors
  from `liveTick`.
- **J. Commits.** Bars/day + "N uncommitted changes" line ("—" when the
  git API cannot provide it).
- **K. Milestones.** Vertical rail, achieved = filled dot + date,
  pending = hollow dot + label. Nine milestones from §3.

Headline insight (header, data-driven, never cheery-AI): one line chosen
by precedence — week-over-week delta ("+18% vs last 7 days") → today
summary ("2h 10m today across 4 sessions") → milestone ("10h total —
milestone reached") → neutral ("No data yet for this range").

### 9.1 Chart library contract (`media/analytics/charts.js`)

Pure functions returning SVG strings — no DOM writes inside:
`barChart, hBarChart, stackedBar, lineChart, timelineStrip, sparkline`.
Common rules: theme colours from `--vscode-charts-*` with hardcoded
fallbacks; 11 px axis labels in `--vscode-descriptionForeground`; every
chart `role="img"` + `aria-label` one-line summary; every datum a
`<title>` tooltip; empty state is a dashed-border box reading "No data
yet. Keep coding."; `prefers-reduced-motion` disables transitions; all
numbers formatted by a shared `fmtDuration` (m/h, 1-decimal hours).

### 9.2 Dashboard states

- Loading: skeleton shimmer only if `stats` takes >300 ms (normally
  instant from cache).
- Empty: per-section empty boxes, never a full-page takeover.
- Stale-hidden: `retainContextWhenHidden` keeps scroll + range; on reveal,
  request fresh `stats` once.
- No-workspace / disabled: reuse the summary copy and settings link.

## 10. Mascot behaviour in analytics surfaces (event-only + data-driven)

Same shared `MascotController`. **No pointer tracking, no scroll gaze, no
hover look-at anywhere** — this is the deliberate v0.3 break from DOCS v1
§11. The mascot communicates through faces + one-line insights.

| Trigger | Behaviour |
|---|---|
| Panel/summary opens | `react('delighted')` 900 ms once (greeting), then neutral |
| `stats` arrives for a range | mood from data (table below), `say(headline)` ≤1/30 s |
| Range switched | `react('surprised')` 600 ms (acknowledge), then range mood |
| Section enters viewport (60% Observer) | mood for that section (table below) |
| Click mascot | boop (existing timeline) |
| Idle 30 s / 5 min | drowsy / asleep (existing controller) |
| Live error spike (`liveTick.errorsNow` rises) | `react('surprised')`, no bubble spam |

Section → mood (map to real atlas cells; unknown → neutral base):

| Section | Mood → face |
|---|---|
| kpi | week ≥ last week → base; else `bashful` |
| trend | `sparkle` briefly on range change only |
| distribution | base (no face — data speaks) |
| files/hotspots | base |
| tests | pass ≥90% → `delighted`; <70% → `surprised`; else base |
| errors | seen rose vs previous equal window → `surprised`; zero → `delighted`; else base |
| commits | commits today >0 → `heart` once; else base |
| milestones | newly achieved since panel opened → `starstruck` + `say(name)`; else base |

Header mascot still shrinks (96→64 px past 80 px scroll) — layout only,
never a gaze direction.

## 11. UX system (shared, professional — not AI-styled)

- **Tokens.** Backgrounds/surfaces/text/borders exclusively from
  `--vscode-*` (`sideBar/editorWidget/toolbar/charts/testing` families).
  Accent usage limited to focus rings, the bubble's 2 px left edge, active
  range tab underline and milestone filled dots.
- **Typography.** System stack only. 11 px section labels (600, uppercase,
  0.06 em tracking, muted), 13 px body, 17 px KPI values (600). Tabular
  numerals for durations (`font-variant-numeric: tabular-nums`).
- **Cards.** 1 px `border`, 8 px radius, transparent background, 12 px
  padding. No shadows, no gradients. Headers separated by 1 px borders.
- **Iconography.** 15 px stroke icons (chart / heart / gear style already
  in the companion toolbar). No emoji in UI chrome.
- **Accessibility.** All charts have text equivalents; range tabs are real
  `<button>`s with `aria-pressed`; focus rings always visible; colour is
  never the only encoding (labels carry values); high-contrast theme
  verified; keyboard reaches range tabs, file bars (`Enter` = open) and
  the mascot button.
- **Copy tone.** Plain, specific, past-tense. "3h 42m across 4 sessions."
  Never "You're crushing it!".

## 12. Performance and privacy budgets

- Tracking overhead per event <1 ms; tick work <5 ms; persist ≤30 s +
  deactivate; aggregation reads ≤`retentionDays` records with a
  write-invalidated cache; range switch <200 ms for 365 days on a cold
  cache <500 ms once, then cached.
- File attribution map capped (500/day); hourly arrays fixed at 24;
  recoveries array capped (100/range, oldest dropped).
- Privacy: workspaceState only; relative paths only; no contents, no
  terminal output, no URLs, no machine identifiers. README + dashboard
  footer carry the one-line guarantee: "Stored locally in this workspace —
  relative paths and timings only, never code."

## 13. Testing plan

- `node --test` unit suites (no vscode dependency — pure logic):
  - `tracker.test.js`: idle stops credit; session split on `idleSeconds`;
    classification precedence (test > debug > git > terminal > coding);
    attribution to files/folders/hourly; midnight session split.
  - `statsStore.test.js`: day-key rollover; range aggregation; null-safe
    averages; prune by `retentionDays`; reset deletes all keys; cap
    behaviour (500 files, 100 recoveries).
  - `classify.test.js` (if extracted): regex matrix for test commands.
- Manual F5 script per phase (recorded in the phase checklist): numbers
  within 1 s, singleton reveal, reload persistence, theme sweep
  (light/dark/high-contrast), `analytics.enabled=false` behaviour, CSP
  check (no network requests in devtools).
- No webview unit framework — charts verified via snapshot strings
  (`charts.test.js` asserting SVG contains `<title>` + `role="img"`).

## 14. Build order (phases with exit criteria)

**Phase 1 — Controller extraction.**
`media/shared/mascotController.js` from `mascotView.js` (faces, bubble,
status, idle/sleep, boop; no aim). Companion + summary + dashboard all
consume it. Exit: companion pixel-identical, F5 green.

**Phase 2 — Data layer.**
`activityHub.ts` + `tracker.ts` + `statsStore.ts` + `gitStats.ts` + the
three unit suites. Wire `noteSilentActivity` → hub → tracker → store.
Exit: `node --test` green; idle/session/classification proven.

**Phase 3 — Summary surface.**
`viewsContainers` + `summaryProvider.ts` + `activity-icon.svg` + `stats` /
`liveTick` plumbing + settings 1–4. Exit: icon visible; numbers <1 s;
button reveals stub panel.

**Phase 4 — Dashboard core.**
`analyticsPanel.ts` (singleton) + `charts.js` + `analytics.js/.css` +
sections A–D + range switching + settings 5–7. Exit: four sections render
for fabricated + real payloads; range <200 ms.

**Phase 5 — Dashboard complete.**
Sections E–K + milestones + `resetStats` + footer guarantee. Exit: all 11
sections with empty/loading/null states.

**Phase 6 — Data-driven mascot.**
§10 moods wired to `stats`/`liveTick`/Observer. Exit: moods match the
table; no gaze code reintroduced (grep gate).

**Phase 7 — Hardening + docs.**
Break reminder, `visible===false` fallbacks, theme/CSP sweep, README +
DOCS close-out, `0.4.0` package. Exit: §15 all green.

## 15. Acceptance criteria (release gate)

- [ ] Activity Bar icon renders (light/dark/HC); summary numbers <1 s.
- [ ] "Open full analytics" opens exactly one tab; re-click reveals + keeps range/scroll.
- [ ] Idle past `idleSeconds` credits nothing (unit + manual).
- [ ] Reload preserves all stats; `resetStats` clears after confirm.
- [ ] Header sticky, shrinks 96→64 past 80 px; grid 1-col under 700 px.
- [ ] Range switch <200 ms warm for 365 days; no external requests.
- [ ] `analytics.enabled=false` stops writes + ticks + hides container.
- [ ] `trackFiles=false` keeps folders, shows the file-off notice.
- [ ] Grep gate: zero `aimAt|editorActivity|trackPointer|fastTyping|pasteLarge|caretModel` in `src/` + dashboard JS.
- [ ] Themes: light, dark, high-contrast verified; reduced-motion verified.

## 16. Risks and open questions

1. `vscode.git` API shape varies by version — keep the `.git/logs/HEAD`
   watcher as the guaranteed fallback (already proven in the companion).
2. Multi-root workspaces: attribute `folders[top]` per workspace folder
   name; `openFile` resolves against the owning folder. Single-root is
   the tested path; multi-root is best-effort in v2.
3. `onDidEndTerminalShellExecution` availability — keep the
   `onDidCloseTerminal` fallback already in the companion.
4. Clock skew across midnight — sessions split at local midnight; the
   day key is always local `YYYY-MM-DD`.
