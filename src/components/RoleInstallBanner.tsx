import { useState } from 'react';
import { X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getRolePwaMeta } from '../utils/pwaManifest';

interface RoleInstallBannerProps {
  role: 'owner' | 'rider';
}

export function RoleInstallBanner({ role }: RoleInstallBannerProps) {
  const { isInstallable, isInstalled, isIOS, installing, promptInstall } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  // Hide automatically once running as an installed standalone app or dismissed
  if (isInstalled || dismissed) {
    return null;
  }

  const meta = getRolePwaMeta(role);
  const testId =
    role === 'owner' ? 'install-owner-app-btn' : 'install-rider-app-btn';
  const bannerTestId =
    role === 'owner' ? 'install-owner-banner' : 'install-rider-banner';

  const handleInstallClick = async () => {
    if (isInstallable) {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') {
        setShowManualHint(true);
      }
      return;
    }
    setShowManualHint((prev) => !prev);
  };

  return (
    <div
      data-testid={bannerTestId}
      className={
        role === 'owner'
          ? 'bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 text-white border-b border-blue-800/70'
          : 'bg-gradient-to-r from-blue-950 via-blue-900 to-cyan-900 text-white border-b border-cyan-700/60'
      }
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={meta.icon192}
            alt={`${meta.name} icon`}
            className="w-9 h-9 rounded-xl border border-white/20 shadow-sm shrink-0"
          />
          <div className="min-w-0">
            <p className="font-display text-sm font-extrabold leading-tight truncate">
              {meta.name}
            </p>
            <p className="text-[11px] text-cyan-200 leading-tight truncate">
              {isInstallable
                ? 'Ready for 1-tap home screen install'
                : 'Install as a standalone app on your phone'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={installing}
            data-testid={testId}
            onClick={() => void handleInstallClick()}
            className="min-h-[40px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-60"
          >
            <span>
              {installing ? 'Opening Install…' : meta.installButtonLabel}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={`Dismiss ${meta.name} install banner`}
            className="min-w-[34px] min-h-[34px] rounded-lg hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showManualHint && (
        <div
          role="status"
          data-testid="install-manual-hint"
          className="max-w-7xl mx-auto px-3 sm:px-6 pb-2.5"
        >
          <div className="rounded-xl bg-white/10 border border-white/15 px-3.5 py-2 text-xs text-cyan-50 flex items-center justify-between gap-2">
            <span>
              {isIOS ? (
                <>
                  On iPhone/iPad Safari: tap the <strong>Share</strong> icon,
                  then tap <strong>Add to Home Screen</strong> to install{' '}
                  <strong>{meta.name}</strong>.
                </>
              ) : (
                <>
                  Open this link directly in Android Chrome and tap{' '}
                  <strong>Menu (⋮) → Install app</strong> (or{' '}
                  <strong>Add to Home screen</strong>) to install{' '}
                  <strong>{meta.name}</strong>.
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => setShowManualHint(false)}
              aria-label="Close install instructions"
              className="p-1 text-cyan-200 hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
