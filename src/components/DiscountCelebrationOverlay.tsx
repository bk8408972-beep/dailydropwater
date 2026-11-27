import React, { useEffect, useRef, useState } from 'react';
import { formatSavingsCelebrationHeadline } from '../utils/discounts';
import {
  DEFAULT_CONGRATS_POPUP_SECONDS,
  sanitizeCongratsPopupSeconds,
} from '../utils/customerFeatures';
import { playDiscountCelebrationClap } from '../utils/sound';

interface DiscountCelebrationOverlayProps {
  totalSavings: number | null;
  durationSeconds?: number;
  onComplete: () => void;
}

interface ConfettiPiece {
  id: number;
  leftPercent: number;
  widthPx: number;
  heightPx: number;
  color: string;
  delayMs: number;
  durationMs: number;
  driftPx: number;
  isCircle: boolean;
}

const CONFETTI_COLORS = [
  '#facc15', // vivid gold
  '#34d399', // emerald
  '#38bdf8', // sky
  '#fb7185', // rose
  '#a78bfa', // violet
  '#fb923c', // orange
  '#ffffff', // crisp white
];

// Precomputed deterministic 48-piece confetti shower across full viewport width
const CONFETTI_PIECES: ConfettiPiece[] = Array.from({ length: 48 }, (_, idx) => {
  const leftPercent = ((idx * 19 + 7) % 98) + 1;
  const widthPx = idx % 3 === 0 ? 12 : idx % 3 === 1 ? 9 : 14;
  const heightPx = idx % 3 === 0 ? 12 : idx % 2 === 0 ? 20 : 14;
  const delayMs = (idx % 12) * 95;
  const durationMs = 1550 + (idx % 7) * 140;
  const driftPx = ((idx % 9) - 4) * 24;
  return {
    id: idx,
    leftPercent,
    widthPx,
    heightPx,
    color: CONFETTI_COLORS[idx % CONFETTI_COLORS.length],
    delayMs,
    durationMs,
    driftPx,
    isCircle: idx % 4 === 0,
  };
});

export function DiscountCelebrationOverlay({
  totalSavings,
  durationSeconds = DEFAULT_CONGRATS_POPUP_SECONDS,
  onComplete,
}: DiscountCelebrationOverlayProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finishedRef = useRef(false);

  const activeSavings =
    typeof totalSavings === 'number' && Number.isFinite(totalSavings) && totalSavings > 0
      ? Math.round(totalSavings)
      : 0;

  const cleanSeconds = sanitizeCongratsPopupSeconds(
    durationSeconds,
    DEFAULT_CONGRATS_POPUP_SECONDS
  );

  const [secondsLeft, setSecondsLeft] = useState(cleanSeconds);

  const handleCloseNow = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCompleteRef.current();
  };

  useEffect(() => {
    if (activeSavings <= 0) {
      finishedRef.current = false;
      return;
    }

    finishedRef.current = false;
    setSecondsLeft(cleanSeconds);
    playDiscountCelebrationClap();

    const deadlineMs = Date.now() + cleanSeconds * 1000;
    const countdownTimer = window.setInterval(() => {
      const remaining = Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 250);

    const autoCloseTimer = window.setTimeout(() => {
      handleCloseNow();
    }, cleanSeconds * 1000);

    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(autoCloseTimer);
    };
  }, [activeSavings, cleanSeconds]);

  if (activeSavings <= 0) {
    return null;
  }

  const headline = formatSavingsCelebrationHeadline(activeSavings);

  return (
    <div
      data-testid="discount-celebration-overlay"
      data-duration-seconds={cleanSeconds}
      role="status"
      aria-live="assertive"
      aria-label={headline}
      className="fixed inset-0 z-[100] w-screen h-[100dvh] overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-600 to-blue-700 flex items-center justify-center p-6 select-none"
    >
      {/* Full-viewport Confetti Shower */}
      <div
        aria-hidden="true"
        data-testid="discount-celebration-confetti"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {CONFETTI_PIECES.map((piece) => (
          <span
            key={piece.id}
            className="dd-confetti-piece absolute top-0 block shadow-sm"
            style={
              {
                left: `${piece.leftPercent}%`,
                width: `${piece.widthPx}px`,
                height: `${piece.heightPx}px`,
                backgroundColor: piece.color,
                borderRadius: piece.isCircle ? '9999px' : '3px',
                '--confetti-delay': `${piece.delayMs}ms`,
                '--confetti-duration': `${piece.durationMs}ms`,
                '--confetti-drift': `${piece.driftPx}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Central Celebration Message */}
      <div className="dd-celebrate-card relative z-10 w-full max-w-lg text-center px-6 py-8 rounded-3xl bg-white/15 backdrop-blur-md border border-white/30 shadow-2xl">
        <div
          data-testid="discount-celebration-emojis"
          aria-hidden="true"
          className="text-6xl sm:text-7xl leading-none mb-5 tracking-wider drop-shadow-md animate-bounce"
        >
          👏🎉
        </div>

        <h2
          data-testid="discount-celebration-text"
          className="font-display text-3xl sm:text-4xl md:text-5xl font-black text-white leading-tight tracking-tight drop-shadow-sm"
        >
          {headline} 👏🎉
        </h2>

        <p
          data-testid="discount-celebration-countdown"
          className="mt-4 text-sm sm:text-base font-bold text-emerald-100 tabular-nums"
        >
          Opening My Orders in {secondsLeft}s…
        </p>

        <button
          type="button"
          data-testid="discount-celebration-ok-btn"
          onClick={handleCloseNow}
          className="mt-6 min-h-[46px] min-w-[140px] px-7 rounded-2xl bg-white hover:bg-emerald-50 active:scale-[0.98] text-emerald-800 font-display font-extrabold text-base shadow-lg cursor-pointer transition-all"
        >
          OK
        </button>
      </div>
    </div>
  );
}
