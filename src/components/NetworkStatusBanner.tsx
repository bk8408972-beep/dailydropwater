import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function NetworkStatusBanner() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="alert"
      data-testid="network-offline-banner"
      className="bg-amber-600 text-white border-b border-amber-700"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-center gap-2 text-xs sm:text-sm font-bold">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          No internet connection — Reconnecting automatically when network returns.
        </span>
      </div>
    </div>
  );
}
