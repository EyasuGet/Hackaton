import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServiceWorkerUpdate } from './service-worker.ts';

describe('useServiceWorkerUpdate (T3-008-B)', () => {
  const originalLocation = window.location;
  const reloadMock = vi.fn();

  beforeEach(() => {
    reloadMock.mockClear();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: reloadMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
    vi.unstubAllGlobals();
  });

  it('remains inactive when navigator.serviceWorker is absent', () => {
    vi.stubGlobal('navigator', {});
    const { result } = renderHook(() => useServiceWorkerUpdate());

    expect(result.current.updateAvailable).toBe(false);
  });

  it('detects a waiting worker when the page is already controlled', async () => {
    const postMessage = vi.fn();
    const mockWaitingWorker = {
      state: 'installed',
      postMessage,
      addEventListener: vi.fn(),
    };
    const mockRegistration = {
      waiting: mockWaitingWorker,
      installing: null,
      addEventListener: vi.fn(),
    };

    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: { state: 'activated' },
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn((event: string, cb: () => void) => {
          listeners[event] = cb;
        }),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useServiceWorkerUpdate());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.updateAvailable).toBe(true);

    act(() => {
      result.current.applyUpdate();
    });

    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('does not trigger a page reload on initial service worker installation', () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: null, // First install: no existing controller
        getRegistration: vi.fn().mockResolvedValue(null),
        addEventListener: vi.fn((event: string, cb: () => void) => {
          listeners[event] = cb;
        }),
        removeEventListener: vi.fn(),
      },
    });

    renderHook(() => useServiceWorkerUpdate());

    act(() => {
      listeners.controllerchange?.();
    });

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('triggers exactly one reload on controller change when already controlled', () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: { state: 'activated' },
        getRegistration: vi.fn().mockResolvedValue(null),
        addEventListener: vi.fn((event: string, cb: () => void) => {
          listeners[event] = cb;
        }),
        removeEventListener: vi.fn(),
      },
    });

    renderHook(() => useServiceWorkerUpdate());

    act(() => {
      listeners.controllerchange?.();
      // Second firing must be guarded against infinite loops
      listeners.controllerchange?.();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
