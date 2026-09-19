# Changelog

All notable changes to **Mascot** are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-09-19

### Added
- **Sidebar TODO** (`Todo` Activity Bar) — buckets `This session / Next up / Someday`, kinds `Feature / Fix / Improvement`, notes + `YYYY-MM-DD` deadlines (overdue highlight), inline editor, filter (`All / Now / Next / Later / Done`), kind-grouped list, `Done` tab with `Clear done` at top, `Move Next → Now` promotion.
- **Pointer-follow gaze** on all three mascots (Explorer, sidebar, dashboard) — webview-local, `mascot.followPointer` (default on), 450 ms dwell, reduced-motion & sleep aware.
- **Dashboard Section L — Tasks** (`completed/day` bars + `N open · M overdue · K done`).
- **Task celebration** on all surfaces (`starstruck` + “Done.”).
- Shared design system: `media/shared/tokens.css` + `media/shared/mascot.css` (100% `--vscode-*` native, container queries, `clamp()`).

### Changed
- Sidebar `Project Summary` replaced by `Todo`; stats live only in the dashboard.
- Explorer toolbar (`analytics / boop / settings`) migrated to the native view title bar (`$(graph)` / `$(heart)` / `$(gear)`); webview keeps only the mascot + bubble.
- `This session` + `Today` merged into `This session` (legacy `today` tasks auto-migrate).

### Fixed
- KPI `Files touched / Most active` layout (escaped + middle-truncated, ellipsis).
- Calmer gaze + fewer idle actions (longer `BLINK_GAP` / `AMBIENT_GAP`).

## [0.4.0] — 2026-09-19
- Analytics data layer (`activityHub / tracker / statsStore / gitStats`), 11 dashboard sections, `Mascot: Reset Project Stats`.

## [0.3.0] — 2026-09-19
- Event-only companion (no typing/caret tracking), 6 signals, 21 characters.

[0.5.0]: https://github.com/mascot/mascot-explorer/releases/tag/v0.5.0
[0.4.0]: https://github.com/mascot/mascot-explorer/releases/tag/v0.4.0
[0.3.0]: https://github.com/mascot/mascot-explorer/releases/tag/v0.3.0
