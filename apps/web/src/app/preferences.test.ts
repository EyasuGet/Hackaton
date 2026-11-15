import { describe, expect, it } from 'vitest';
import {
  loadStoredPreferences,
  PREFERENCES_STORAGE_KEY,
  saveStoredPreferences,
} from './preferences.ts';

class MemoryStorage implements Storage {
  #store = new Map<string, string>();

  get length(): number {
    return this.#store.size;
  }

  clear(): void {
    this.#store.clear();
  }

  getItem(key: string): string | null {
    return this.#store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, value);
  }
}

describe('User preferences persistence (T3-008-B)', () => {
  it('returns an empty preference set when storage is empty', () => {
    const storage = new MemoryStorage();
    expect(loadStoredPreferences(storage)).toEqual({});
  });

  it('persists and reloads the selected locale without wiping state', () => {
    const storage = new MemoryStorage();
    saveStoredPreferences({ locale: 'am' }, storage);

    const loaded = loadStoredPreferences(storage);
    expect(loaded.locale).toBe('am');
  });

  it('preserves existing settings when updating a single preference', () => {
    const storage = new MemoryStorage();
    saveStoredPreferences({ locale: 'am', scenario: 'faqCited', simpleLanguage: true }, storage);
    saveStoredPreferences({ locale: 'en' }, storage);

    const loaded = loadStoredPreferences(storage);
    expect(loaded.locale).toBe('en');
    expect(loaded.scenario).toBe('faqCited');
    expect(loaded.simpleLanguage).toBe(true);
  });

  it('persists and reloads the simpleLanguage preference (T3-029)', () => {
    const storage = new MemoryStorage();
    saveStoredPreferences({ simpleLanguage: true }, storage);

    expect(loadStoredPreferences(storage).simpleLanguage).toBe(true);

    saveStoredPreferences({ simpleLanguage: false }, storage);
    expect(loadStoredPreferences(storage).simpleLanguage).toBe(false);
  });

  it('recovers gracefully from malformed stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, 'not-valid-json{');

    expect(loadStoredPreferences(storage)).toEqual({});
  });

  it('ignores unsupported locale values in storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ locale: 'invalid-lang' }));

    expect(loadStoredPreferences(storage).locale).toBeUndefined();
  });

  it('handles storage failures gracefully', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('Access denied');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    } as unknown as Storage;

    expect(() => saveStoredPreferences({ locale: 'am' }, throwingStorage)).not.toThrow();
    expect(loadStoredPreferences(throwingStorage)).toEqual({});
  });
});
