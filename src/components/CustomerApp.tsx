import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Bell,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  LocateFixed,
  MapPin,
  Minus,
  Navigation,
  Phone,
  Plus,
  ShoppingBag,
  Sparkles,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import type {
  CustomerRecord,
  GeoPoint,
  Order,
  OrderItem,
  Product,
  ProductCategory,
  RiderRecord,
  ServiceMode,
} from '../types';
import {
  dbGet,
  ensureProductsSeeded,
  placeCustomerOrder,
  sanitizeFirebaseKey,
  subscribePath,
} from '../services/firebaseDb';
import {
  calculateCartTotals,
  COD_DISPLAY_LABEL,
  createOrderId,
  detectCustomerOrderChanges,
  EVENT_TIME_SLOTS,
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isActiveOrderStatus,
  isSafeImageDataUrl,
  MISSING_GPS_MESSAGE,
  normalizeOrderStatus,
  PRODUCT_CATEGORIES,
  resolveOrderCustomerCoords,
  resolveOrderRiderCoords,
  validateCheckoutInput,
  type CustomerOrderAlertEvent,
  type CustomerOrderSnapshot,
} from '../utils/domain';
import {
  checkTolichowkiZone,
  isValidGeoPoint,
  type ZoneCheckResult,
} from '../utils/geo';
import {
  buildTrackRiderMapUrl,
  formatIndianPhoneE164,
  openExternalMapUrl,
  triggerPhoneCall,
} from '../utils/androidIntents';
import {
  installGlobalAudioUnlock,
  playCustomerStatusChime,
  unlockAudioContext,
} from '../utils/sound';
import { ProductImage } from './ProductImage';
import { BrandLogo } from './BrandLogo';
import { LiveOrderMap } from './LiveOrderMap';
import { PWAInstallButton } from './PWAInstallButton';
import { BackExitToast } from './BackExitToast';
import { useAndroidBackGuard } from '../hooks/useAndroidBackGuard';

const CUSTOMER_MOBILE_KEY = 'dailydrop_customer_mobile';

const STATUS_STEPS = [
  { key: 'pending', label: 'Order Placed' },
  { key: 'accepted', label: 'Rider Accepted' },
  { key: 'reached_pickup', label: 'Reached Plant' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
] as const;

interface CustomerAppProps {
  onOpenPrivacy?: () => void;
}

export function CustomerApp({ onOpenPrivacy }: CustomerAppProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'shop' | 'orders'>('shop');
  const [serviceMode, setServiceMode] = useState<ServiceMode>('fast');
  const [selectedCategory, setSelectedCategory] = useState<'All' | ProductCategory>('All');
  const [cart, setCart] = useState<Record<string, number>>({});

  // Events mode fields
  const [eventDate, setEventDate] = useState('');
  const [timeSlot, setTimeSlot] = useState<string>(EVENT_TIME_SLOTS[0]);
  const [eventNotes, setEventNotes] = useState('');

  // Location verification & checkout GPS state
  const [locating, setLocating] = useState(false);
  const [zoneResult, setZoneResult] = useState<ZoneCheckResult | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [customerLocation, setCustomerLocation] = useState<GeoPoint | null>(null);

  // Checkout drawer state
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState(() => {
    try {
      return window.sessionStorage.getItem(CUSTOMER_MOBILE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [address, setAddress] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderBanner, setOrderBanner] = useState<string | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ orderId: string; src: string } | null>(
    null
  );

  // Orders & Riders live tracking
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ridersMap, setRidersMap] = useState<Record<string, RiderRecord>>({});
  const [trackMobile, setTrackMobile] = useState(() => {
    try {
      return window.sessionStorage.getItem(CUSTOMER_MOBILE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [liveStatusAlert, setLiveStatusAlert] =
    useState<CustomerOrderAlertEvent | null>(null);

  const prevOrderSnapshotsRef = useRef<Record<string, CustomerOrderSnapshot>>({});
  const trackedMobileInitRef = useRef<string>('');

  // Unlock Web Audio automatically on customer's very first tap or keypress
  useEffect(() => {
    return installGlobalAudioUnlock();
  }, []);

  // Prevent accidental app exit on Android hardware/gesture Back button
  const { exitPromptVisible } = useAndroidBackGuard({
    scope: 'customer',
    hasOpenOverlay: Boolean(zoomPhoto || checkoutOpen),
    onCloseOverlay: () => {
      if (zoomPhoto) {
        setZoomPhoto(null);
      } else if (checkoutOpen) {
        setCheckoutOpen(false);
      }
    },
    isOnSubView: activeTab !== 'shop',
    onReturnHome: () => setActiveTab('shop'),
  });

  // Live products subscription + auto-seeding if empty
  useEffect(() => {
    let mounted = true;
    ensureProductsSeeded()
      .then((seeded) => {
        if (!mounted) return;
        const list = Object.values(seeded).sort(
          (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
        );
        setProducts(list);
        setLoadingProducts(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setDbError(err instanceof Error ? err.message : 'Unable to load catalog.');
        setLoadingProducts(false);
      });

    const unsubProducts = subscribePath<Record<string, Product>>(
      'products',
      (data) => {
        if (!mounted) return;
        if (data && Object.keys(data).length > 0) {
          const list = Object.entries(data)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
          setProducts(list);
          setLoadingProducts(false);
          setDbError(null);
        }
      },
      (err) => {
        if (mounted) setDbError(err.message);
      }
    );

    const unsubOrders = subscribePath<Record<string, Order>>(
      'orders',
      (data) => {
        if (!mounted) return;
        setOrdersLoaded(true);
        if (!data) {
          setAllOrders([]);
          return;
        }
        const list = Object.entries(data)
          .map(([id, ord]) => ({ ...ord, id: ord.id || id }))
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setAllOrders(list);
      }
    );

    const unsubRiders = subscribePath<Record<string, RiderRecord>>(
      'riders',
      (data) => {
        if (!mounted) return;
        setRidersMap(data ?? {});
      }
    );

    return () => {
      mounted = false;
      unsubProducts();
      unsubOrders();
      unsubRiders();
    };
  }, []);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'All') return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [products, selectedCategory]);

  const { itemCount, subtotal } = useMemo(
    () => calculateCartTotals(cart, products),
    [cart, products]
  );

  const myOrders = useMemo(() => {
    const cleanDigits = trackMobile.replace(/\D/g, '');
    if (cleanDigits.length !== 10) return [];
    return allOrders.filter(
      (ord) => ord.customerMobile.replace(/\D/g, '') === cleanDigits
    );
  }, [allOrders, trackMobile]);

  const activeOrderCount = useMemo(
    () => myOrders.filter((o) => isActiveOrderStatus(o.status)).length,
    [myOrders]
  );

  // Detect live 5-step order status transitions -> play loud 3-note chime + vibrate + banner
  useEffect(() => {
    if (!ordersLoaded) return;
    const cleanDigits = trackMobile.replace(/\D/g, '');
    if (cleanDigits.length !== 10) {
      prevOrderSnapshotsRef.current = {};
      trackedMobileInitRef.current = '';
      return;
    }

    const nextSnapshots: Record<string, CustomerOrderSnapshot> = {};
    for (const ord of myOrders) {
      nextSnapshots[ord.id] = {
        status: normalizeOrderStatus(ord.status),
      };
    }

    if (trackedMobileInitRef.current !== cleanDigits) {
      trackedMobileInitRef.current = cleanDigits;
      prevOrderSnapshotsRef.current = nextSnapshots;
      return;
    }

    const changeEvent = detectCustomerOrderChanges(
      prevOrderSnapshotsRef.current,
      myOrders
    );
    if (changeEvent) {
      playCustomerStatusChime();
      setLiveStatusAlert(changeEvent);
    }

    prevOrderSnapshotsRef.current = nextSnapshots;
  }, [myOrders, trackMobile, ordersLoaded]);

  const handleVerifyLocation = () => {
    setLocationError(null);
    if (!('geolocation' in navigator)) {
      setLocationError('GPS location is not supported on this browser.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: GeoPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setCustomerLocation(coords);
        setZoneResult(checkTolichowkiZone(coords.lat, coords.lng));
        setFormErrors((prev) => {
          if (!prev.location) return prev;
          const next = { ...prev };
          delete next.location;
          return next;
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError(
            'Location permission was denied. Please enable GPS in your browser or app settings and tap Share Current Location again.'
          );
        } else {
          setLocationError(
            'Could not read your GPS coordinates right now. Please turn on phone GPS and tap Share Current Location again.'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const updateCartQty = (product: Product, delta: number) => {
    setCart((prev) => {
      const current = prev[product.id] ?? 0;
      const next = Math.max(0, Math.min(product.stock, current + delta));
      const updated = { ...prev };
      if (next === 0) {
        delete updated[product.id];
      } else {
        updated[product.id] = next;
      }
      return updated;
    });
  };

  const hasValidGps = isValidGeoPoint(customerLocation);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioContext();
    const errors = validateCheckoutInput({
      customerName,
      customerMobile,
      address,
      customerLat: customerLocation?.lat ?? null,
      customerLng: customerLocation?.lng ?? null,
      serviceMode,
      eventDate,
      timeSlot,
      itemCount,
    });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0 || !customerLocation) return;

    const cleanMobile = sanitizeFirebaseKey(customerMobile.replace(/\D/g, ''));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const items: OrderItem[] = [];
    for (const [productId, qty] of Object.entries(cart)) {
      const p = productMap.get(productId);
      if (p && qty > 0) {
        items.push({
          productId: p.id,
          name: p.name,
          price: p.price,
          quantity: qty,
          category: p.category,
        });
      }
    }

    if (items.length === 0) {
      setFormErrors({ cart: 'Please add at least one item to your cart.' });
      return;
    }

    setSubmittingOrder(true);
    try {
      const existingCustomer = await dbGet<CustomerRecord>(
        `customers/${cleanMobile}`
      ).catch(() => null);

      const now = Date.now();
      const orderId = createOrderId(now);
      const newOrder: Order = {
        id: orderId,
        customerName: customerName.trim(),
        customerMobile: cleanMobile,
        address: address.trim(),
        customerLat: customerLocation.lat,
        customerLng: customerLocation.lng,
        customerLocation,
        ownerApproved: false,
        serviceMode,
        eventDetails:
          serviceMode === 'events'
            ? {
                eventDate: eventDate.trim(),
                timeSlot: timeSlot.trim(),
                notes: eventNotes.trim(),
              }
            : null,
        paymentMethod: 'Cash on Delivery',
        items,
        totalAmount: subtotal,
        status: 'pending',
        assignedRiderId: null,
        assignedRiderName: null,
        assignedRiderMobile: null,
        createdAt: now,
        updatedAt: now,
        deliveredAt: null,
      };

      await placeCustomerOrder(newOrder, existingCustomer);

      try {
        window.sessionStorage.setItem(CUSTOMER_MOBILE_KEY, cleanMobile);
      } catch {
        // ignore storage restrictions
      }

      setTrackMobile(cleanMobile);
      setCart({});
      setCheckoutOpen(false);
      setActiveTab('orders');
      setOrderBanner(
        `Order ${orderId} placed! ${COD_DISPLAY_LABEL} · Total ${formatRupees(subtotal)}.`
      );
    } catch (err) {
      setFormErrors({
        submit:
          err instanceof Error
            ? err.message
            : 'Could not place your order. Check your connection and retry.',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  return (
    <div className="app-scroll-page bg-slate-50 pb-safe-bar">
      {/* Compact Sticky Top Header (Single-row, clean brand + My Orders tab) */}
      <header className="sticky top-0 z-30 bg-blue-800 text-white shadow-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 min-h-[60px] py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <span className="font-display text-base sm:text-xl font-extrabold tracking-tight block leading-tight truncate">
                DailyDrop Water
              </span>
              <span className="text-[10px] sm:text-xs text-cyan-200 font-medium block leading-tight truncate">
                Water &amp; Cold Drinks Delivery • Tolichowki, Hyderabad
              </span>
            </div>
          </div>

          <nav aria-label="DailyDrop Water sections" className="flex items-center gap-1 bg-blue-900/70 p-1 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('shop')}
              className={`min-h-[36px] px-2.5 sm:px-3.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'shop'
                  ? 'bg-white text-blue-900'
                  : 'text-blue-100 hover:text-white'
              }`}
            >
              Order Now
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`min-h-[36px] px-2.5 sm:px-3.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'orders'
                  ? 'bg-white text-blue-900'
                  : 'text-blue-100 hover:text-white'
              }`}
            >
              <span>My Orders</span>
              {activeOrderCount > 0 && (
                <span className="tabular-nums text-[11px] font-bold px-1.5 py-0.5 rounded bg-cyan-500 text-white">
                  {activeOrderCount}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      {/* Prominent Live Order Status Alert Banner */}
      {liveStatusAlert && (
        <div
          role="alert"
          className="sticky top-[60px] z-30 bg-emerald-600 text-white border-b border-emerald-700 shadow-md"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Bell className="w-5 h-5 text-emerald-100 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-display text-sm sm:text-base font-extrabold leading-tight">
                  {liveStatusAlert.headline}
                </p>
                <p className="text-xs text-emerald-50 mt-0.5 leading-snug">
                  {liveStatusAlert.detail}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeTab !== 'orders' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  className="min-h-[36px] px-3 rounded-lg bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs cursor-pointer"
                >
                  Track Live
                </button>
              )}
              <button
                type="button"
                onClick={() => setLiveStatusAlert(null)}
                aria-label="Dismiss live order update"
                className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-emerald-700 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tolichowki 3 km Zone Banner & Location Check */}
      <section className="bg-gradient-to-b from-blue-800 to-blue-700 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-3 pb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-cyan-200 text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                Delivering in Tolichowki (Within 3 km Radius)
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 text-balance">
                Pure Water Cans &amp; Chilled Drinks at Your Door
              </h1>
            </div>

            <button
              type="button"
              onClick={handleVerifyLocation}
              disabled={locating}
              className="min-h-[46px] px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] text-blue-950 font-bold text-sm flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer disabled:opacity-70"
            >
              <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{locating ? 'Checking GPS…' : 'Verify My Location'}</span>
            </button>
          </div>

          {zoneResult && (
            <div
              role="status"
              className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2.5 ${
                zoneResult.withinZone
                  ? 'bg-emerald-500/20 border border-emerald-300/50 text-emerald-50'
                  : 'bg-amber-500/20 border border-amber-300/50 text-amber-50'
              }`}
            >
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              {zoneResult.withinZone ? (
                <span>
                  Within 3 km Fast Delivery Zone · You are{' '}
                  <strong className="tabular-nums">{zoneResult.formattedDistance}</strong>{' '}
                  from Tolichowki Center.
                </span>
              ) : (
                <span>
                  You are currently{' '}
                  <strong className="tabular-nums">{zoneResult.formattedDistance}</strong>{' '}
                  from Tolichowki Center (outside our 3 km instant delivery radius). You can
                  still schedule bulk Event Supply or enter a Tolichowki drop address.
                </span>
              )}
            </div>
          )}

          {locationError && (
            <div
              role="alert"
              className="mt-4 rounded-xl px-4 py-3 text-sm bg-blue-950/60 border border-blue-400/40 text-blue-100"
            >
              {locationError}
            </div>
          )}
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
        {orderBanner && (
          <div
            role="status"
            className="mb-5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3.5 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm font-semibold">{orderBanner}</p>
            </div>
            <button
              type="button"
              onClick={() => setOrderBanner(null)}
              aria-label="Dismiss order confirmation"
              className="text-emerald-700 hover:text-emerald-900 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === 'shop' ? (
          <>
            {/* Two Service Modes Switcher */}
            <section aria-label="Service mode" className="mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setServiceMode('fast')}
                  aria-pressed={serviceMode === 'fast'}
                  className={`min-h-[68px] p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 cursor-pointer ${
                    serviceMode === 'fast'
                      ? 'bg-blue-700 border-blue-700 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-900 hover:border-blue-300'
                  }`}
                >
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      serviceMode === 'fast'
                        ? 'bg-cyan-400 text-blue-950'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    <Zap className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-base leading-snug">
                      15–20 Mins Fast Home Delivery
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${
                        serviceMode === 'fast' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Instant daily water cans &amp; chilled cold drinks
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setServiceMode('events')}
                  aria-pressed={serviceMode === 'events'}
                  className={`min-h-[68px] p-4 rounded-2xl border text-left transition-all flex items-center gap-3.5 cursor-pointer ${
                    serviceMode === 'events'
                      ? 'bg-cyan-700 border-cyan-700 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-900 hover:border-cyan-400'
                  }`}
                >
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      serviceMode === 'events'
                        ? 'bg-white text-cyan-800'
                        : 'bg-cyan-50 text-cyan-700'
                    }`}
                  >
                    <Sparkles className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-base leading-snug">
                      Every Events Water Supply
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${
                        serviceMode === 'events' ? 'text-cyan-100' : 'text-slate-500'
                      }`}
                    >
                      Bulk cans &amp; bottle boxes for functions &amp; gatherings
                    </div>
                  </div>
                </button>
              </div>

              {serviceMode === 'events' && (
                <div className="mt-3 bg-white border border-cyan-200 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-cyan-900 font-display font-bold text-sm mb-3">
                    <Calendar className="w-4 h-4 text-cyan-700" aria-hidden="true" />
                    <span>Event Schedule Details (Included with Your Bulk Order)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="event-date-inline"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Event Date
                      </label>
                      <input
                        id="event-date-inline"
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="event-slot-inline"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Time Slot
                      </label>
                      <select
                        id="event-slot-inline"
                        value={timeSlot}
                        onChange={(e) => setTimeSlot(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                      >
                        {EVENT_TIME_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="event-notes-inline"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Event Notes (Optional)
                      </label>
                      <input
                        id="event-notes-inline"
                        type="text"
                        placeholder="e.g. Function hall gate 2, dispensers needed"
                        value={eventNotes}
                        onChange={(e) => setEventNotes(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Category Filter Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-4">
              <div
                role="tablist"
                aria-label="Product categories"
                className="flex flex-wrap items-center gap-1.5"
              >
                {PRODUCT_CATEGORIES.map((category) => {
                  const active = selectedCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedCategory(category)}
                      className={`min-h-[42px] px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-700 text-white'
                          : 'bg-white text-slate-700 border border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs font-medium text-slate-500 tabular-nums">
                {filteredProducts.length} items available
              </p>
            </div>

            {dbError && (
              <div
                role="alert"
                className="mb-5 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"
              >
                {dbError}
              </div>
            )}

            {/* Live Product Grid */}
            {loadingProducts ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse"
                  >
                    <div className="aspect-[4/3] bg-slate-200" />
                    <div className="p-4 space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-1/3" />
                      <div className="h-5 bg-slate-200 rounded w-3/4" />
                      <div className="h-10 bg-slate-200 rounded w-full mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <p className="text-base font-semibold text-slate-900">
                  No products in {selectedCategory} right now.
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Try switching to All categories to browse available water cans and
                  cold drinks.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {filteredProducts.map((product) => {
                  const qty = cart[product.id] ?? 0;
                  const available = product.inStock && product.stock > 0;
                  return (
                    <article
                      key={product.id}
                      className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between transition-shadow hover:shadow-sm"
                    >
                      <div>
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                          <ProductImage product={product} />
                        </div>
                        <div className="p-4">
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mb-1">
                            <span>{product.category}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                available
                                  ? 'text-emerald-700 font-semibold tabular-nums'
                                  : 'text-red-600 font-semibold'
                              }
                            >
                              {available ? `In Stock (${product.stock})` : 'Out of Stock'}
                            </span>
                          </div>
                          <h2 className="font-display text-lg font-bold text-slate-900 leading-snug">
                            {product.name}
                          </h2>
                          {product.unit && (
                            <p className="text-xs text-slate-500 mt-0.5">{product.unit}</p>
                          )}
                        </div>
                      </div>

                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                        <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                          {formatRupees(product.price)}
                        </div>

                        {!available ? (
                          <span className="text-xs font-semibold text-slate-400">
                            Currently Unavailable
                          </span>
                        ) : qty === 0 ? (
                          <button
                            type="button"
                            onClick={() => updateCartQty(product, 1)}
                            aria-label={`Add ${product.name}`}
                            className="min-h-[44px] min-w-[116px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            <span>ADD</span>
                          </button>
                        ) : (
                          <div className="flex items-center bg-blue-700 text-white rounded-xl overflow-hidden">
                            <button
                              type="button"
                              onClick={() => updateCartQty(product, -1)}
                              aria-label={`Decrease quantity of ${product.name}`}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-blue-800 active:bg-blue-900 transition-colors cursor-pointer"
                            >
                              <Minus className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <span
                              aria-label={`${product.name} quantity`}
                              className="min-w-[32px] text-center font-bold text-sm tabular-nums"
                            >
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(product, 1)}
                              disabled={qty >= product.stock}
                              aria-label={`Increase quantity of ${product.name}`}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-blue-800 active:bg-blue-900 transition-colors disabled:opacity-40 cursor-pointer"
                            >
                              <Plus className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* MY ORDERS LIVE TRACKING TAB */
          <section aria-label="My Orders" className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
              <h2 className="font-display text-xl font-bold text-slate-900 mb-1">
                Track Your DailyDrop Orders
              </h2>
              <p className="text-sm text-slate-600 mb-4">
                Enter your 10-digit mobile number to follow live delivery status and
                contact your assigned Tolichowki rider.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <label htmlFor="track-mobile-input" className="sr-only">
                  10-digit mobile number
                </label>
                <input
                  id="track-mobile-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={trackMobile}
                  onChange={(e) =>
                    setTrackMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="Enter 10-digit mobile number"
                  className="flex-1 min-h-[46px] px-4 rounded-xl border border-slate-300 text-base text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                />
                <button
                  type="button"
                  onClick={() => setActiveTab('shop')}
                  className="min-h-[46px] px-5 rounded-xl bg-blue-50 text-blue-800 hover:bg-blue-100 font-semibold text-sm whitespace-nowrap cursor-pointer"
                >
                  Order More
                </button>
              </div>
            </div>

            {trackMobile.replace(/\D/g, '').length !== 10 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <Truck className="w-10 h-10 text-blue-700 mx-auto mb-3" aria-hidden="true" />
                <p className="font-semibold text-slate-900">
                  Enter your 10-digit mobile number above
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Orders placed from this phone appear here automatically in real time.
                </p>
              </div>
            ) : myOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <ShoppingBag className="w-10 h-10 text-slate-400 mx-auto mb-3" aria-hidden="true" />
                <p className="font-semibold text-slate-900">
                  No orders found for {trackMobile}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Place a fast home delivery or event water supply order to track it live.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {myOrders.map((order) => {
                  const canonicalStatus = normalizeOrderStatus(order.status);
                  const trackerKey =
                    canonicalStatus === 'assigned' || canonicalStatus === 'unassigned'
                      ? 'pending'
                      : canonicalStatus;
                  const stepIdx = STATUS_STEPS.findIndex(
                    (s) => s.key === trackerKey
                  );
                  const riderMobile =
                    order.assignedRiderMobile ||
                    (order.assignedRiderId
                      ? ridersMap[order.assignedRiderId]?.mobile
                      : null) ||
                    null;
                  const riderE164 = riderMobile
                    ? formatIndianPhoneE164(riderMobile)
                    : '';
                  const customerCoords = resolveOrderCustomerCoords(order);
                  const liveRiderCoords = resolveOrderRiderCoords(
                    order,
                    order.assignedRiderId
                      ? ridersMap[order.assignedRiderId]?.liveLocation ?? null
                      : null
                  );
                  const isOutForDelivery = canonicalStatus === 'out_for_delivery';
                  const hasDeliveryPhoto = isSafeImageDataUrl(order.deliveryPhoto);
                  const showEmbeddedMap =
                    Boolean(order.assignedRiderId) &&
                    (canonicalStatus === 'accepted' ||
                      canonicalStatus === 'reached_pickup' ||
                      canonicalStatus === 'out_for_delivery');

                  return (
                    <article
                      key={order.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
                        <div>
                          <div className="text-xs text-slate-500 font-medium tabular-nums">
                            {order.id} · {formatTimestamp(order.createdAt)} ·{' '}
                            {order.serviceMode === 'events'
                              ? 'Events Supply'
                              : 'Fast Delivery'}
                          </div>
                          <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                            {getStatusLabel(order.status)}
                          </h3>
                        </div>
                        <div className="font-display text-lg font-extrabold text-blue-800 tabular-nums">
                          {formatRupees(order.totalAmount)}
                        </div>
                      </div>

                      {/* Live 5-Step Progress Tracker */}
                      {canonicalStatus !== 'rejected' ? (
                        <div className="py-4">
                          <div className="grid grid-cols-5 gap-1.5">
                            {STATUS_STEPS.map((step, idx) => {
                              const completed = stepIdx >= idx;
                              const isCurrent = stepIdx === idx;
                              return (
                                <div key={step.key} className="text-center">
                                  <div
                                    className={`h-2 rounded-full mb-2 transition-colors ${
                                      completed ? 'bg-blue-700' : 'bg-slate-200'
                                    }`}
                                  />
                                  <span
                                    className={`text-[10px] sm:text-xs font-semibold block leading-tight ${
                                      isCurrent
                                        ? 'text-blue-700 font-extrabold'
                                        : completed
                                          ? 'text-blue-950'
                                          : 'text-slate-400'
                                    }`}
                                  >
                                    {step.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="my-3 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-800 font-medium">
                          This order was declined by the store. Please place a new order
                          or contact support.
                        </div>
                      )}

                      {/* Prominent "Track Rider on Map" button during out_for_delivery */}
                      {isOutForDelivery && liveRiderCoords && (
                        <div className="mb-3 rounded-xl bg-blue-50 border border-blue-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-blue-900">
                              Rider is On the Way to Your Location
                            </p>
                            <p className="text-[11px] text-blue-700 tabular-nums mt-0.5">
                              Live GPS: {liveRiderCoords.lat.toFixed(5)},{' '}
                              {liveRiderCoords.lng.toFixed(5)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              openExternalMapUrl(
                                buildTrackRiderMapUrl(
                                  liveRiderCoords.lat,
                                  liveRiderCoords.lng
                                )
                              )
                            }
                            className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-2 cursor-pointer transition-colors"
                          >
                            <Navigation className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Track Rider on Map</span>
                          </button>
                        </div>
                      )}

                      {/* Embedded Live Map when rider is active on the order */}
                      {showEmbeddedMap && order.assignedRiderId ? (
                        <LiveOrderMap
                          orderId={order.id}
                          customerLocation={customerCoords}
                          customerAddress={order.address}
                          riderLocation={liveRiderCoords}
                          riderName={
                            order.assignedRiderName ||
                            ridersMap[order.assignedRiderId]?.name ||
                            'DailyDrop Rider'
                          }
                          riderId={order.assignedRiderId}
                          riderMobile={riderMobile}
                          showExternalTrackButton={isOutForDelivery}
                          onCallFeedback={setOrderBanner}
                        />
                      ) : order.assignedRiderName ? (
                        <div className="my-3 rounded-xl bg-cyan-50 border border-cyan-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-cyan-800">
                              Assigned Delivery Rider
                            </p>
                            <p className="text-sm font-bold text-slate-900">
                              {order.assignedRiderName}
                              {order.assignedRiderId ? ` (${order.assignedRiderId})` : ''}
                            </p>
                          </div>
                          {riderE164 && riderMobile && (
                            <button
                              type="button"
                              onClick={() =>
                                triggerPhoneCall(riderMobile, setOrderBanner)
                              }
                              className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm flex items-center gap-2 transition-colors cursor-pointer"
                            >
                              <Phone className="w-4 h-4" aria-hidden="true" />
                              <span>Call Rider</span>
                            </button>
                          )}
                        </div>
                      ) : null}

                      {/* Delivery Photo Proof when delivered */}
                      {hasDeliveryPhoto && (
                        <div className="my-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              type="button"
                              onClick={() =>
                                setZoomPhoto({
                                  orderId: order.id,
                                  src: order.deliveryPhoto!,
                                })
                              }
                              aria-label={`View delivery proof photo for ${order.id}`}
                              className="w-16 h-16 rounded-xl overflow-hidden border border-emerald-300 shrink-0 cursor-pointer hover:opacity-90"
                            >
                              <img
                                src={order.deliveryPhoto!}
                                alt={`Delivery proof for order ${order.id}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                                <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>Delivery Photo Proof</span>
                              </p>
                              <p className="text-xs text-emerald-800 mt-0.5">
                                Doorstep photo verified by your rider
                                {order.deliveredAt
                                  ? ` · ${formatTimestamp(order.deliveredAt)}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setZoomPhoto({
                                orderId: order.id,
                                src: order.deliveryPhoto!,
                              })
                            }
                            className="min-h-[38px] px-3 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-xs font-bold shrink-0 cursor-pointer"
                          >
                            View Photo
                          </button>
                        </div>
                      )}

                      {/* Items & Delivery Details */}
                      <div className="pt-3 border-t border-slate-100 text-sm text-slate-700 space-y-1.5">
                        <div className="font-medium text-slate-900">
                          {order.items
                            .map((i) => `${i.quantity} × ${i.name}`)
                            .join(' · ')}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{order.address}</span>
                        </div>
                        {order.eventDetails && (
                          <div className="text-xs text-cyan-800 font-medium flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Event: {order.eventDetails.eventDate} ·{' '}
                              {order.eventDetails.timeSlot}
                              {order.eventDetails.notes
                                ? ` · ${order.eventDetails.notes}`
                                : ''}
                            </span>
                          </div>
                        )}
                        <div className="text-xs text-slate-600 font-semibold flex items-center gap-1.5">
                          <Banknote className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                          <span>Payment: {COD_DISPLAY_LABEL}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Play Store / Customer Transparency Footer */}
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 mt-10 pt-6 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="text-center sm:text-left">
            <p className="font-bold text-slate-800">DailyDrop Water</p>
            <p className="mt-0.5">
              Water &amp; Cold Drinks Delivery • Tolichowki, Hyderabad
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <PWAInstallButton />
            <a
              href="/?app=privacy"
              onClick={(e) => {
                if (onOpenPrivacy) {
                  e.preventDefault();
                  onOpenPrivacy();
                }
              }}
              className="min-h-[38px] px-3.5 rounded-xl bg-white border border-slate-200 hover:border-blue-300 text-blue-800 font-semibold inline-flex items-center transition-colors"
            >
              Privacy Policy
            </a>
          </div>
        </div>
      </footer>

      {/* Compact Sticky Cart Bar (only when items > 0 and on shop view) */}
      {activeTab === 'shop' && itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5 pb-safe">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500 font-semibold tabular-nums">
                {itemCount} {itemCount === 1 ? 'item' : 'items'} ·{' '}
                {serviceMode === 'events' ? 'Events Supply' : '15–20 Mins Fast'}
              </div>
              <div className="font-display text-lg font-extrabold text-slate-900 tabular-nums">
                {formatRupees(subtotal)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setFormErrors({});
                setLocationError(null);
                setCheckoutOpen(true);
              }}
              className="min-h-[48px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.98] text-white font-bold text-sm sm:text-base flex items-center gap-2 transition-all cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" aria-hidden="true" />
              <span>Checkout</span>
            </button>
          </div>
        </div>
      )}

      {/* Checkout Drawer / Modal */}
      {checkoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-heading"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h2
                  id="checkout-heading"
                  className="font-display text-xl font-bold text-slate-900"
                >
                  Complete Your Order
                </h2>
                <p className="text-xs text-slate-500 tabular-nums">
                  {itemCount} items · Total {formatRupees(subtotal)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                aria-label="Close checkout"
                className="min-w-[44px] min-h-[44px] rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePlaceOrder} className="p-5 space-y-4" noValidate>
              {/* Cart Summary */}
              <div className="bg-slate-50 rounded-xl p-3.5 space-y-1.5">
                {Object.entries(cart).map(([productId, qty]) => {
                  const p = products.find((item) => item.id === productId);
                  if (!p || qty <= 0) return null;
                  return (
                    <div
                      key={productId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-slate-700 font-medium">
                        {qty} × {p.name}
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {formatRupees(p.price * qty)}
                      </span>
                    </div>
                  );
                })}
                <div className="pt-2 mt-2 border-t border-slate-200 flex items-center justify-between font-bold text-slate-900">
                  <span>Payable Total</span>
                  <span className="font-display text-lg text-blue-800 tabular-nums">
                    {formatRupees(subtotal)}
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="checkout-name"
                  className="block text-sm font-semibold text-slate-800 mb-1"
                >
                  Customer Name
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
                />
                {formErrors.customerName && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.customerName}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-mobile"
                  className="block text-sm font-semibold text-slate-800 mb-1"
                >
                  10-Digit Mobile Number
                </label>
                <input
                  id="checkout-mobile"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  required
                  value={customerMobile}
                  onChange={(e) =>
                    setCustomerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="e.g. 9848012345"
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                />
                {formErrors.customerMobile && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.customerMobile}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-address"
                  className="block text-sm font-semibold text-slate-800 mb-1"
                >
                  House/Flat No. &amp; Tolichowki Landmark
                </label>
                <textarea
                  id="checkout-address"
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Flat 204, Al-Hasnath Colony, Near Reliance Fresh, Tolichowki"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
                />
                {formErrors.address && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.address}</p>
                )}

                {/* Mandatory GPS Location Capture */}
                <div
                  className={`mt-3 rounded-xl border p-3.5 space-y-2.5 ${
                    hasValidGps
                      ? 'bg-emerald-50 border-emerald-300'
                      : 'bg-amber-50 border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-bold flex items-center gap-1.5 ${
                          hasValidGps ? 'text-emerald-900' : 'text-amber-950'
                        }`}
                      >
                        <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>
                          {hasValidGps
                            ? 'Current GPS Location Captured'
                            : 'Current GPS Location Required'}
                        </span>
                      </p>
                      {hasValidGps && customerLocation ? (
                        <p className="text-xs text-emerald-800 tabular-nums mt-0.5">
                          Coordinates: {customerLocation.lat.toFixed(5)},{' '}
                          {customerLocation.lng.toFixed(5)}
                          {zoneResult
                            ? ` · ${zoneResult.formattedDistance} from Tolichowki`
                            : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-900 font-semibold mt-0.5">
                          {MISSING_GPS_MESSAGE}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={locating}
                    onClick={handleVerifyLocation}
                    className={`w-full min-h-[46px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      hasValidGps
                        ? 'bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-100'
                        : 'bg-blue-700 hover:bg-blue-800 text-white'
                    }`}
                  >
                    <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {locating
                        ? 'Capturing Current GPS…'
                        : hasValidGps
                          ? 'Refresh Current Location'
                          : 'Share Current Location'}
                    </span>
                  </button>

                  {locationError && (
                    <p role="alert" className="text-xs text-red-700 font-semibold">
                      {locationError}
                    </p>
                  )}
                  {formErrors.location && !hasValidGps && (
                    <p role="alert" className="text-xs text-red-700 font-semibold">
                      {formErrors.location}
                    </p>
                  )}
                </div>
              </div>

              {/* Service Mode Selector inside checkout */}
              <div>
                <span className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Service Mode
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setServiceMode('fast')}
                    className={`min-h-[44px] px-3 rounded-xl border text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                      serviceMode === 'fast'
                        ? 'bg-blue-700 border-blue-700 text-white'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    15–20 Mins Fast
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceMode('events')}
                    className={`min-h-[44px] px-3 rounded-xl border text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                      serviceMode === 'events'
                        ? 'bg-cyan-700 border-cyan-700 text-white'
                        : 'bg-white border-slate-300 text-slate-700'
                    }`}
                  >
                    Events Supply
                  </button>
                </div>
              </div>

              {serviceMode === 'events' && (
                <div className="bg-cyan-50/70 border border-cyan-200 rounded-xl p-3.5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="checkout-event-date"
                        className="block text-xs font-semibold text-slate-800 mb-1"
                      >
                        Event Date
                      </label>
                      <input
                        id="checkout-event-date"
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm bg-white"
                      />
                      {formErrors.eventDate && (
                        <p className="text-xs text-red-600 mt-1">
                          {formErrors.eventDate}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="checkout-time-slot"
                        className="block text-xs font-semibold text-slate-800 mb-1"
                      >
                        Time Slot
                      </label>
                      <select
                        id="checkout-time-slot"
                        value={timeSlot}
                        onChange={(e) => setTimeSlot(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm bg-white"
                      >
                        {EVENT_TIME_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="checkout-event-notes"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Event Notes
                    </label>
                    <input
                      id="checkout-event-notes"
                      type="text"
                      value={eventNotes}
                      onChange={(e) => setEventNotes(e.target.value)}
                      placeholder="Venue contact, floor, or dispenser notes"
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Payment Mode: Cash on Delivery Only */}
              <div>
                <span className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Payment Method
                </span>
                <div className="rounded-xl bg-emerald-50 border border-emerald-300 px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Banknote className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-950">
                      {COD_DISPLAY_LABEL}
                    </p>
                    <p className="text-xs text-emerald-800">
                      Pay {formatRupees(subtotal)} in cash when your water cans arrive.
                    </p>
                  </div>
                </div>
              </div>

              {formErrors.submit && (
                <p role="alert" className="text-sm text-red-600 font-medium">
                  {formErrors.submit}
                </p>
              )}

              {!hasValidGps && (
                <p className="text-xs font-semibold text-amber-800 text-center">
                  {MISSING_GPS_MESSAGE}
                </p>
              )}

              <div className="pb-safe">
                <button
                  type="submit"
                  disabled={submittingOrder || !hasValidGps}
                  className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {submittingOrder
                    ? 'Placing Order…'
                    : `Place Order · ${formatRupees(subtotal)}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Photo Proof Lightbox */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delivery Photo Proof Preview"
        >
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-slate-900">
                  Delivery Photo Proof
                </p>
                <p className="text-xs text-slate-500">Order {zoomPhoto.orderId}</p>
              </div>
              <button
                type="button"
                onClick={() => setZoomPhoto(null)}
                aria-label="Close delivery photo"
                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={zoomPhoto.src}
              alt={`Delivery proof for order ${zoomPhoto.orderId}`}
              className="w-full max-h-[70dvh] object-contain bg-slate-100"
            />
          </div>
        </div>
      )}

      <BackExitToast visible={exitPromptVisible} />
    </div>
  );
}
