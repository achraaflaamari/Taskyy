import * as vscode from 'vscode';
import { ANIMALS, SIZES, readSettings } from './settings';
import type { MascotViewProvider } from './mascotViewProvider';

/**
 * Native settings menu — the VS Code analogue of the Chrome popup's
 * "Mascot settings" view.
 *
 * The companion is event-driven: it stays calm while you type and reacts
 * only to workspace events (errors, terminal/task results, commits).
 */

const TOGGLE_ITEMS = [
  { key: 'clickReaction' as const, label: 'Boop reaction', hint: 'Click the mascot for a squash-and-smile' },
  { key: 'autoReaction' as const, label: 'Ambient reactions', hint: 'Idle smiles, drowsy at 30s, asleep at 5 min' },
];

async function setConfig(key: string, value: unknown): Promise<void> {
  const config = vscode.workspace.getConfiguration('mascot');
  await config.update(key, value, vscode.ConfigurationTarget.Global);
}

function animalLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function registerMascotCommands(
  context: vscode.ExtensionContext,
  provider: MascotViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mascot.openSettings', async () => {
      const s = readSettings();
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: `${s.enabled ? '$(eye) ' : '$(eye-closed) '}Show the mascot: ${s.enabled ? 'On' : 'Off'}`,
            description: 'Master switch (Chrome: Show the mascot)',
            action: 'toggleEnabled',
          },
          {
            label: `$(paw) Choose your animal: ${animalLabel(s.characterId)}`,
            description: `${ANIMALS.length} animals, same order as Chrome`,
            action: 'animal',
          },
          {
            label: '$(sliders) Behaviour…',
            description: 'Boop reaction / Ambient reactions',
            action: 'behaviour',
          },
          {
            label: `$(symbol-ruler) Size: ${s.size}px`,
            description: 'Small 96 / Medium 140 / Large 200 (+ custom)',
            action: 'size',
          },
        ].map((i) => ({ ...i, detail: undefined as string | undefined })),
        { placeHolder: 'Mascot settings (mirrors the Chrome ⚙ menu)', matchOnDescription: true },
      );
      if (!pick) { return; }
      const action = (pick as { action: string }).action;
      if (action === 'toggleEnabled') {
        await setConfig('enabled', !s.enabled);
      } else if (action === 'animal') {
        await vscode.commands.executeCommand('mascot.selectCharacter');
      } else if (action === 'behaviour') {
        await vscode.commands.executeCommand('mascot.toggleBehaviour');
      } else if (action === 'size') {
        await vscode.commands.executeCommand('mascot.setSize');
      }
    }),

    vscode.commands.registerCommand('mascot.selectCharacter', async () => {
      const s = readSettings();
      const pick = await vscode.window.showQuickPick(
        [...ANIMALS].map((id) => ({
          label: `${id === s.characterId ? '$(check) ' : ''}${animalLabel(id)}`,
          description: id,
        })),
        { placeHolder: 'Choose your animal (same 21 as Chrome)' },
      );
      if (!pick) { return; }
      const id = (pick as { description: string }).description;
      if ((ANIMALS as readonly string[]).includes(id)) {
        await setConfig('characterId', id);
      }
    }),

    vscode.commands.registerCommand('mascot.setSize', async () => {
      const s = readSettings();
      const items = [
        ...SIZES.map((z) => ({
          label: `${s.size === z.px ? '$(check) ' : ''}${z.label} — ${z.px}px`,
          description: String(z.px),
        })),
        { label: '$(edit) Custom…', description: 'custom' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Mascot size' });
      if (!pick) { return; }
      const desc = (pick as { description: string }).description;
      if (desc === 'custom') {
        const raw = await vscode.window.showInputBox({
          prompt: 'Mascot size in pixels (64–320)',
          value: String(s.size),
          validateInput: (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= 64 && n <= 320 ? null : 'Enter 64–320';
          },
        });
        if (raw !== undefined) { await setConfig('size', Number(raw)); }
      } else {
        await setConfig('size', Number(desc));
      }
    }),

    vscode.commands.registerCommand('mascot.toggleBehaviour', async () => {
      const run = async (): Promise<void> => {
        const s = readSettings();
        const pick = await vscode.window.showQuickPick(
          TOGGLE_ITEMS.map((t) => ({
            label: `${s[t.key] ? '$(check) ' : ''}${t.label}`,
            description: s[t.key] ? 'On' : 'Off',
            detail: t.hint,
            key: t.key,
          })),
          { placeHolder: 'Behaviour — pick to toggle, Esc when done' },
        );
        if (!pick) { return; }
        const key = (pick as { key: 'clickReaction' | 'autoReaction' }).key;
        await setConfig(key, !readSettings()[key]);
        await run();
      };
      await run();
    }),

    vscode.commands.registerCommand('mascot.boop', () => {
      provider.postBoop();
    }),
  );
}
