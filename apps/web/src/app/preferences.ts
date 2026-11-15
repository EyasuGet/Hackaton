// Persistent user preferences (T3-008-B).
// Preserves learner settings across page reloads, service worker updates, and cache refreshes
// so language and scenario preferences are not wiped.
import type { Locale } from '../shared/i18n/i18n.tsx';
import type { FixtureScenario } from '../features/assistant/fixture-client.ts';

export const PREFERENCES_STORAGE_KEY = 'track3.preferences';

export interface UserPreferences {
  readonly locale?: Locale | undefined;
  readonly scenario?: FixtureScenario | undefined;
}

export function loadStoredPreferences(storage: Storage = localStorage): UserPreferences {
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const locale = parsed.locale === 'en' || parsed.locale === 'am' ? parsed.locale : undefined;
    const scenario =
      typeof parsed.scenario === 'string' ? (parsed.scenario as FixtureScenario) : undefined;
    return {
      ...(locale !== undefined ? { locale } : {}),
      ...(scenario !== undefined ? { scenario } : {}),
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
