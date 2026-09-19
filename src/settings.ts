import * as vscode from 'vscode';

export interface MascotSettings {
  enabled: boolean;
  characterId: string;
  size: number;
  clickReaction: boolean;
  autoReaction: boolean;
  followPointer: boolean;
}

export const ANIMALS = [
  'bear', 'bunny', 'cat', 'deer', 'dino', 'fox', 'frog', 'hamster',
  'hedgehog', 'koala', 'mouse', 'otter', 'owl', 'panda', 'penguin',
  'pug', 'raccoon', 'redpanda', 'sheep', 'sloth', 'tiger',
] as const;

export const SIZES = [
  { id: 'small', label: 'Small', px: 96 },
  { id: 'medium', label: 'Medium', px: 140 },
  { id: 'large', label: 'Large', px: 200 },
];

export const DEFAULTS: MascotSettings = {
  enabled: true,
  characterId: 'fox',
  size: 140,
  clickReaction: true,
  autoReaction: true,
  followPointer: true,
};

const MIN_SIZE = 64;
const MAX_SIZE = 320;

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sizePx(value: unknown): number {
  if (typeof value === 'string') {
    const named = SIZES.find((s) => s.id === value);
    if (named) { return named.px; }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) { return sizePx(parsed); }
    return DEFAULTS.size;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
  }
  return DEFAULTS.size;
}

export function normalize(raw: Record<string, unknown> | null | undefined): MascotSettings {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = (source as Record<string, unknown>)['characterId'];
  return {
    enabled: boolean((source as Record<string, unknown>)['enabled'], DEFAULTS.enabled),
    characterId: typeof id === 'string' && (ANIMALS as readonly string[]).includes(id)
      ? id
      : DEFAULTS.characterId,
    size: sizePx((source as Record<string, unknown>)['size']),
    clickReaction: boolean((source as Record<string, unknown>)['clickReaction'], DEFAULTS.clickReaction),
    autoReaction: boolean((source as Record<string, unknown>)['autoReaction'], DEFAULTS.autoReaction),
    followPointer: boolean((source as Record<string, unknown>)['followPointer'], DEFAULTS.followPointer),
  };
}

export interface AnalyticsSettings {
  enabled: boolean;
  idleSeconds: number;
  trackFiles: boolean;
  retentionDays: number;
  reactToErrors: boolean;
  reactToTerminal: boolean;
  breakReminderMinutes: number;
}

export const ANALYTICS_DEFAULTS: AnalyticsSettings = {
  enabled: true,
  idleSeconds: 120,
  trackFiles: true,
  retentionDays: 365,
  reactToErrors: true,
  reactToTerminal: true,
  breakReminderMinutes: 0,
};

function num(value: unknown, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return fallback; }
  return Math.max(min, Math.round(value));
}

export function normalizeAnalytics(raw: Record<string, unknown> | null | undefined): AnalyticsSettings {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: boolean(source['analytics.enabled'], ANALYTICS_DEFAULTS.enabled),
    idleSeconds: num(source['analytics.idleSeconds'], ANALYTICS_DEFAULTS.idleSeconds, 30),
    trackFiles: boolean(source['analytics.trackFiles'], ANALYTICS_DEFAULTS.trackFiles),
    retentionDays: num(source['analytics.retentionDays'], ANALYTICS_DEFAULTS.retentionDays, 7),
    reactToErrors: boolean(source['reactToErrors'], ANALYTICS_DEFAULTS.reactToErrors),
    reactToTerminal: boolean(source['reactToTerminal'], ANALYTICS_DEFAULTS.reactToTerminal),
    breakReminderMinutes: num(source['breakReminderMinutes'], ANALYTICS_DEFAULTS.breakReminderMinutes, 0),
  };
}

export function readSettings(): MascotSettings {
  const config = vscode.workspace.getConfiguration('mascot');
  return normalize({
    enabled: config.get('enabled'),
    characterId: config.get('characterId'),
    size: config.get('size'),
    clickReaction: config.get('clickReaction'),
    autoReaction: config.get('autoReaction'),
    followPointer: config.get('followPointer'),
  });
}

export function readAnalyticsSettings(): AnalyticsSettings {
  const config = vscode.workspace.getConfiguration('mascot');
  return normalizeAnalytics({
    'analytics.enabled': config.get('analytics.enabled'),
    'analytics.idleSeconds': config.get('analytics.idleSeconds'),
    'analytics.trackFiles': config.get('analytics.trackFiles'),
    'analytics.retentionDays': config.get('analytics.retentionDays'),
    'reactToErrors': config.get('reactToErrors'),
    'reactToTerminal': config.get('reactToTerminal'),
    'breakReminderMinutes': config.get('breakReminderMinutes'),
  });
}
