import * as vscode from 'vscode';
import { ANIMALS, MascotSettings, SIZES, readSettings } from './settings';
import type { SignalType } from './signals';

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export class MascotViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'mascotExplorerView';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** True while the Explorer view is visible (for critical-event fallbacks). */
  public get visible(): boolean {
    return this.view?.visible === true;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.onDidChangeVisibility(() => {
      this.onVisibilityChanged?.(webviewView.visible);
    });
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const config = vscode.workspace.getConfiguration('mascot');
      if (message?.type === 'pickCharacter' && typeof message.id === 'string') {
        await config.update('characterId', message.id, vscode.ConfigurationTarget.Global);
      } else if (message?.type === 'setSize' && typeof message.px === 'number') {
        await config.update('size', message.px, vscode.ConfigurationTarget.Global);
      } else if (message?.type === 'setToggle' && typeof message.key === 'string') {
        if (['clickReaction', 'autoReaction', 'enabled'].includes(message.key)) {
          await config.update(message.key, message.value === true, vscode.ConfigurationTarget.Global);
        }
      } else if (message?.type === 'openSettings') {
        await vscode.commands.executeCommand('mascot.openSettings');
        return;
      } else if (message?.type === 'openAnalytics') {
        await vscode.commands.executeCommand('mascot.openAnalytics');
        return;
      } else if (message?.type === 'boop') {
        this.postBoop();
        return;
      }
      // Echo canonical settings back (covers clamping + external edits).
      this.postSettings(readSettings());
    });

    this.postSettings(readSettings());
  }

  public postSettings(settings: MascotSettings): void {
    void this.view?.webview.postMessage({
      type: 'settings',
      settings,
      animals: [...ANIMALS],
      sizes: SIZES,
    });
  }

  public postSignal(type: SignalType, extra?: Record<string, unknown>): void {
    void this.view?.webview.postMessage({ type: 'signal', signal: type, ...(extra ?? {}), at: Date.now() });
  }

  public postNotice(reaction: 'sparkle' | 'delighted' | 'surprised'): void {
    void this.view?.webview.postMessage({ type: 'notice', reaction, at: Date.now() });
  }

  public postReact(name: string, say?: string): void {
    void this.view?.webview.postMessage({ type: 'react', name, say, at: Date.now() });
  }

  public postBoop(): void {
    void this.view?.webview.postMessage({ type: 'boop' });
  }

  public onVisibilityChanged?: (visible: boolean) => void;

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mascotView.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mascotView.css'),
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
<link rel="stylesheet" href="${styleUri}" />
</head>
<body data-mascots-root="${mascotsRoot}">
<main id="mascot-app">
  <section class="card" aria-label="Mascot companion">
    <header class="card-head">
      <div class="title-block">
        <h2 class="card-title">Companion</h2>
        <p class="card-sub"><span id="status-dot" class="dot" aria-hidden="true"></span><span id="status-text">Ready</span></p>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Mascot actions">
        <button id="btn-analytics" class="icon-btn" type="button" title="Open Mascot Analytics" aria-label="Open Mascot Analytics">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 13.5v-5M6.5 13.5v-8M10.5 13.5V4.5M14.5 13.5V2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button id="btn-boop" class="icon-btn" type="button" title="Boop the mascot" aria-label="Boop the mascot">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14s5-3.1 5-7.2C13 4.2 11.1 3 9.3 3c-.6 0-1 .2-1.3.5C7.7 3.2 7.3 3 6.7 3 4.9 3 3 4.2 3 6.8 3 10.9 8 14 8 14Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <button id="btn-settings" class="icon-btn" type="button" title="Mascot settings" aria-label="Mascot settings">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2 3.6 12.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>
    </header>
    <div id="bubble" class="bubble" hidden><span id="bubble-text"></span></div>
    <section class="stage" aria-label="Mascot stage">
      <button id="mascot" class="mascot" type="button" aria-label="Boop the fox">
        <span class="mascot-squash">
          <span class="mascot-layer mascot-directions"></span>
          <span class="mascot-layer mascot-reactions"></span>
        </span>
      </button>
      <p id="mascot-off" class="off-note" hidden>Mascot is off — enable <code>mascot.enabled</code> in Settings.</p>
    </section>
    <footer class="card-foot">
      <span id="meta-line" class="meta">Event-driven · stays calm while you type</span>
    </footer>
  </section>
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
