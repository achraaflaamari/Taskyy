import * as vscode from 'vscode';
import { MascotViewProvider } from './mascotViewProvider';
import { TodoProvider } from './todoProvider';
import { readAnalyticsSettings, readSettings } from './settings';
import { registerMascotCommands } from './mascotQuickPick';
import { SignalType, cooldownOk } from './signals';
import { StatsStore } from './statsStore';
import { Tracker } from './tracker';
import { ActivityHub } from './activityHub';
import { GitStats } from './gitStats';
import { TodoStore } from './todoStore';

// Module refs so deactivate() can flush pending stats.
let storeRef: StatsStore | undefined;
let trackerRef: Tracker | undefined;
let todoRef: TodoProvider | undefined;
let todoStoreRef: TodoStore | undefined;
let gitRef: GitStats | undefined;

export function getStatsStore(): StatsStore | undefined { return storeRef; }
export function getTracker(): Tracker | undefined { return trackerRef; }
export function getTodoStore(): TodoStore | undefined { return todoStoreRef; }

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MascotViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MascotViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  registerMascotCommands(context, provider);

  // ---- sidebar TODO list (Activity Bar; replaces the v0.4 summary) ----
  const todoStore = new TodoStore(context.workspaceState, () => {
    // Every mutation re-feeds section L (dashboard reads todos at query time).
    try { storeRef?.setTodoList(todoStore.getAll()); } catch { /* best-effort */ }
    void import('./analyticsPanel').then(({ AnalyticsPanel }) => {
      AnalyticsPanel.refreshActive();
    }).catch(() => undefined);
  });
  todoStoreRef = todoStore;
  const todos = new TodoProvider(context.extensionUri, todoStore);
  todoRef = todos;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TodoProvider.viewId, todos, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  todos.onReady = () => todos.postList();
  todos.onTaskCompleted = (task) => {
    // Celebration on every surface (rate-limited bubbles, never wakes sleep).
    provider.postReact('starstruck', 'Done.');
    todos.postReact('starstruck', 'Done.');
    void import('./analyticsPanel').then(({ AnalyticsPanel }) => {
      AnalyticsPanel.postReact('starstruck', 'Done.');
      AnalyticsPanel.refreshActive();
    }).catch(() => undefined);
    void task;
  };

  // Full dashboard singleton (promoted from the v0.3 info-message stub).
  context.subscriptions.push(
    vscode.commands.registerCommand('mascot.openAnalytics', async () => {
      try {
        if (!readAnalyticsSettings().enabled) {
          void vscode.window.showInformationMessage(
            'Mascot Analytics is disabled. Enable mascot.analytics.enabled to view stats.',
          );
          return;
        }
        const { AnalyticsPanel } = await import('./analyticsPanel');
        AnalyticsPanel.show(context.extensionUri, storeRef as StatsStore, async () => ({
          uncommitted: await (gitRef as GitStats).uncommittedCount(),
        }));
      } catch {
        void vscode.window.showInformationMessage(
          'Mascot Analytics is coming soon. Your companion keeps reacting meanwhile.',
        );
      }
    }),
    vscode.commands.registerCommand('mascot.resetStats', async () => {
      const pick = await vscode.window.showWarningMessage(
        'Reset all Mascot project stats in this workspace? This cannot be undone.',
        { modal: true },
        'Reset stats',
      );
      if (pick !== 'Reset stats') { return; }
      try {
        await (storeRef as StatsStore).reset();
        const { AnalyticsPanel } = await import('./analyticsPanel');
        AnalyticsPanel.refreshActive();
        void vscode.window.showInformationMessage('Mascot stats reset.');
      } catch { /* best-effort */ }
    }),
    vscode.commands.registerCommand('mascot.clearCompletedTodos', async () => {
      try {
        const removed = (todoStoreRef as TodoStore).clearCompleted();
        (todoRef as TodoProvider).postList();
        void vscode.window.showInformationMessage(
          removed === 0 ? 'No completed tasks to clear.' : `Cleared ${removed} completed task${removed === 1 ? '' : 's'}.`,
        );
      } catch { /* best-effort */ }
    }),
  );

  // ------------------------------------------------------- signal bus
  // ONE place for every Signal → Reaction trigger. The webview owns the
  // Reaction table (signals.ts DEFAULT_RULES); here we only detect + gate.
  const lastFiredAt: Partial<Record<SignalType, number>> = {};
  const fire = (signal: SignalType, extra?: Record<string, unknown>) => {
    try {
      const a = readAnalyticsSettings();
      if (signal === 'errorsUp' || signal === 'errorsZero') {
        if (!a.reactToErrors) { return; }
      }
      if (signal === 'termFail' || signal === 'termOk') {
        if (!a.reactToTerminal) { return; }
      }
    } catch { /* settings are best-effort; default to firing */ }
    const now = Date.now();
    if (!cooldownOk(signal, now, lastFiredAt)) { return; }
    lastFiredAt[signal] = now;
    provider.postSignal(signal, extra);
    // Critical-event fallback: warn when the Explorer view is not visible.
    if ((signal === 'errorsUp' || signal === 'termFail') && !provider.visible) {
      const label = signal === 'errorsUp' ? 'errors need attention' : 'last command failed';
      void vscode.window.showWarningMessage(`Mascot: ${label}.`);
    }
  };
  const sendNotice = (reaction: 'sparkle' | 'delighted' | 'surprised') => {
    provider.postNotice(reaction);
  };

  // ------------------------------------------------------- data layer (Phase 2)
  const analytics = readAnalyticsSettings();
  const store = new StatsStore(context.workspaceState);
  const tracker = new Tracker(store, {
    enabled: analytics.enabled,
    idleSeconds: analytics.idleSeconds,
    trackFiles: analytics.trackFiles,
  }, {
    onMilestone: (id, ts) => {
      // Milestone faces land in Phase 6; recording happens in the store.
      // Greet immediately so the moment is visible even before the dashboard.
      provider.postReact('starstruck', id);
      void ts;
    },
  });
  storeRef = store;
  trackerRef = tracker;
  try { store.setTodoList(todoStore.getAll()); } catch { /* best-effort */ }

  // Prune keys older than retentionDays on activation.
  try { store.prune(analytics.retentionDays); } catch { /* best-effort */ }

  const hub = new ActivityHub(tracker, {
    fireSignal: (signal, extra) => {
      // Hub emits string names; gate to known companion signals.
      if (signal === 'errorsUp' || signal === 'errorsZero' || signal === 'termFail'
        || signal === 'termOk' || signal === 'taskOk' || signal === 'gitCommit') {
        fire(signal as SignalType, extra);
      }
    },
    sendNotice: (reaction) => sendNotice(reaction),
  });

  const git = new GitStats(
    (ts) => {
      try {
        if (readAnalyticsSettings().enabled) { tracker.noteCommit(ts); }
      } catch { /* best-effort */ }
      fire('gitCommit');
    },
    (ts) => {
      try {
        if (readAnalyticsSettings().enabled) {
          tracker.noteActivity('focus', ts);
          tracker.noteGit(ts);
        }
      } catch { /* best-effort */ }
    },
  );
  git.watch(context);
  gitRef = git;
  hub.attach(context);

  // ---- liveTick plumbing (dashboard only from v0.5) ----
  const currentErrors = (): number => {
    let errors = 0;
    try {
      for (const [, diags] of vscode.languages.getDiagnostics()) {
        for (const d of diags) {
          if (d.severity === vscode.DiagnosticSeverity.Error) { errors += 1; }
        }
      }
    } catch { /* best-effort */ }
    return errors;
  };
  const pushLiveTick = (): void => {
    try {
      if (!readAnalyticsSettings().enabled) { return; }
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) { return; }
      const today = store.query('today');
      const errors = currentErrors();
      void import('./analyticsPanel').then(({ AnalyticsPanel }) => {
        AnalyticsPanel.postLiveTick(today.kpis.activeMs, errors);
      }).catch(() => undefined);
    } catch { /* best-effort */ }
  };
  const liveTimer = setInterval(() => pushLiveTick(), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(liveTimer) });
  void vscode.commands.executeCommand(
    'setContext', 'mascot.analyticsEnabled', readAnalyticsSettings().enabled,
  );

  // Companion error faces (event-only, unchanged from v0.3). The hub owns a
  // separate debounced diagnostics listener for stats; this one drives faces.
  let lastErrorCount: number | null = null;
  const pollDiagnostics = () => {
    let errors = 0;
    for (const [, diags] of vscode.languages.getDiagnostics()) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) { errors += 1; }
      }
    }
    if (lastErrorCount === null) {
      lastErrorCount = errors;
      return;
    }
    if (errors > lastErrorCount) {
      fire('errorsUp', { errors });
    } else if (errors === 0 && lastErrorCount > 0) {
      fire('errorsZero');
    }
    lastErrorCount = errors;
  };
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => pollDiagnostics()));
  pollDiagnostics();

  // Settings fan-out: any mascot.* change re-posts canonical settings and
  // reconfigures the tracker (idle threshold, file tracking).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mascot')) {
        provider.postSettings(readSettings());
        todos.postSettings();
        // Keep the dashboard mascot on the same character/settings.
        void import('./analyticsPanel').then(({ AnalyticsPanel }) => {
          AnalyticsPanel.postSettingsToActive();
        }).catch(() => undefined);
        try {
          const next = readAnalyticsSettings();
          tracker.configure({ enabled: next.enabled, idleSeconds: next.idleSeconds, trackFiles: next.trackFiles });
          void vscode.commands.executeCommand('setContext', 'mascot.analyticsEnabled', next.enabled);
        } catch { /* best-effort */ }
      }
    }),
  );

  // Periodic persist hook (the store writes through; this keeps the
  // write-invalidated query cache honest on a 30 s cadence).
  const persistTimer = setInterval(() => {
    try { tracker.flush(); } catch { /* best-effort */ }
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(persistTimer) });

  // Break reminder (§7/§12): sleepy face + "N min without a break", max
  // once per hour, off when 0. Clicking the mascot snoozes (boop resets).
  let lastBreakReminder = 0;
  const breakTimer = setInterval(() => {
    try {
      const mins = readAnalyticsSettings().breakReminderMinutes;
      if (!mins || mins <= 0) { return; }
      const st = tracker.getState();
      if (st.sessionStart === null) { return; } // on a break already
      const now = Date.now();
      if (now - st.sessionStart < mins * 60_000) { return; }
      if (now - lastBreakReminder < 3_600_000) { return; }
      lastBreakReminder = now;
      provider.postReact('sleepy', `${mins} min without a break`);
    } catch { /* best-effort */ }
  }, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(breakTimer) });
}

export function deactivate(): void {
  try { trackerRef?.flush(); } catch { /* ignore */ }
  storeRef = undefined;
  trackerRef = undefined;
  todoRef = undefined;
  todoStoreRef = undefined;
  gitRef = undefined;
}
