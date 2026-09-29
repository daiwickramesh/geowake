/**
 * `localStorage` helpers.
 *
 * Storage throws in a number of real situations (Safari private browsing,
 * blocked third-party/embedded contexts, quota exceeded). Every access is
 * guarded so a storage failure degrades the app instead of crashing it.
 */

const canUseStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
};

export const STORAGE_KEYS = {
  token: "geowake_token",
  userId: "geowake_uid",
  themeId: "geowake_theme_id",
  mapStyle: "geowake_map_style",
  sound: "geowake_sound",
  customAudio: "geowake_custom_audio",
  vibration: "geowake_vibration",
} as const;

export const readSetting = <T extends string | null>(
  key: string,
  fallback: T,
): string | T => {
  if (!canUseStorage()) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
};

export const writeSetting = (key: string, value: string): boolean => {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded is the common case (large custom ringtone).
    return false;
  }
};

export const removeSettings = (keys: readonly string[]): void => {
  if (!canUseStorage()) return;
  try {
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    /* nothing to do — the session simply will not be remembered */
  }
};
