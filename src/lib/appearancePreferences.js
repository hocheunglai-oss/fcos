export const APPEARANCE_STORAGE_KEY = 'fcos:workspace-appearance:v1';

export const APPEARANCE_MODES = ['system', 'light', 'dark'];
export const GLASS_INTENSITIES = ['clear', 'balanced', 'tinted'];

export const DEFAULT_APPEARANCE_PREFERENCES = Object.freeze({
  appearanceMode: 'system',
  glassIntensity: 'balanced',
});

export function normalizeAppearancePreferences(value = {}) {
  return {
    appearanceMode: APPEARANCE_MODES.includes(value.appearanceMode)
      ? value.appearanceMode
      : DEFAULT_APPEARANCE_PREFERENCES.appearanceMode,
    glassIntensity: GLASS_INTENSITIES.includes(value.glassIntensity)
      ? value.glassIntensity
      : DEFAULT_APPEARANCE_PREFERENCES.glassIntensity,
  };
}

export function readAppearancePreferences() {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE_PREFERENCES;
  try {
    return normalizeAppearancePreferences(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'null') || {});
  } catch {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function resolveAppearanceMode(appearanceMode, media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null) {
  if (appearanceMode === 'dark' || appearanceMode === 'light') return appearanceMode;
  return media?.matches ? 'dark' : 'light';
}

export function applyAppearancePreferences(value, { persist = true } = {}) {
  const preferences = normalizeAppearancePreferences(value);
  if (typeof document === 'undefined') return preferences;
  const resolvedMode = resolveAppearanceMode(preferences.appearanceMode);
  const root = document.documentElement;
  root.dataset.appearance = preferences.appearanceMode;
  root.dataset.resolvedAppearance = resolvedMode;
  root.dataset.glassIntensity = preferences.glassIntensity;
  root.classList.toggle('dark', resolvedMode === 'dark');
  root.style.colorScheme = resolvedMode;
  if (persist && typeof window !== 'undefined') {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
  }
  return preferences;
}

export function listenForSystemAppearance(value, onChange) {
  if (typeof window === 'undefined' || value?.appearanceMode !== 'system') return () => {};
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => {};
  const listener = () => onChange?.(applyAppearancePreferences(value, { persist: false }));
  media.addEventListener?.('change', listener);
  return () => media.removeEventListener?.('change', listener);
}
