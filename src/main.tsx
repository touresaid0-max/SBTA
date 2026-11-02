import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupServiceWorkerAutoReload } from './utils/swAutoReload';

// Counter tabs stay open all day: show each new version as soon as it is deployed
setupServiceWorkerAutoReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
