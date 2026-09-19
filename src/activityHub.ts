/**
 * activityHub.ts — the ONLY place that subscribes to VS Code events.
 *
 * Emits two disjoint streams:
 *   activity(kind, ts, meta) → tracker (silent, high frequency)
 *   signal(name, extra) / notice(reaction) → companion (rare, gated)
 *
 * The mascot never watches typing or cursor movement: activity events only
 * advance the tracker's clock, never the companion face.
 */
import * as vscode from 'vscode';
import { Tracker, isTestCommand, isTestTaskGroup, SilentKind } from './tracker';

export interface HubCallbacks {
  fireSignal: (signal: string, extra?: Record<string, unknown>) => void;
  sendNotice: (reaction: 'sparkle' | 'delighted' | 'surprised') => void;
}

function activeRelPath(): string | undefined {
  try {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.isUntitled) { return undefined; }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      for (const f of folders) {
        const rel = vscode.workspace.asRelativePath(doc.fileName, false);
        if (rel && !rel.startsWith('..')) { return rel; }
      }
      return vscode.workspace.asRelativePath(doc.fileName, false);
    }
    return doc.fileName.split(/[\\/]/).pop();
  } catch {
    return undefined;
  }
}

function workspaceName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name || 'workspace';
}

export class ActivityHub {
  private disposables: vscode.Disposable[] = [];
  private diagTimer: NodeJS.Timeout | undefined;
  private lastShellLine = '';

  constructor(
    private readonly tracker: Tracker,
    private readonly cb: HubCallbacks,
  ) {}

  attach(context: vscode.ExtensionContext): void {
    const t = this.tracker;
    const push = (d: vscode.Disposable): void => {
      this.disposables.push(d);
      context.subscriptions.push(d);
    };

    const activity = (kind: SilentKind, meta?: { switches?: boolean }): void => {
      try { t.noteActivity(kind, Date.now(), meta); } catch { /* best-effort */ }
    };

    // ---- silent activity sources (§4): advance the clock only ----
    push(vscode.window.onDidChangeTextEditorSelection(() => activity('selection')));
    push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0) { activity('typing'); }
    }));
    push(vscode.window.onDidChangeActiveTextEditor(() => activity('focus', { switches: true })));
    push(vscode.window.onDidChangeActiveTerminal(() => {
      activity('focus');
      t.noteTerminal(Date.now());
    }));
    push(vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) { activity('focus'); }
    }));
    push(vscode.tasks.onDidStartTask((e) => {
      activity('focus');
      const exec = (e.execution as unknown as { task?: { group?: unknown } })?.task?.group;
      if (isTestTaskGroup(exec)) { t.setTestRunning(true); }
    }));
    push(vscode.tasks.onDidEndTaskProcess((e) => {
      activity('focus');
      t.setTestRunning(false);
      const group = (e.execution as unknown as { task?: { group?: unknown; name?: string } })?.task;
      const isTest = isTestTaskGroup(group?.group) || isTestCommand(group?.name || '');
      if (isTest) {
        t.noteTestResult(e.exitCode === 0, group?.name || 'task', Date.now());
      }
      if (e.exitCode === 0) { this.cb.fireSignal('taskOk'); }
      else if (typeof e.exitCode === 'number') { this.cb.fireSignal('termFail'); }
    }));
    push(vscode.debug.onDidStartDebugSession(() => {
      activity('focus');
      t.setDebugActive(true);
      this.cb.sendNotice('surprised');
    }));
    push(vscode.debug.onDidTerminateDebugSession(() => {
      activity('focus');
      t.setDebugActive(false);
      this.cb.sendNotice('delighted');
    }));
    push(vscode.debug.onDidChangeBreakpoints((e) => {
      activity('focus');
      if (e.added.length > 0 || e.removed.length > 0) { this.cb.sendNotice('surprised'); }
    }));

    // SCM changes advance the clock + mark git recency for classification.
    // The git commit itself is reported by GitStats → tracker.noteCommit.
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      void gitExt;
    } catch { /* ignore */ }
    push(vscode.workspace.onDidSaveTextDocument(() => {
      activity('focus');
      this.cb.sendNotice('sparkle');
    }));

    // Diagnostics → tracker errors (debounced 500 ms) + companion signals.
    // The hub does NOT keep its own error count for stats; the tracker owns it.
    push(vscode.languages.onDidChangeDiagnostics(() => {
      if (this.diagTimer) { clearTimeout(this.diagTimer); }
      this.diagTimer = setTimeout(() => {
        let errors = 0;
        for (const [, diags] of vscode.languages.getDiagnostics()) {
          for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) { errors += 1; }
          }
        }
        t.noteErrors(errors, Date.now());
      }, 500);
    }));

    // Terminal shell executions: test detection + terminal recency.
    try {
      const win = vscode.window as unknown as {
        onDidEndTerminalShellExecution?: (
          cb: (ev: { exitCode?: number; execution?: { commandLine?: { value?: string } } }) => void,
        ) => vscode.Disposable;
        onDidStartTerminalShellExecution?: (
          cb: (ev: { execution?: { commandLine?: { value?: string } } }) => void,
        ) => vscode.Disposable;
      };
      if (typeof win.onDidStartTerminalShellExecution === 'function') {
        push(win.onDidStartTerminalShellExecution((ev) => {
          activity('focus');
          t.noteTerminal(Date.now());
          const line = ev.execution?.commandLine?.value || '';
          this.lastShellLine = line;
          if (isTestCommand(line)) { t.setTestRunning(true); }
        }));
      }
      if (typeof win.onDidEndTerminalShellExecution === 'function') {
        push(win.onDidEndTerminalShellExecution((ev) => {
          activity('focus');
          t.noteTerminal(Date.now());
          const line = this.lastShellLine || '';
          if (isTestCommand(line)) {
            t.setTestRunning(false);
            t.noteTestResult(ev.exitCode === 0, line.slice(0, 120), Date.now());
          } else if (t && isTestCommand(String((ev as unknown as { execution?: unknown }).execution || ''))) {
            t.setTestRunning(false);
          }
          if (ev.exitCode === 0) { this.cb.fireSignal('termOk'); }
          else if (typeof ev.exitCode === 'number') { this.cb.fireSignal('termFail', { exitCode: ev.exitCode }); }
        }));
      } else {
        push(vscode.window.onDidCloseTerminal((term) => {
          activity('focus');
          const code = typeof term.exitStatus?.code === 'number' ? term.exitStatus.code : undefined;
          if (code === 0) { this.cb.fireSignal('termOk'); }
          else if (typeof code === 'number') { this.cb.fireSignal('termFail', { exitCode: code }); }
        }));
      }
    } catch {
      // Terminal signals are best-effort.
    }

    // 5 s tracker tick with file/folder attribution.
    const interval = setInterval(() => {
      try {
        t.tick(Date.now(), { fileRel: activeRelPath() }, workspaceName());
      } catch { /* best-effort */ }
    }, 5000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];
    if (this.diagTimer) { clearTimeout(this.diagTimer); }
  }
}
