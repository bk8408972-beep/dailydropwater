import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface SplashScreenProps {
  durationMs?: number;
  onComplete: () => void;
}

export function SplashScreen({
  durationMs = 2000,
  onComplete,
}: SplashScreenProps) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(Math.max(8, pct));
      if (elapsed < durationMs) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    const doneTimer = window.setTimeout(() => {
      setProgress(100);
      onComplete();
    }, durationMs);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(doneTimer);
    };
  }, [durationMs, onComplete]);

  return (
    <div
      data-testid="dailydrop-splash"
      className="fixed inset-0 z-50 bg-gradient-to-b from-blue-900 via-blue-800 to-cyan-700 text-white flex flex-col items-center justify-between px-6 py-12 overflow-hidden"
    >
      {/* Subtle radial water glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(34,211,238,0.28),transparent_60%)]"
      />

      <div className="h-4" aria-hidden="true" />

      {/* Center Emblem & Brand Copy */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        <div className="mb-6 p-1.5 rounded-full bg-white/10 shadow-2xl shadow-blue-950/50">
          <BrandLogo size="xl" className="ring-4 ring-cyan-300/80" />
        </div>

        <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
          Daily<span className="text-cyan-300">Drop</span> Water
        </h1>

        <p className="mt-2.5 text-sm sm:text-base font-semibold text-cyan-100 leading-snug text-balance">
          Pure Water Cans &amp; Cold Drinks Delivery
        </p>

        <div className="mt-4 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-blue-100">
          <MapPin className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <span>15–25 Min Fast Delivery · 3 km Radius</span>
        </div>
      </div>

      {/* Smooth 2-Second Loading Bar */}
      <div className="relative z-10 w-full max-w-xs space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-cyan-100 tabular-nums">
          <span>Loading DailyDrop Water…</span>
          <span>{progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Loading DailyDrop Water"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-2.5 w-full rounded-full bg-blue-950/60 overflow-hidden p-0.5"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-400 to-white transition-[width] duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center text-xs text-blue-200/90 font-medium pt-1">
          Aapka Paani, Har Zarurat Ke Liye
        </p>
      </div>
    </div>
  );
}
