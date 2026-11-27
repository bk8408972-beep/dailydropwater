export const MAX_RINGTONE_BYTES = 3 * 1024 * 1024; // 3 MB

export type RingtoneRole = 'owner' | 'rider';

export const ORDER_ALERT_VIBRATION_PATTERN = [1000, 300, 1000, 300, 1000, 300, 1000];
export const OWNER_VIBRATION_PATTERN = ORDER_ALERT_VIBRATION_PATTERN;
export const RIDER_VIBRATION_PATTERN = ORDER_ALERT_VIBRATION_PATTERN;
export const CUSTOMER_VIBRATION_PATTERN = [300, 150, 300];

const STORAGE_KEYS: Record<RingtoneRole, { data: string; name: string; fallbackLabel: string }> = {
  owner: {
    data: 'dailydrop_custom_ringtone_data',
    name: 'dailydrop_custom_ringtone_name',
    fallbackLabel: 'DailyDrop Dual-Tone Alert Chime',
  },
  rider: {
    data: 'dailydrop_rider_ringtone_data',
    name: 'dailydrop_rider_ringtone_name',
    fallbackLabel: 'DailyDrop Dual-Tone Delivery Chime',
  },
};

let sharedAudioCtx: AudioContext | null = null;
let activeAudioEl: HTMLAudioElement | null = null;
let activeLoopInterval: number | null = null;
let activeVibrationInterval: number | null = null;
let activeLoopMode: 'none' | 'owner' | 'rider' = 'none';
let globalUnlockInstalled = false;
let userHasInteracted = false;

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

function canUseDeviceVibration(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  const userActivation = (
    navigator as Navigator & {
      userActivation?: { hasBeenActive?: boolean; isActive?: boolean };
    }
  ).userActivation;
  if (userActivation && typeof userActivation.hasBeenActive === 'boolean') {
    return userActivation.hasBeenActive || userActivation.isActive === true;
  }
  return userHasInteracted;
}

export function triggerVibration(pattern: number | number[]): boolean {
  if (!canUseDeviceVibration()) {
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
  userHasInteracted = true;
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
    userHasInteracted = true;
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
 * Original DailyDrop High-Alert Dual-Tone Delivery Chime via Web Audio API.
 * Distinct alternating fifth-interval cadence (F#5+C#6 -> B5+F#6 double-pulse)
 * designed to cut through street noise without resembling third-party app tones.
 */
export function playDailyDropDualToneChime(
  role: RingtoneRole = 'owner',
  withVibration: boolean = true
): boolean {
  if (withVibration) {
    triggerVibration(ORDER_ALERT_VIBRATION_PATTERN);
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1.0, now);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, now);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Distinct frequency voicing per role while both share DailyDrop's signature dual-tone cadence
    const pulses =
      role === 'rider'
        ? [
            { start: 0.0, duration: 0.22, f1: 739.99, f2: 1108.73 }, // F#5 + C#6
            { start: 0.26, duration: 0.24, f1: 987.77, f2: 1479.98 }, // B5 + F#6
            { start: 0.72, duration: 0.22, f1: 739.99, f2: 1108.73 },
            { start: 0.98, duration: 0.34, f1: 987.77, f2: 1479.98 },
            { start: 1.42, duration: 0.26, f1: 1174.66, f2: 1760.0 }, // D6 + A6 bright finish
          ]
        : [
            { start: 0.0, duration: 0.24, f1: 659.25, f2: 987.77 }, // E5 + B5
            { start: 0.28, duration: 0.24, f1: 880.0, f2: 1318.51 }, // A5 + E6
            { start: 0.74, duration: 0.24, f1: 659.25, f2: 987.77 },
            { start: 1.02, duration: 0.36, f1: 880.0, f2: 1318.51 },
            { start: 1.46, duration: 0.26, f1: 1046.5, f2: 1567.98 }, // C6 + G6
          ];

    for (const pulse of pulses) {
      const oscPrimary = ctx.createOscillator();
      const oscHarmony = ctx.createOscillator();
      const env = ctx.createGain();

      oscPrimary.type = 'triangle';
      oscHarmony.type = 'sine';
      oscPrimary.frequency.setValueAtTime(pulse.f1, now + pulse.start);
      oscHarmony.frequency.setValueAtTime(pulse.f2, now + pulse.start);

      env.gain.setValueAtTime(0.0001, now + pulse.start);
      env.gain.exponentialRampToValueAtTime(0.68, now + pulse.start + 0.015);
      env.gain.setValueAtTime(0.58, now + pulse.start + pulse.duration - 0.04);
      env.gain.exponentialRampToValueAtTime(0.0008, now + pulse.start + pulse.duration);

      oscPrimary.connect(env);
      oscHarmony.connect(env);
      env.connect(filter);

      oscPrimary.start(now + pulse.start);
      oscHarmony.start(now + pulse.start);
      oscPrimary.stop(now + pulse.start + pulse.duration + 0.02);
      oscHarmony.stop(now + pulse.start + pulse.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Plays a crisp 1-second dual-tone test chime + short haptic tap to unlock mobile WebView audio.
 */
export function playShortTestChime(role: RingtoneRole = 'owner'): boolean {
  unlockAudioContext();
  triggerVibration([200, 120, 200]);

  const ctx = getAudioContext();
  if (!ctx) return false;

  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    const tones =
      role === 'rider'
        ? [
            { start: 0.0, duration: 0.26, f1: 739.99, f2: 1108.73 },
            { start: 0.3, duration: 0.3, f1: 987.77, f2: 1479.98 },
            { start: 0.64, duration: 0.32, f1: 1174.66, f2: 1760.0 },
          ]
        : [
            { start: 0.0, duration: 0.26, f1: 659.25, f2: 987.77 },
            { start: 0.3, duration: 0.3, f1: 880.0, f2: 1318.51 },
            { start: 0.64, duration: 0.32, f1: 1046.5, f2: 1567.98 },
          ];

    for (const tone of tones) {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const env = ctx.createGain();

      oscA.type = 'triangle';
      oscB.type = 'sine';
      oscA.frequency.setValueAtTime(tone.f1, now + tone.start);
      oscB.frequency.setValueAtTime(tone.f2, now + tone.start);

      env.gain.setValueAtTime(0.0001, now + tone.start);
      env.gain.exponentialRampToValueAtTime(0.5, now + tone.start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0008, now + tone.start + tone.duration);

      oscA.connect(env);
      oscB.connect(env);
      env.connect(masterGain);

      oscA.start(now + tone.start);
      oscB.start(now + tone.start);
      oscA.stop(now + tone.start + tone.duration + 0.02);
      oscB.stop(now + tone.start + tone.duration + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Owner Controller: High-volume dual-tone chime via Web Audio API.
 */
export function playOwnerDualToneSiren(withVibration: boolean = true): boolean {
  return playDailyDropDualToneChime('owner', withVibration);
}

/**
 * Rider App: Original DailyDrop high-alert delivery chime + Android vibration.
 */
export function playRiderDeliverySiren(withVibration: boolean = true): boolean {
  return playDailyDropDualToneChime('rider', withVibration);
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
 * Immediately resumes Web Audio and triggers a loud gain=1.0 siren pulse (and ensures loop is active)
 * when a high-priority order notification fires or the window regains focus.
 */
export function ensureOrderAlertAudioPlaying(role: RingtoneRole): boolean {
  unlockAudioContext();
  if (activeLoopMode === role) {
    if (activeAudioEl && activeAudioEl.paused) {
      void activeAudioEl.play().catch(() => {
        playDailyDropDualToneChime(role, true);
      });
    } else if (!activeAudioEl) {
      playDailyDropDualToneChime(role, true);
    }
    return true;
  }
  return startRoleAlarmLoop(role);
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

/**
 * Plays a lively 1-second clapping + festive chime burst when a customer places an order with discount savings.
 */
export function playDiscountCelebrationClap(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Generate short white-noise buffer for crisp hand-clap bursts
    const sampleRate = ctx.sampleRate || 44100;
    const clapDuration = 0.085;
    const bufferLen = Math.floor(sampleRate * clapDuration);
    const noiseBuffer = ctx.createBuffer(1, bufferLen, sampleRate);
    const channelData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferLen; i++) {
      const decay = Math.pow(1 - i / bufferLen, 2.2);
      channelData[i] = (Math.random() * 2 - 1) * decay;
    }

    // Staggered realistic applause rhythm across ~850ms
    const clapOffsets = [0.0, 0.07, 0.13, 0.21, 0.28, 0.36, 0.44, 0.52, 0.61, 0.71, 0.8];
    for (const offset of clapOffsets) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1150 + (offset * 500) % 450, now + offset);
      filter.Q.setValueAtTime(1.4, now + offset);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.55, now + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + clapDuration);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(now + offset);
      src.stop(now + offset + clapDuration + 0.01);
    }

    // Bright celebratory ascending chime chord (C5 -> E5 -> G5 -> C6)
    const chimeNotes = [
      { freq: 523.25, t: 0.02, dur: 0.22 },
      { freq: 659.25, t: 0.12, dur: 0.24 },
      { freq: 783.99, t: 0.22, dur: 0.26 },
      { freq: 1046.5, t: 0.34, dur: 0.45 },
    ];
    for (const note of chimeNotes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.freq, now + note.t);
      gain.gain.setValueAtTime(0.001, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.28, now + note.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.t);
      osc.stop(now + note.t + note.dur + 0.02);
    }

    triggerVibration([120, 60, 120]);
    return true;
  } catch {
    return false;
  }
}

