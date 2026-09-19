/**
 * gitStats.ts — git API wrapper (HEAD hash watch, commit counting,
 * uncommitted count). No CLI spawns except `repo.exec('rev-list')` when
 * available. Falls back to `.git/logs/HEAD` watching (proven in v0.3).
 */
import * as vscode from 'vscode';

interface GitRepoState {
  HEAD?: { commit?: string };
  onDidChange: (cb: () => void) => vscode.Disposable;
  indexChanges?: unknown[];
  workingTreeChanges?: unknown[];
}

interface GitRepo {
  state: GitRepoState;
  exec?: (args: string[]) => Promise<{ stdout?: string } | string>;
}

interface GitApi {
  repositories: GitRepo[];
  onDidOpenRepository: (cb: (r: GitRepo) => void) => vscode.Disposable;
}

function getGitApi(): GitApi | undefined {
  try {
    const ext = vscode.extensions.getExtension<{ getAPI: (v: number) => GitApi }>('vscode.git');
    if (!ext) { return undefined; }
    if (!ext.isActive) { return undefined; }
    return ext.exports.getAPI(1);
  } catch {
    return undefined;
  }
}

export class GitStats {
  private lastHeads = new Map<GitRepo, string | undefined>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly onCommit: (ts: number) => void = () => undefined,
    private readonly onScmChange: (ts: number) => void = () => undefined,
  ) {}

  watch(context: vscode.ExtensionContext): void {
    const api = getGitApi();
    if (api?.repositories) {
      const hookRepo = (repo: GitRepo) => {
        this.lastHeads.set(repo, repo.state?.HEAD?.commit);
        const d = repo.state.onDidChange(() => {
          const head = repo.state?.HEAD?.commit;
          const last = this.lastHeads.get(repo);
          this.onScmChange(Date.now());
          if (head && last && head !== last) {
            this.onCommit(Date.now());
          }
          this.lastHeads.set(repo, head);
        });
        this.disposables.push(d);
        context.subscriptions.push(d);
      };
      api.repositories.forEach(hookRepo);
      const openSub = api.onDidOpenRepository(hookRepo);
      this.disposables.push(openSub);
      context.subscriptions.push(openSub);
      return;
    }
    // Fallback: .git/logs/HEAD watcher (v0.3-proven).
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const pattern = new vscode.RelativePattern(folder, '.git/logs/HEAD');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(() => this.onCommit(Date.now()));
        watcher.onDidCreate(() => this.onCommit(Date.now()));
        context.subscriptions.push(watcher);
      }
    }
  }

  /** Staged + unstaged change count via API when exposed, else null ("—"). */
  async uncommittedCount(): Promise<number | null> {
    try {
      const api = getGitApi();
      const repo = api?.repositories?.[0];
      if (!repo) { return null; }
      const idx = Array.isArray(repo.state.indexChanges) ? repo.state.indexChanges.length : 0;
      const wt = Array.isArray(repo.state.workingTreeChanges) ? repo.state.workingTreeChanges.length : 0;
      if (!Array.isArray(repo.state.indexChanges) && !Array.isArray(repo.state.workingTreeChanges)) {
        return null;
      }
      return idx + wt;
    } catch {
      return null;
    }
  }

  /** Total-history count via rev-list when repo.exec exists; else null. */
  async totalCount(): Promise<number | null> {
    try {
      const api = getGitApi();
      const repo = api?.repositories?.[0];
      if (!repo?.exec) { return null; }
      const out = await repo.exec(['rev-list', '--count', 'HEAD']);
      const text = typeof out === 'string' ? out : out?.stdout ?? '';
      const n = parseInt(String(text).trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];
  }
}
