import type { Order } from '../types';

export type AlertRole = 'rider' | 'owner';
export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export const HEAVY_NOTIFICATION_VIBRATE: number[] = [
  1000, 300, 1000, 300, 1000, 300, 1000,
];

export interface HighPriorityNotificationOptions extends NotificationOptions {
  renotify?: boolean;
  vibrate?: number[];
  timestamp?: number;
  actions?: Array<{ action: string; title: string }>;
}

export interface OrderNotificationPayload {
  title: string;
  options: HighPriorityNotificationOptions;
}

export interface NotificationClickMessage {
  orderId: string | null;
  role: AlertRole | null;
}

const SILENT_WAV_SAMPLE_RATE = 8000;
let cachedSilentWavUrl: string | null = null;
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

let keepAliveAudioEl: HTMLAudioElement | null = null;
let keepAliveAudioCtx: AudioContext | null = null;
let keepAliveBufferSource: AudioBufferSourceNode | null = null;
let keepAliveActive = false;
let keepAliveRole: AlertRole | null = null;

function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  return '';
}

/**
 * Generates a valid, tiny mono 8-bit unsigned PCM silent WAV data URL (0x80 = exact zero-amplitude silence).
 * Looped on an <audio> element with Media Session metadata so Android Chrome does not freeze the tab
 * while the rider watches YouTube or locks the screen.
 */
export function createSilentWavDataUrl(durationSec: number = 1): string {
  const safeDuration = Math.max(0.5, Math.min(5, durationSec));
  if (safeDuration === 1 && cachedSilentWavUrl) {
    return cachedSilentWavUrl;
  }

  const numSamples = Math.floor(SILENT_WAV_SAMPLE_RATE * safeDuration);
  const dataSize = numSamples;
  const totalSize = 44 + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');

  // fmt sub-chunk (PCM, 1 channel, 8000 Hz, 8-bit unsigned)
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SILENT_WAV_SAMPLE_RATE, true);
  view.setUint32(28, SILENT_WAV_SAMPLE_RATE, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample

  // data sub-chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  bytes.fill(0x80, 44);

  const dataUrl = `data:audio/wav;base64,${encodeBytesToBase64(bytes)}`;
  if (safeDuration === 1) {
    cachedSilentWavUrl = dataUrl;
  }
  return dataUrl;
}

export function getMediaSessionTitle(role: AlertRole): string {
  return role === 'rider'
    ? 'DailyDrop Duty ON - Listening for Orders'
    : 'DailyDrop Owner - Listening for Orders';
}

export function buildRiderAssignmentAlertKey(
  order: Pick<Order, 'id' | 'assignedAt' | 'updatedAt' | 'createdAt'>
): string {
  return `${order.id}:${order.assignedAt ?? order.updatedAt ?? order.createdAt ?? 0}`;
}

/**
 * Pure state-transition detector ensuring Rider App is 100% silent on initial load,
 * while Duty OFF, or when toggling Duty ON — and returns orders to ring the loud siren
 * ONLY when a genuinely new order arrives for a Duty-ON rider.
 */
export function detectNewlyArrivedRiderOrders<
  T extends Pick<Order, 'id' | 'assignedAt' | 'updatedAt' | 'createdAt'>,
>(
  awaitingOrders: T[],
  knownKeys: Set<string>,
  options: {
    isDutyOnline: boolean;
    ordersInitialized: boolean;
    justTurnedDutyOn?: boolean;
  }
): { newlyArrived: T[]; nextKnownKeys: Set<string> } {
  const nextKnownKeys = new Set(knownKeys);

  // Never ring on initial load, while Duty OFF, or at the exact moment Duty is toggled ON:
  // simply record any already-present keys so only genuinely new incoming orders ring.
  if (!options.ordersInitialized || !options.isDutyOnline || options.justTurnedDutyOn) {
    for (const order of awaitingOrders) {
      nextKnownKeys.add(buildRiderAssignmentAlertKey(order));
    }
    return { newlyArrived: [], nextKnownKeys };
  }

  const newlyArrived: T[] = [];
  for (const order of awaitingOrders) {
    const key = buildRiderAssignmentAlertKey(order);
    if (!nextKnownKeys.has(key)) {
      nextKnownKeys.add(key);
      newlyArrived.push(order);
    }
  }

  return { newlyArrived, nextKnownKeys };
}

export function buildOrderNotificationPayload(
  order: Pick<
    Order,
    'id' | 'customerName' | 'address' | 'totalAmount' | 'status'
  >,
  role: AlertRole
): OrderNotificationPayload {
  const safeOrderId = String(order.id || 'ORDER').trim();
  const amount = Math.max(0, Math.round(Number(order.totalAmount) || 0));
  const customerName = (order.customerName || 'Customer').trim();
  const addressSnippet = (order.address || '').trim().slice(0, 90);
  const statusLower = String(order.status || '').toLowerCase();

  const isTimedOutReassign =
    role === 'owner' && statusLower === 'unassigned';

  const title =
    role === 'rider'
      ? `New Delivery Assigned — ${safeOrderId}`
      : isTimedOutReassign
        ? `Rider Timed Out — Re-Assign ${safeOrderId}`
        : `New DailyDrop Order — ${safeOrderId}`;

  const body =
    role === 'rider'
      ? `${customerName} · ₹${amount}${addressSnippet ? ` · ${addressSnippet}` : ''} · Tap to Accept within 3 min!`
      : isTimedOutReassign
        ? `${customerName} · ₹${amount} · Previous rider timed out. Tap to re-assign.`
        : `${customerName} · ₹${amount}${addressSnippet ? ` · ${addressSnippet}` : ''} · Tap to open Command Center.`;

  const targetUrl =
    role === 'rider'
      ? `/?app=rider&autostart=1#order-${encodeURIComponent(safeOrderId)}`
      : `/?app=owner&autostart=1#order-${encodeURIComponent(safeOrderId)}`;

  return {
    title,
    options: {
      body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      tag: `new-order-${safeOrderId}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [...HEAVY_NOTIFICATION_VIBRATE],
      timestamp: Date.now(),
      data: {
        orderId: safeOrderId,
        role,
        url: targetUrl,
      },
    },
  };
}

export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function registerDailyDropServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return null;
  }

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => reg)
      .catch(() => {
        swRegistrationPromise = null;
        return null;
      });
  }

  return swRegistrationPromise;
}

export async function requestBackgroundAlertPermission(): Promise<NotificationPermissionState> {
  void registerDailyDropServiceWorker();
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return window.Notification.permission;
  }
}

async function resolveActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  const direct = await registerDailyDropServiceWorker();
  if (direct && typeof direct.showNotification === 'function') {
    return direct;
  }
  try {
    const ready = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
    ]);
    if (ready && typeof ready.showNotification === 'function') {
      return ready;
    }
  } catch {
    // ignore and fall back to window.Notification
  }
  return null;
}

/**
 * Triggers a persistent, high-priority system notification banner via ServiceWorkerRegistration.showNotification()
 * (stays pinned on top of YouTube / other foreground apps via requireInteraction + renotify + heavy vibration).
 */
export async function showHighPriorityOrderNotification(
  order: Pick<
    Order,
    'id' | 'customerName' | 'address' | 'totalAmount' | 'status'
  >,
  role: AlertRole
): Promise<boolean> {
  if (getNotificationPermissionState() !== 'granted') {
    return false;
  }

  const { title, options } = buildOrderNotificationPayload(order, role);

  try {
    const reg = await resolveActiveServiceWorkerRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    // Fall back to Window Notification constructor below
  }

  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const notif = new window.Notification(title, options);
      notif.onclick = () => {
        try {
          window.focus();
          notif.close();
        } catch {
          // ignore
        }
      };
      return true;
    }
  } catch {
    // ignore when Notification constructor is restricted on mobile Android Chrome
  }

  return false;
}

function updateMediaSessionMetadata(role: AlertRole | null): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }
  const ms = navigator.mediaSession;
  if (!role) {
    try {
      ms.playbackState = 'none';
      ms.metadata = null;
    } catch {
      // ignore
    }
    return;
  }

  try {
    if (typeof window !== 'undefined' && 'MediaMetadata' in window) {
      ms.metadata = new window.MediaMetadata({
        title: getMediaSessionTitle(role),
        artist: 'DailyDrop Water',
        album: 'Background Order Alerts',
        artwork: [
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    }
    ms.playbackState = 'playing';

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Not all browsers support every MediaSession action
      }
    };

    safeSetHandler('play', () => {
      if (keepAliveAudioEl) {
        void keepAliveAudioEl.play().catch(() => {});
      }
      if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'suspended') {
        void keepAliveAudioCtx.resume().catch(() => {});
      }
      try {
        ms.playbackState = 'playing';
      } catch {
        // ignore
      }
    });
    safeSetHandler('pause', () => {
      // Keep-alive listener remains ready; do not crash if OS sends pause
      if (keepAliveAudioEl && keepAliveActive) {
        void keepAliveAudioEl.play().catch(() => {});
      }
    });
    safeSetHandler('stop', () => {
      stopDutyBackgroundKeepAlive();
    });
  } catch {
    // ignore mediaSession failures on unsupported WebViews
  }
}

function startSilentWebAudioKeepAlive(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    if (!keepAliveAudioCtx) {
      keepAliveAudioCtx = new AudioCtx();
    }
    if (keepAliveAudioCtx.state === 'suspended') {
      void keepAliveAudioCtx.resume().catch(() => {});
    }
    if (!keepAliveBufferSource) {
      // 100% zero-amplitude muted silent buffer (no oscillator, zero audible sound/clicks/hiss)
      const sampleRate = keepAliveAudioCtx.sampleRate || 8000;
      const silentBuffer = keepAliveAudioCtx.createBuffer(1, sampleRate, sampleRate);
      const source = keepAliveAudioCtx.createBufferSource();
      const gain = keepAliveAudioCtx.createGain();
      source.buffer = silentBuffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, keepAliveAudioCtx.currentTime);
      source.connect(gain);
      gain.connect(keepAliveAudioCtx.destination);
      source.start();
      keepAliveBufferSource = source;
    }
  } catch {
    // ignore AudioContext startup errors
  }
}

/**
 * Starts the 100% silent looping audio track (volume = 0) + muted zero-gain AudioBuffer + Media Session metadata
 * ("DailyDrop Duty ON - Listening for Orders") so Android Chrome keeps the tab awake
 * while the Rider waits for orders or watches YouTube — with ZERO audible sound.
 */
export async function startDutyBackgroundKeepAlive(
  role: AlertRole = 'rider'
): Promise<{ active: boolean; blockedByAutoplay: boolean }> {
  if (typeof window === 'undefined') {
    return { active: false, blockedByAutoplay: false };
  }

  if (keepAliveActive && keepAliveRole === role && keepAliveAudioEl && !keepAliveAudioEl.paused) {
    keepAliveAudioEl.volume = 0;
    updateMediaSessionMetadata(role);
    return { active: true, blockedByAutoplay: false };
  }

  keepAliveRole = role;
  startSilentWebAudioKeepAlive();
  updateMediaSessionMetadata(role);

  try {
    if (!keepAliveAudioEl) {
      const audio = new Audio(createSilentWavDataUrl(1));
      audio.loop = true;
      audio.volume = 0;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('aria-hidden', 'true');
      keepAliveAudioEl = audio;
    } else {
      keepAliveAudioEl.volume = 0;
    }

    const playPromise = keepAliveAudioEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
    keepAliveActive = true;
    updateMediaSessionMetadata(role);
    return { active: true, blockedByAutoplay: false };
  } catch {
    // Autoplay blocked before user gesture — caller can retry on next user tap
    keepAliveActive = false;
    return { active: false, blockedByAutoplay: true };
  }
}

export function stopDutyBackgroundKeepAlive(): void {
  keepAliveActive = false;
  keepAliveRole = null;

  if (keepAliveAudioEl) {
    try {
      keepAliveAudioEl.pause();
      keepAliveAudioEl.currentTime = 0;
    } catch {
      // ignore
    }
    keepAliveAudioEl = null;
  }

  if (keepAliveBufferSource) {
    try {
      keepAliveBufferSource.stop();
      keepAliveBufferSource.disconnect();
    } catch {
      // ignore
    }
    keepAliveBufferSource = null;
  }

  if (keepAliveAudioCtx) {
    try {
      void keepAliveAudioCtx.close().catch(() => {});
    } catch {
      // ignore
    }
    keepAliveAudioCtx = null;
  }

  updateMediaSessionMetadata(null);
}

export function isBackgroundKeepAliveActive(): boolean {
  return keepAliveActive;
}

export function getKeepAliveAudioVolume(): number | null {
  return keepAliveAudioEl ? keepAliveAudioEl.volume : null;
}

export function subscribeNotificationClickMessages(
  onClick: (payload: NotificationClickMessage) => void
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'DAILYDROP_NOTIFICATION_CLICK') {
      onClick({
        orderId: typeof data.orderId === 'string' ? data.orderId : null,
        role:
          data.role === 'rider' || data.role === 'owner' ? data.role : null,
      });
    }
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => {
    navigator.serviceWorker.removeEventListener('message', listener);
  };
}
