import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Bell,
  BellOff,
  Camera,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Music,
  Navigation,
  PackageCheck,
  Phone,
  Play,
  Power,
  RotateCcw,
  Square,
  Truck,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { CanonicalOrderStatus, Order, RiderRecord } from '../types';
import {
  authenticateRider,
  dbPatch,
  sanitizeFirebaseKey,
  subscribePath,
} from '../services/firebaseDb';
import {
  buildGoogleMapsUrl,
  COD_DISPLAY_LABEL,
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isActiveOrderStatus,
  isSafeImageDataUrl,
  normalizeOrderStatus,
  resolveOrderCustomerCoords,
} from '../utils/domain';
import {
  getRiderAcceptanceCountdown,
  isAwaitingRiderAcceptance,
  shouldAutoUnassignOrder,
} from '../utils/orderTimer';
import { formatRelativeTime } from '../utils/geo';
import {
  buildMapsDirectionsUrl,
  openExternalMapUrl,
  triggerPhoneCall,
  WATER_PLANT_LOCATION,
} from '../utils/androidIntents';
import { compressDeliveryPhotoFile } from '../utils/imageCompress';
import {
  getCustomRingtoneInfo,
  installGlobalAudioUnlock,
  playShortTestChime,
  resetCustomRingtone,
  saveCustomRingtoneFile,
  startRiderAlarmLoop,
  stopOrderAlertLoop,
  testRingtone,
  unlockAudioContext,
  type CustomRingtoneInfo,
} from '../utils/sound';
import { BrandLogo } from './BrandLogo';
import { BackExitToast } from './BackExitToast';
import { useAndroidBackGuard } from '../hooks/useAndroidBackGuard';

const RIDER_WORKFLOW_STEPS = [
  { key: 'pending', short: '1. Accept' },
  { key: 'accepted', short: '2. Plant' },
  { key: 'reached_pickup', short: '3. Pickup' },
  { key: 'out_for_delivery', short: '4. Photo' },
  { key: 'delivered', short: '5. Cash' },
] as const;

export function RiderApp() {
  const [riderIdInput, setRiderIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [sessionRiderId, setSessionRiderId] = useState<string | null>(null);
  const [rider, setRider] = useState<RiderRecord | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [uploadingPhotoOrderId, setUploadingPhotoOrderId] = useState<string | null>(
    null
  );
  const [photoErrorByOrder, setPhotoErrorByOrder] = useState<Record<string, string>>(
    {}
  );
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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [acknowledgedOrderIds, setAcknowledgedOrderIds] = useState<string[]>([]);
  const [isRinging, setIsRinging] = useState(false);
  const [ringtoneInfo, setRingtoneInfo] = useState<CustomRingtoneInfo>(() =>
    getCustomRingtoneInfo('rider')
  );
  const [ringtoneModalOpen, setRingtoneModalOpen] = useState(false);
  const [ringtoneFeedback, setRingtoneFeedback] = useState<string | null>(null);
  const [ringtoneError, setRingtoneError] = useState<string | null>(null);

  // Live 1-second clock for 3-minute rider acceptance countdown & auto-unassign
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const timedOutAssignmentKeysRef = useRef<Set<string>>(new Set());

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

  const activeDeliveries = useMemo(
    () => orders.filter((o) => isActiveOrderStatus(o.status)),
    [orders]
  );

  const outForDeliveryIds = useMemo(
    () =>
      orders
        .filter((o) => normalizeOrderStatus(o.status) === 'out_for_delivery')
        .map((o) => o.id),
    [orders]
  );
  const outForDeliveryIdsRef = useRef<string[]>(outForDeliveryIds);
  outForDeliveryIdsRef.current = outForDeliveryIds;

  const completedDeliveries = useMemo(
    () => orders.filter((o) => normalizeOrderStatus(o.status) === 'delivered'),
    [orders]
  );

  const awaitingAcceptanceOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.assignedRiderId === sessionRiderId &&
          isAwaitingRiderAcceptance(o)
      ),
    [orders, sessionRiderId]
  );

  const unacknowledgedAssignedOrders = useMemo(
    () =>
      awaitingAcceptanceOrders.filter(
        (o) => !acknowledgedOrderIds.includes(o.id)
      ),
    [awaitingAcceptanceOrders, acknowledgedOrderIds]
  );

  // Tick every second while any assigned order is awaiting Step 1 acceptance
  useEffect(() => {
    if (!sessionRiderId || awaitingAcceptanceOrders.length === 0) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [sessionRiderId, awaitingAcceptanceOrders.length]);

  // Auto-unassign any assigned order whose 3-minute acceptance countdown hits 00:00
  useEffect(() => {
    if (!sessionRiderId || awaitingAcceptanceOrders.length === 0) return;
    for (const order of awaitingAcceptanceOrders) {
      if (!shouldAutoUnassignOrder(order, nowMs)) continue;
      const assignmentKey = `${order.id}:${order.assignedAt ?? order.updatedAt ?? order.createdAt}`;
      if (timedOutAssignmentKeysRef.current.has(assignmentKey)) continue;
      timedOutAssignmentKeysRef.current.add(assignmentKey);

      stopOrderAlertLoop();
      setIsRinging(false);
      const now = Date.now();
      void dbPatch(`orders/${sanitizeFirebaseKey(order.id)}`, {
        status: 'unassigned',
        assignedRiderId: null,
        assignedRiderName: null,
        assignedRiderMobile: null,
        assignedAt: null,
        timedOutAt: now,
        lastTimedOutRiderId: sessionRiderId,
        lastTimedOutRiderName: rider?.name ?? sessionRiderId,
        updatedAt: now,
      })
        .then(() => {
          setActionMessage(
            `Order ${order.id} timed out after 3 minutes and was returned to Owner for re-assignment.`
          );
        })
        .catch(() => {
          timedOutAssignmentKeysRef.current.delete(assignmentKey);
        });
    }
  }, [sessionRiderId, awaitingAcceptanceOrders, nowMs, rider?.name]);

  // Continuously watch GPS and push /riders/{riderId}/liveLocation AND /orders/{orderId} (riderLat/riderLng)
  // every 5 seconds while Duty ON or while any order is out_for_delivery
  const isDutyOnline = Boolean(rider?.isOnline);
  const hasOutForDeliveryOrders = outForDeliveryIds.length > 0;
  const shouldTrackGps = Boolean(
    sessionRiderId && (isDutyOnline || hasOutForDeliveryOrders)
  );

  useEffect(() => {
    if (!shouldTrackGps || !sessionRiderId) {
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
      const fixedLat = Number(lat.toFixed(6));
      const fixedLng = Number(lng.toFixed(6));

      try {
        const tasks: Promise<unknown>[] = [];
        if (isDutyOnline) {
          tasks.push(
            dbPatch(`riders/${safeRiderId}`, {
              liveLocation: {
                lat: fixedLat,
                lng: fixedLng,
                updatedAt: now,
              },
            })
          );
        }
        for (const orderId of outForDeliveryIdsRef.current) {
          const safeOrderId = sanitizeFirebaseKey(orderId);
          if (safeOrderId) {
            tasks.push(
              dbPatch(`orders/${safeOrderId}`, {
                riderLat: fixedLat,
                riderLng: fixedLng,
                riderLocationUpdatedAt: now,
                updatedAt: now,
              })
            );
          }
        }
        await Promise.all(tasks);
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
  }, [sessionRiderId, isDutyOnline, shouldTrackGps]);

  // Continuously ring original DailyDrop dual-tone delivery chime + vibration for newly assigned orders
  useEffect(() => {
    if (sessionRiderId && soundEnabled && unacknowledgedAssignedOrders.length > 0) {
      startRiderAlarmLoop();
      setIsRinging(true);
    } else {
      stopOrderAlertLoop();
      setIsRinging(false);
    }
  }, [sessionRiderId, soundEnabled, unacknowledgedAssignedOrders.length]);

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
        ? `Alert muted for order ${orderIds[0]}. Tap Step 1: Accept Order before the 3-minute timer expires.`
        : `Alert muted for ${orderIds.length} assigned orders.`
    );
  };

  const handleAlertSoundOnButton = () => {
    setRingtoneError(null);
    unlockAudioContext();
    setSoundEnabled(true);
    playShortTestChime('rider');
    setActionMessage(
      'Order Alert Sound is ON — audio unlocked for incoming delivery alerts.'
    );
  };

  const handleMuteAlertButton = () => {
    if (unacknowledgedAssignedOrders.length > 0) {
      handleAcknowledgeOrders(unacknowledgedAssignedOrders.map((o) => o.id));
    } else {
      stopOrderAlertLoop();
      setIsRinging(false);
      setSoundEnabled(false);
      setActionMessage('Order alert sound muted. Tap "Order Alert Sound: ON" to re-enable.');
    }
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

  const handleUpdateOrderStep = async (
    order: Order,
    nextStatus: Extract<
      CanonicalOrderStatus,
      'accepted' | 'reached_pickup' | 'out_for_delivery' | 'delivered'
    >
  ) => {
    if (nextStatus === 'delivered' && !isSafeImageDataUrl(order.deliveryPhoto)) {
      setPhotoErrorByOrder((prev) => ({
        ...prev,
        [order.id]: 'Take a doorstep delivery photo first before marking as delivered.',
      }));
      return;
    }

    setUpdatingOrderId(order.id);
    if (nextStatus === 'accepted') {
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
      if (nextStatus === 'accepted') {
        patch.riderAcceptedAt = now;
      } else if (nextStatus === 'reached_pickup') {
        patch.reachedPickupAt = now;
      } else if (nextStatus === 'out_for_delivery') {
        patch.pickedUpAt = now;
        const coords = latestCoordsRef.current ?? rider?.liveLocation ?? null;
        if (coords) {
          patch.riderLat = Number(coords.lat.toFixed(6));
          patch.riderLng = Number(coords.lng.toFixed(6));
          patch.riderLocationUpdatedAt = now;
        }
      } else if (nextStatus === 'delivered') {
        patch.deliveredAt = now;
      }

      await dbPatch(`orders/${sanitizeFirebaseKey(order.id)}`, patch);

      const stepMessages: Record<typeof nextStatus, string> = {
        accepted: `Order ${order.id} accepted! Navigate to the Water Plant for pickup.`,
        reached_pickup: `Marked Reached Pickup Location for ${order.id}. Load items and tap Picked Up.`,
        out_for_delivery: `Order ${order.id} is Out for Delivery! Live GPS tracking started for customer.`,
        delivered: `Order ${order.id} Delivered! Cash collected (${formatRupees(order.totalAmount)}).`,
      };
      setActionMessage(stepMessages[nextStatus]);
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : 'Failed to update order status.'
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleCaptureDeliveryPhoto = async (
    order: Order,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingPhotoOrderId(order.id);
    setPhotoErrorByOrder((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

    try {
      const compressed = await compressDeliveryPhotoFile(file);
      await dbPatch(`orders/${sanitizeFirebaseKey(order.id)}`, {
        deliveryPhoto: compressed.dataUrl,
        updatedAt: Date.now(),
      });
      setActionMessage(
        `Delivery photo saved for ${order.id} (${compressed.sizeKb} KB). You can now collect ${formatRupees(order.totalAmount)} cash and mark as Delivered.`
      );
    } catch (err) {
      setPhotoErrorByOrder((prev) => ({
        ...prev,
        [order.id]:
          err instanceof Error
            ? err.message
            : 'Could not save delivery photo. Please retake.',
      }));
    } finally {
      setUploadingPhotoOrderId(null);
    }
  };

  // Prevent accidental app exit on Android hardware/gesture Back button
  const { exitPromptVisible } = useAndroidBackGuard({
    scope: 'rider',
    hasOpenOverlay: Boolean(selfieModalOpen || ringtoneModalOpen),
    onCloseOverlay: () => {
      if (selfieModalOpen) {
        handleCloseSelfieModal();
      } else if (ringtoneModalOpen) {
        setRingtoneModalOpen(false);
      }
    },
  });

  // RIDER LOGIN SCREEN
  if (!sessionRiderId || !rider) {
    return (
      <div className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-safe">
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
        <BackExitToast visible={exitPromptVisible} />
      </div>
    );
  }

  return (
    <div className="app-scroll-page bg-slate-50 pb-safe-page">
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

      {/* Clear Top Audio Unlock Bar ("Order Alert Sound: ON" + "Mute Alert") */}
      <div className="bg-blue-950 text-white border-b border-blue-900">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleAlertSoundOnButton}
            data-testid="rider-alert-sound-btn"
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

          <button
            type="button"
            onClick={handleMuteAlertButton}
            className="min-h-[38px] px-3 rounded-xl bg-blue-900 hover:bg-blue-800 border border-blue-700 text-cyan-100 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <BellOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Mute Alert</span>
          </button>
        </div>
      </div>

      {/* Loud New Delivery Assignment Alert Banner */}
      {isRinging && unacknowledgedAssignedOrders.length > 0 && (
        <div
          role="alert"
          className="bg-amber-500 text-slate-950 border-b border-amber-600 shadow-sm"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-extrabold">
              <Bell className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>
                New Delivery Assigned! Ringing ({ringtoneInfo.name}) ·{' '}
                {unacknowledgedAssignedOrders.length}{' '}
                {unacknowledgedAssignedOrders.length === 1 ? 'order' : 'orders'} waiting
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                handleAcknowledgeOrders(
                  unacknowledgedAssignedOrders.map((o) => o.id)
                )
              }
              className="min-h-[40px] px-4 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
            >
              <BellOff className="w-4 h-4" aria-hidden="true" />
              <span>Mute Alert</span>
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
                const canonicalStatus = normalizeOrderStatus(order.status);
                const busy = updatingOrderId === order.id;
                const uploadingPhoto = uploadingPhotoOrderId === order.id;
                const hasDeliveryPhoto = isSafeImageDataUrl(order.deliveryPhoto);
                const customerCoords = resolveOrderCustomerCoords(order);
                const plantNavUrl = buildMapsDirectionsUrl(
                  WATER_PLANT_LOCATION.lat,
                  WATER_PLANT_LOCATION.lng
                );
                const customerNavUrl = customerCoords
                  ? buildMapsDirectionsUrl(customerCoords.lat, customerCoords.lng)
                  : buildGoogleMapsUrl(order.address);

                const awaitingAcceptance = isAwaitingRiderAcceptance(order);
                const acceptanceTimer = awaitingAcceptance
                  ? getRiderAcceptanceCountdown(order, nowMs)
                  : null;

                const currentStepIndex =
                  awaitingAcceptance || canonicalStatus === 'pending' || canonicalStatus === 'assigned'
                    ? 0
                    : canonicalStatus === 'accepted'
                      ? 1
                      : canonicalStatus === 'reached_pickup'
                        ? 2
                        : canonicalStatus === 'out_for_delivery'
                          ? hasDeliveryPhoto
                            ? 4
                            : 3
                          : 4;

                return (
                  <article
                    key={order.id}
                    data-testid={`rider-order-${order.id}`}
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
                          <p className="text-xs font-bold text-blue-700 mt-0.5">
                            {getStatusLabel(order.status)}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                            {formatRupees(order.totalAmount)}
                          </div>
                          <span className="text-[11px] font-bold text-emerald-700">
                            COD Cash
                          </span>
                        </div>
                      </div>

                      {/* 5-Stage Progress Indicator */}
                      <div className="grid grid-cols-5 gap-1 py-3 border-b border-slate-100">
                        {RIDER_WORKFLOW_STEPS.map((st, idx) => {
                          const done = idx < currentStepIndex;
                          const active = idx === currentStepIndex;
                          return (
                            <div key={st.key} className="text-center">
                              <div
                                className={`h-1.5 rounded-full mb-1 ${
                                  done
                                    ? 'bg-emerald-600'
                                    : active
                                      ? 'bg-blue-700'
                                      : 'bg-slate-200'
                                }`}
                              />
                              <span
                                className={`text-[10px] font-bold block leading-tight ${
                                  active
                                    ? 'text-blue-700'
                                    : done
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                }`}
                              >
                                {st.short}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* COD Cash Banner */}
                      <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                          <Banknote className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                          <span>{COD_DISPLAY_LABEL}</span>
                        </span>
                        <span className="font-display font-extrabold text-emerald-900 text-sm tabular-nums shrink-0">
                          Collect {formatRupees(order.totalAmount)}
                        </span>
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

                    {/* Step-by-Step Controls */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      {/* Call Customer button (Android Telecom Intent + Copy fallback) */}
                      <button
                        type="button"
                        onClick={() =>
                          triggerPhoneCall(order.customerMobile, setActionMessage)
                        }
                        className="w-full min-h-[46px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Phone className="w-4 h-4 text-blue-700" aria-hidden="true" />
                        <span>Call Customer ({order.customerMobile})</span>
                      </button>

                      {/* STEP 1: Accept Order + 3-Minute Acceptance Countdown */}
                      {awaitingAcceptance && (
                        <div className="space-y-2.5">
                          {acceptanceTimer && (
                            <div
                              data-testid={`rider-timer-${order.id}`}
                              className={`rounded-xl border p-3 ${
                                acceptanceTimer.isUrgent
                                  ? 'bg-red-50 border-red-300 text-red-900'
                                  : 'bg-amber-50 border-amber-300 text-amber-950'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs font-extrabold">
                                <span className="flex items-center gap-1.5">
                                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                                  <span>Accept within 3 minutes</span>
                                </span>
                                <span className="font-mono text-sm tabular-nums">
                                  {acceptanceTimer.formatted}
                                </span>
                              </div>
                              <div className="mt-2 h-2 w-full rounded-full bg-white/80 overflow-hidden border border-black/5">
                                <div
                                  className={`h-full rounded-full transition-all duration-700 ${
                                    acceptanceTimer.isUrgent ? 'bg-red-600' : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${acceptanceTimer.progressPercent}%` }}
                                />
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleUpdateOrderStep(order, 'accepted')
                            }
                            className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                          >
                            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>{busy ? 'Accepting…' : 'Step 1: Accept Order'}</span>
                          </button>

                          {!acknowledgedOrderIds.includes(order.id) && (
                            <button
                              type="button"
                              onClick={() => handleAcknowledgeOrders([order.id])}
                              className="w-full min-h-[42px] rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                            >
                              <BellOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                              <span>Mute Alert</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* STEP 2: Navigate to Plant / Pickup Location -> Reached Pickup Location */}
                      {canonicalStatus === 'accepted' && (
                        <div className="space-y-2.5">
                          <button
                            type="button"
                            onClick={() => openExternalMapUrl(plantNavUrl)}
                            className="w-full min-h-[46px] px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Navigation className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                            <span>Navigate to Plant / Pickup Location</span>
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleUpdateOrderStep(order, 'reached_pickup')
                            }
                            className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                          >
                            <MapPin className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>
                              {busy ? 'Updating…' : 'Step 2: Reached Pickup Location'}
                            </span>
                          </button>
                        </div>
                      )}

                      {/* STEP 3: Order Picked Up / Out for Delivery */}
                      {canonicalStatus === 'reached_pickup' && (
                        <div className="space-y-2.5">
                          <button
                            type="button"
                            onClick={() => openExternalMapUrl(plantNavUrl)}
                            className="w-full min-h-[44px] px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-950 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Navigation className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                            <span>Navigate to Plant / Pickup Location</span>
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleUpdateOrderStep(order, 'out_for_delivery')
                            }
                            className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                          >
                            <Truck className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>
                              {busy
                                ? 'Starting Delivery…'
                                : 'Step 3: Order Picked Up / Out for Delivery'}
                            </span>
                          </button>
                        </div>
                      )}

                      {/* STEP 4 & STEP 5: Navigate to Customer -> Take Delivery Photo -> Mark as Delivered (Cash Collected) */}
                      {canonicalStatus === 'out_for_delivery' && (
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={() => openExternalMapUrl(customerNavUrl)}
                            className="w-full min-h-[46px] px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                          >
                            <Navigation className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                            <span>Navigate to Customer Location</span>
                          </button>

                          <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-900 flex items-center gap-2">
                            <PackageCheck className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                            <span>
                              Live GPS tracking active for customer · Collect{' '}
                              <strong className="tabular-nums">
                                {formatRupees(order.totalAmount)}
                              </strong>{' '}
                              cash at doorstep
                            </span>
                          </div>

                          {/* Step 4: Mandatory Delivery Photo Proof */}
                          <div
                            className={`rounded-xl border p-3 space-y-2.5 ${
                              hasDeliveryPhoto
                                ? 'bg-emerald-50 border-emerald-300'
                                : 'bg-amber-50 border-amber-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-bold flex items-center gap-1.5 ${
                                  hasDeliveryPhoto
                                    ? 'text-emerald-900'
                                    : 'text-amber-950'
                                }`}
                              >
                                <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>
                                  {hasDeliveryPhoto
                                    ? 'Step 4 Complete: Delivery Photo Saved'
                                    : 'Step 4 (Required): Take Delivery Photo'}
                                </span>
                              </span>
                            </div>

                            {hasDeliveryPhoto && (
                              <div className="overflow-hidden rounded-xl border border-emerald-300 bg-white">
                                <img
                                  src={order.deliveryPhoto!}
                                  alt={`Doorstep delivery proof for ${order.id}`}
                                  className="w-full h-40 object-cover"
                                />
                              </div>
                            )}

                            <label
                              className={`w-full min-h-[46px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                                hasDeliveryPhoto
                                  ? 'bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-100'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white'
                              }`}
                            >
                              <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
                              <span>
                                {uploadingPhoto
                                  ? 'Compressing & Saving Photo…'
                                  : hasDeliveryPhoto
                                    ? 'Retake Delivery Photo'
                                    : 'Take Delivery Photo'}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                disabled={uploadingPhoto}
                                onChange={(e) =>
                                  void handleCaptureDeliveryPhoto(order, e)
                                }
                                className="sr-only"
                              />
                            </label>

                            {photoErrorByOrder[order.id] && (
                              <p
                                role="alert"
                                className="text-xs font-semibold text-red-700"
                              >
                                {photoErrorByOrder[order.id]}
                              </p>
                            )}
                          </div>

                          {/* Step 5: Mark as Delivered (Cash Collected) — strictly disabled until deliveryPhoto exists */}
                          <button
                            type="button"
                            disabled={busy || !hasDeliveryPhoto}
                            onClick={() =>
                              void handleUpdateOrderStep(order, 'delivered')
                            }
                            className="w-full min-h-[54px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-all disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span>
                              {busy
                                ? 'Completing Delivery…'
                                : `Mark as Delivered (Cash Collected · ${formatRupees(order.totalAmount)})`}
                            </span>
                          </button>

                          {!hasDeliveryPhoto && (
                            <p className="text-[11px] font-semibold text-amber-800 text-center">
                              Capture the doorstep delivery photo above to unlock Mark as
                              Delivered.
                            </p>
                          )}
                        </div>
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
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
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
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
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

      <BackExitToast visible={exitPromptVisible} />
    </div>
  );
}
