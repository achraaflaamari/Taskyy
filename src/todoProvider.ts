import * as vscode from 'vscode';
import { readSettings } from './settings';
import { TodoStore, TodoTask, summarize } from './todoStore';

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * Sidebar TODO view (Activity Bar container, 250–350 px). Replaces the
 * v0.4 Project Summary — stats live in the dashboard from v0.5 on.
 * 72 px mini mascot (shared controller, faces only) + bucketed task list
 * with type badges, notes and deadlines.
 */
export class TodoProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'mascotTodoView';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: TodoStore,
  ) {}

  public onReady?: () => void;
  public onTaskCompleted?: (task: TodoTask) => void;

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.type !== 'string') { return; }
      try {
        if (message.type === 'ready') {
          this.onReady?.();
          this.postList();
        } else if (message.type === 'todo:add') {
          const task = this.store.add(
            { title: message.title, bucket: message.bucket, kind: message.kind },
            Date.now(),
          );
          this.postList(task.id);
        } else if (message.type === 'todo:update') {
          const next = this.store.update(message.id, message.patch ?? {});
          if (!next) { this.postError('Could not save that change.'); return; }
          this.postList(message.id);
        } else if (message.type === 'todo:toggle') {
          const next = this.store.toggle(message.id, Date.now());
          if (!next) { this.postError('Could not update that task.'); return; }
          this.postList(message.id);
          if (next.done) { this.onTaskCompleted?.(next); }
        } else if (message.type === 'todo:move') {
          const next = this.store.move(message.id, message.bucket);
          if (!next) { this.postError('Could not move that task.'); return; }
          this.postList(message.id);
        } else if (message.type === 'todo:remove') {
          if (!this.store.remove(message.id)) { this.postError('Could not delete that task.'); return; }
          this.postList();
        } else if (message.type === 'todo:clearCompleted') {
          this.store.clearCompleted();
          this.postList();
        } else if (message.type === 'todo:promoteNext') {
          const moved = this.store.promoteNextToSession();
          if (moved === 0) { this.postError('Nothing to move.'); return; }
          this.postList();
        } else if (message.type === 'openSettings') {
          await vscode.commands.executeCommand('mascot.openSettings');
        } else if (message.type === 'openAnalytics') {
          await vscode.commands.executeCommand('mascot.openAnalytics');
        }
      } catch (err) {
        this.postError(err instanceof Error ? err.message : 'Could not save that task.');
      }
    });

    this.postSettings();
  }

  public postList(focusId?: string): void {
    const tasks = this.store.getAll();
    void this.view?.webview.postMessage({
      type: 'todo:list',
      tasks,
      summary: summarize(tasks, Date.now()),
      focusId: focusId ?? null,
    });
  }

  public postSettings(): void {
    void this.view?.webview.postMessage({ type: 'settings', settings: readSettings() });
  }

  public postReact(name: string, say?: string): void {
    void this.view?.webview.postMessage({ type: 'react', name, say });
  }

  private postError(message: string): void {
    void this.view?.webview.postMessage({ type: 'todo:error', message });
  }

  private getHtml(webview: vscode.Webview): string {
    const tokensUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', 'tokens.css'),
    );
    const mascotCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', 'mascot.css'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'todo.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'todo.css'),
    );
    const shared = (name: string): vscode.Uri =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', name));
    const mascotsRoot = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mascots'),
    );
    const n = nonce();
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${tokensUri}" />
<link rel="stylesheet" href="${mascotCssUri}" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body data-mascots-root="${mascotsRoot}">
<main id="todo-app" aria-label="Task list">
  <div class="top">
    <div class="head">
      <button id="todo-mascot" class="todo-mascot" type="button" aria-label="Boop the mascot">
        <span class="mascot-squash">
          <span class="mascot-layer mascot-directions"></span>
          <span class="mascot-layer mascot-reactions"></span>
        </span>
      </button>
      <div class="stats">
        <div><b id="open">0</b> open · <span id="doneN">0</span> done</div>
        <div class="bar"><i id="prog"></i></div>
      </div>
    </div>
    <div class="add">
      <input id="in" placeholder="Add a task, press Enter" aria-label="New task title" autocomplete="off" maxlength="200" />
      <div class="opts">
        <label class="field" aria-label="Bucket">
          <select id="bucketPick">
            <option value="session">Now</option>
            <option value="next">Next</option>
            <option value="someday">Later</option>
          </select>
        </label>
        <label class="field" aria-label="Type">
          <select id="kindPick">
            <option value="feature">Feature</option>
            <option value="fix">Fix</option>
            <option value="improvement">Improvement</option>
          </select>
        </label>
        <button id="addBtn" type="button">Add</button>
      </div>
      <p id="todo-error" class="todo-error" hidden></p>
    </div>
    <div class="filter-row">
      <div class="seg" id="seg" role="group" aria-label="Filter">
        <button type="button" data-b="all" aria-pressed="true">All</button>
        <button type="button" data-b="session" aria-pressed="false">Now</button>
        <button type="button" data-b="next" aria-pressed="false">Next</button>
        <button type="button" data-b="someday" aria-pressed="false">Later</button>
        <button type="button" data-b="done" aria-pressed="false">Done</button>
      </div>
    </div>
  </div>
  <div id="list"></div>
  <div class="foot"><a href="#" id="full">Open full analytics →</a></div>
</main>
<script nonce="${n}" src="${shared('characters.js')}"></script>
<script nonce="${n}" src="${shared('sprite.js')}"></script>
<script nonce="${n}" src="${shared('aim.js')}"></script>
<script nonce="${n}" src="${shared('reactions.js')}"></script>
<script nonce="${n}" src="${shared('mascotController.js')}"></script>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
