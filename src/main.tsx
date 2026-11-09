import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupAppUpdates } from './utils/appUpdate';

// Counter tabs stay open all day: each new version is shown (banner) as soon as it is deployed
setupAppUpdates();

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
