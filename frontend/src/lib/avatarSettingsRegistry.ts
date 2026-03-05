/**
 * avatarSettingsRegistry — lightweight singleton with localStorage persistence.
 * Key: avatarSettings. Debounce 150ms on write. No console in production.
 */

const AVATAR_SETTINGS_KEY = 'avatarSettings';
const DEBOUNCE_MS = 150;

export interface AvatarSettings {
  gesturesEnabled?: { wave?: boolean; point?: boolean; openHand?: boolean };
  interactionStyle?: string;
  ttsEngine?: string;
  language?: string;
  volume?: number;
  /** Spawn/position overrides from scene fit */
  spawnPosition?: [number, number, number];
}

let _current: AvatarSettings | null = null;
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;

function persistToStorage() {
  if (typeof window === 'undefined') return;
  try {
    const s = _current ? JSON.stringify(_current) : '{}';
    window.localStorage.setItem(AVATAR_SETTINGS_KEY, s);
  } catch {
    /* ignore quota / disabled */
  }
}

function debouncedPersist() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    persistToStorage();
  }, DEBOUNCE_MS);
}

export function setAvatarSettingsRegistry(settings: AvatarSettings): void {
  _current = settings;
  debouncedPersist();
}

export function getAvatarSettings(): AvatarSettings | null {
  return _current;
}

export function loadAvatarSettingsFromStorage(): AvatarSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AVATAR_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AvatarSettings;
    _current = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/** Convenience helpers */
export function getGesturesEnabled() {
  return _current?.gesturesEnabled ?? { wave: true, point: true, openHand: true };
}

export function getInteractionStyle() {
  return _current?.interactionStyle ?? 'friendly';
}

export function getTTSEngine() {
  return _current?.ttsEngine ?? 'kokoro';
}

export function getLanguage() {
  return _current?.language ?? 'ar';
}

export function getVolume() {
  return _current?.volume ?? 0.8;
}
