# Mascot (VS Code)

A calm workspace companion that lives in the Explorer, plus honest
local-first project analytics. The mascot stays quiet while you type and
reacts to things that matter: errors, terminal and task results, commits,
save/debug milestones — plus a boop when you need one.

21 animals, sizes Small 96 / Medium 140 / Large 200 (or any 64–320 px),
configured in the native Settings UI (`mascot.*`).

## The companion

```
┌───────────────────────────────┐
│ COMPANION        [chart][♡][⚙]│  status + toolbar (analytics / boop / settings)
│ [one-line bubble when events] │  rate-limited, auto-hides
│            MASCOT             │  fixed resting face, event reactions overlay it
│  Event-driven · calm footer   │  error-count aware
└───────────────────────────────┘
```

Behaviour:

- Errors appear → concerned face. Errors cleared → pleased + "Clean."
- Command fails → "Command failed." Task passes → "Task passed."
- Commit → short celebration + "Committed."
- Save / debug start / stop → brief acknowledgement, never wakes sleep.
- Idle 30 s → drowsy, 5 min → asleep (click to wake). Ambient smiles and
  blinks while awake. The mascot follows the mouse pointer inside its own
  views only (webview-local gaze via `mascot.followPointer`, default on,
  off under reduced-motion and while asleep) — typing, caret and focus
  never move the face; they advance the analytics clock silently.

## Sidebar TODO (v0.5)

Activity Bar → **Mascot Analytics** → **Todo** view (replaces the v0.4
Project Summary; stats live in the dashboard now). Three buckets — This
session, Next up, Someday — and three types — Feature (`FEAT`),
Fix (`FIX`), Improvement (`IMPR`).

Add from the top input (`Enter` saves), click a row to expand its inline
editor: notes, deadline (date picker, overdue dates highlighted), bucket
and type changers, delete. Checkbox completes a task (celebration face on
every surface + counts toward dashboard section L). `Clear done` and
`Mascot: Clear Completed Todos` delete all completed tasks.

## Analytics (v0.4, plus v0.5 section L)

Full **Mascot Analytics** editor-tab dashboard (singleton, sticky
shrinking header, Today/7d/30d/All ranges, 12 sections: KPI row, time
trend, activity mix (estimated), today timeline, focus, top files (click
to open), hotspots, tests, errors, commits, milestones timeline, tasks).

Tracking: 5 s tick, idle stops counting past `mascot.analytics.idleSeconds`
(min 30). Sessions split on idle gaps (no minimum length). Classification
(test > debug > git > terminal > coding) is labelled "(estimated)".
Test detection is command-level (`jest|vitest|mocha|pytest|go test|cargo
test|dotnet test|phpunit|npm test|…`) or task group `Test`. Errors count
workspace `Error` diagnostics with recovery timings. Commits come from the
built-in git API with a `.git/logs/HEAD` fallback.

Settings: `mascot.analytics.enabled` (master switch — off stops all
writes/ticks and hides live numbers), `idleSeconds` (120), `trackFiles`
(false keeps folders only), `retentionDays` (365, pruned on activation),
`reactToErrors`, `reactToTerminal`, `breakReminderMinutes` (0 = off;
sleepy nudge + "N min without a break", max once/hour, click snoozes),
`followPointer` (default on; webview-local gaze only).

Tasks completed per day feed dashboard section L ("N open · M overdue ·
K done in range"); checking a task celebrates on all three mascots.

`Mascot: Reset Project Stats` clears all `stats:v1:*` keys after a modal
confirmation. Critical failures (`errorsUp`, `termFail`) also raise a
warning notification when the Explorer view is not visible.

## Run it

**Option A — debug (F5):**

1. Open this folder (`VscodeExtension/`) in VS Code.
2. `npm install`, `npm run compile`.
3. Press **F5** (uses `.vscode/launch.json`). The Mascot view sits at the
   bottom of the Explorer.

**Option B — install the packaged build:**

```bash
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension mascot-explorer-0.5.0.vsix
```

Then **reload the window** (`Developer: Reload Window`) so the newly
installed extension activates.

## If the view says "no data provider registered"

That message means the view is visible but the extension has not activated
yet in this window. Fix:

1. `Ctrl+Shift+P` → **Developer: Reload Window**.
2. Check the Extensions view: **Mascot** must be present and enabled.
3. Still failing? Check `Output` → **Log (Extension Host)** and
   `Help` → **Toggle Developer Tools** console for activation errors, then
   reinstall: `code --uninstall-extension mascot.mascot-explorer` and
   install the `.vsix` again, followed by a window reload.

## Layout

```
src/extension.ts            activate: providers + signal bus + data layer + todo/dashboard plumbing + break reminder
src/activityHub.ts          the ONLY event subscriber (silent activity → tracker; rare signals/notices → companion)
src/tracker.ts              5 s tick, idle/session accounting, classification, file/folder/hourly attribution
src/statsStore.ts           persistence + aggregation (sole owner of stats:v1:*), cached range queries, prune/reset, tasks roll-up
src/gitStats.ts             git API wrapper (HEAD watch, uncommitted + total counts, .git/logs fallback)
src/todoStore.ts            workspace TODO list (buckets/kinds/notes/deadlines, validation, completion stamps)
src/todoProvider.ts         sidebar Todo view (Activity Bar container, 72 px mini mascot, bucket groups)
src/analyticsPanel.ts       singleton dashboard panel (retainContextWhenHidden, range, openFile whitelist)
src/mascotViewProvider.ts   WebviewViewProvider (companion card HTML shell + toolbar message bridge)
src/settings.ts             mascot.* + mascot.analytics.* + react/break/follow settings (normalize/clamp)
src/signals.ts              Signal→Reaction registry (6 event-only signals + bubble lines + cooldowns)
src/mascotQuickPick.ts      native settings menu (character / size / behaviour)
test/                       node --test suites: statsStore, tracker, classify, charts, todoStore, aim (66 tests)
media/mascotView.js         companion runtime (controller + webview-local pointer gaze)
media/todo.js/.css          todo runtime + styling (--vscode-* tokens only)
media/analytics/            analytics.js (12 sections + moods + observer + gaze) / analytics.css / charts.js (hand SVG)
media/shared/               characters/sprite/aim/reactions/mascotController (one controller for all surfaces)
media/mascots/              42 atlases + 21 thumbnails
media/activity-icon.svg     Activity Bar icon (24×24 monochrome currentColor)
ANALYTICS_PLAN.md           professional analytics build plan (v0.4 binding; gaze sections superseded in v0.5)
DOCS.md                     base spec + v0.3 event-only amendment + v0.4 close-out + v0.5 amendment
```

## Commands

`Mascot: Boop` · `Mascot: Open Settings` · `Mascot: Select Character` ·
`Mascot: Set Size` · `Mascot: Toggle Behaviour` ·
`Mascot: Open Analytics` (full dashboard singleton) ·
`Mascot: Reset Project Stats` (modal confirmation) ·
`Mascot: Clear Completed Todos`.

## Privacy

Stored locally in this workspace — relative paths and timings only, never
code. All state lives in `workspaceState` (`stats:v1:*` for analytics,
`todos:v1:list` for tasks — titles/notes/deadlines never leave the
workspace or enter telemetry); no file contents, terminal output, URLs,
machine identifiers, network requests, or telemetry.
