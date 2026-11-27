import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __ddDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaMatch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mediaMatch || iosStandalone);
}

function detectIsIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(() =>
      typeof window !== 'undefined'
        ? window.__ddDeferredInstallPrompt ?? null
        : null
    );
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    detectStandaloneMode()
  );
  const [isIOS] = useState<boolean>(() => detectIsIOS());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsInstalled(detectStandaloneMode());
    if (window.__ddDeferredInstallPrompt) {
      setDeferredPrompt(window.__ddDeferredInstallPrompt);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__ddDeferredInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleEarlyReady = () => {
      if (window.__ddDeferredInstallPrompt) {
        setDeferredPrompt(window.__ddDeferredInstallPrompt);
      }
    };

    const handleAppInstalled = () => {
      window.__ddDeferredInstallPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('dd-install-prompt-ready', handleEarlyReady);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('dd-install-prompt-ready', handleEarlyReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const activePrompt =
      deferredPrompt ??
      (typeof window !== 'undefined'
        ? window.__ddDeferredInstallPrompt ?? null
        : null);
    if (!activePrompt) return 'unavailable';

    setInstalling(true);
    try {
      await activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      window.__ddDeferredInstallPrompt = null;
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    installing,
    promptInstall,
  };
}
