import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import { IframeApp } from './embed/iframe-app.tsx';
import './app/app.css';
import { takeHandoffCode } from './features/demo-session/session-api.ts';

// Register the service worker for offline shell caching (T3-008-A).
// Only in a browser that supports SW; never in jsdom or test environments.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Detect if running inside iframe; use headless iframe app, otherwise full app.
const isIframe = window.self !== window.top;
const appComponent = isIframe ? <IframeApp /> : <App handoffCode={takeHandoffCode()} />;

createRoot(root).render(<StrictMode>{appComponent}</StrictMode>);
