import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import './app/app.css';
import { takeHandoffCode } from './features/demo-session/session-api.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App handoffCode={takeHandoffCode()} />
  </StrictMode>,
);
