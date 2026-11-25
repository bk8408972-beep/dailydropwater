import { useState } from 'react';
import { Droplets } from 'lucide-react';

export const DAILYDROP_LOGO_URL =
  '/assets/aistudio/1795645289411_0676e95a.png';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'w-9 h-9',
  md: 'w-11 h-11',
  lg: 'w-14 h-14',
  xl: 'w-32 h-32 sm:w-36 sm:h-36',
};

export function BrandLogo({ size = 'sm', className = '' }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`${SIZE_CLASSES[size]} rounded-full bg-cyan-400 text-blue-950 flex items-center justify-center shrink-0 ring-2 ring-cyan-300/60 ${className}`}
        aria-label="DailyDrop logo"
      >
        <Droplets className="w-1/2 h-1/2" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full overflow-hidden shrink-0 bg-blue-950 ring-2 ring-cyan-300/70 shadow-sm ${className}`}
    >
      <img
        src={DAILYDROP_LOGO_URL}
        alt="DailyDrop Water & Cold Drinks"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full rounded-full object-cover scale-[1.06]"
      />
    </div>
  );
}
