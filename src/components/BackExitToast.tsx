interface BackExitToastProps {
  visible: boolean;
}

export function BackExitToast({ visible }: BackExitToastProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="back-exit-toast"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[70] pointer-events-none px-4 w-full max-w-xs flex justify-center"
    >
      <div className="bg-slate-900/95 text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg border border-slate-700 whitespace-nowrap">
        Press Back again to exit
      </div>
    </div>
  );
}
