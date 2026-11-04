import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupServiceWorkerAutoReload } from './utils/swAutoReload';

// Counter tabs stay open all day: show each new version as soon as it is deployed
setupServiceWorkerAutoReload();

// The app started: after a while, allow a new automatic recovery (see index.html) for a later
// redeploy. Not at once, so that a version still failing does not reload in a loop.
window.setTimeout(() => {
  try { sessionStorage.removeItem('sbta_boot_recover'); } catch { /* ignore */ }
}, 30_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
