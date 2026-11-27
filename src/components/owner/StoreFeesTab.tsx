import { useEffect, useState } from 'react';
import {
  Bike,
  Building2,
  Check,
  CreditCard,
  Headphones,
  IndianRupee,
  LocateFixed,
  Mail,
  MapPin,
  Megaphone,
  Minus,
  PartyPopper,
  Phone,
  Plus,
  Power,
  QrCode,
  Radar,
  Save,
  ShoppingBag,
  Sparkles,
  Store,
  Zap,
} from 'lucide-react';
import type { RiderRecord, StoreSettings } from '../../types';
import { updateStoreSettings } from '../../services/firebaseDb';
import {
  DEFAULT_STORE_COORDS,
  DELIVERY_FEE_PRESETS,
  DELIVERY_RADIUS_PRESETS,
  PLATFORM_FEE_PRESETS,
  sanitizeCoordinate,
  sanitizeDeliveryRadiusKm,
  sanitizeFeeAmount,
} from '../../utils/storeSettings';
import { getAvailablePaymentOptions } from '../../utils/payment';
import {
  isValidUpiIdFormat,
  sanitizeTextInput,
  sanitizeUpiId,
} from '../../utils/security';
import {
  DEFAULT_PROMO_BANNER_BUTTON_TEXT,
  DEFAULT_PROMO_BANNER_INTERVAL_MINUTES,
  MAX_CONGRATS_POPUP_SECONDS,
  MAX_PROMO_BANNER_INTERVAL_MINUTES,
  MIN_CONGRATS_POPUP_SECONDS,
  MIN_ORDER_PRESETS,
  MIN_PROMO_BANNER_INTERVAL_MINUTES,
  PROMO_INTERVAL_PRESETS,
  sanitizeCongratsPopupSeconds,
  sanitizeMinOrderAmount,
  sanitizePromoBannerIntervalMinutes,
  validatePromoBannerDraft,
  validateSupportContactDraft,
} from '../../utils/customerFeatures';

interface StoreFeesTabProps {
  settings: StoreSettings;
  riders: RiderRecord[];
  onNotify: (msg: string) => void;
}

export function StoreFeesTab({
  settings,
  riders,
  onNotify,
}: StoreFeesTabProps) {
  const [platformInput, setPlatformInput] = useState(String(settings.platformFee));
  const [deliveryInput, setDeliveryInput] = useState(String(settings.deliveryFee));
  const [floor2Input, setFloor2Input] = useState(String(settings.floor2Charge));
  const [floor3Input, setFloor3Input] = useState(String(settings.floor3PlusCharge));
  const [radiusInput, setRadiusInput] = useState(String(settings.deliveryRadiusKm));
  const [storeLatInput, setStoreLatInput] = useState(String(settings.storeLat));
  const [storeLngInput, setStoreLngInput] = useState(String(settings.storeLng));
  const [upiIdInput, setUpiIdInput] = useState(settings.upiId);
  const [upiNameInput, setUpiNameInput] = useState(settings.upiName);
  const [minOrderInput, setMinOrderInput] = useState(String(settings.minOrderAmount));
  const [supportMobileInput, setSupportMobileInput] = useState(settings.supportMobile);
  const [supportEmailInput, setSupportEmailInput] = useState(settings.supportEmail);
  const [congratsSecondsInput, setCongratsSecondsInput] = useState(
    String(settings.congratsPopupSeconds)
  );
  const [promoEnabledInput, setPromoEnabledInput] = useState(
    Boolean(settings.promoBannerEnabled)
  );
  const [promoTextInput, setPromoTextInput] = useState(settings.promoBannerText);
  const [promoButtonTextInput, setPromoButtonTextInput] = useState(
    settings.promoBannerButtonText || DEFAULT_PROMO_BANNER_BUTTON_TEXT
  );
  const [promoActionUrlInput, setPromoActionUrlInput] = useState(
    settings.promoBannerActionUrl ||
      (settings.promoBannerPhone ? `tel:+91${settings.promoBannerPhone}` : '')
  );
  const [promoIntervalInput, setPromoIntervalInput] = useState(
    String(
      settings.promoBannerIntervalMinutes ?? DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
    )
  );
  const [capturingStoreGps, setCapturingStoreGps] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    setPlatformInput(String(settings.platformFee));
  }, [settings.platformFee]);

  useEffect(() => {
    setDeliveryInput(String(settings.deliveryFee));
  }, [settings.deliveryFee]);

  useEffect(() => {
    setFloor2Input(String(settings.floor2Charge));
  }, [settings.floor2Charge]);

  useEffect(() => {
    setFloor3Input(String(settings.floor3PlusCharge));
  }, [settings.floor3PlusCharge]);

  useEffect(() => {
    setRadiusInput(String(settings.deliveryRadiusKm));
  }, [settings.deliveryRadiusKm]);

  useEffect(() => {
    setStoreLatInput(String(settings.storeLat));
  }, [settings.storeLat]);

  useEffect(() => {
    setStoreLngInput(String(settings.storeLng));
  }, [settings.storeLng]);

  useEffect(() => {
    setUpiIdInput(settings.upiId);
  }, [settings.upiId]);

  useEffect(() => {
    setUpiNameInput(settings.upiName);
  }, [settings.upiName]);

  useEffect(() => {
    setMinOrderInput(String(settings.minOrderAmount));
  }, [settings.minOrderAmount]);

  useEffect(() => {
    setSupportMobileInput(settings.supportMobile);
  }, [settings.supportMobile]);

  useEffect(() => {
    setSupportEmailInput(settings.supportEmail);
  }, [settings.supportEmail]);

  useEffect(() => {
    setCongratsSecondsInput(String(settings.congratsPopupSeconds));
  }, [settings.congratsPopupSeconds]);

  useEffect(() => {
    setPromoEnabledInput(Boolean(settings.promoBannerEnabled));
  }, [settings.promoBannerEnabled]);

  useEffect(() => {
    setPromoTextInput(settings.promoBannerText);
  }, [settings.promoBannerText]);

  useEffect(() => {
    setPromoButtonTextInput(
      settings.promoBannerButtonText || DEFAULT_PROMO_BANNER_BUTTON_TEXT
    );
  }, [settings.promoBannerButtonText]);

  useEffect(() => {
    setPromoActionUrlInput(
      settings.promoBannerActionUrl ||
        (settings.promoBannerPhone ? `tel:+91${settings.promoBannerPhone}` : '')
    );
  }, [settings.promoBannerActionUrl, settings.promoBannerPhone]);

  useEffect(() => {
    setPromoIntervalInput(
      String(
        settings.promoBannerIntervalMinutes ??
          DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
      )
    );
  }, [settings.promoBannerIntervalMinutes]);

  const paymentAvailability = getAvailablePaymentOptions(settings);

  const handleSavePromoBanner = async () => {
    const validated = validatePromoBannerDraft({
      promoBannerEnabled: promoEnabledInput,
      promoBannerText: promoTextInput,
      promoBannerButtonText: promoButtonTextInput,
      promoBannerActionUrl: promoActionUrlInput,
      promoBannerIntervalMinutes: promoIntervalInput,
    });
    if (!validated.ok) {
      onNotify(validated.error);
      return;
    }
    setPromoEnabledInput(validated.promoBannerEnabled);
    setPromoTextInput(validated.promoBannerText);
    setPromoButtonTextInput(validated.promoBannerButtonText);
    setPromoActionUrlInput(validated.promoBannerActionUrl);
    setPromoIntervalInput(String(validated.promoBannerIntervalMinutes));
    setSavingKey('promoBanner');
    try {
      await updateStoreSettings({
        promoBannerEnabled: validated.promoBannerEnabled,
        promoBannerText: validated.promoBannerText,
        promoBannerButtonText: validated.promoBannerButtonText,
        promoBannerActionUrl: validated.promoBannerActionUrl,
        promoBannerIntervalMinutes: validated.promoBannerIntervalMinutes,
        promoBannerPhone: '',
      });
      onNotify(
        validated.promoBannerEnabled
          ? `Running Rider Ad Banner is ON (repeats every ${validated.promoBannerIntervalMinutes} min).`
          : 'Running Rider Ad Banner saved as OFF (hidden in Customer App).'
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Could not save Running Rider Ad Banner settings.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveSupportContact = async () => {
    const validated = validateSupportContactDraft({
      supportMobile: supportMobileInput,
      supportEmail: supportEmailInput,
    });
    if (!validated.ok) {
      onNotify(validated.error);
      return;
    }
    setSupportMobileInput(validated.supportMobile);
    setSupportEmailInput(validated.supportEmail);
    setSavingKey('supportContact');
    try {
      await updateStoreSettings({
        supportMobile: validated.supportMobile,
        supportEmail: validated.supportEmail,
      });
      onNotify(
        validated.supportEmail
          ? `Support Contact saved (Mobile: ${validated.supportMobile}, Email: ${validated.supportEmail}).`
          : `Support Mobile saved as ${validated.supportMobile}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not save Support Contact settings.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleSavePaymentDetails = async () => {
    const cleanUpiId = sanitizeUpiId(upiIdInput);
    const cleanUpiName = sanitizeTextInput(upiNameInput, 60) || 'DailyDrop Water';
    if (cleanUpiId && !isValidUpiIdFormat(cleanUpiId)) {
      onNotify('Enter a valid UPI ID (for example: dailydrop@ybl or store@okaxis).');
      return;
    }
    setUpiIdInput(cleanUpiId);
    setUpiNameInput(cleanUpiName);
    setSavingKey('paymentDetails');
    try {
      await updateStoreSettings({
        upiId: cleanUpiId,
        upiName: cleanUpiName,
      });
      onNotify(
        cleanUpiId
          ? `Payment details saved (UPI ID: ${cleanUpiId}, Business: ${cleanUpiName}).`
          : `Business Name saved as ${cleanUpiName}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not save payment settings.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleUseCurrentGpsAsStore = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      onNotify('GPS is not available on this device. Enter coordinates manually.');
      return;
    }
    setCapturingStoreGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setStoreLatInput(String(lat));
        setStoreLngInput(String(lng));
        setCapturingStoreGps(false);
        onNotify(
          `Captured current GPS (${lat}, ${lng}). Tap Save Store GPS to apply.`
        );
      },
      (err) => {
        setCapturingStoreGps(false);
        onNotify(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Allow GPS or type Store Lat/Lng manually.'
            : 'Could not read current GPS right now. Please try again.'
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const handleSaveStoreGps = async () => {
    const cleanLat = sanitizeCoordinate(
      storeLatInput,
      -90,
      90,
      DEFAULT_STORE_COORDS.lat
    );
    const cleanLng = sanitizeCoordinate(
      storeLngInput,
      -180,
      180,
      DEFAULT_STORE_COORDS.lng
    );
    setStoreLatInput(String(cleanLat));
    setStoreLngInput(String(cleanLng));
    setSavingKey('storeGps');
    try {
      await updateStoreSettings({ storeLat: cleanLat, storeLng: cleanLng });
      onNotify(`Store Base GPS saved (${cleanLat}, ${cleanLng}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not save Store Base GPS.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const onlineRiders = riders.filter((r) => r.isActive && r.isOnline);

  const saveSetting = async (
    key: keyof StoreSettings,
    value: boolean | number,
    successMsg: string
  ) => {
    setSavingKey(key);
    try {
      await updateStoreSettings({ [key]: value });
      onNotify(successMsg);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not save store setting.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section aria-label="Store Controls and Fees" className="space-y-6">
      {/* Row 1: Manual Store Open/Closed & Auto-Assign Online Rider */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Manual Store Open / Closed Toggle */}
        <div
          data-testid="owner-store-open-card"
          className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
            settings.isOpen
              ? 'bg-emerald-50/70 border-emerald-300'
              : 'bg-red-50/80 border-red-300'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Store
                  className={`w-5 h-5 shrink-0 ${
                    settings.isOpen ? 'text-emerald-700' : 'text-red-700'
                  }`}
                  aria-hidden="true"
                />
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Manual Store Open / Closed
                </h2>
              </div>
              <p
                className={`text-sm font-bold mt-1 ${
                  settings.isOpen ? 'text-emerald-800' : 'text-red-800'
                }`}
              >
                {settings.isOpen
                  ? 'Store is OPEN — Accepting Customer Orders'
                  : 'Store is CLOSED — Orders Disabled in Customer App'}
              </p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Manual switch synced instantly to{' '}
                <code className="font-mono">storeSettings/isOpen</code> (no
                auto-timer). When closed, customers see a red closed banner and
                cannot place orders.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={savingKey === 'isOpen'}
            data-testid="owner-store-open-toggle"
            onClick={() =>
              void saveSetting(
                'isOpen',
                !settings.isOpen,
                !settings.isOpen
                  ? 'Store is now OPEN. Customers can place orders.'
                  : 'Store is now CLOSED. Customer checkout has been paused.'
              )
            }
            className={`w-full min-h-[50px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
              settings.isOpen
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <Power className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'isOpen'
                ? 'Updating…'
                : settings.isOpen
                  ? 'Switch to Store Closed'
                  : 'Switch to Store Open'}
            </span>
          </button>
        </div>

        {/* One-Click Auto-Assign Online Rider Switch */}
        <div
          data-testid="owner-auto-assign-card"
          className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
            settings.autoAssign
              ? 'bg-blue-50/70 border-blue-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <Zap
                className={`w-5 h-5 shrink-0 ${
                  settings.autoAssign ? 'text-blue-700' : 'text-slate-500'
                }`}
                aria-hidden="true"
              />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Auto-Assign Online Rider
              </h2>
            </div>
            <p
              className={`text-sm font-bold mt-1 ${
                settings.autoAssign ? 'text-blue-800' : 'text-slate-600'
              }`}
            >
              {settings.autoAssign
                ? 'Auto-Assign Online Rider: ON'
                : 'Auto-Assign Online Rider: OFF (Manual Dispatch)'}
            </p>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Automatically assigns each new order to the Duty-ON rider with the
              fewest active orders, ringing their Rider App immediately. If zero
              riders are online, the order stays unassigned and alerts you.
            </p>
            <p className="text-xs font-semibold text-cyan-800 mt-2 flex items-center gap-1.5">
              <Bike className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {onlineRiders.length} Duty-ON{' '}
                {onlineRiders.length === 1 ? 'rider' : 'riders'} online right now
              </span>
            </p>
          </div>

          <button
            type="button"
            disabled={savingKey === 'autoAssign'}
            data-testid="owner-auto-assign-toggle"
            onClick={() =>
              void saveSetting(
                'autoAssign',
                !settings.autoAssign,
                !settings.autoAssign
                  ? 'Auto-Assign Online Rider switched ON.'
                  : 'Auto-Assign Online Rider switched OFF (manual dispatch).'
              )
            }
            className={`w-full min-h-[50px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
              settings.autoAssign
                ? 'bg-slate-900 hover:bg-slate-800 text-white'
                : 'bg-blue-700 hover:bg-blue-800 text-white'
            }`}
          >
            <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'autoAssign'
                ? 'Updating…'
                : settings.autoAssign
                  ? 'Turn Auto-Assign OFF'
                  : 'Turn Auto-Assign ON'}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1.1: Minimum Order Amount, Function Bulk Orders Toggle, and Support Contact Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Minimum Order Amount (₹) Control */}
        <div
          data-testid="owner-min-order-card"
          className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
                <span>Minimum Order Amount (₹)</span>
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Customers must reach this combined cart total across water cans &amp; cold
                drinks before Place Order is enabled (default ₹100).
              </p>
            </div>
            <span className="text-xs font-extrabold text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg tabular-nums shrink-0">
              Saved: ₹{settings.minOrderAmount}
            </span>
          </div>

          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Minimum order amount presets"
          >
            {MIN_ORDER_PRESETS.map((preset) => {
              const selected = Number(minOrderInput) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMinOrderInput(String(preset))}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                    selected
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-50 border border-slate-300 text-slate-700 hover:bg-blue-50'
                  }`}
                >
                  ₹{preset}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <label htmlFor="owner-min-order-input" className="sr-only">
              Minimum Order Amount in Rupees
            </label>
            <input
              id="owner-min-order-input"
              data-testid="owner-min-order-input"
              type="number"
              min={0}
              max={50000}
              step={1}
              value={minOrderInput}
              onChange={(e) => setMinOrderInput(e.target.value)}
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
            />
            <button
              type="button"
              disabled={savingKey === 'minOrderAmount'}
              data-testid="save-min-order-btn"
              onClick={() => {
                const clean = sanitizeMinOrderAmount(
                  minOrderInput,
                  settings.minOrderAmount
                );
                setMinOrderInput(String(clean));
                void saveSetting(
                  'minOrderAmount',
                  clean,
                  `Minimum Order Amount saved as ₹${clean}.`
                );
              }}
              className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{savingKey === 'minOrderAmount' ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>

        {/* Events / Function Bulk Orders ON/OFF Toggle */}
        <div
          data-testid="owner-bulk-orders-card"
          className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
            settings.bulkOrdersEnabled
              ? 'bg-cyan-50/70 border-cyan-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <Sparkles
                className={`w-5 h-5 shrink-0 ${
                  settings.bulkOrdersEnabled ? 'text-cyan-800' : 'text-slate-500'
                }`}
                aria-hidden="true"
              />
              <h2 className="font-display text-lg font-bold text-slate-900">
                Function / Events Bulk Orders
              </h2>
            </div>
            <p
              className={`text-sm font-bold mt-1 ${
                settings.bulkOrdersEnabled ? 'text-cyan-900' : 'text-slate-600'
              }`}
            >
              {settings.bulkOrdersEnabled
                ? 'Function Bulk Orders: ON (Visible to Customers)'
                : 'Function Bulk Orders: OFF (Hidden in Customer App)'}
            </p>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              When ON, customers can tap &ldquo;Events / Function Bulk Order&rdquo; to book
              10, 20, 50 or custom water cans for functions and send requests directly
              to your Live Orders tab.
            </p>
          </div>

          <button
            type="button"
            disabled={savingKey === 'bulkOrdersEnabled'}
            data-testid="owner-bulk-orders-toggle"
            onClick={() =>
              void saveSetting(
                'bulkOrdersEnabled',
                !settings.bulkOrdersEnabled,
                !settings.bulkOrdersEnabled
                  ? 'Function Bulk Orders switched ON in Customer App.'
                  : 'Function Bulk Orders switched OFF and hidden in Customer App.'
              )
            }
            className={`w-full min-h-[48px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
              settings.bulkOrdersEnabled
                ? 'bg-cyan-700 hover:bg-cyan-800 text-white'
                : 'bg-slate-800 hover:bg-slate-900 text-white'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'bulkOrdersEnabled'
                ? 'Updating…'
                : settings.bulkOrdersEnabled
                  ? 'Function Bulk Orders: ON (Tap to Turn OFF)'
                  : 'Function Bulk Orders: OFF (Tap to Turn ON)'}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1.15: Support Contact Settings (Owner Only — Syncs to Customer & Rider Apps) */}
      <div
        data-testid="owner-support-contact-card"
        className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4"
      >
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
            <Headphones className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
            <span>Support Contact Settings</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Automatically updates the Support Section, Call Owner buttons, and Events
            Bulk Order helpline across both Customer App and Rider App.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <label
              htmlFor="owner-support-mobile-input"
              className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1"
            >
              <Phone className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
              <span>Support Mobile Number (10 Digits)</span>
            </label>
            <input
              id="owner-support-mobile-input"
              data-testid="owner-support-mobile-input"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={supportMobileInput}
              onChange={(e) =>
                setSupportMobileInput(e.target.value.replace(/\D/g, '').slice(0, 10))
              }
              placeholder="9885138592"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold tabular-nums text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label
              htmlFor="owner-support-email-input"
              className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
              <span>Support Email ID</span>
            </label>
            <input
              id="owner-support-email-input"
              data-testid="owner-support-email-input"
              type="email"
              value={supportEmailInput}
              onChange={(e) => setSupportEmailInput(e.target.value)}
              placeholder="support@dailydropwater.com"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <button
            type="button"
            disabled={savingKey === 'supportContact'}
            data-testid="save-support-contact-btn"
            onClick={() => void handleSaveSupportContact()}
            className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>
              {savingKey === 'supportContact' ? 'Saving…' : 'Save Support Contact'}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1.18: Owner-Controlled Congratulations Popup Seconds & Running Rider Ad Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Congratulations Popup Seconds */}
        <div
          data-testid="owner-congrats-timer-card"
          className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                <PartyPopper className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Congratulations Popup Seconds</span>
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Controls how long the full-screen discount celebration popup stays visible
                (1–10 seconds, default 4s) before opening My Orders.
              </p>
            </div>
            <span
              data-testid="owner-congrats-timer-saved-badge"
              className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-extrabold tabular-nums shrink-0"
            >
              Saved: {settings.congratsPopupSeconds}s
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="congrats-timer-minus-btn"
              aria-label="Decrease Congratulations popup duration"
              onClick={() => {
                const current = sanitizeCongratsPopupSeconds(
                  congratsSecondsInput,
                  settings.congratsPopupSeconds
                );
                setCongratsSecondsInput(
                  String(Math.max(MIN_CONGRATS_POPUP_SECONDS, current - 1))
                );
              }}
              className="w-11 h-11 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 flex items-center justify-center cursor-pointer shrink-0"
            >
              <Minus className="w-4 h-4" aria-hidden="true" />
            </button>

            <label htmlFor="owner-congrats-timer-input" className="sr-only">
              Congratulations Popup Seconds
            </label>
            <input
              id="owner-congrats-timer-input"
              data-testid="owner-congrats-timer-input"
              type="number"
              min={MIN_CONGRATS_POPUP_SECONDS}
              max={MAX_CONGRATS_POPUP_SECONDS}
              step={1}
              value={congratsSecondsInput}
              onChange={(e) => setCongratsSecondsInput(e.target.value)}
              className="w-24 min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-center text-base font-extrabold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
            />

            <button
              type="button"
              data-testid="congrats-timer-plus-btn"
              aria-label="Increase Congratulations popup duration"
              onClick={() => {
                const current = sanitizeCongratsPopupSeconds(
                  congratsSecondsInput,
                  settings.congratsPopupSeconds
                );
                setCongratsSecondsInput(
                  String(Math.min(MAX_CONGRATS_POPUP_SECONDS, current + 1))
                );
              }}
              className="w-11 h-11 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 flex items-center justify-center cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>

            <span className="text-xs font-semibold text-slate-500 mr-auto">
              sec (1–10)
            </span>

            <button
              type="button"
              disabled={savingKey === 'congratsPopupSeconds'}
              data-testid="save-congrats-timer-btn"
              onClick={() => {
                const clean = sanitizeCongratsPopupSeconds(
                  congratsSecondsInput,
                  settings.congratsPopupSeconds
                );
                setCongratsSecondsInput(String(clean));
                void saveSetting(
                  'congratsPopupSeconds',
                  clean,
                  `Congratulations Popup Seconds saved as ${clean}s.`
                );
              }}
              className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{savingKey === 'congratsPopupSeconds' ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>

        {/* Running Rider Ad Banner Settings */}
        <div
          data-testid="owner-promo-banner-card"
          className={`rounded-2xl border p-5 space-y-3.5 transition-colors ${
            promoEnabledInput
              ? 'bg-sky-50/70 border-blue-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
                <span>Running Rider Ad Banner</span>
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Slim ~70px strip at the top of Customer App where an animated scooter
                rider pulls your offer banner &amp; button every saved interval.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={promoEnabledInput}
              data-testid="owner-promo-banner-toggle"
              onClick={() => setPromoEnabledInput((prev) => !prev)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors ${
                promoEnabledInput
                  ? 'bg-blue-700 hover:bg-blue-800 text-white'
                  : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
              }`}
            >
              <Power className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{promoEnabledInput ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <label
                htmlFor="owner-promo-banner-text-input"
                className="block text-xs font-bold text-slate-800 mb-1"
              >
                Offer Text
              </label>
              <input
                id="owner-promo-banner-text-input"
                data-testid="owner-promo-banner-text-input"
                type="text"
                maxLength={160}
                value={promoTextInput}
                onChange={(e) => setPromoTextInput(e.target.value)}
                placeholder="e.g. Summer Offer: Flat ₹20 OFF on 20L Water Cans!"
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="owner-promo-banner-btn-text-input"
                  className="block text-xs font-bold text-slate-800 mb-1"
                >
                  Button Text
                </label>
                <input
                  id="owner-promo-banner-btn-text-input"
                  data-testid="owner-promo-banner-btn-text-input"
                  type="text"
                  maxLength={28}
                  value={promoButtonTextInput}
                  onChange={(e) => setPromoButtonTextInput(e.target.value)}
                  placeholder="Order Now"
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label
                  htmlFor="owner-promo-banner-url-input"
                  className="block text-xs font-bold text-slate-800 mb-1"
                >
                  Optional Action URL
                </label>
                <input
                  id="owner-promo-banner-url-input"
                  data-testid="owner-promo-banner-url-input"
                  type="text"
                  maxLength={300}
                  value={promoActionUrlInput}
                  onChange={(e) => setPromoActionUrlInput(e.target.value)}
                  placeholder="https://wa.me/91... or leave blank"
                  className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5 pt-0.5">
              <div className="flex-1">
                <label
                  htmlFor="owner-promo-banner-interval-input"
                  className="block text-xs font-bold text-slate-800 mb-1"
                >
                  Repeat Interval (Minutes, default 1 min)
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PROMO_INTERVAL_PRESETS.map((mins) => {
                    const selected =
                      sanitizePromoBannerIntervalMinutes(
                        promoIntervalInput,
                        DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
                      ) === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setPromoIntervalInput(String(mins))}
                        className={`min-h-[38px] px-2.5 rounded-lg text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                          selected
                            ? 'bg-blue-700 text-white'
                            : 'bg-slate-50 border border-slate-300 text-slate-700 hover:bg-blue-50'
                        }`}
                      >
                        {mins}m
                      </button>
                    );
                  })}
                  <input
                    id="owner-promo-banner-interval-input"
                    data-testid="owner-promo-banner-interval-input"
                    type="number"
                    min={MIN_PROMO_BANNER_INTERVAL_MINUTES}
                    max={MAX_PROMO_BANNER_INTERVAL_MINUTES}
                    step={1}
                    value={promoIntervalInput}
                    onChange={(e) => setPromoIntervalInput(e.target.value)}
                    className="w-16 min-h-[38px] px-2 rounded-lg border border-slate-300 bg-white text-center text-xs font-extrabold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                  />
                  <span className="text-xs font-semibold text-slate-500">min</span>
                </div>
              </div>

              <button
                type="button"
                disabled={savingKey === 'promoBanner'}
                data-testid="save-promo-banner-btn"
                onClick={() => void handleSavePromoBanner()}
                className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'promoBanner' ? 'Saving…' : 'Save Banner'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Row 1.25: Owner Payment Control (UPI & COD) */}
      <div
        data-testid="owner-payment-control-card"
        className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Owner Payment Control (UPI &amp; COD)</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Toggle UPI and Cash on Delivery independently in{' '}
              <code className="font-mono">/storeSettings</code>. If both are OFF,
              Customer checkout is disabled.
            </p>
          </div>
          <span
            data-testid="owner-payment-mode-badge"
            className={`inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-extrabold shrink-0 ${
              paymentAvailability.checkoutDisabled
                ? 'bg-red-100 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-900 border border-blue-200'
            }`}
          >
            {paymentAvailability.checkoutDisabled
              ? 'Both OFF — Checkout Disabled'
              : paymentAvailability.upiEnabled && paymentAvailability.codEnabled
                ? 'Active: UPI & COD'
                : paymentAvailability.upiEnabled
                  ? 'Active: UPI Only'
                  : 'Active: COD Only'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={savingKey === 'upiEnabled'}
            data-testid="owner-upi-enabled-toggle"
            onClick={() =>
              void saveSetting(
                'upiEnabled',
                !settings.upiEnabled,
                !settings.upiEnabled
                  ? 'Accept UPI switched ON.'
                  : 'Accept UPI switched OFF.'
              )
            }
            className={`min-h-[50px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
              settings.upiEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-800 hover:bg-slate-900 text-white'
            }`}
          >
            <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'upiEnabled'
                ? 'Updating…'
                : settings.upiEnabled
                  ? 'Accept UPI: ON'
                  : 'Accept UPI: OFF'}
            </span>
          </button>

          <button
            type="button"
            disabled={savingKey === 'codEnabled'}
            data-testid="owner-cod-enabled-toggle"
            onClick={() =>
              void saveSetting(
                'codEnabled',
                !settings.codEnabled,
                !settings.codEnabled
                  ? 'Accept COD switched ON.'
                  : 'Accept COD switched OFF.'
              )
            }
            className={`min-h-[50px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
              settings.codEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-800 hover:bg-slate-900 text-white'
            }`}
          >
            <IndianRupee className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'codEnabled'
                ? 'Updating…'
                : settings.codEnabled
                  ? 'Accept COD: ON'
                  : 'Accept COD: OFF'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <label
              htmlFor="owner-upi-id-input"
              className="block text-xs font-bold text-slate-800 mb-1"
            >
              Owner UPI ID
            </label>
            <input
              id="owner-upi-id-input"
              type="text"
              value={upiIdInput}
              onChange={(e) => setUpiIdInput(e.target.value)}
              placeholder="e.g. dailydropwater@okaxis"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label
              htmlFor="owner-upi-name-input"
              className="block text-xs font-bold text-slate-800 mb-1"
            >
              Business Name
            </label>
            <input
              id="owner-upi-name-input"
              type="text"
              value={upiNameInput}
              onChange={(e) => setUpiNameInput(e.target.value)}
              placeholder="DailyDrop Water"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <button
            type="button"
            disabled={savingKey === 'paymentDetails'}
            data-testid="save-payment-settings-btn"
            onClick={() => void handleSavePaymentDetails()}
            className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>
              {savingKey === 'paymentDetails' ? 'Saving…' : 'Save Payment Settings'}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1.5: Delivery Radius Control Card */}
      <div
        data-testid="owner-radius-control-card"
        className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
              <Radar className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Delivery Radius Control</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Control the maximum Haversine distance from your store GPS synced via{' '}
              <code className="font-mono">/storeSettings</code>. When ON, customers
              outside the radius see a popup and cannot place orders.
            </p>
          </div>

          <button
            type="button"
            disabled={savingKey === 'radiusEnabled'}
            data-testid="owner-radius-enabled-toggle"
            onClick={() =>
              void saveSetting(
                'radiusEnabled',
                !settings.radiusEnabled,
                !settings.radiusEnabled
                  ? `Delivery Radius Limit switched ON (${settings.deliveryRadiusKm} km max).`
                  : 'Delivery Radius Limit switched OFF (accepting orders from any distance).'
              )
            }
            className={`min-h-[46px] px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 shrink-0 ${
              settings.radiusEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            <Radar className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {savingKey === 'radiusEnabled'
                ? 'Updating…'
                : settings.radiusEnabled
                  ? 'Delivery Radius Limit: ON'
                  : 'Delivery Radius Limit: OFF'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Max Delivery Radius (km) */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="owner-delivery-radius-input"
                className="font-display text-sm font-bold text-slate-900"
              >
                Max Delivery Radius (km)
              </label>
              <span className="text-xs font-extrabold text-blue-800 tabular-nums">
                Saved: {settings.deliveryRadiusKm} km
              </span>
            </div>

            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Delivery radius presets"
            >
              {DELIVERY_RADIUS_PRESETS.map((preset) => {
                const selected = Number(radiusInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRadiusInput(String(preset))}
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                      selected
                        ? 'bg-blue-700 text-white'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50'
                    }`}
                  >
                    {preset} km
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                id="owner-delivery-radius-input"
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={radiusInput}
                onChange={(e) => setRadiusInput(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                disabled={savingKey === 'deliveryRadiusKm'}
                data-testid="save-delivery-radius-btn"
                onClick={() => {
                  const clean = sanitizeDeliveryRadiusKm(
                    radiusInput,
                    settings.deliveryRadiusKm
                  );
                  setRadiusInput(String(clean));
                  void saveSetting(
                    'deliveryRadiusKm',
                    clean,
                    `Max Delivery Radius saved as ${clean} km.`
                  );
                }}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>
                  {savingKey === 'deliveryRadiusKm' ? 'Saving…' : 'Save'}
                </span>
              </button>
            </div>
          </div>

          {/* Store Base GPS */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>Store Base GPS</span>
              </span>
              <span className="text-xs font-semibold text-blue-800 tabular-nums">
                {settings.storeLat.toFixed(4)}, {settings.storeLng.toFixed(4)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="owner-store-lat-input"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Store Latitude
                </label>
                <input
                  id="owner-store-lat-input"
                  type="number"
                  step="0.0001"
                  value={storeLatInput}
                  onChange={(e) => setStoreLatInput(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                />
              </div>
              <div>
                <label
                  htmlFor="owner-store-lng-input"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Store Longitude
                </label>
                <input
                  id="owner-store-lng-input"
                  type="number"
                  step="0.0001"
                  value={storeLngInput}
                  onChange={(e) => setStoreLngInput(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={capturingStoreGps}
                data-testid="use-current-gps-store-btn"
                onClick={handleUseCurrentGpsAsStore}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-white hover:bg-blue-50 border border-blue-300 text-blue-800 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {capturingStoreGps
                    ? 'Reading GPS…'
                    : 'Use My Current GPS as Store Location'}
                </span>
              </button>
              <button
                type="button"
                disabled={savingKey === 'storeGps'}
                data-testid="save-store-gps-btn"
                onClick={() => void handleSaveStoreGps()}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'storeGps' ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Editable Fees & Floor/Lift Policy */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
            <span>Editable Fees &amp; Floor / Lift Charges</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Changes sync immediately to Customer checkout bill breakdown via
            Firebase <code className="font-mono">/storeSettings</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Platform Fee */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="owner-platform-fee-input"
                className="font-display text-sm font-bold text-slate-900"
              >
                Platform Fee (₹)
              </label>
              <span className="text-xs font-extrabold text-blue-800 tabular-nums">
                Saved: ₹{settings.platformFee}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform fee presets">
              {PLATFORM_FEE_PRESETS.map((preset) => {
                const selected = Number(platformInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPlatformInput(String(preset))}
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                      selected
                        ? 'bg-blue-700 text-white'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50'
                    }`}
                  >
                    ₹{preset}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                id="owner-platform-fee-input"
                type="number"
                min={0}
                max={5000}
                step={1}
                value={platformInput}
                onChange={(e) => setPlatformInput(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                disabled={savingKey === 'platformFee'}
                data-testid="save-platform-fee-btn"
                onClick={() => {
                  const clean = sanitizeFeeAmount(platformInput, settings.platformFee);
                  setPlatformInput(String(clean));
                  void saveSetting(
                    'platformFee',
                    clean,
                    `Platform Fee saved as ₹${clean}.`
                  );
                }}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'platformFee' ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Delivery Fee */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="owner-delivery-fee-input"
                className="font-display text-sm font-bold text-slate-900"
              >
                Delivery Fee (₹)
              </label>
              <span className="text-xs font-extrabold text-blue-800 tabular-nums">
                Saved: ₹{settings.deliveryFee}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Delivery fee presets">
              {DELIVERY_FEE_PRESETS.map((preset) => {
                const selected = Number(deliveryInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDeliveryInput(String(preset))}
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-bold tabular-nums cursor-pointer transition-colors ${
                      selected
                        ? 'bg-blue-700 text-white'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50'
                    }`}
                  >
                    ₹{preset}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                id="owner-delivery-fee-input"
                type="number"
                min={0}
                max={5000}
                step={1}
                value={deliveryInput}
                onChange={(e) => setDeliveryInput(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                disabled={savingKey === 'deliveryFee'}
                data-testid="save-delivery-fee-btn"
                onClick={() => {
                  const clean = sanitizeFeeAmount(deliveryInput, settings.deliveryFee);
                  setDeliveryInput(String(clean));
                  void saveSetting(
                    'deliveryFee',
                    clean,
                    `Delivery Fee saved as ₹${clean}.`
                  );
                }}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'deliveryFee' ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* 2nd Floor Without Lift Charge */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="owner-floor2-charge-input"
                className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5"
              >
                <Building2 className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>2nd Floor Without Lift Charge (₹)</span>
              </label>
              <span className="text-xs font-extrabold text-blue-800 tabular-nums shrink-0">
                Saved: ₹{settings.floor2Charge}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Added only when customer selects <strong>2nd Floor</strong> and{' '}
              <strong>No Lift</strong> (default ₹10).
            </p>
            <div className="flex gap-2">
              <input
                id="owner-floor2-charge-input"
                type="number"
                min={0}
                max={5000}
                step={1}
                value={floor2Input}
                onChange={(e) => setFloor2Input(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                disabled={savingKey === 'floor2Charge'}
                data-testid="save-floor2-charge-btn"
                onClick={() => {
                  const clean = sanitizeFeeAmount(floor2Input, settings.floor2Charge);
                  setFloor2Input(String(clean));
                  void saveSetting(
                    'floor2Charge',
                    clean,
                    `2nd Floor Without Lift Charge saved as ₹${clean}.`
                  );
                }}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'floor2Charge' ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* 3rd+ Floor Without Lift Charge */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="owner-floor3-charge-input"
                className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5"
              >
                <Building2 className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>3rd+ Floor Without Lift Charge (₹)</span>
              </label>
              <span className="text-xs font-extrabold text-blue-800 tabular-nums shrink-0">
                Saved: ₹{settings.floor3PlusCharge}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Added only when customer selects <strong>3rd Floor &amp; Above</strong>{' '}
              and <strong>No Lift</strong> (default ₹20).
            </p>
            <div className="flex gap-2">
              <input
                id="owner-floor3-charge-input"
                type="number"
                min={0}
                max={5000}
                step={1}
                value={floor3Input}
                onChange={(e) => setFloor3Input(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                disabled={savingKey === 'floor3PlusCharge'}
                data-testid="save-floor3-charge-btn"
                onClick={() => {
                  const clean = sanitizeFeeAmount(
                    floor3Input,
                    settings.floor3PlusCharge
                  );
                  setFloor3Input(String(clean));
                  void saveSetting(
                    'floor3PlusCharge',
                    clean,
                    `3rd+ Floor Without Lift Charge saved as ₹${clean}.`
                  );
                }}
                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shrink-0"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingKey === 'floor3PlusCharge' ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Policy Preview */}
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-950 flex items-start gap-2">
          <Check className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">
            <strong>Customer Checkout Preview:</strong> Delivery Policy: Ground/1st
            Floor (or any floor with Lift) has NO extra floor charge. Without lift:
            2nd Floor (+₹{settings.floor2Charge}), 3rd+ Floor (+₹
            {settings.floor3PlusCharge}). Platform Fee: ₹{settings.platformFee} ·
            Delivery Fee: ₹{settings.deliveryFee}.
          </p>
        </div>
      </div>
    </section>
  );
}
