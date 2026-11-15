// Persistent user preferences (T3-008-B).
// Preserves learner settings across page reloads, service worker updates, and cache refreshes
// so language and scenario preferences are not wiped.
import { LOCALES, type Locale } from '../shared/i18n/messages.ts';
import type { FixtureScenario } from '../features/assistant/fixture-client.ts';

export const PREFERENCES_STORAGE_KEY = 'track3.preferences';

export interface UserPreferences {
  readonly locale?: Locale | undefined;
  readonly scenario?: FixtureScenario | undefined;
  readonly simpleLanguage?: boolean | undefined;
  readonly localMode?: boolean | undefined;
}

export function loadStoredPreferences(storage: Storage = localStorage): UserPreferences {
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const locale = LOCALES.find((option) => option === parsed.locale);
    const scenario =
      typeof parsed.scenario === 'string' ? (parsed.scenario as FixtureScenario) : undefined;
    const simpleLanguage =
      typeof parsed.simpleLanguage === 'boolean' ? parsed.simpleLanguage : undefined;
    const localMode = typeof parsed.localMode === 'boolean' ? parsed.localMode : undefined;
    return {
      ...(locale !== undefined ? { locale } : {}),
      ...(scenario !== undefined ? { scenario } : {}),
      ...(simpleLanguage !== undefined ? { simpleLanguage } : {}),
      ...(localMode !== undefined ? { localMode } : {}),
    };
  } catch {
    return {};
  }
}

export function saveStoredPreferences(
  updates: Partial<UserPreferences>,
  storage: Storage = localStorage,
): void {
  try {
    const current = loadStoredPreferences(storage);
    const updated: UserPreferences = {
      ...current,
      ...updates,
    };
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Tolerates private browsing or storage quota issues gracefully.
  }
}
