import { useEffect, useRef, useState } from 'react';
import { resolveBackNavigationAction } from '../utils/orderTimer';

export interface UseAndroidBackGuardOptions {
  /** Unique scope name (e.g. 'customer', 'rider', 'owner') */
  scope: string;
  /** Whether a modal, drawer, or photo lightbox is currently open */
  hasOpenOverlay: boolean;
  /** Callback to close the topmost open modal/drawer/lightbox */
  onCloseOverlay: () => void;
  /** Whether the user is on a secondary tab/view rather than the app's root screen */
  isOnSubView?: boolean;
  /** Callback to return to the app's primary view */
  onReturnHome?: () => void;
  /** When true, completely blocks leaving the current screen on Back press (only allows closing overlays) */
  locked?: boolean;
  /** Optional callback invoked when user presses Back while locked */
  onLockedBackPress?: () => void;
  /** Window in ms where a second Back press permits exiting (default 2500ms) */
  exitWindowMs?: number;
}

const GUARD_STATE_FLAG = 'dailyDropBackGuard';

/**
 * Prevents accidental Android WebView / browser app exit when tapping hardware or gesture Back:
 * 1. Closes any open modal/drawer first.
 * 2. If `locked` is true (e.g. Rider Active Order screen), strictly prevents navigating back or exiting.
 * 3. Returns from secondary tabs to the main view next.
 * 4. On the root view, shows "Press Back again to exit" toast and keeps the app open unless pressed twice within 2.5s.
 */
export function useAndroidBackGuard({
  scope,
  hasOpenOverlay,
  onCloseOverlay,
  isOnSubView = false,
  onReturnHome,
  locked = false,
  onLockedBackPress,
  exitWindowMs = 2500,
}: UseAndroidBackGuardOptions): { exitPromptVisible: boolean } {
  const [exitPromptVisible, setExitPromptVisible] = useState(false);

  const latestRef = useRef({
    hasOpenOverlay,
    onCloseOverlay,
    isOnSubView,
    onReturnHome,
    locked,
    onLockedBackPress,
    exitWindowMs,
  });
  latestRef.current = {
    hasOpenOverlay,
    onCloseOverlay,
    isOnSubView,
    onReturnHome,
    locked,
    onLockedBackPress,
    exitWindowMs,
  };

  const lastBackPressAtRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.pushState) {
      return;
    }

    const pushGuardSentinel = () => {
      try {
        window.history.pushState(
          { [GUARD_STATE_FLAG]: true, scope },
          '',
          window.location.href
        );
      } catch {
        // Ignore SecurityError in restricted environments
      }
    };

    // Seed a guard entry above the current URL if not already seeded for this scope
    const currentState = window.history.state as Record<string, unknown> | null;
    if (!currentState || currentState[GUARD_STATE_FLAG] !== true || currentState.scope !== scope) {
      pushGuardSentinel();
    }

    const handlePopState = () => {
      const now = Date.now();
      const current = latestRef.current;

      if (current.hasOpenOverlay) {
        lastBackPressAtRef.current = null;
        setExitPromptVisible(false);
        current.onCloseOverlay();
        pushGuardSentinel();
        return;
      }

      if (current.locked) {
        lastBackPressAtRef.current = null;
        setExitPromptVisible(false);
        current.onLockedBackPress?.();
        pushGuardSentinel();
        return;
      }

      const decision = resolveBackNavigationAction({
        hasOpenOverlay: current.hasOpenOverlay,
        isOnSubView: current.isOnSubView,
        lastBackPressAt: lastBackPressAtRef.current,
        nowMs: now,
        exitWindowMs: current.exitWindowMs,
      });

      if (decision === 'return_home') {
        lastBackPressAtRef.current = null;
        setExitPromptVisible(false);
        current.onReturnHome?.();
        pushGuardSentinel();
        return;
      }

      if (decision === 'warn_press_again') {
        lastBackPressAtRef.current = now;
        setExitPromptVisible(true);
        if (hideTimerRef.current !== null) {
          window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(() => {
          setExitPromptVisible(false);
          lastBackPressAtRef.current = null;
        }, current.exitWindowMs);
        pushGuardSentinel();
        return;
      }

      // Second Back press within exitWindowMs: allow default back/exit behavior
      lastBackPressAtRef.current = null;
      setExitPromptVisible(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [scope]);

  return { exitPromptVisible };
}
