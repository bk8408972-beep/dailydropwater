import { ArrowRight, Bike, MapPin, ShieldCheck, ShoppingBag } from 'lucide-react';
import type { AppRole } from '../types';
import { BrandLogo } from './BrandLogo';

interface LauncherScreenProps {
  onSelectRole: (role: Exclude<AppRole, 'launcher' | 'privacy'>) => void;
  onOpenPrivacy: () => void;
}

export function LauncherScreen({
  onSelectRole,
  onOpenPrivacy,
}: LauncherScreenProps) {
  const cards: Array<{
    role: Exclude<AppRole, 'launcher' | 'privacy'>;
    title: string;
    subtitle: string;
    description: string;
    cta: string;
    urlHint: string;
    icon: typeof ShoppingBag;
    accentClass: string;
  }> = [
    {
      role: 'customer',
      title: 'DailyDrop Water',
      subtitle: 'Pure Water & Cold Drinks Delivery',
      description:
        'Order 20L water cans, 1L bottle boxes, and chilled 2L cold drinks near you with live GPS order tracking.',
      cta: 'Order Water & Drinks',
      urlHint: '?app=customer',
      icon: ShoppingBag,
      accentClass: 'bg-blue-700 text-white',
    },
    {
      role: 'rider',
      title: 'Open Rider App',
      subtitle: 'ID Login & Live Duty Selfie',
      description:
        'Sign in with your Rider ID, verify duty ON with a live front-camera selfie, call customers, and complete drops.',
      cta: 'Rider Duty Portal',
      urlHint: '?app=rider',
      icon: Bike,
      accentClass: 'bg-cyan-600 text-white',
    },
    {
      role: 'owner',
      title: 'Open Owner Controller',
      subtitle: 'Live Orders, Riders & Stock',
      description:
        'Monitor incoming orders with loud chime alerts, assign online riders, inspect duty selfies, and manage pricing.',
      cta: 'Owner Command Center',
      urlHint: '?app=owner',
      icon: ShieldCheck,
      accentClass: 'bg-slate-900 text-white',
    },
  ];

  return (
    <div className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-safe">
      <header className="bg-blue-800 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3.5 mb-4">
            <BrandLogo size="lg" />
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                DailyDrop Water
              </h1>
              <p className="text-cyan-100 text-sm sm:text-base font-medium flex items-center gap-1.5 mt-0.5">
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                Water &amp; Cold Drinks Delivery · Live GPS Coverage
              </p>
            </div>
          </div>

          <p className="max-w-2xl text-blue-100 text-base sm:text-lg leading-relaxed">
            Pure drinking water cans, packaged bottle cases, and chilled cold drinks
            delivered to your doorstep in 15–20 minutes — plus bulk supply for every
            function and event.
          </p>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            Choose Your DailyDrop Workspace
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Each workspace also opens directly via its dedicated link with zero role
            switcher clutter.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.role}
                type="button"
                onClick={() => onSelectRole(card.role)}
                className="group text-left bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md active:scale-[0.99] transition-all p-6 flex flex-col justify-between min-h-[248px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <div
                      className={`w-13 h-13 rounded-xl flex items-center justify-center ${card.accentClass}`}
                    >
                      <Icon className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      {card.urlHint}
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-cyan-700 mb-1">
                    {card.subtitle}
                  </p>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">
                    {card.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {card.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-blue-700 font-semibold text-sm">
                  <span>{card.cta}</span>
                  <ArrowRight
                    className="w-4 h-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>DailyDrop Water · Water &amp; Cold Drinks Delivery</span>
          <div className="flex items-center gap-4">
            <a
              href="/?app=privacy"
              onClick={(e) => {
                e.preventDefault();
                onOpenPrivacy();
              }}
              className="font-semibold text-blue-700 hover:underline"
            >
              Privacy Policy
            </a>
            <span>3 km Delivery Radius</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
