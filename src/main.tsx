import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// Ensure global PWA listener is attached instantly before anything else mounts
import './hooks/usePwaInstall';

// In development mode, unregister any stale service workers that might cache old UI
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
      console.log('Unregistered stale development service worker');
    }
  });
}

// Apply saved theme immediately to prevent flash
; (() => {
  try {
    const saved = localStorage.getItem('invro-libera-settings');
    if (saved) {
      const { theme } = JSON.parse(saved);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (theme === 'system') {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.classList.add('dark');
        }
      }
    }
  } catch { /* ignore */ }

  // Listen for OS theme changes when user selected "system"
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    try {
      const saved = localStorage.getItem('invro-libera-settings');
      if (saved) {
        const { theme } = JSON.parse(saved);
        if (theme === 'system') {
          document.documentElement.classList.toggle('dark', e.matches);
        }
      }
    } catch { /* ignore */ }
  });
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
