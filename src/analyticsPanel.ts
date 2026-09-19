import * as vscode from 'vscode';
import { readSettings } from './settings';
import { StatsStore, RangeKey } from './statsStore';

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

const ALLOWED_COMMANDS = new Set(['problems', 'nextError']);

/**
 * Singleton WebviewPanel dashboard (editor tab).
 * Second invocation reveals the existing panel and re-applies the range.
 * retainContextWhenHidden keeps scroll + range; on reveal, fresh stats once.
 */
export class AnalyticsPanel {
  private static current: AnalyticsPanel | undefined;

  public static show(
    extensionUri: vscode.Uri,
    store: StatsStore,
    getExtras: () => Promise<{ uncommitted: number | null }>,
  ): AnalyticsPanel {
    if (AnalyticsPanel.current) {
      AnalyticsPanel.current.panel.reveal(vscode.ViewColumn.One);
      void AnalyticsPanel.current.refresh();
      return AnalyticsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'mascotAnalytics',
      'Mascot Analytics',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    AnalyticsPanel.current = new AnalyticsPanel(panel, extensionUri, store, getExtras);
    return AnalyticsPanel.current;
  }

  public static postStatsToActive(payload: { range: RangeKey; data: unknown }): void {
    AnalyticsPanel.current?.postStats(payload.range, payload.data);
  }

  public static refreshActive(): void {
    void AnalyticsPanel.current?.refresh();
  }

  public static postLiveTick(activeMsToday: number, errorsNow: number): void {
    AnalyticsPanel.current?.panel.webview.postMessage({ type: 'liveTick', activeMsToday, errorsNow });
  }

  public static postReact(name: string, say?: string): void {
    AnalyticsPanel.current?.panel.webview.postMessage({ type: 'react', name, say });
  }

  /** Push fresh settings (character, size, toggles) to the open dashboard. */
  public static postSettingsToActive(): void {
    AnalyticsPanel.current?.postSettings();
  }

  private range: RangeKey = 'today';
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly store: StatsStore,
    private readonly getExtras: () => Promise<{ uncommitted: number | null }>,
  ) {
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (AnalyticsPanel.current === this) { AnalyticsPanel.current = undefined; }
    });
    this.panel.onDidChangeViewState(() => {
      if (this.panel.visible) { void this.refresh(); }
    });
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.type !== 'string') { return; }
      if (message.type === 'ready') {
        this.postSettings();
        await this.refresh();
      } else if (message.type === 'setRange' && typeof message.range === 'string') {
        if (message.range === 'today' || message.range === '7d' || message.range === '30d' || message.range === 'all') {
          this.range = message.range;
          await this.refresh();
        }
      } else if (message.type === 'openFile' && typeof message.relPath === 'string') {
        await this.openFile(message.relPath);
      } else if (message.type === 'command' && typeof message.id === 'string') {
        if (ALLOWED_COMMANDS.has(message.id)) {
          if (message.id === 'problems') { await vscode.commands.executeCommand('workbench.actions.view.problems'); }
          else if (message.id === 'nextError') { await vscode.commands.executeCommand('editor.action.marker.next'); }
        }
      }
    });
    this.postSettings();
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.disposed) { return; }
    try {
      const { uncommitted } = await this.getExtras();
      this.store.setLiveExtras(uncommitted, null);
      const data = this.store.query(this.range);
      this.postStats(this.range, data);
    } catch { /* best-effort */ }
  }

  private postSettings(): void {
    void this.panel.webview.postMessage({ type: 'settings', settings: readSettings() });
  }

  private postStats(range: RangeKey, data: unknown): void {
    void this.panel.webview.postMessage({ type: 'stats', range, data });
  }

  private async openFile(relPath: string): Promise<void> {
    try {
      // Validate: stays inside the workspace, no absolute escapes.
      if (relPath.includes('..') || relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath)) { return; }
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return; }
      // Resolve against the owning folder (first match wins; single-root tested).
      for (const folder of folders) {
        const candidate = vscode.Uri.joinPath(folder.uri, relPath);
        try {
          await vscode.workspace.fs.stat(candidate);
          const doc = await vscode.workspace.openTextDocument(candidate);
          await vscode.window.showTextDocument(doc, { preview: true });
          return;
        } catch { /* try next folder */ }
      }
    } catch { /* best-effort */ }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'analytics', 'analytics.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'analytics', 'analytics.css'),
    );
    const shared = (name: string): vscode.Uri =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', name));
    const chartsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'analytics', 'charts.js'),
    );
    const mascotsRoot = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mascots'),
    );
    const n = nonce();
    // Sections A–D in Phase 4; E–K containers land in Phase 5 with the same ids.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body data-mascots-root="${mascotsRoot}">
<div class="dash">
  <header class="dash-head">
    <button id="dash-mascot" class="head-mascot" type="button" aria-label="Boop the mascot">
      <span class="mascot-squash">
        <span class="mascot-layer mascot-directions"></span>
        <span class="mascot-layer mascot-reactions"></span>
      </span>
    </button>
    <div class="head-text">
      <h1>Mascot Analytics</h1>
      <p id="headline" class="head-insight">Loading…</p>
    </div>
    <div class="range-tabs" role="group" aria-label="Time range">
      <button type="button" data-range="today" aria-pressed="true">Today</button>
      <button type="button" data-range="7d" aria-pressed="false">7d</button>
      <button type="button" data-range="30d" aria-pressed="false">30d</button>
      <button type="button" data-range="all" aria-pressed="false">All</button>
    </div>
  </header>
  <div id="dash-say" class="bubble-line" hidden></div>

  <section class="sec" id="sec-kpi" aria-label="Key metrics"><h2>Overview</h2><div id="kpi" class="kpi-grid"></div></section>

  <section class="sec" id="sec-trend" aria-label="Time trend"><h2>Time trend</h2><div id="trend-chart"></div><p id="trend-text" class="head-insight"></p></section>

  <div class="grid-2">
    <section class="sec" id="sec-distribution" aria-label="Activity mix"><h2>Activity mix <span class="hint" title="Heuristic: test command running → testing; debug active → debugging; git event in last 60s → git; terminal in last 30s → terminal; else coding.">(estimated)</span></h2><div id="mix-chart"></div></section>
    <section class="sec" id="sec-timeline" aria-label="Today timeline"><h2>Today timeline</h2><div id="timeline-chart"></div><p id="timeline-text" class="head-insight"></p></section>
  </div>

  <section class="sec" id="sec-focus" aria-label="Focus"><h2>Focus</h2><div id="focus-chart"></div><p id="focus-text" class="head-insight"></p></section>

  <div class="grid-2">
    <section class="sec" id="sec-files" aria-label="Top files"><h2>Top files</h2><div id="files-chart"></div><p id="files-text" class="head-insight"></p></section>
    <section class="sec" id="sec-hotspots" aria-label="Folder hotspots"><h2>Hotspots</h2><div id="hotspots-chart"></div></section>
  </div>

  <section class="sec" id="sec-tests" aria-label="Tests"><h2>Tests</h2><div id="tests-chart"></div><p id="tests-text" class="head-insight"></p></section>

  <div class="grid-2">
    <section class="sec" id="sec-errors" aria-label="Errors"><h2>Errors</h2><div id="errors-chart"></div><p id="errors-text" class="head-insight"></p></section>
    <section class="sec" id="sec-commits" aria-label="Commits"><h2>Commits</h2><div id="commits-chart"></div><p id="commits-text" class="head-insight"></p></section>
  </div>

  <section class="sec" id="sec-milestones" aria-label="Milestones"><h2>Milestones</h2><div id="milestones-list" class="milestones"></div></section>

  <section class="sec" id="sec-tasks" aria-label="Tasks"><h2>Tasks</h2><div id="tasks-chart"></div><p id="tasks-text" class="head-insight"></p></section>

  <footer class="dash-foot">Stored locally in this workspace — relative paths and timings only, never code.</footer>
</div>
<script nonce="${n}" src="${shared('characters.js')}"></script>
<script nonce="${n}" src="${shared('sprite.js')}"></script>
<script nonce="${n}" src="${shared('aim.js')}"></script>
<script nonce="${n}" src="${shared('reactions.js')}"></script>
<script nonce="${n}" src="${shared('mascotController.js')}"></script>
<script nonce="${n}" src="${chartsUri}"></script>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
