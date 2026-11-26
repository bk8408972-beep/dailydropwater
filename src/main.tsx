import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerDailyDropServiceWorker } from './utils/backgroundAlerts';

// Register Service Worker early for high-priority background Rider & Owner order alerts
void registerDailyDropServiceWorker();

// Block multi-finger pinch-zoom while preserving smooth single-finger vertical scrolling
if (typeof document !== 'undefined') {
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
  document.addEventListener('gesturestart', (e) => {
    if (e.cancelable) e.preventDefault();
  });
  document.addEventListener('gesturechange', (e) => {
    if (e.cancelable) e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(<App />);
