import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  BellOff,
  Bike,
  ClipboardList,
  KeyRound,
  LogOut,
  Music,
  Package,
  Play,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Store,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type {
  CustomerRecord,
  Order,
  Product,
  RiderRecord,
  StoreSettings,
} from '../types';
import {
  clearCompletedOrdersAndCustomerData,
  ensureProductsSeeded,
  ensureStoreSettingsSeeded,
  ownerPatchOrder,
  runAutoWeeklyArchiveIfNeeded,
  subscribePath,
  updateOwnerPassword,
  updateStoreSettings,
  verifyOwnerPassword,
} from '../services/firebaseDb';
import {
  getCompletedOrdersForCleanup,
  normalizeOrderStatus,
} from '../utils/domain';
import { isOwnerAlertOrder } from '../utils/orderTimer';
import {
  DEFAULT_STORE_SETTINGS,
  normalizeStoreSettings,
  pickBestOnlineRiderForAutoAssign,
} from '../utils/storeSettings';
import {
  ensureOrderAlertAudioPlaying,
  getCustomRingtoneInfo,
  installGlobalAudioUnlock,
  playShortTestChime,
  resetCustomRingtone,
  saveCustomRingtoneFile,
  startOrderAlertLoop,
  stopOrderAlertLoop,
  testRingtone,
  unlockAudioContext,
  type CustomRingtoneInfo,
} from '../utils/sound';
import {
  getNotificationPermissionState,
  isBackgroundKeepAliveActive,
  registerDailyDropServiceWorker,
  requestBackgroundAlertPermission,
  showHighPriorityOrderNotification,
  startDutyBackgroundKeepAlive,
  stopDutyBackgroundKeepAlive,
  subscribeNotificationClickMessages,
  type NotificationPermissionState,
} from '../utils/backgroundAlerts';
import { BrandLogo } from './BrandLogo';
import { BackExitToast } from './BackExitToast';
import { CopyToast } from './CopyToast';
import { InAppMapModal, type MapModalTarget } from './InAppMapModal';
import { NetworkStatusBanner } from './NetworkStatusBanner';
import { useAndroidBackGuard } from '../hooks/useAndroidBackGuard';
import { LiveOrdersTab } from './owner/LiveOrdersTab';
import { RidersTab } from './owner/RidersTab';
import { StockTab } from './owner/StockTab';
import { SalesCustomersTab } from './owner/SalesCustomersTab';
import { StoreFeesTab } from './owner/StoreFeesTab';
import {
  clearOwnerSession,
  loadOwnerSession,
  saveOwnerSession,
} from '../utils/sessionStorage';

type OwnerTab = 'orders' | 'riders' | 'stock' | 'sales' | 'store';

export function OwnerApp() {
  const [authenticated, setAuthenticated] = useState<boolean>(() =>
    Boolean(loadOwnerSession())
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<OwnerTab>('orders');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isRinging, setIsRinging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);
  const [mapModalTarget, setMapModalTarget] = useState<MapModalTarget | null>(null);

  const handleTabNotify = (msg: string) => {
    if (msg === 'Number copied!' || msg === 'Location copied!') {
      setCopyToast(msg);
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
      copyToastTimerRef.current = window.setTimeout(() => {
        setCopyToast(null);
      }, 2200);
      return;
    }
    setToast(msg);
  };

  // Custom Ringtone state
  const [ringtoneInfo, setRingtoneInfo] = useState<CustomRingtoneInfo>(() =>
    getCustomRingtoneInfo('owner')
  );
  const [ringtoneFeedback, setRingtoneFeedback] = useState<string | null>(null);
  const [ringtoneError, setRingtoneError] = useState<string | null>(null);

  // Live RTDB collections
  const [orders, setOrders] = useState<Order[]>([]);
  const [riders, setRiders] = useState<RiderRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(
    DEFAULT_STORE_SETTINGS
  );
  const [togglingQuickKey, setTogglingQuickKey] = useState<'isOpen' | 'autoAssign' | null>(null);
  const autoAssignedOrderIdsRef = useRef<Set<string>>(new Set());
  const noOnlineRiderNotifiedRef = useRef<Set<string>>(new Set());
  const autoArchiveCheckedRef = useRef(false);

  // Settings modal (Custom Ringtone + Change Owner Password + Weekly Data Cleanup)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Weekly Completed Orders & Customer Data Cleanup confirmation popup
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);

  // Track PENDING order IDs so ANY pending order loops loudly every 2s until Accepted/Rejected
  const initialOrdersLoadedRef = useRef(false);
  const knownPendingIdsRef = useRef<Set<string>>(new Set());
  const silencedPendingIdsRef = useRef<Set<string>>(new Set());
  const notifiedOwnerAlertKeysRef = useRef<Set<string>>(new Set());
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // High-priority System Notification + Background Audio Keep-Alive state
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(() => getNotificationPermissionState());
  const [keepAliveActive, setKeepAliveActive] = useState<boolean>(() =>
    isBackgroundKeepAliveActive()
  );

  // Unlock Web Audio on first tap/keypress, listen to notification clicks, and stop audio on unmount
  useEffect(() => {
    const cleanupUnlock = installGlobalAudioUnlock();
    void registerDailyDropServiceWorker();
    const unsubNotifClick = subscribeNotificationClickMessages((payload) => {
      if (payload.role && payload.role !== 'owner') return;
      setActiveTab('orders');
      if (soundEnabledRef.current) {
        const hasUnsilenced = Array.from(knownPendingIdsRef.current).some(
          (id) => !silencedPendingIdsRef.current.has(id)
        );
        if (hasUnsilenced) {
          ensureOrderAlertAudioPlaying('owner');
          setIsRinging(true);
        }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    return () => {
      cleanupUnlock();
      unsubNotifClick();
      stopOrderAlertLoop();
      stopDutyBackgroundKeepAlive();
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
    };
  }, []);

  // Immediately resume gain=1.0 siren if Owner window regains focus while an order is waiting
  useEffect(() => {
    if (!authenticated) return;
    const handleRegainFocus = () => {
      setNotificationPermission(getNotificationPermissionState());
      if (document.visibilityState !== 'visible' || !soundEnabledRef.current) return;
      const hasUnsilenced = Array.from(knownPendingIdsRef.current).some(
        (id) => !silencedPendingIdsRef.current.has(id)
      );
      if (hasUnsilenced) {
        ensureOrderAlertAudioPlaying('owner');
        setIsRinging(true);
      }
    };

    window.addEventListener('focus', handleRegainFocus);
    document.addEventListener('visibilitychange', handleRegainFocus);
    return () => {
      window.removeEventListener('focus', handleRegainFocus);
      document.removeEventListener('visibilitychange', handleRegainFocus);
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      stopOrderAlertLoop();
      stopDutyBackgroundKeepAlive();
      setKeepAliveActive(false);
      setIsRinging(false);
      return;
    }
    let active = true;

    void ensureProductsSeeded();
    void ensureStoreSettingsSeeded();

    const unsubStoreSettings = subscribePath<Partial<StoreSettings>>(
      'storeSettings',
      (data) => {
        if (!active) return;
        setStoreSettings(normalizeStoreSettings(data));
      }
    );

    const unsubOrders = subscribePath<Record<string, Order>>(
      'orders',
      (data) => {
        if (!active) return;
        const list = data
          ? Object.entries(data)
              .map(([id, ord]) => ({ ...ord, id: ord.id || id }))
              .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          : [];

        const currentAlertOrders = list.filter((o) => isOwnerAlertOrder(o));
        const currentPendingIds = new Set(currentAlertOrders.map((o) => o.id));

        // Prune manually silenced IDs that are no longer PENDING
        for (const id of Array.from(silencedPendingIdsRef.current)) {
          if (!currentPendingIds.has(id)) {
            silencedPendingIdsRef.current.delete(id);
          }
        }

        if (!initialOrdersLoadedRef.current) {
          for (const ord of currentAlertOrders) {
            const alertKey = `${ord.id}:${normalizeOrderStatus(ord.status)}:${ord.timedOutAt ?? ord.createdAt}`;
            notifiedOwnerAlertKeysRef.current.add(alertKey);
          }
        }

        if (currentPendingIds.size === 0) {
          stopOrderAlertLoop();
          setIsRinging(false);
        } else {
          let hasUnsilencedPending = false;
          let hasNewlyArrivedPending = false;
          const newlyAlertableOrders: Order[] = [];

          for (const ord of currentAlertOrders) {
            const id = ord.id;
            if (!silencedPendingIdsRef.current.has(id)) {
              hasUnsilencedPending = true;
            }
            const alertKey = `${ord.id}:${normalizeOrderStatus(ord.status)}:${ord.timedOutAt ?? ord.createdAt}`;
            if (
              initialOrdersLoadedRef.current &&
              (!knownPendingIdsRef.current.has(id) ||
                !notifiedOwnerAlertKeysRef.current.has(alertKey))
            ) {
              hasNewlyArrivedPending = true;
              if (!notifiedOwnerAlertKeysRef.current.has(alertKey)) {
                notifiedOwnerAlertKeysRef.current.add(alertKey);
                newlyAlertableOrders.push(ord);
              }
            }
          }

          for (const ord of newlyAlertableOrders) {
            void showHighPriorityOrderNotification(ord, 'owner');
          }

          if (hasUnsilencedPending && soundEnabledRef.current) {
            if (hasNewlyArrivedPending) {
              ensureOrderAlertAudioPlaying('owner');
              setToast(
                'New PENDING order arrived! Loud siren & vibration looping until Accepted or Rejected.'
              );
            } else {
              startOrderAlertLoop();
            }
            setIsRinging(true);
          } else {
            stopOrderAlertLoop();
            setIsRinging(false);
          }
        }

        initialOrdersLoadedRef.current = true;
        knownPendingIdsRef.current = currentPendingIds;
        setOrders(list);
      }
    );

    const unsubRiders = subscribePath<Record<string, RiderRecord>>(
      'riders',
      (data) => {
        if (!active) return;
        const list = data
          ? Object.entries(data)
              .map(([id, r]) => ({ ...r, id: r.id || id }))
              .sort((a, b) => a.id.localeCompare(b.id))
          : [];
        setRiders(list);
      }
    );

    const unsubProducts = subscribePath<Record<string, Product>>(
      'products',
      (data) => {
        if (!active) return;
        const list = data
          ? Object.entries(data)
              .map(([id, p]) => ({ ...p, id: p.id || id }))
              .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
          : [];
        setProducts(list);
      }
    );

    const unsubCustomers = subscribePath<Record<string, CustomerRecord>>(
      'customers',
      (data) => {
        if (!active) return;
        const list = data
          ? Object.entries(data)
              .map(([mobile, c]) => ({ ...c, mobile: c.mobile || mobile }))
              .sort((a, b) => (b.lastOrderAt ?? 0) - (a.lastOrderAt ?? 0))
          : [];
        setCustomers(list);
      }
    );

    return () => {
      active = false;
      initialOrdersLoadedRef.current = false;
      stopOrderAlertLoop();
      unsubStoreSettings();
      unsubOrders();
      unsubRiders();
      unsubProducts();
      unsubCustomers();
    };
  }, [authenticated]);

  // Automatic 7-day weekly history maintenance (archives financial totals before cleaning >7d completed orders)
  useEffect(() => {
    if (!authenticated || autoArchiveCheckedRef.current) return;
    if (orders.length === 0) return;
    autoArchiveCheckedRef.current = true;
    void runAutoWeeklyArchiveIfNeeded(orders, customers)
      .then((res) => {
        if (res.archivedOrders > 0) {
          setToast(
            `Automatic 7-day privacy cleanup archived ${res.archivedOrders} completed ${
              res.archivedOrders === 1 ? 'order' : 'orders'
            } (backup ${res.archiveId}) while keeping all active orders safe.`
          );
        }
      })
      .catch(() => {
        autoArchiveCheckedRef.current = false;
      });
  }, [authenticated, orders, customers]);

  // Safety Auto-Assign Online Rider watcher: if Auto-Assign is ON and an unassigned pending
  // order arrives (e.g. placed when no rider was online or via another client), auto-assign
  // it to the Duty-ON rider with fewest active orders, or alert Owner if none are online.
  useEffect(() => {
    if (!authenticated || !storeSettings.autoAssign) return;

    const pendingUnassigned = orders.filter(
      (o) =>
        normalizeOrderStatus(o.status) === 'pending' &&
        !o.assignedRiderId &&
        !o.ownerApproved
    );
    if (pendingUnassigned.length === 0) return;

    const workingOrders = orders.map((o) => ({ ...o }));
    for (const order of pendingUnassigned) {
      if (autoAssignedOrderIdsRef.current.has(order.id)) continue;

      const bestRider = pickBestOnlineRiderForAutoAssign(riders, workingOrders);
      if (!bestRider) {
        if (!noOnlineRiderNotifiedRef.current.has(order.id)) {
          noOnlineRiderNotifiedRef.current.add(order.id);
          setToast(
            `New order ${order.id} arrived — no Duty-ON riders online! Please assign manually.`
          );
        }
        continue;
      }

      autoAssignedOrderIdsRef.current.add(order.id);
      const now = Date.now();
      // Optimistically reflect assignment in workingOrders for fair load distribution across batch
      const target = workingOrders.find((o) => o.id === order.id);
      if (target) {
        target.status = 'assigned';
        target.assignedRiderId = bestRider.id;
      }

      void ownerPatchOrder(order.id, {
        status: 'assigned',
        ownerApproved: true,
        autoAssigned: true,
        assignedRiderId: bestRider.id,
        assignedRiderName: bestRider.name,
        assignedRiderPhone: bestRider.mobile,
        assignedRiderMobile: bestRider.mobile,
        assignedAt: now,
        timedOutAt: null,
      })
        .then(() => {
          setToast(
            `Auto-assigned ${order.id} to ${bestRider.name} (${bestRider.id}) — Rider App alerted.`
          );
        })
        .catch(() => {
          autoAssignedOrderIdsRef.current.delete(order.id);
        });
    }
  }, [authenticated, storeSettings.autoAssign, orders, riders]);

  const handleQuickToggleSetting = async (key: 'isOpen' | 'autoAssign') => {
    setTogglingQuickKey(key);
    try {
      const nextVal = !storeSettings[key];
      await updateStoreSettings({ [key]: nextVal });
      if (key === 'isOpen') {
        setToast(
          nextVal
            ? 'Store is now OPEN — accepting customer orders.'
            : 'Store is now CLOSED — Customer App checkout disabled.'
        );
      } else {
        setToast(
          nextVal
            ? 'Auto-Assign Online Rider: ON'
            : 'Auto-Assign Online Rider: OFF (manual dispatch)'
        );
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to update store setting.');
    } finally {
      setTogglingQuickKey(null);
    }
  };

  const handleStopRinging = () => {
    for (const id of knownPendingIdsRef.current) {
      silencedPendingIdsRef.current.add(id);
    }
    stopOrderAlertLoop();
    setIsRinging(false);
  };

  const handleEnableOwnerBackgroundAlerts = async () => {
    unlockAudioContext();
    setSoundEnabled(true);

    const perm = await requestBackgroundAlertPermission();
    setNotificationPermission(perm);

    const keepAliveRes = await startDutyBackgroundKeepAlive('owner');
    setKeepAliveActive(keepAliveRes.active);

    if (perm === 'granted') {
      setToast(
        keepAliveRes.active
          ? 'Background Order Alerts & Media Session Keep-Alive are ON — new orders will alert you over YouTube or other apps.'
          : 'Background Order Alerts enabled! System banners will stay pinned on screen for new orders.'
      );
    } else if (perm === 'denied') {
      setToast(
        'Notifications are blocked in browser settings. Allow Notifications for DailyDrop in Chrome Site Settings.'
      );
    } else {
      setToast(
        'Audio unlocked. Allow browser notifications when prompted for pinned alerts over other apps.'
      );
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      unlockAudioContext();
      const valid = await verifyOwnerPassword(passwordInput);
      if (!valid) {
        setLoginError('Incorrect owner password. Please try again.');
        return;
      }
      silencedPendingIdsRef.current.clear();
      saveOwnerSession();
      setAuthenticated(true);
      setPasswordInput('');
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : 'Could not verify owner password.'
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const handleUploadRingtone = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setRingtoneError(null);
    setRingtoneFeedback(null);
    try {
      const info = await saveCustomRingtoneFile(file, 'owner');
      setRingtoneInfo(info);
      setRingtoneFeedback(`Saved "${info.name}" as your order alert ringtone.`);
    } catch (err) {
      setRingtoneError(
        err instanceof Error ? err.message : 'Failed to save ringtone.'
      );
    }
  };

  const handleTestRingtone = () => {
    setRingtoneError(null);
    unlockAudioContext();
    testRingtone('owner');
    setIsRinging(true);
    setRingtoneFeedback(`Playing "${ringtoneInfo.name}" at full volume + vibration…`);
  };

  const handleResetRingtone = () => {
    setRingtoneError(null);
    const info = resetCustomRingtone('owner');
    setRingtoneInfo(info);
    setIsRinging(false);
    setRingtoneFeedback('Reset to Built-In Dual-Tone Siren.');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    const cleanedCurrent = currentPassword.trim();
    const cleanedNew = newPassword.trim();
    if (!cleanedCurrent) {
      setPasswordMsg('Please enter your current password.');
      return;
    }
    if (cleanedNew.length < 6) {
      setPasswordMsg('New password must be at least 6 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      const validCurrent = await verifyOwnerPassword(cleanedCurrent);
      if (!validCurrent) {
        setPasswordMsg('Current password is incorrect (case-sensitive).');
        return;
      }
      await updateOwnerPassword(cleanedNew);
      setCurrentPassword('');
      setNewPassword('');
      setToast('Owner password updated in Firebase /settings/ownerAuth/password.');
      setSettingsOpen(false);
    } catch (err) {
      setPasswordMsg(
        err instanceof Error ? err.message : 'Failed to update password.'
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const pendingCount = orders.filter((o) => isOwnerAlertOrder(o)).length;
  const completedOrdersForCleanup = getCompletedOrdersForCleanup(orders);

  // Prevent accidental app exit on Android hardware/gesture Back button
  const { exitPromptVisible } = useAndroidBackGuard({
    scope: 'owner',
    hasOpenOverlay: Boolean(mapModalTarget || cleanupModalOpen || settingsOpen),
    onCloseOverlay: () => {
      if (mapModalTarget) {
        setMapModalTarget(null);
      } else if (cleanupModalOpen) {
        setCleanupModalOpen(false);
      } else if (settingsOpen) {
        setSettingsOpen(false);
      }
    },
    isOnSubView: authenticated && activeTab !== 'orders',
    onReturnHome: () => setActiveTab('orders'),
  });

  const handleConfirmWeeklyCleanup = async () => {
    setCleaningUp(true);
    try {
      const result = await clearCompletedOrdersAndCustomerData(orders, customers);
      setCleanupModalOpen(false);
      setSettingsOpen(false);
      if (result.deletedOrders === 0 && result.deletedCustomers === 0) {
        setToast(
          'No DELIVERED or REJECTED orders to clear right now. Product stock, riders, and settings are untouched.'
        );
      } else {
        setToast(
          `Weekly cleanup complete: permanently deleted ${result.deletedOrders} completed ${
            result.deletedOrders === 1 ? 'order' : 'orders'
          } and ${result.deletedCustomers} customer ${
            result.deletedCustomers === 1 ? 'record' : 'records'
          }. Product stock, riders, and settings remain safe.`
        );
      }
    } catch (err) {
      setToast(
        err instanceof Error
          ? err.message
          : 'Weekly cleanup failed. Please check connection and retry.'
      );
    } finally {
      setCleaningUp(false);
    }
  };

  // OWNER LOGIN SCREEN
  if (!authenticated) {
    return (
      <div className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-safe">
        <header className="bg-slate-900 text-white px-4 sm:px-6 py-5">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <BrandLogo size="md" />
            <div>
              <h1 className="font-display text-2xl font-extrabold leading-tight">
                DailyDrop Owner
              </h1>
              <p className="text-xs text-slate-300">
                Store Command Center
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Owner Login
            </h2>
            <p className="text-sm text-slate-600 mt-1 mb-6">
              Enter your Owner Controller password to manage live orders, riders,
              stock, and daily revenue.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="owner-password-input"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Owner Password
                </label>
                <input
                  id="owner-password-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter owner password"
                  className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-800 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loggingIn}
                className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-base transition-all disabled:opacity-60 cursor-pointer"
              >
                {loggingIn ? 'Verifying…' : 'Open Command Center'}
              </button>
            </form>
          </div>
        </main>
        <BackExitToast visible={exitPromptVisible} />
      </div>
    );
  }

  const tabs: Array<{
    key: OwnerTab;
    label: string;
    icon: typeof ClipboardList;
    badge?: number;
  }> = [
    { key: 'orders', label: 'Live Orders', icon: ClipboardList, badge: pendingCount },
    { key: 'riders', label: 'Riders & Duty', icon: Bike },
    { key: 'stock', label: 'Stock & Prices', icon: Package },
    { key: 'sales', label: 'Sales & Customers', icon: BarChart3 },
    { key: 'store', label: 'Store & Fees', icon: SlidersHorizontal },
  ];

  return (
    <div className="app-scroll-page bg-slate-50 pb-safe-page">
      <NetworkStatusBanner />
      {/* Owner Header */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <span className="font-display text-lg sm:text-xl font-extrabold tracking-tight whitespace-nowrap">
              DailyDrop Owner
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                unlockAudioContext();
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (!next) {
                  handleStopRinging();
                } else {
                  silencedPendingIdsRef.current.clear();
                  if (knownPendingIdsRef.current.size > 0) {
                    startOrderAlertLoop();
                    setIsRinging(true);
                  } else {
                    testRingtone('owner');
                  }
                }
              }}
              aria-label={soundEnabled ? 'Mute order ringtone' : 'Enable order ringtone'}
              className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                soundEnabled
                  ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <VolumeX className="w-4 h-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {soundEnabled ? 'Alert ON' : 'Muted'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentPassword('');
                setNewPassword('');
                setPasswordMsg(null);
                setRingtoneError(null);
                setRingtoneFeedback(null);
                setRingtoneInfo(getCustomRingtoneInfo('owner'));
                setSettingsOpen(true);
              }}
              aria-label="Owner settings and custom ringtone"
              className="min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                handleStopRinging();
                stopDutyBackgroundKeepAlive();
                setKeepAliveActive(false);
                clearOwnerSession();
                setAuthenticated(false);
              }}
              aria-label="Sign out of Owner Controller"
              className="min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Clear Top Audio & Background Alerts Unlock Bar */}
      <div className="bg-slate-800 text-white border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="owner-alert-sound-btn"
              onClick={() => {
                unlockAudioContext();
                setSoundEnabled(true);
                silencedPendingIdsRef.current.clear();
                playShortTestChime('owner');
                if (knownPendingIdsRef.current.size > 0) {
                  startOrderAlertLoop();
                  setIsRinging(true);
                }
                setToast(
                  'Order Alert Sound is ON — audio unlocked for incoming & unassigned order alerts.'
                );
              }}
              className={`min-h-[38px] px-3.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer transition-colors ${
                soundEnabled
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                  : 'bg-slate-700 hover:bg-slate-600 text-white'
              }`}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <VolumeX className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {soundEnabled ? 'Order Alert Sound: ON' : 'Order Alert Sound: MUTED (Tap to Enable)'}
              </span>
            </button>

          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={togglingQuickKey === 'isOpen'}
              data-testid="owner-quick-store-toggle"
              onClick={() => void handleQuickToggleSetting('isOpen')}
              className={`min-h-[38px] px-3 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 ${
                storeSettings.isOpen
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              {storeSettings.isOpen ? (
                <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Power className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{storeSettings.isOpen ? 'Store Open' : 'Store Closed'}</span>
            </button>

            <button
              type="button"
              disabled={togglingQuickKey === 'autoAssign'}
              data-testid="owner-quick-autoassign-toggle"
              onClick={() => void handleQuickToggleSetting('autoAssign')}
              className={`min-h-[38px] px-3 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 ${
                storeSettings.autoAssign
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                Auto-Assign Online Rider: {storeSettings.autoAssign ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              data-testid="owner-enable-notifications-btn"
              onClick={() => void handleEnableOwnerBackgroundAlerts()}
              className={`min-h-[38px] px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors ${
                notificationPermission === 'granted' && keepAliveActive
                  ? 'bg-cyan-400 hover:bg-cyan-300 text-slate-950'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
              }`}
            >
              <span>
                {notificationPermission === 'granted' && keepAliveActive
                  ? '🔔 Notifications: ON'
                  : '🔔 Enable Notifications'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                handleStopRinging();
                setToast('Order alert muted for current pending orders.');
              }}
              className="min-h-[38px] px-3 rounded-xl bg-slate-900 hover:bg-slate-950 border border-slate-700 text-slate-100 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <BellOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Mute Alert</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Ringing Banner when a new PENDING or timed-out UNASSIGNED order is looping */}
      {isRinging && (
        <div
          role="alert"
          className="bg-blue-700 text-white border-b border-blue-600"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-bold">
              <Bell className="w-5 h-5 text-cyan-300 shrink-0" aria-hidden="true" />
              <span>
                Order Alert Ringing ({ringtoneInfo.name})
                {pendingCount > 0
                  ? ` · ${pendingCount} ${pendingCount === 1 ? 'order' : 'orders'} waiting`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopRinging}
              className="min-h-[40px] px-4 rounded-xl bg-white text-blue-900 hover:bg-cyan-50 font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
            >
              <BellOff className="w-4 h-4" aria-hidden="true" />
              <span>Mute Alert</span>
            </button>
          </div>
        </div>
      )}

      {/* 4 Navigation Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav
            role="tablist"
            aria-label="Owner sections"
            className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 py-2.5"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-50 sm:bg-transparent text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span
                      className={`tabular-nums text-xs font-extrabold px-1.5 py-0.5 rounded ${
                        active
                          ? 'bg-cyan-400 text-blue-950'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5">
        {toast && (
          <div
            role="status"
            className="mb-5 bg-blue-50 border border-blue-200 text-blue-950 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between gap-3"
          >
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="p-1 text-blue-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === 'orders' && (
          <LiveOrdersTab
            orders={orders}
            riders={riders}
            completedCleanupCount={completedOrdersForCleanup.length}
            onOpenWeeklyCleanup={() => setCleanupModalOpen(true)}
            onOpenMapModal={setMapModalTarget}
            onNotify={handleTabNotify}
          />
        )}
        {activeTab === 'riders' && (
          <RidersTab
            riders={riders}
            orders={orders}
            onNotify={handleTabNotify}
          />
        )}
        {activeTab === 'stock' && (
          <StockTab products={products} onNotify={handleTabNotify} />
        )}
        {activeTab === 'sales' && (
          <SalesCustomersTab
            orders={orders}
            customers={customers}
            onNotify={handleTabNotify}
          />
        )}
        {activeTab === 'store' && (
          <StoreFeesTab
            settings={storeSettings}
            riders={riders}
            onNotify={handleTabNotify}
          />
        )}
      </main>

      {/* Owner Settings Modal (Custom Phone Ringtone + Owner Password) */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="owner-settings-title"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2
                id="owner-settings-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Owner Settings &amp; Alert Ringtone
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Custom Phone Ringtone Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-blue-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Custom Order Alert Ringtone
                  </h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Loops loudly every 2 seconds with vibration whenever any PENDING
                  order is waiting until you click Accept or Reject. Active tone:{' '}
                  <strong className="text-slate-900">{ringtoneInfo.name}</strong>
                </p>

                <label className="w-full min-h-[48px] px-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4 text-cyan-700" aria-hidden="true" />
                  <span>Upload Custom Ringtone from Phone (Max 3 MB)</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => void handleUploadRingtone(e)}
                    className="sr-only"
                  />
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handleTestRingtone}
                    className="min-h-[44px] px-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>Test Ringtone</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      handleStopRinging();
                      setRingtoneFeedback('Ringtone stopped.');
                    }}
                    className="min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Stop</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetRingtone}
                    className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Reset to Default</span>
                  </button>
                </div>

                {ringtoneFeedback && (
                  <p role="status" className="text-xs font-semibold text-emerald-700">
                    {ringtoneFeedback}
                  </p>
                )}
                {ringtoneError && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    {ringtoneError}
                  </p>
                )}
              </div>

              <hr className="border-slate-200" />

              {/* Owner Password Change Form */}
              <form onSubmit={handleChangePassword} className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-700" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Change Owner Password
                  </h3>
                </div>
                <p className="text-xs text-slate-600">
                  Stored in Firebase Realtime Database at{' '}
                  <code className="font-mono">/settings/ownerAuth/password</code>{' '}
                  (exact case-sensitive match).
                </p>

                <div>
                  <label
                    htmlFor="current-owner-pass"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    Current Password
                  </label>
                  <input
                    id="current-owner-pass"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current owner password"
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-owner-pass"
                    className="block text-xs font-semibold text-slate-800 mb-1"
                  >
                    New Password
                  </label>
                  <input
                    id="new-owner-pass"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-blue-700"
                  />
                </div>

                {passwordMsg && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    {passwordMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingPassword}
                  className="w-full min-h-[48px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm cursor-pointer disabled:opacity-60"
                >
                  {savingPassword ? 'Saving…' : 'Save'}
                </button>
              </form>

              <hr className="border-slate-200" />

              {/* Weekly Customer Data Cleanup Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Weekly Customer Data Cleanup (7-Day Policy)
                  </h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Permanently deletes all <strong>DELIVERED</strong> and{' '}
                  <strong>REJECTED</strong> orders (including customer names, mobile
                  numbers, addresses, and delivery proof photos) from Firebase{' '}
                  <code className="font-mono">/orders</code> and clears inactive
                  customer records, while keeping product stock, rider accounts, active
                  orders, and settings safe.
                </p>
                <button
                  type="button"
                  onClick={() => setCleanupModalOpen(true)}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    Clear Completed Orders &amp; Customer Data (Weekly Cleanup)
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Weekly Cleanup Confirmation Popup */}
      {cleanupModalOpen && (
        <div
          className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="weekly-cleanup-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2
                id="weekly-cleanup-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Confirm Weekly Data Cleanup
              </h2>
              <button
                type="button"
                onClick={() => setCleanupModalOpen(false)}
                disabled={cleaningUp}
                aria-label="Close cleanup confirmation"
                className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-950 space-y-1.5">
                <p className="font-bold">
                  {completedOrdersForCleanup.length === 0
                    ? 'No DELIVERED or REJECTED orders are currently waiting for cleanup.'
                    : `Permanently delete ${completedOrdersForCleanup.length} completed ${
                        completedOrdersForCleanup.length === 1 ? 'order' : 'orders'
                      } (DELIVERED & REJECTED)?`}
                </p>
                <p className="text-xs text-red-800 leading-relaxed">
                  This removes customer names, mobile numbers, delivery locations, and
                  delivery proof photos from Firebase <code className="font-mono">/orders</code>{' '}
                  (and wipes inactive customer entries) in line with DailyDrop Water&apos;s
                  7-day deletion policy.
                </p>
              </div>

              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 font-medium leading-relaxed">
                <strong>Safe &amp; Untouched:</strong> Active orders (Order Placed, Rider
                Accepted, Reached Plant, Out for Delivery), product catalog &amp; stock,
                rider accounts, and Owner settings will NOT be modified.
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={cleaningUp}
                  onClick={() => setCleanupModalOpen(false)}
                  className="min-h-[46px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={cleaningUp}
                  onClick={() => void handleConfirmWeeklyCleanup()}
                  className="min-h-[46px] rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{cleaningUp ? 'Deleting…' : 'Confirm Delete'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <InAppMapModal
        target={mapModalTarget}
        onClose={() => setMapModalTarget(null)}
        onCopied={handleTabNotify}
      />
      <CopyToast message={copyToast} />
      <BackExitToast visible={exitPromptVisible} />
    </div>
  );
}
