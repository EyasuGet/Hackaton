// Service worker update lifecycle and reload handling (T3-008-B).
// Detects background updates, notifies the learner gracefully, and prevents infinite
// reload loops by only triggering a refresh when an existing controller has updated.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ServiceWorkerUpdateState {
  readonly updateAvailable: boolean;
  readonly applyUpdate: () => void;
}

export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Track whether there was an active service worker controlling this page at load time.
    // If not (e.g. initial visit / installation), controllerchange must never reload the page.
    const hadControllerAtStartup = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;

    const onControllerChange = () => {
      if (refreshing || !hadControllerAtStartup) return;
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;

      const trackWorker = (worker: ServiceWorker) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && hadControllerAtStartup) {
            waitingWorkerRef.current = worker;
            setUpdateAvailable(true);
          }
        });
      };

      if (registration.waiting && hadControllerAtStartup) {
        waitingWorkerRef.current = registration.waiting;
        setUpdateAvailable(true);
      }

      registration.addEventListener('updatefound', () => {
        if (registration.installing) {
          trackWorker(registration.installing);
        }
      });
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (waitingWorkerRef.current) {
      waitingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  }, []);

  return { updateAvailable, applyUpdate };
}
