# Mascot Project Analytics: Technical Spec (v1) + v0.3 Amendment + v0.4 Close-out + v0.5 Amendment

> **v0.5 amendment (pointer gaze + TODO sidebar).**
> 1. **Gaze reversal (deliberate).** The v0.3 no-gaze rule is lifted for the
>    mouse pointer only: all three mascots (Explorer, sidebar, dashboard
>    header) follow the pointer *inside their own webview* via the existing
>    9-cell direction atlas + `aim.js` sectors (dead zone, hysteresis,
>    center on leave). Typing, caret and focus still never move the face.
>    Gated by new setting `mascot.followPointer` (default true), hard-off
>    under `prefers-reduced-motion` and while asleep. The v0.4 grep gate is
>    retired for `MascotAim` usage in webview runtimes.
> 2. **Sidebar TODO replaces the summary** (`mascotTodoView`, "Todo").
>    Buckets this-session/next/someday, kinds feature/fix/improvement,
>    notes + `YYYY-MM-DD` deadlines with overdue highlight, full CRUD over
>    `todo:*` messages, persisted as `todos:v1:list` in workspaceState.
>    Stats now live only in the dashboard.
> 3. **Dashboard section L (Tasks):** completed/day bars + "N open ·
>    M overdue · K done in range", fed from todo `completedAt` stamps at
>    query time (task titles/notes never enter `StatsPayload`). Checking a
>    task fires the celebrate face on all three surfaces.
>
> **v0.4 close-out (analytics shipped).** Built per `ANALYTICS_PLAN.md (v2)`
> phases 1–7 and released as 0.4.0: shared `mascotController.js` (Phase 1);
> `activityHub` + `tracker` + `statsStore` + `gitStats` + 43 unit tests
> (Phase 2); Activity Bar summary + `stats`/`liveTick` plumbing (Phase 3);
> dashboard singleton + hand-written SVG `charts.js` + sections A–D
> (Phase 4); sections E–K + milestones + `resetStats` (Phase 5);
> data-driven moods + gaze grep gate (Phase 6); break reminder,
> `visible===false` warning fallbacks, CSP/theme sweep, docs (Phase 7).
> Gaze stays deleted project-wide: zero `aimAt|editorActivity|trackPointer|
> fastTyping|pasteLarge|caretModel` in `src/` + dashboard JS.
>
> **v0.3 amendment (event-only companion — read first).** The companion no
> longer follows typing, caret, focus, terminal or pointer. Removed:
> `mascot.trackPointer`, `caretModel.ts`, `postEditorActivity` /
> `editorActivity` messages, `fastTyping` / `pasteLarge` signals, all gaze
> (`holdGlance`, `aimAt`, `MascotAim` usage in the webview). Six signals
> remain: `errorsUp, errorsZero, termFail, termOk, taskOk, gitCommit` plus
> save/debug notices. The full forward build is specified in
> `ANALYTICS_PLAN.md (v2)`, which supersedes §§3, 4, 7, 11, 12 below where
> they describe gaze behaviour. Everything else in this file (data model,
> tracking rules, charts, phases) still applies.
>
> Audience: AI coding agent. Extend the existing `mascot-explorer` VS Code extension (TypeScript, webview views, no runtime deps). Follow this spec literally. Do not add features not listed.

## 1. Goal

Two surfaces, one mascot component:

| Surface | Where | Role |
|---|---|---|
| **Companion** (exists, v0.3 event-only) | Explorer view `mascotExplorerView` | Always-on mascot. Reacts to errors, terminal/task results, git, save/debug. Never reacts to typing, caret or focus. Card layout + 3-button toolbar. |
| **Analytics** (new) | Activity Bar icon → sidebar summary + full editor-tab dashboard | Stats and charts. Mascot is sticky at top and reacts to scroll, hover and data. |

Principle: **mascot = personality, dashboard = data.** All data is local. No network. No telemetry.

## 2. Constraints (do not fight these)

- The webview never follows the pointer, caret or focus (v0.3 decision). The
  Extension API gives **no pixel coordinates** for workbench parts and **no
  global mouse** — and we do not forward activity as gaze either. Typing,
  selection and focus are observed silently on the host for future
  analytics accounting only. Inside the analytics tab the mascot is
  data-driven (faces + insights), never eye-tracked.
- Activity Bar order cannot be forced. Register the container normally; it appears after built-in icons (usually right after Extensions). Users can drag it.
- Webview CSP: no CDN, no remote fonts, no chart libraries. Charts are hand-written inline SVG. Use `--vscode-*` CSS variables for theming.
- Webview views cannot open an editor tab by themselves. The sidebar view exposes a button that runs a command opening a `WebviewPanel`.

## 3. Files

```
src/
  extension.ts            // wiring only
  activityHub.ts          // subscribes to VS Code events, emits normalized events
  tracker.ts              // time/session/activity accounting
  statsStore.ts           // persistence + aggregation queries
  gitStats.ts             // git API wrapper
  companionProvider.ts    // existing MascotViewProvider (Explorer)
  summaryProvider.ts      // sidebar view in the new Activity Bar container
  analyticsPanel.ts       // WebviewPanel (full dashboard), singleton
media/
  shared/                 // existing: characters.js, reactions.js, sprite.js (aim.js retired, not loaded)
  shared/mascotController.js   // NEW: reusable class used by ALL surfaces (companion, summary, dashboard)
  analytics/analytics.html.ts? (no) -> analytics.js, analytics.css, charts.js
```

`mascotController.js` API (extract from current `mascotView.js`, v0.3):
`new MascotController(rootEl, {characterId, size})`, `.react(name, ms)`,
`.say(text, ms)`, `.setSettings(s)`, `.sleep()/.wake()`. There is no
`.aimAt()` — gaze was deleted project-wide.

## 4. package.json contributions

```jsonc
"viewsContainers": { "activitybar": [
  { "id": "mascotAnalytics", "title": "Mascot Analytics", "icon": "media/activity-icon.svg" }
]},
"views": {
  "explorer": [ { "id": "mascotExplorerView", "name": "Mascot", "type": "webview" } ],
  "mascotAnalytics": [ { "id": "mascotSummaryView", "name": "Project Summary", "type": "webview" } ]
},
"commands": [
  { "command": "mascot.openAnalytics", "title": "Mascot: Open Analytics" },
  { "command": "mascot.resetStats", "title": "Mascot: Reset Project Stats" }
],
"viewsWelcome": []   // not used; the summary view is a webview
```

`activity-icon.svg`: monochrome 24x24, uses `currentColor`.

New settings (all under `mascot.`):
`analytics.enabled` (true), `analytics.idleSeconds` (120, min 30), `analytics.trackFiles` (true, when false store folders only), `analytics.retentionDays` (365), `reactToErrors` (true), `reactToTerminal` (true), `breakReminderMinutes` (0 = off).

## 5. Data model

Storage: `context.workspaceState`, one key per day `stats:v1:YYYY-MM-DD`, plus `stats:v1:meta`. Never store code or file contents. Store workspace-relative paths only.

```ts
interface DayRecord {
  date: string;                       // YYYY-MM-DD local
  activeMs: number;
  sessions: { start: number; end: number }[];
  byActivity: { coding: number; debugging: number; testing: number; git: number; terminal: number }; // ms
  files: Record<string, number>;      // relPath -> ms
  folders: Record<string, number>;    // top-level folder -> ms
  switches: number;                   // active editor changes
  errors: { seen: number; recoveries: number[] };   // recovery durations ms
  tests: { runs: number; passed: number; failed: number };  // command-level, not per test case
  commits: number;
  hourly: number[];                   // 24 buckets, ms
}
interface Meta { firstActivity: number; totalCommitsAtStart: number; milestones: { id: string; ts: number }[] }
```

## 6. Tracking rules

**Active time.** Tick every 5 s. If `now - lastActivityTs < idleSeconds`, add tick to `activeMs`, to the current activity bucket, to `files[activeFile]`, and to `hourly[h]`. Activity = any of: text change, selection change, active editor change, terminal command start/end, debug event, window focus. A new session starts when idle gap > `idleSeconds`; close previous session at its last activity time.

**Activity classification (priority order, first match wins):**
1. Test task or test command running → `testing`
2. Debug session active, or active file has errors and user is editing → `debugging`
3. Git commit or SCM command in last 60 s → `git`
4. Active terminal focused within last 30 s (terminal events) → `terminal`
5. else → `coding`

This is a heuristic. Label it "estimated" in the UI.

**Test detection.** `onDidEndTerminalShellExecution` or task end where command matches `/\b(jest|vitest|mocha|pytest|go test|cargo test|dotnet test|phpunit|npm( run)? test|pnpm test|yarn test)\b/`, or task group is `Test`. Pass = exit code 0.

**Errors.** On `onDidChangeDiagnostics` (debounce 500 ms), per active file: count of `Error` severity. On 0→>0 store `errorStartTs`; on >0→0 push `now - errorStartTs` to `recoveries`. `seen` += positive delta only.

**Commits.** Via `vscode.git` API: on HEAD commit hash change per repo, `commits++`. Total commits from `repo.log({maxEntries:1})` count is not available cheaply, so use `git rev-list --count HEAD` via the API's `repo.exec` if present, else count only observed commits.

**Milestones** (write once to `meta.milestones`): `first-session`, `first-commit`, `first-green-test`, `10-commits`, `100-commits`, `10h`, `50h`, `100h`, `7-day-streak`.

**Derived metrics (MVP 12):** active time, session count, avg session, files touched (count of `files` keys), most active file, context switches, errors seen, avg error recovery, test runs, pass rate, commits, project total time.

Focus score (v1.1, optional): `1 - min(1, switches / (activeMinutes * 0.5))`.

## 7. Messaging protocol (extension ↔ webview)

Extension → webview:
```ts
{type:'settings', settings}
{type:'react', name, say?}                 // name ∈ reactions.js (data-driven moods, no gaze)
{type:'stats', range:'today'|'7d'|'30d'|'all', data: StatsPayload}   // analytics + summary
{type:'liveTick', activeMsToday, errorsNow}   // every 5 s, summary + analytics
```
// v0.3: no `{type:'aim'}` and no `editorActivity` messages exist. Any such
// message is ignored.
Webview → extension:
```ts
{type:'ready'}
{type:'setRange', range}
{type:'openAnalytics'}                     // from summary view button
{type:'openFile', relPath}                 // from file bars
{type:'command', id:'problems'|'nextError'}  // whitelist only
```
Whitelist all `command` ids; ignore anything else.

## 8. Layout: Explorer companion (v0.3, shipped)

```
┌───────────────────────────────┐
│ COMPANION        [📊][♡][⚙]  │   header: status dot + text, icon toolbar
│ [speech bubble, 1 line]       │   auto-hides after 4 s, rate-limited 1/30 s
│            MASCOT             │   size = mascot.size, fixed center face
│  Event-driven · calm text     │   footer meta line (error count aware)
└───────────────────────────────┘
```
Bubble lines: "Clean." (errors→0), "Command failed." (exit ≠0),
"Task passed.", "Committed.", milestone names. Terminal exit 0 and
errors-appearing stay silent-faced. Settings are the native `mascot.*`
(except retired `trackPointer`).

## 9. Layout: Sidebar summary (Activity Bar view)

Width ~250-350 px. No charts beyond one sparkline. Mascot is small (72 px), top-left.

```
┌────────────────────────────┐
│ [mascot 72]  project-name  │
│              12 active days│
├────────────────────────────┤
│ TODAY                      │
│  3h 42m        active      │
│  18 files   47 tests       │
│  6 errors   4 sessions     │
│  ▁▂▅▇▃▂▆  (7-day sparkline)│
├────────────────────────────┤
│ PROJECT                    │
│  84h 21m  · 23 days · 147c │
├────────────────────────────┤
│ [ Open full analytics → ]  │
└────────────────────────────┘
```
Updates on `liveTick`. Button posts `openAnalytics`.

## 10. Layout: Full analytics (WebviewPanel, editor tab)

Title: `Mascot Analytics`. `retainContextWhenHidden: true`. Singleton: reveal if already open. Max content width 1100 px, centered, responsive (grid collapses to 1 column under 700 px).

```
┌─ STICKY HEADER (position:sticky; top:0; z-index:10; backdrop blur) ─────────┐
│ [MASCOT 120→72px on scroll]  "Nice week: +18% vs last"   [Today|7d|30d|All] │
├──────────────────────────────────────────────────────────────────────────────┤
│ A. KPI ROW  (6 cards, grid auto-fit 160px)                                   │
│  Active time | Sessions (avg) | Files touched | Errors (avg recovery)        │
│  Test runs (pass %) | Commits                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ B. TIME TREND   bar chart, x=day, y=hours (7d/30d), today = hourly bars      │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ C. WHERE DID MY TIME GO         │ D. TODAY TIMELINE                          │
│  horizontal stacked/bars:       │  24h strip, one rect per session,          │
│  coding/debug/test/git/terminal │  hover = start–end, duration               │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ E. FOCUS: context switches per day (line) + avg session length (number)      │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ F. TOP FILES (10 bars, click    │ G. HOTSPOTS (folders, % of total time)     │
│    = openFile)                  │                                            │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ H. TESTS: stacked bar per day pass/fail + last run result                    │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ I. ERRORS: line per day (seen)  │ J. COMMITS: bar per day                    │
│    + avg recovery time          │    + uncommitted count now                 │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ K. MILESTONES: vertical timeline, achieved = filled dot + date               │
└──────────────────────────────────────────────────────────────────────────────┘
```

Section ids: `kpi, trend, distribution, timeline, focus, files, hotspots, tests, errors, commits, milestones`.

**Chart rules.** Vanilla JS in `charts.js`, functions `barChart, hBarChart, stackedBar, lineChart, timelineStrip, sparkline`, each returning an SVG string. Colors from `--vscode-charts-*` variables with fallbacks. Axis labels 11 px. Every chart has `role="img"` and an `aria-label` summary; every data point has a `<title>` tooltip. Empty state: dashed box "No data yet. Keep coding." Respect `prefers-reduced-motion` (no animation).

## 11. Mascot behavior in the analytics tab (superseded by ANALYTICS_PLAN.md §10)

> v0.3 rule, binding: **no pointer tracking, no scroll gaze, no hover
> look-at.** The original table below (aimAt pointer, look at cards,
> eyes up/down on scroll, dizzy on fast scroll) is retired and must not be
> reimplemented. The dashboard mascot is data-driven: faces + one-line
> insights from `stats`/`liveTick` per `ANALYTICS_PLAN.md §10`. Header
> shrink on scroll is layout-only.

Retired v1 table (kept for history, do not implement):

| Trigger | Reaction |
|---|---|
| Pointer moves in the tab | ~~`aimAt` pointer (exact, full tab)~~ retired |
| Pointer over a card or bar | ~~Look at it~~ retired → bubble insight only |
| Scroll down/up | ~~Eyes look down/up~~ retired → shrink 96→64px past 80px only |
| Fast scroll (>2000 px/s) | ~~`dizzy` for 800 ms~~ retired |
| Section enters viewport (IntersectionObserver, 60% threshold) | Mood by section, table below |
| Range switched | `curious` |
| No interaction 30 s / 5 min | drowsy / asleep (reuse existing) |
| Click mascot | boop (existing) |

Section → mood:

| Section | Mood |
|---|---|
| kpi | happy if week ≥ previous week, else neutral |
| trend | curious |
| distribution | neutral |
| files/hotspots | curious |
| tests | happy if pass ≥ 90 %, concerned if < 70 % |
| errors | dizzy if seen > previous period, else happy |
| commits | proud if commits > 0 today |
| milestones | proud |

Map mood names to the actual sprite cells in `reactions.js`. Fall back to `neutral` if a mood is missing.

## 12. Companion reaction rules (Explorer mascot, v0.3 event-only)

| Signal | Reaction | Bubble |
|---|---|---|
| Errors 0 → >0 | surprised (face only, no aim) | none |
| Errors → 0 after ≥1 | delighted | "Clean." |
| Terminal command exit ≠ 0 | surprised (face only) | "Command failed." |
| Test command exit 0 | starstruck | "Task passed." |
| Same diagnostic code seen ≥ 5 times today | dizzy | "Same error ×N" + click = `workbench.action.problems.focus` |
| Continuous activity ≥ `breakReminderMinutes` | sleepy | "N min without a break" (once per hour, snooze on click) |
| Commit detected | sparkle→heart→delighted | "Committed." |
| Milestone achieved | delighted | milestone name |

Global rules: rate-limit bubbles to 1 per 30 s; same message max once per
hour. Deleted v1 rules: typing-fast suppression (no typing signals exist),
"aim at error line / panel direction" (no gaze), "Tests are green."
excited variant (mapped to `starstruck` + "Task passed."). Failures of
critical events also use `showWarningMessage` when the Explorer view is
not visible (`webviewView.visible === false`).

## 13. Performance and privacy

- Persist at most every 30 s and on deactivate. Batch into the current day record.
- Aggregation queries read at most `retentionDays` day records; cache the result until next write.
- Ignore files in `node_modules`, `.git`, `out`, `dist` for file/folder stats.
- Prune records older than `retentionDays` on activation.
- `mascot.resetStats` asks confirmation, then deletes all `stats:v1:*` keys.
- README must state: data stays local, no code content is stored, only relative paths and timings.

## 14. Build order (see ANALYTICS_PLAN.md §14 for the binding phase plan)

1. ~~Extract `mascotController.js`; Explorer keeps working (regression check).~~
   Done in v0.3 except the file split itself: `mascotView.js` is already
   gaze-free, so Phase 1 is now a pure extraction with no behaviour change.
2. `tracker.ts` + `statsStore.ts` + unit tests (`node --test`) for session splitting, idle handling, classification.
3. `summaryProvider.ts` + Activity Bar container + KPIs.
4. `analyticsPanel.ts` + `charts.js` + sections A-D.
5. Sections E-K.
6. Mascot scroll/hover reactions (§11).
7. Companion rules (§12) via `activityHub.ts`.
8. Settings, reset command, README.

## 15. Acceptance criteria

- Activity Bar shows a Mascot icon; its view shows today/project numbers within 1 s of opening.
- "Open full analytics" opens exactly one editor tab; a second click reveals it.
- Idle for `idleSeconds` stops the active-time counter (verify in a test).
- Closing and reopening VS Code preserves all stats.
- Analytics mascot header stays visible while scrolling and shrinks past 80 px.
- Range switch re-renders all charts in < 200 ms for 365 days of data.
- Works in light, dark and high-contrast themes; no external network requests.
- `analytics.enabled = false` stops all tracking and hides the Activity Bar view.