import { Check } from 'lucide-react';

interface CopyToastProps {
  message: string | null;
}

export function CopyToast({ message }: CopyToastProps) {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="copy-number-toast"
      className="fixed top-18 left-1/2 -translate-x-1/2 z-[80] pointer-events-none px-4 w-full max-w-xs flex justify-center"
    >
      <div className="bg-emerald-700 text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg border border-emerald-500 flex items-center gap-2 whitespace-nowrap">
        <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  );
}
