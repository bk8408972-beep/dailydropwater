import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  Camera,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Music,
  Navigation,
  Phone,
  Play,
  Power,
  RotateCcw,
  Square,
  Truck,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type { Order, RiderRecord } from '../types';
import {
  authenticateRider,
  dbPatch,
  sanitizeFirebaseKey,
  subscribePath,
} from '../services/firebaseDb';
import {
  buildGoogleMapsUrl,
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isSafeImageDataUrl,
  sanitizePhoneForTel,
} from '../utils/domain';
import { formatRelativeTime } from '../utils/geo';
import {
  getCustomRingtoneInfo,
  installGlobalAudioUnlock,
  resetCustomRingtone,
  saveCustomRingtoneFile,
  startRiderAlarmLoop,
  stopOrderAlertLoop,
  testRingtone,
  unlockAudioContext,
  type CustomRingtoneInfo,
} from '../utils/sound';
import { BrandLogo } from './BrandLogo';

export function RiderApp() {
  const [riderIdInput, setRiderIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [sessionRiderId, setSessionRiderId] = useState<string | null>(null);
  const [rider, setRider] = useState<RiderRecord | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Live Selfie Camera Modal
  const [selfieModalOpen, setSelfieModalOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [savingDuty, setSavingDuty] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live GPS broadcasting state (every 5s while Duty ON)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [lastGpsSentAt, setLastGpsSentAt] = useState<number | null>(null);
  const latestCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastBroadcastMsRef = useRef<number>(0);

  // Loud delivery assignment alarm & custom ringtone state
  const [acknowledgedOrderIds, setAcknowledgedOrderIds] = useState<string[]>([]);
  const [isRinging, setIsRinging] = useState(false);
  const [ringtoneInfo, setRingtoneInfo] = useState<CustomRingtoneInfo>(() =>
    getCustomRingtoneInfo('rider')
  );
  const [ringtoneModalOpen, setRingtoneModalOpen] = useState(false);
  const [ringtoneFeedback, setRingtoneFeedback] = useState<string | null>(null);
  const [ringtoneError, setRingtoneError] = useState<string | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    const cleanupUnlock = installGlobalAudioUnlock();
    return () => {
      cleanupUnlock();
      stopCameraStream();
      stopOrderAlertLoop();
    };
  }, []);

  // Subscribe to logged-in rider profile & live orders
  useEffect(() => {
    if (!sessionRiderId) return;
    let active = true;

    const unsubRider = subscribePath<RiderRecord>(
      `riders/${sanitizeFirebaseKey(sessionRiderId)}`,
      (data) => {
        if (!active) return;
        if (!data || data.isActive === false) {
          setSessionRiderId(null);
          setRider(null);
          setAuthError(
            'Your Rider account is no longer active. Please contact the DailyDrop owner.'
          );
          return;
        }
        setRider({ ...data, id: sessionRiderId });
      }
    );

    const unsubOrders = subscribePath<Record<string, Order>>('orders', (data) => {
      if (!active) return;
      if (!data) {
        setOrders([]);
        return;
      }
      const list = Object.entries(data)
        .map(([id, ord]) => ({ ...ord, id: ord.id || id }))
        .filter((ord) => ord.assignedRiderId === sessionRiderId)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setOrders(list);
    });

    return () => {
      active = false;
      unsubRider();
      unsubOrders();
    };
  }, [sessionRiderId]);

  // Continuously watch GPS and push /riders/{riderId}/liveLocation every 5 seconds while Duty ON
  const isDutyOnline = Boolean(rider?.isOnline);
  useEffect(() => {
    if (!sessionRiderId || !isDutyOnline) {
      setGpsStatus('idle');
      setGpsError(null);
      latestCoordsRef.current = null;
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsError('GPS is not supported on this browser.');
      return;
    }

    let active = true;
    const safeRiderId = sanitizeFirebaseKey(sessionRiderId);

    const pushLiveLocation = async (lat: number, lng: number) => {
      if (!active) return;
      const now = Date.now();
      lastBroadcastMsRef.current = now;
      try {
        await dbPatch(`riders/${safeRiderId}`, {
          liveLocation: {
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            updatedAt: now,
          },
        });
        if (active) {
          setGpsStatus('active');
          setGpsError(null);
          setLastGpsSentAt(now);
        }
      } catch {
        // Retry automatically on next 5s interval
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!active) return;
        const { latitude, longitude } = pos.coords;
        latestCoordsRef.current = { lat: latitude, lng: longitude };
        setGpsStatus('active');
        setGpsError(null);
        // Push immediately on first fix or if >= 5s since last broadcast
        if (Date.now() - lastBroadcastMsRef.current >= 5000) {
          void pushLiveLocation(latitude, longitude);
        }
      },
      (err) => {
        if (!active) return;
        setGpsStatus('error');
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enable GPS so customers and Owner can track you live.'
            : 'Waiting for clear GPS signal…'
        );
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );

    const intervalId = window.setInterval(() => {
      if (!active) return;
      const coords = latestCoordsRef.current;
      if (coords && Date.now() - lastBroadcastMsRef.current >= 4800) {
        void pushLiveLocation(coords.lat, coords.lng);
      }
    }, 5000);

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(intervalId);
    };
  }, [sessionRiderId, isDutyOnline]);

  const activeDeliveries = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.status === 'PENDING' ||
          o.status === 'ACCEPTED' ||
          o.status === 'OUT_FOR_DELIVERY'
      ),
    [orders]
  );

  const completedDeliveries = useMemo(
    () => orders.filter((o) => o.status === 'DELIVERED'),
    [orders]
  );

  const unacknowledgedAcceptedOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.assignedRiderId === sessionRiderId &&
          o.status === 'ACCEPTED' &&
          !acknowledgedOrderIds.includes(o.id)
      ),
    [orders, sessionRiderId, acknowledgedOrderIds]
  );

  // Continuously ring Zomato-style delivery siren + vibration every 2s for assigned ACCEPTED orders
  useEffect(() => {
    if (sessionRiderId && unacknowledgedAcceptedOrders.length > 0) {
      startRiderAlarmLoop();
      setIsRinging(true);
    } else {
      stopOrderAlertLoop();
      setIsRinging(false);
    }
  }, [sessionRiderId, unacknowledgedAcceptedOrders.length]);

  const handleAcknowledgeOrders = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    stopOrderAlertLoop();
    setIsRinging(false);
    setAcknowledgedOrderIds((prev) => {
      const merged = new Set([...prev, ...orderIds]);
      return Array.from(merged);
    });
    setActionMessage(
      orderIds.length === 1
        ? `Acknowledged order ${orderIds[0]}. Tap Start Delivery when heading out.`
        : `Acknowledged ${orderIds.length} assigned orders.`
    );
  };

  const handleTestRiderSound = () => {
    setRingtoneError(null);
    unlockAudioContext();
    testRingtone('rider');
    setRingtoneFeedback(`Playing "${ringtoneInfo.name}" + vibration…`);
    if (!ringtoneModalOpen) {
      setActionMessage(`Playing Rider alert sound (${ringtoneInfo.name}).`);
    }
  };

  const handleUploadRiderRingtone = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setRingtoneError(null);
    setRingtoneFeedback(null);
    try {
      const info = await saveCustomRingtoneFile(file, 'rider');
      setRingtoneInfo(info);
      setRingtoneFeedback(`Saved "${info.name}" as your delivery alert ringtone.`);
    } catch (err) {
      setRingtoneError(
        err instanceof Error ? err.message : 'Failed to save ringtone.'
      );
    }
  };

  const handleResetRiderRingtone = () => {
    setRingtoneError(null);
    const info = resetCustomRingtone('rider');
    setRingtoneInfo(info);
    setRingtoneFeedback('Reset to Built-In Delivery Siren.');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSigningIn(true);
    try {
      unlockAudioContext();
      const result = await authenticateRider(riderIdInput, passwordInput);
      if (result.ok === false) {
        setAuthError(result.error);
        return;
      }
      setAcknowledgedOrderIds([]);
      setRider(result.rider);
      setSessionRiderId(result.rider.id);
      setPasswordInput('');
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in right now. Check internet connection.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const startFrontCamera = async () => {
    setCameraError(null);
    setCapturedPreview(null);
    setCameraReady(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera API is not available on this device or browser. Use mobile Chrome with HTTPS to capture your Duty Selfie.'
      );
      return;
    }

    const constraintSteps: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
        },
        audio: false,
      },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr: unknown = null;
    for (const constraints of constraintSteps) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
        return;
      } catch (err) {
        lastErr = err;
        // Stop retrying if user explicitly denied permission
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          break;
        }
      }
    }

    const message =
      lastErr instanceof Error ? lastErr.message : 'Camera permission denied.';
    setCameraError(
      `Front camera could not be opened (${message}). Please allow camera permission to go Duty ON.`
    );
  };

  const handleOpenDutyOnModal = () => {
    setSelfieModalOpen(true);
    setTimeout(() => {
      void startFrontCamera();
    }, 60);
  };

  const handleCloseSelfieModal = () => {
    stopCameraStream();
    setCapturedPreview(null);
    setCameraError(null);
    setSelfieModalOpen(false);
  };

  const handleCaptureSelfie = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const maxWidth = 320;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(160, Math.round(video.videoWidth * scale));
    const height = Math.max(160, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror selfie horizontally so it feels natural
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.65);
    setCapturedPreview(jpegDataUrl);
    stopCameraStream();
  };

  const handleConfirmDutyOn = async () => {
    if (!sessionRiderId || !capturedPreview) return;
    setSavingDuty(true);
    try {
      const dutyOnTime = Date.now();
      await dbPatch(`riders/${sanitizeFirebaseKey(sessionRiderId)}`, {
        isOnline: true,
        lastSelfie: capturedPreview,
        dutyOnTime,
      });
      setActionMessage('Duty is now ON with your live selfie proof saved.');
      handleCloseSelfieModal();
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : 'Failed to save Duty Selfie.'
      );
    } finally {
      setSavingDuty(false);
    }
  };

  const handleDutyOff = async () => {
    if (!sessionRiderId) return;
    setSavingDuty(true);
    try {
      await dbPatch(`riders/${sanitizeFirebaseKey(sessionRiderId)}`, {
        isOnline: false,
      });
      setActionMessage('You are now OFF Duty.');
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : 'Failed to update duty status.'
      );
    } finally {
      setSavingDuty(false);
    }
  };

  const handleUpdateOrderStatus = async (
    order: Order,
    nextStatus: 'OUT_FOR_DELIVERY' | 'DELIVERED'
  ) => {
    setUpdatingOrderId(order.id);
    if (nextStatus === 'OUT_FOR_DELIVERY') {
      stopOrderAlertLoop();
      setIsRinging(false);
      setAcknowledgedOrderIds((prev) =>
        prev.includes(order.id) ? prev : [...prev, order.id]
      );
    }
    try {
      const now = Date.now();
      const patch: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: now,
      };
      if (nextStatus === 'DELIVERED') {
        patch.deliveredAt = now;
      }
      await dbPatch(`orders/${sanitizeFirebaseKey(order.id)}`, patch);
      setActionMessage(
        nextStatus === 'DELIVERED'
          ? `Order ${order.id} marked Delivered.`
          : `Order ${order.id} is now Out for Delivery.`
      );
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : 'Failed to update order status.'
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // RIDER LOGIN SCREEN
  if (!sessionRiderId || !rider) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-blue-800 text-white px-4 sm:px-6 py-5">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <BrandLogo size="md" />
            <div>
              <h1 className="font-display text-2xl font-extrabold leading-tight">
                DailyDrop Rider
              </h1>
              <p className="text-xs text-cyan-100">
                Tolichowki Delivery Fleet Portal
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Rider Sign In
            </h2>
            <p className="text-sm text-slate-600 mt-1 mb-6">
              Sign in with your Unique Rider ID (such as DD001) and Password issued
              by the DailyDrop Owner.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="rider-id-input"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Unique Rider ID
                </label>
                <input
                  id="rider-id-input"
                  type="text"
                  autoComplete="username"
                  required
                  value={riderIdInput}
                  onChange={(e) => setRiderIdInput(e.target.value.toUpperCase())}
                  placeholder="DD001"
                  className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 text-base font-semibold uppercase tracking-wide text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label
                  htmlFor="rider-password-input"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Rider Password
                </label>
                <input
                  id="rider-password-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              {authError && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-800 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{authError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={signingIn}
                className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-base transition-all disabled:opacity-60 cursor-pointer"
              >
                {signingIn ? 'Verifying Rider ID…' : 'Sign In to Rider App'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Rider Sticky Top Bar */}
      <header className="sticky top-0 z-30 bg-blue-800 text-white shadow-sm">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <span className="font-display text-sm sm:text-lg font-extrabold tracking-tight block leading-tight truncate">
                {rider.name}
              </span>
              <span className="text-[11px] text-cyan-200 font-mono block leading-tight mt-0.5">
                {rider.id}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleTestRiderSound}
              aria-label="Test delivery alert sound"
              className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-blue-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Test Sound</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRingtoneError(null);
                setRingtoneFeedback(null);
                setRingtoneInfo(getCustomRingtoneInfo('rider'));
                setRingtoneModalOpen(true);
              }}
              aria-label="Rider custom ringtone settings"
              className="min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-blue-900/70 hover:bg-blue-900 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Music className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Ringtone</span>
            </button>

            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                stopOrderAlertLoop();
                setIsRinging(false);
                setSessionRiderId(null);
                setRider(null);
              }}
              aria-label="Sign out of Rider App"
              className="min-h-[38px] px-2.5 sm:px-3.5 rounded-xl bg-blue-900/70 hover:bg-blue-900 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Loud New Delivery Assignment Alert Banner */}
      {isRinging && unacknowledgedAcceptedOrders.length > 0 && (
        <div
          role="alert"
          className="bg-amber-500 text-slate-950 border-b border-amber-600 shadow-sm"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-extrabold">
              <Bell className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>
                New Delivery Assigned! Ringing ({ringtoneInfo.name}) ·{' '}
                {unacknowledgedAcceptedOrders.length}{' '}
                {unacknowledgedAcceptedOrders.length === 1 ? 'order' : 'orders'} waiting
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                handleAcknowledgeOrders(
                  unacknowledgedAcceptedOrders.map((o) => o.id)
                )
              }
              className="min-h-[40px] px-4 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
            >
              <BellOff className="w-4 h-4" aria-hidden="true" />
              <span>Acknowledge Order</span>
            </button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 space-y-6">
        {actionMessage && (
          <div
            role="status"
            className="bg-blue-50 border border-blue-200 text-blue-950 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between gap-3"
          >
            <span>{actionMessage}</span>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              aria-label="Dismiss notification"
              className="p-1 text-blue-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Duty ON/OFF Control Panel */}
        <section
          aria-label="Duty status"
          className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {isSafeImageDataUrl(rider.lastSelfie) ? (
                <img
                  src={rider.lastSelfie!}
                  alt={`${rider.name} live duty selfie`}
                  className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                  <Camera className="w-7 h-7" aria-hidden="true" />
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-500">
                  Current Duty Status
                </p>
                <h2
                  className={`font-display text-2xl font-extrabold ${
                    rider.isOnline ? 'text-emerald-700' : 'text-slate-700'
                  }`}
                >
                  {rider.isOnline ? 'Duty ON · Online' : 'Duty OFF · Offline'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rider.dutyOnTime
                    ? `Last selfie check-in: ${formatTimestamp(rider.dutyOnTime)}`
                    : 'Capture a live front-camera selfie to start receiving orders.'}
                </p>
                {rider.isOnline && (
                  <p
                    className={`text-xs font-semibold mt-1 flex items-center gap-1.5 ${
                      gpsStatus === 'error'
                        ? 'text-amber-700'
                        : 'text-cyan-700'
                    }`}
                  >
                    <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {gpsStatus === 'error'
                        ? gpsError
                        : lastGpsSentAt
                          ? `Live GPS sharing every 5s · Updated ${formatRelativeTime(
                              lastGpsSentAt
                            )}`
                          : 'Acquiring live GPS fix (shares every 5s)…'}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {rider.isOnline ? (
                <>
                  <button
                    type="button"
                    onClick={handleOpenDutyOnModal}
                    className="min-h-[48px] px-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-900 font-semibold text-sm flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    <span>Retake Selfie</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingDuty}
                    onClick={handleDutyOff}
                    className="min-h-[48px] px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <Power className="w-4 h-4" aria-hidden="true" />
                    <span>Go Duty OFF</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={savingDuty}
                  onClick={handleOpenDutyOnModal}
                  className="w-full sm:w-auto min-h-[52px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-base flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Camera className="w-5 h-5" aria-hidden="true" />
                  <span>Go Duty ON (Live Selfie)</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Active Assigned Deliveries */}
        <section aria-label="Assigned deliveries">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl font-bold text-slate-900">
              Active Assigned Orders ({activeDeliveries.length})
            </h2>
          </div>

          {activeDeliveries.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <Truck className="w-10 h-10 text-blue-700 mx-auto mb-3" aria-hidden="true" />
              <p className="font-semibold text-slate-900">
                No active deliveries assigned right now
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {rider.isOnline
                  ? 'Stay online — newly assigned Tolichowki orders appear here instantly.'
                  : 'Switch Duty ON with your selfie so the Owner can assign orders to you.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeDeliveries.map((order) => {
                const customerTel = sanitizePhoneForTel(order.customerMobile);
                const mapsUrl = buildGoogleMapsUrl(order.address);
                const busy = updatingOrderId === order.id;

                return (
                  <article
                    key={order.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                        <div>
                          <div className="text-xs font-medium text-slate-500 tabular-nums">
                            {order.id} · {formatTimestamp(order.createdAt)}
                          </div>
                          <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                            {order.customerName}
                          </h3>
                          <p className="text-xs font-semibold text-blue-700 mt-0.5">
                            {getStatusLabel(order.status)} · {order.paymentMethod}
                          </p>
                        </div>
                        <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                          {formatRupees(order.totalAmount)}
                        </div>
                      </div>

                      <div className="py-3 space-y-2 text-sm text-slate-700">
                        <div className="flex items-start gap-2">
                          <MapPin
                            className="w-4 h-4 text-blue-700 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                          <span>{order.address}</span>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3 text-sm font-medium text-slate-800">
                          {order.items
                            .map((item) => `${item.quantity} × ${item.name}`)
                            .join(' · ')}
                        </div>
                        {order.eventDetails && (
                          <div className="text-xs text-cyan-800 font-semibold flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Event: {order.eventDetails.eventDate} ·{' '}
                              {order.eventDetails.timeSlot}
                              {order.eventDetails.notes
                                ? ` · ${order.eventDetails.notes}`
                                : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-2.5">
                        <a
                          href={`tel:${customerTel}`}
                          className="min-h-[46px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                          <Phone className="w-4 h-4 text-blue-700" aria-hidden="true" />
                          <span>Call Customer</span>
                        </a>

                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[46px] px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                          <Navigation className="w-4 h-4 text-cyan-700" aria-hidden="true" />
                          <span>Open Maps</span>
                        </a>
                      </div>

                      {order.status !== 'OUT_FOR_DELIVERY' ? (
                        <div className="space-y-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              handleUpdateOrderStatus(order, 'OUT_FOR_DELIVERY')
                            }
                            className="w-full min-h-[50px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                          >
                            <Truck className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>
                              {busy
                                ? 'Updating…'
                                : 'Start Delivery / Out for Delivery'}
                            </span>
                          </button>

                          {order.status === 'ACCEPTED' &&
                            !acknowledgedOrderIds.includes(order.id) && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledgeOrders([order.id])}
                                className="w-full min-h-[44px] rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                              >
                                <BellOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>Acknowledge Order (Silence Alert)</span>
                              </button>
                            )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleUpdateOrderStatus(order, 'DELIVERED')
                          }
                          className="w-full min-h-[50px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                        >
                          <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                          <span>{busy ? 'Completing…' : 'Mark Delivered'}</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Completed Deliveries History */}
        {completedDeliveries.length > 0 && (
          <section aria-label="Completed deliveries">
            <h2 className="font-display text-lg font-bold text-slate-900 mb-3">
              Completed Deliveries ({completedDeliveries.length})
            </h2>
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {completedDeliveries.slice(0, 10).map((order) => (
                <div
                  key={order.id}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {order.customerName} · {order.id}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {order.address} · Delivered{' '}
                      {formatTimestamp(order.deliveredAt || order.updatedAt)}
                    </p>
                  </div>
                  <div className="font-display font-bold text-emerald-700 tabular-nums shrink-0">
                    {formatRupees(order.totalAmount)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Live Front-Camera Duty Selfie Modal */}
      {selfieModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="selfie-modal-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2
                  id="selfie-modal-title"
                  className="font-display text-lg font-bold text-slate-900"
                >
                  Live Duty Selfie Proof
                </h2>
                <p className="text-xs text-slate-500">
                  Front camera check-in saved to DailyDrop Owner dashboard
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseSelfieModal}
                aria-label="Close camera modal"
                className="min-w-[44px] min-h-[44px] rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="aspect-square w-full max-w-[320px] mx-auto rounded-2xl bg-slate-900 overflow-hidden relative flex items-center justify-center">
                {capturedPreview ? (
                  <img
                    src={capturedPreview}
                    alt="Captured duty selfie preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      autoPlay
                      className="w-full h-full object-cover -scale-x-100"
                    />
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-200 text-sm font-medium">
                        Opening front camera…
                      </div>
                    )}
                  </>
                )}
              </div>

              {cameraError && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-800"
                >
                  {cameraError}
                </div>
              )}

              {capturedPreview ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => void startFrontCamera()}
                    className="min-h-[48px] rounded-xl border border-slate-300 text-slate-800 font-semibold text-sm cursor-pointer"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    disabled={savingDuty}
                    onClick={handleConfirmDutyOn}
                    className="min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm cursor-pointer disabled:opacity-60"
                  >
                    {savingDuty ? 'Saving…' : 'Confirm Duty ON'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!cameraReady}
                  onClick={handleCaptureSelfie}
                  className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <Camera className="w-5 h-5" aria-hidden="true" />
                  <span>Capture Selfie</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rider Custom Ringtone Modal */}
      {ringtoneModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rider-ringtone-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2
                id="rider-ringtone-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Rider Delivery Alert Sound
              </h2>
              <button
                type="button"
                onClick={() => setRingtoneModalOpen(false)}
                aria-label="Close ringtone settings"
                className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Loops every 2 seconds with vibration whenever a new delivery is
                assigned until you tap Start Delivery or Acknowledge Order. Active
                tone:{' '}
                <strong className="text-slate-900">{ringtoneInfo.name}</strong>
              </p>

              <label className="w-full min-h-[48px] px-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-cyan-700" aria-hidden="true" />
                <span>Upload Custom Ringtone from Phone (Max 3 MB)</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => void handleUploadRiderRingtone(e)}
                  className="sr-only"
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleTestRiderSound}
                  className="min-h-[44px] px-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>Test</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopOrderAlertLoop();
                    setRingtoneFeedback('Sound stopped.');
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Stop</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetRiderRingtone}
                  className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reset</span>
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
          </div>
        </div>
      )}
    </div>
  );
}
