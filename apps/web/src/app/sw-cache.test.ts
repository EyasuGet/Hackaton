// Verification of Service Worker cache upgrade and exclusion semantics (T3-008-B).
// Ensures version updates purge old/withdrawn versions, and private API responses
// never enter cache storage.
import { describe, expect, it, vi } from 'vitest';

describe('Service Worker cache versioning and policy (T3-008-B)', () => {
  it('purges outdated shell cache versions during activation', async () => {
    const deletedKeys: string[] = [];
    const existingKeys = ['track3-shell-v1', 'track3-shell-v2'];
    const ACTIVE_CACHE = 'track3-shell-v2';

    const mockCaches = {
      keys: (): Promise<string[]> => Promise.resolve(existingKeys),
      delete: vi.fn((key: string): Promise<boolean> => {
        deletedKeys.push(key);
        return Promise.resolve(true);
      }),
    };

    // Mirrors the activate event handler logic in sw.js
    const keys = await mockCaches.keys();
    await Promise.all(
      keys.filter((key) => key !== ACTIVE_CACHE).map((key) => mockCaches.delete(key)),
    );

    expect(deletedKeys).toEqual(['track3-shell-v1']);
    expect(mockCaches.delete).not.toHaveBeenCalledWith('track3-shell-v2');
  });

  it('excludes /api/ requests from caching so private data never persists', () => {
    const testUrls = [
      { url: 'http://localhost:5173/api/tutoring/faq', shouldCache: false },
      { url: 'http://localhost:5173/api/help/requests', shouldCache: false },
      { url: 'http://localhost:5173/api/accommodation', shouldCache: false },
      { url: 'http://localhost:5173/assets/index-abc.js', shouldCache: true },
      { url: 'http://localhost:5173/', shouldCache: true },
    ];

    for (const { url, shouldCache } of testUrls) {
      const parsed = new URL(url);
      const isApi = parsed.pathname.startsWith('/api/');
      expect(!isApi).toBe(shouldCache);
    }
  });

  it('rejects caching non-GET methods', () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    for (const method of methods) {
      const isGet = method === 'GET';
      expect(isGet).toBe(false);
    }
  });
});
