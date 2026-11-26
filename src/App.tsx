import { useCallback, useEffect, useState } from 'react';
import type { AppRole } from './types';
import { parseAppRole } from './utils/domain';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplashScreen } from './components/SplashScreen';
import { LauncherScreen } from './components/LauncherScreen';
import { CustomerApp } from './components/CustomerApp';
import { RiderApp } from './components/RiderApp';
import { OwnerApp } from './components/OwnerApp';
import { PrivacyPolicyScreen } from './components/PrivacyPolicyScreen';

function getTitleForRole(role: AppRole): string {
  switch (role) {
    case 'customer':
    case 'launcher':
      return 'DailyDrop Water — Water & Cold Drinks Delivery';
    case 'privacy':
      return 'Privacy Policy — DailyDrop Water';
    case 'rider':
      return 'DailyDrop Rider — Delivery Fleet Portal';
    case 'owner':
      return 'DailyDrop Owner — Store Command Center';
  }
}

function DailyDropRouter() {
  const [role, setRole] = useState<AppRole>(() =>
    parseAppRole(typeof window !== 'undefined' ? window.location.search : '')
  );

  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') return false;
    if (parseAppRole(window.location.search) === 'privacy') return false;
    return true;
  });

  useEffect(() => {
    document.title = getTitleForRole(role);
  }, [role]);

  useEffect(() => {
    const onPopState = () => {
      const next = parseAppRole(window.location.search);
      setRole(next);
      if (next === 'privacy') {
        setShowSplash(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleSelectRole = useCallback((nextRole: Exclude<AppRole, 'launcher'>) => {
    const url = new URL(window.location.href);
    url.searchParams.set('app', nextRole);
    window.history.pushState({}, '', url.toString());
    setRole(nextRole);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  if (showSplash) {
    return <SplashScreen durationMs={2000} onComplete={handleSplashComplete} />;
  }

  if (role === 'privacy') {
    return (
      <PrivacyPolicyScreen
        onBackToApp={() => handleSelectRole('customer')}
      />
    );
  }
  if (role === 'customer') {
    return (
      <CustomerApp onOpenPrivacy={() => handleSelectRole('privacy')} />
    );
  }
  if (role === 'rider') {
    return <RiderApp />;
  }
  if (role === 'owner') {
    return <OwnerApp />;
  }
  return (
    <LauncherScreen
      onSelectRole={handleSelectRole}
      onOpenPrivacy={() => handleSelectRole('privacy')}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <DailyDropRouter />
    </ErrorBoundary>
  );
}
