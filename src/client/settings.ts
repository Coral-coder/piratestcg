// Per-device settings, kept in localStorage (wrapped: storage can be blocked).
export interface Settings {
  forbiddenParadise: boolean;
  quality: 'auto' | 'low' | 'high';
  sound: boolean;
  autoMasts: boolean;
  botSpeed: 'slow' | 'normal' | 'fast';
  points: number;
  seenAssembly: boolean;
}

const KEY = 'potsm.settings.v1';
const DEFAULTS: Settings = { forbiddenParadise: false, quality: 'auto', sound: true, autoMasts: true, botSpeed: 'normal', points: 30, seenAssembly: false };

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  let s: Partial<Settings>;
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    s = {};
  }
  cache = { ...DEFAULTS, ...s };
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable: keep in memory */
  }
  return cache;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const isTouch = () => typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
export const isSmallScreen = () => typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
