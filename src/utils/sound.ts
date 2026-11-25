export const MAX_RINGTONE_BYTES = 3 * 1024 * 1024; // 3 MB

export type RingtoneRole = 'owner' | 'rider';

export const OWNER_VIBRATION_PATTERN = [600, 250, 600, 250, 800];
export const RIDER_VIBRATION_PATTERN = [500, 200, 500, 200, 700];
export const CUSTOMER_VIBRATION_PATTERN = [300, 150, 300];

const STORAGE_KEYS: Record<RingtoneRole, { data: string; name: string; fallbackLabel: string }> = {
  owner: {
    data: 'dailydrop_custom_ringtone_data',
    name: 'dailydrop_custom_ringtone_name',
    fallbackLabel: 'Built-In Dual-Tone Siren',
  },
  rider: {
    data: 'dailydrop_rider_ringtone_data',
    name: 'dailydrop_rider_ringtone_name',
    fallbackLabel: 'Built-In Delivery Siren',
  },
};

let sharedAudioCtx: AudioContext | null = null;
let activeAudioEl: HTMLAudioElement | null = null;
let activeLoopInterval: number | null = null;
let activeVibrationInterval: number | null = null;
let activeLoopMode: 'none' | 'owner' | 'rider' = 'none';
let globalUnlockInstalled = false;

export interface CustomRingtoneInfo {
  hasCustom: boolean;
  name: string;
}

export function isSafeAudioDataUrl(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  return /^data:audio\/[a-z0-9.+-]+;base64,/i.test(value);
}

export function validateAudioFile(file: {
  type: string;
  size: number;
  name?: string;
}): string | null {
  if (file.size <= 0) {
    return 'Selected audio file is empty.';
  }
  if (file.size > MAX_RINGTONE_BYTES) {
    return 'Ringtone file must be 3 MB or smaller.';
  }
  const hasAudioMime = file.type.startsWith('audio/');
  const hasAudioExt =
    typeof file.name === 'string' &&
    /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(file.name);
  if (!hasAudioMime && !hasAudioExt) {
    return 'Please select an audio file (MP3, WAV, M4A, OGG, or AAC).';
  }
  return null;
}

export function triggerVibration(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export function getCustomRingtoneInfo(
  role: RingtoneRole = 'owner'
): CustomRingtoneInfo {
  const keys = STORAGE_KEYS[role];
  try {
    const data = window.localStorage.getItem(keys.data);
    const name = window.localStorage.getItem(keys.name);
    if (data && isSafeAudioDataUrl(data)) {
      return {
        hasCustom: true,
        name: name || 'Custom Phone Ringtone',
      };
    }
  } catch {
    // ignore storage restrictions
  }
  return { hasCustom: false, name: keys.fallbackLabel };
}

export async function saveCustomRingtoneFile(
  file: File,
  role: RingtoneRole = 'owner'
): Promise<CustomRingtoneInfo> {
  const validationError = validateAudioFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && isSafeAudioDataUrl(reader.result)) {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read selected audio file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to load audio from phone.'));
    reader.readAsDataURL(file);
  });

  const keys = STORAGE_KEYS[role];
  try {
    window.localStorage.setItem(keys.data, dataUrl);
    window.localStorage.setItem(keys.name, file.name);
  } catch {
    throw new Error(
      'Browser storage is full for this audio file. Please pick a smaller ringtone (under 2.5 MB).'
    );
  }

  return { hasCustom: true, name: file.name };
}

export function resetCustomRingtone(
  role: RingtoneRole = 'owner'
): CustomRingtoneInfo {
  stopOrderAlertLoop();
  const keys = STORAGE_KEYS[role];
  try {
    window.localStorage.removeItem(keys.data);
    window.localStorage.removeItem(keys.name);
  } catch {
    // ignore
  }
  return { hasCustom: false, name: keys.fallbackLabel };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {
      // Autoplay policies may block until first user gesture.
    });
  }
  return sharedAudioCtx;
}

/**
 * Unlocks Web Audio API on mobile Chrome & Android WebViews using a silent buffer pulse.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore
  }
}

/**
 * Automatically unlocks Web Audio on the user's very first tap, click, or keypress.
 */
export function installGlobalAudioUnlock(): () => void {
  if (typeof window === 'undefined' || globalUnlockInstalled) {
    return () => {};
  }
  globalUnlockInstalled = true;

  const events: Array<keyof WindowEventMap> = [
    'pointerdown',
    'touchstart',
    'click',
    'keydown',
  ];

  const handleFirstGesture = () => {
    unlockAudioContext();
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
      cleanup();
    }
  };

  const cleanup = () => {
    for (const evt of events) {
      window.removeEventListener(evt, handleFirstGesture, true);
    }
    globalUnlockInstalled = false;
  };

  for (const evt of events) {
    window.addEventListener(evt, handleFirstGesture, {
      capture: true,
      passive: true,
    });
  }

  return cleanup;
}

/**
 * Owner Controller: High-volume dual-tone siren via Web Audio API.
 */
export function playOwnerDualToneSiren(withVibration: boolean = true): boolean {
  if (withVibration) {
    triggerVibration(OWNER_VIBRATION_PATTERN);
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3400, now);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    // 3 urgent dual-tone pulses spanning ~1.65 seconds (fits cleanly inside 2s loop)
    const pulses = [
      { start: 0.0, duration: 0.24, f1: 880, f2: 1174.66 },
      { start: 0.27, duration: 0.26, f1: 1108.73, f2: 1479.98 },
      { start: 0.62, duration: 0.24, f1: 880, f2: 1174.66 },
      { start: 0.89, duration: 0.26, f1: 1108.73, f2: 1479.98 },
      { start: 1.24, duration: 0.34, f1: 1318.51, f2: 1760.0 },
    ];

    for (const pulse of pulses) {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const env = ctx.createGain();

      oscA.type = 'sawtooth';
      oscB.type = 'square';
      oscA.frequency.setValueAtTime(pulse.f1, now + pulse.start);
      oscB.frequency.setValueAtTime(pulse.f2, now + pulse.start);

      env.gain.setValueAtTime(0.0001, now + pulse.start);
      env.gain.exponentialRampToValueAtTime(0.42, now + pulse.start + 0.015);
      env.gain.setValueAtTime(0.38, now + pulse.start + pulse.duration - 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, now + pulse.start + pulse.duration);

      oscA.connect(env);
      oscB.connect(env);
      env.connect(filter);

      oscA.start(now + pulse.start);
      oscB.start(now + pulse.start);
      oscA.stop(now + pulse.start + pulse.duration + 0.02);
      oscB.stop(now + pulse.start + pulse.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Rider App: Loud Zomato-style delivery assignment alert siren + vibration.
 */
export function playRiderDeliverySiren(withVibration: boolean = true): boolean {
  if (withVibration) {
    triggerVibration(RIDER_VIBRATION_PATTERN);
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.88, now);
    masterGain.connect(ctx.destination);

    // Rapid bright Zomato-style ascending bell-siren repeated twice in ~1.7s
    const notes = [
      { freq: 987.77, start: 0.0, duration: 0.14 },
      { freq: 1318.51, start: 0.14, duration: 0.14 },
      { freq: 1567.98, start: 0.28, duration: 0.16 },
      { freq: 1975.53, start: 0.44, duration: 0.26 },
      { freq: 987.77, start: 0.85, duration: 0.14 },
      { freq: 1318.51, start: 0.99, duration: 0.14 },
      { freq: 1567.98, start: 1.13, duration: 0.16 },
      { freq: 1975.53, start: 1.29, duration: 0.34 },
    ];

    for (const note of notes) {
      const oscMain = ctx.createOscillator();
      const oscHarm = ctx.createOscillator();
      const env = ctx.createGain();

      oscMain.type = 'triangle';
      oscHarm.type = 'sine';
      oscMain.frequency.setValueAtTime(note.freq, now + note.start);
      oscHarm.frequency.setValueAtTime(note.freq * 1.5, now + note.start);

      env.gain.setValueAtTime(0.0001, now + note.start);
      env.gain.exponentialRampToValueAtTime(0.55, now + note.start + 0.015);
      env.gain.exponentialRampToValueAtTime(
        0.0008,
        now + note.start + note.duration
      );

      oscMain.connect(env);
      oscHarm.connect(env);
      env.connect(masterGain);

      oscMain.start(now + note.start);
      oscHarm.start(now + note.start);
      oscMain.stop(now + note.start + note.duration + 0.02);
      oscHarm.stop(now + note.start + note.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Customer App: Loud, clear 3-note status change chime + vibration [300, 150, 300].
 */
export function playCustomerStatusChime(): boolean {
  triggerVibration(CUSTOMER_VIBRATION_PATTERN);

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 1046.5, start: 0.0, duration: 0.22 }, // C6
      { freq: 1318.51, start: 0.22, duration: 0.22 }, // E6
      { freq: 1567.98, start: 0.44, duration: 0.48 }, // G6
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      harmonic.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      harmonic.frequency.setValueAtTime(note.freq * 2, now + note.start);

      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.55, now + note.start + 0.018);
      gain.gain.exponentialRampToValueAtTime(
        0.0008,
        now + note.start + note.duration
      );

      osc.connect(gain);
      harmonic.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.start);
      harmonic.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.03);
      harmonic.stop(now + note.start + note.duration + 0.03);
    }

    return true;
  } catch {
    return false;
  }
}

// Backward-compatible alias
export function playNewOrderChime(): boolean {
  return playOwnerDualToneSiren(true);
}

/**
 * Stops any playing custom ringtone, Web Audio loop, or active device vibration.
 */
export function stopOrderAlertLoop(): void {
  activeLoopMode = 'none';
  if (activeLoopInterval !== null) {
    window.clearInterval(activeLoopInterval);
    activeLoopInterval = null;
  }
  if (activeVibrationInterval !== null) {
    window.clearInterval(activeVibrationInterval);
    activeVibrationInterval = null;
  }
  if (activeAudioEl) {
    try {
      activeAudioEl.pause();
      activeAudioEl.currentTime = 0;
    } catch {
      // ignore
    }
    activeAudioEl = null;
  }
  triggerVibration(0);
}

export function isOrderAlertLooping(): boolean {
  return activeLoopMode !== 'none';
}

function startRoleAlarmLoop(role: RingtoneRole): boolean {
  if (activeLoopMode === role) {
    return true;
  }
  stopOrderAlertLoop();
  activeLoopMode = role;

  const keys = STORAGE_KEYS[role];
  const vibrationPattern =
    role === 'owner' ? OWNER_VIBRATION_PATTERN : RIDER_VIBRATION_PATTERN;
  const playBuiltIn =
    role === 'owner' ? playOwnerDualToneSiren : playRiderDeliverySiren;

  try {
    const customData = window.localStorage.getItem(keys.data);
    if (customData && isSafeAudioDataUrl(customData)) {
      const audio = new Audio(customData);
      audio.loop = true;
      audio.volume = 1.0;
      activeAudioEl = audio;

      // Vibrate immediately and every 2 seconds alongside the looping custom ringtone
      triggerVibration(vibrationPattern);
      activeVibrationInterval = window.setInterval(() => {
        if (activeLoopMode === role) {
          triggerVibration(vibrationPattern);
        }
      }, 2000);

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (activeLoopMode === role) {
            playBuiltIn(false);
            activeLoopInterval = window.setInterval(() => {
              if (activeLoopMode === role) playBuiltIn(false);
            }, 2000);
          }
        });
      }
      return true;
    }
  } catch {
    // Fall back to built-in siren loop below
  }

  playBuiltIn(true);
  activeLoopInterval = window.setInterval(() => {
    if (activeLoopMode === role) {
      playBuiltIn(true);
    }
  }, 2000);
  return true;
}

export function startOrderAlertLoop(): boolean {
  return startRoleAlarmLoop('owner');
}

export function startRiderAlarmLoop(): boolean {
  return startRoleAlarmLoop('rider');
}

/**
 * Plays a single test preview of the role's custom ringtone (volume 1.0) or built-in siren + vibration.
 */
export function testRingtone(role: RingtoneRole = 'owner'): boolean {
  stopOrderAlertLoop();
  unlockAudioContext();

  const keys = STORAGE_KEYS[role];
  const vibrationPattern =
    role === 'owner' ? OWNER_VIBRATION_PATTERN : RIDER_VIBRATION_PATTERN;

  try {
    const customData = window.localStorage.getItem(keys.data);
    if (customData && isSafeAudioDataUrl(customData)) {
      const audio = new Audio(customData);
      audio.loop = false;
      audio.volume = 1.0;
      activeAudioEl = audio;
      triggerVibration(vibrationPattern);
      audio.onended = () => {
        if (activeAudioEl === audio) {
          activeAudioEl = null;
        }
      };
      audio.play().catch(() => {
        if (role === 'owner') {
          playOwnerDualToneSiren(false);
        } else {
          playRiderDeliverySiren(false);
        }
      });
      return true;
    }
  } catch {
    // fallback below
  }

  return role === 'owner'
    ? playOwnerDualToneSiren(true)
    : playRiderDeliverySiren(true);
}
