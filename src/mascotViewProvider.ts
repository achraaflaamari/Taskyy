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
    const tokensUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', 'tokens.css'),
    );
    const mascotCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'shared', 'mascot.css'),
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
<link rel="stylesheet" href="${tokensUri}" />
<link rel="stylesheet" href="${mascotCssUri}" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body data-mascots-root="${mascotsRoot}">
<main id="mascot-app" aria-label="Mascot companion">
  <section class="card" aria-label="Mascot companion">
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
