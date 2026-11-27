import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Bell,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Headphones,
  History,
  LocateFixed,
  MapPin,
  Minus,
  MoreVertical,
  Navigation,
  Phone,
  Plus,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  User,
  X,
  Zap,
} from 'lucide-react';
import type {
  CustomerProfile,
  CustomerRecord,
  FloorLevel,
  GeoPoint,
  Order,
  PaymentMethod,
  Product,
  ProductCategory,
  RiderRecord,
  ServiceMode,
  StoreSettings,
} from '../types';
import {
  dbGet,
  deleteCustomerProfileData,
  ensureProductsSeeded,
  getStoreSettings,
  placeCustomerOrder,
  sanitizeFirebaseKey,
  subscribePath,
} from '../services/firebaseDb';
import {
  calculateCartTotals,
  COD_DISPLAY_LABEL,
  detectCustomerOrderChanges,
  EVENT_TIME_SLOTS,
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isSafeImageDataUrl,
  normalizeOrderStatus,
  PRODUCT_CATEGORIES,
  resolveOrderCustomerCoords,
  resolveOrderRiderCoords,
  validateCheckoutInput,
  type CustomerOrderAlertEvent,
  type CustomerOrderSnapshot,
} from '../utils/domain';
import {
  calculateOrderBillBreakdown,
  DEFAULT_STORE_SETTINGS,
  FLOOR_OPTIONS,
  formatFloorLiftSummary,
  normalizeStoreSettings,
  STORE_CLOSED_BANNER_MESSAGE,
} from '../utils/storeSettings';
import {
  checkDeliveryRadius,
  isValidGeoPoint,
  type DeliveryRadiusCheck,
} from '../utils/geo';
import {
  buildPhoneCallUrl,
  buildTrackRiderMapUrl,
  copyPhoneNumber,
  formatDisplayPhone10,
  formatIndianPhoneE164,
} from '../utils/androidIntents';
import {
  installGlobalAudioUnlock,
  playCustomerStatusChime,
  unlockAudioContext,
} from '../utils/sound';
import {
  buildUpiPaymentUri,
  getAvailablePaymentOptions,
  getOrderPaymentBadge,
  isValidUtr,
  sanitizeUtrInput,
} from '../utils/payment';
import {
  clearCustomerProfile,
  hasAcceptedGpsDisclosure,
  loadCustomerProfile,
  saveCustomerProfile,
  saveGpsDisclosureAccepted,
} from '../utils/sessionStorage';
import { fetchLiveAreaName } from '../utils/reverseGeocode';
import {
  sanitizePhone10,
  validateAndBuildCanonicalOrder,
} from '../utils/security';
import {
  calculateOrderSavings,
  formatDiscountAmountBadge,
  resolveProductPricing,
} from '../utils/discounts';
import {
  buildRepeatOrderCart,
  checkMinimumOrderAmount,
  findLatestCustomerOrder,
  partitionCustomerOrders,
} from '../utils/customerFeatures';
import { ProductImage } from './ProductImage';
import { BrandLogo } from './BrandLogo';
import { LiveOrderMap } from './LiveOrderMap';
import { PWAInstallButton } from './PWAInstallButton';
import { BackExitToast } from './BackExitToast';
import { CopyToast } from './CopyToast';
import { NetworkStatusBanner } from './NetworkStatusBanner';
import { UpiQrCode } from './UpiQrCode';
import { GpsDisclosureModal } from './GpsDisclosureModal';
import { DiscountCelebrationOverlay } from './DiscountCelebrationOverlay';
import { RepeatLastOrderCard } from './customer/RepeatLastOrderCard';
import { PromoBanner } from './customer/PromoBanner';
import { BulkBookingModal } from './customer/BulkBookingModal';
import {
  CustomerMenuPages,
  type CustomerMenuPage,
} from './customer/CustomerMenuPages';
import { useAndroidBackGuard } from '../hooks/useAndroidBackGuard';

const CUSTOMER_MOBILE_KEY = 'dailydrop_customer_mobile';

const FLOOR_CHARGE_NOTE =
  'ℹ️ Note: Extra floor charges apply when there is no lift (2nd Floor: +₹10, 3rd+ Floor: +₹20), already included in your total payable amount.';

const LIVE_TRACKING_STEPS = [
  { key: 'placed', label: '1. Order Placed' },
  { key: 'out_for_delivery', label: '2. Out for Delivery' },
  { key: 'delivered', label: '3. Delivered' },
] as const;

async function copyPlainText(
  text: string,
  successMsg: string,
  onFeedback: (msg: string) => void
): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(clean);
      onFeedback(successMsg);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = clean;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onFeedback(successMsg);
    return true;
  } catch {
    onFeedback(`Copy failed. Value: ${clean}`);
    return false;
  }
}

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
  const [locationError, setLocationError] = useState<string | null>(null);
  const [customerLocation, setCustomerLocation] = useState<GeoPoint | null>(null);
  const [outsideRadiusModal, setOutsideRadiusModal] =
    useState<DeliveryRadiusCheck | null>(null);

  // Saved Customer Profile & Three-Dots Menu state
  const initialCustomerProfile = useMemo(() => loadCustomerProfile(), []);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(
    () => initialCustomerProfile
  );
  const [menuDropdownOpen, setMenuDropdownOpen] = useState(false);
  const [activeMenuPage, setActiveMenuPage] = useState<CustomerMenuPage | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const [celebrationSavings, setCelebrationSavings] = useState<number | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Checkout drawer state
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerName, setCustomerName] = useState(
    () => initialCustomerProfile?.name ?? ''
  );
  const [customerMobile, setCustomerMobile] = useState(() => {
    if (initialCustomerProfile?.mobile) return initialCustomerProfile.mobile;
    try {
      return window.sessionStorage.getItem(CUSTOMER_MOBILE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [address, setAddress] = useState(
    () => initialCustomerProfile?.address ?? ''
  );
  const [floorLevel, setFloorLevel] = useState<FloorLevel | null>(null);
  const [hasLift, setHasLift] = useState<boolean | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettings>(
    DEFAULT_STORE_SETTINGS
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>('Cash on Delivery');
  const [upiUtr, setUpiUtr] = useState('');
  const [gpsDisclosureAccepted, setGpsDisclosureAccepted] = useState<boolean>(
    () => hasAcceptedGpsDisclosure()
  );
  const [gpsDisclosureOpen, setGpsDisclosureOpen] = useState<boolean>(false);
  const [liveAreaName, setLiveAreaName] = useState<string | null>(null);
  const [resolvingAreaName, setResolvingAreaName] = useState<boolean>(false);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderBanner, setOrderBanner] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ orderId: string; src: string } | null>(
    null
  );
  const copyToastTimerRef = useRef<number | null>(null);

  const showCopyToast = (msg: string) => {
    setCopyToast(msg);
    if (copyToastTimerRef.current !== null) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToast(null);
    }, 2200);
  };

  // Orders & Riders live tracking (accepts 10-digit mobile number OR Order ID)
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ridersMap, setRidersMap] = useState<Record<string, RiderRecord>>({});
  const [trackMobile, setTrackMobile] = useState(() => {
    if (initialCustomerProfile?.mobile) return initialCustomerProfile.mobile;
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

  // Close three-dots dropdown when clicking outside
  useEffect(() => {
    if (!menuDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setMenuDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuDropdownOpen]);

  // Unlock Web Audio automatically on customer's very first tap or keypress
  useEffect(() => {
    return installGlobalAudioUnlock();
  }, []);

  // Prevent accidental app exit on Android hardware/gesture Back button
  const { exitPromptVisible } = useAndroidBackGuard({
    scope: 'customer',
    hasOpenOverlay: Boolean(
      gpsDisclosureOpen ||
        outsideRadiusModal ||
        bulkModalOpen ||
        zoomPhoto ||
        checkoutOpen ||
        menuDropdownOpen
    ),
    onCloseOverlay: () => {
      if (gpsDisclosureOpen) {
        setGpsDisclosureOpen(false);
      } else if (outsideRadiusModal) {
        setOutsideRadiusModal(null);
      } else if (bulkModalOpen) {
        setBulkModalOpen(false);
      } else if (zoomPhoto) {
        setZoomPhoto(null);
      } else if (menuDropdownOpen) {
        setMenuDropdownOpen(false);
      } else if (checkoutOpen) {
        setCheckoutOpen(false);
      }
    },
    isOnSubView: Boolean(activeMenuPage) || activeTab !== 'shop',
    onReturnHome: () => {
      if (activeMenuPage) {
        setActiveMenuPage(null);
      } else {
        setActiveTab('shop');
      }
    },
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

    // Subscribe to storeSettings FIRST so live promo banner & store controls always get priority SSE slot #1
    const unsubStoreSettings = subscribePath<Partial<StoreSettings>>(
      'storeSettings',
      (data) => {
        if (!mounted) return;
        setStoreSettings(normalizeStoreSettings(data));
      }
    );

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
      unsubStoreSettings();
      unsubProducts();
      unsubOrders();
      unsubRiders();
    };
  }, []);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'All') return products;
    return products.filter((p) => p.category === selectedCategory);
  }, [products, selectedCategory]);

  const { itemCount, subtotal, totalSavings } = useMemo(
    () => calculateCartTotals(cart, products),
    [cart, products]
  );

  const minOrderCheck = useMemo(
    () => checkMinimumOrderAmount(subtotal, storeSettings.minOrderAmount),
    [subtotal, storeSettings.minOrderAmount]
  );

  const latestCustomerOrder = useMemo(
    () =>
      findLatestCustomerOrder(
        allOrders,
        customerProfile?.mobile || trackMobile || customerMobile
      ),
    [allOrders, customerProfile?.mobile, trackMobile, customerMobile]
  );

  useEffect(() => {
    if (!storeSettings.bulkOrdersEnabled && serviceMode === 'events') {
      setServiceMode('fast');
    }
    if (!storeSettings.bulkOrdersEnabled && bulkModalOpen) {
      setBulkModalOpen(false);
    }
  }, [storeSettings.bulkOrdersEnabled, serviceMode, bulkModalOpen]);

  const handleReorderNow = () => {
    if (!latestCustomerOrder) return;
    const rebuilt = buildRepeatOrderCart(latestCustomerOrder, products);
    if (rebuilt.addedItemCount === 0) {
      showCopyToast('Items from your last order are currently out of stock.');
      return;
    }
    setCart(rebuilt.cart);
    setServiceMode('fast');
    setFormErrors({});
    setLocationError(null);
    setCheckoutOpen(true);

    const notices: string[] = [];
    if (rebuilt.unavailableNames.length > 0) {
      notices.push(`Skipped out-of-stock: ${rebuilt.unavailableNames.join(', ')}`);
    }
    if (rebuilt.adjustedStockNames.length > 0) {
      notices.push(`Stock adjusted: ${rebuilt.adjustedStockNames.join(', ')}`);
    }
    if (rebuilt.priceChangedCount > 0) {
      notices.push('Latest live prices applied');
    }
    if (notices.length > 0) {
      showCopyToast(notices.join(' · '));
    }
  };

  const normalizedTrackQuery = trackMobile.trim();
  const trackQueryDigits = normalizedTrackQuery.replace(/\D/g, '');
  const isTrackQueryValid =
    (/^\d{10}$/.test(normalizedTrackQuery) ||
      (trackQueryDigits.length === 10 && !/[a-zA-Z]/.test(normalizedTrackQuery))) ||
    normalizedTrackQuery.length >= 4;

  const myOrders = useMemo(() => {
    const trimmed = trackMobile.trim();
    if (!trimmed) return [];
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length === 10 && !/[a-zA-Z]/.test(trimmed)) {
      return allOrders.filter(
        (ord) => ord.customerMobile.replace(/\D/g, '') === digitsOnly
      );
    }
    if (trimmed.length >= 4) {
      const upper = trimmed.toUpperCase();
      return allOrders.filter((ord) => ord.id.toUpperCase().includes(upper));
    }
    return [];
  }, [allOrders, trackMobile]);

  const customerHistoryOrders = useMemo(() => {
    const mobileToMatch = (
      customerProfile?.mobile ||
      (trackQueryDigits.length === 10 && !/[a-zA-Z]/.test(normalizedTrackQuery)
        ? trackQueryDigits
        : '')
    ).replace(/\D/g, '');
    if (mobileToMatch.length !== 10) return myOrders;
    return allOrders.filter(
      (ord) => ord.customerMobile.replace(/\D/g, '') === mobileToMatch
    );
  }, [allOrders, customerProfile?.mobile, myOrders, normalizedTrackQuery, trackQueryDigits]);

  const { activeOrders: myActiveOrders, pastOrders: myPastOrders } = useMemo(
    () => partitionCustomerOrders(myOrders),
    [myOrders]
  );

  const activeOrderCount = myActiveOrders.length;

  // Detect live order status transitions -> play loud 3-note chime + vibrate + banner
  useEffect(() => {
    if (!ordersLoaded) return;
    if (!isTrackQueryValid) {
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

    if (trackedMobileInitRef.current !== normalizedTrackQuery) {
      trackedMobileInitRef.current = normalizedTrackQuery;
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
  }, [myOrders, normalizedTrackQuery, isTrackQueryValid, ordersLoaded]);

  const resolveAreaFromCoords = (coords: GeoPoint) => {
    setResolvingAreaName(true);
    void fetchLiveAreaName(coords.lat, coords.lng)
      .then((area) => {
        if (area) {
          setLiveAreaName(area);
        }
      })
      .finally(() => {
        setResolvingAreaName(false);
      });
  };

  const executeGpsLookup = () => {
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
        resolveAreaFromCoords(coords);
        const check = checkDeliveryRadius(coords.lat, coords.lng, storeSettings);
        if (check.blocked) {
          setOutsideRadiusModal(check);
        } else {
          setOutsideRadiusModal(null);
        }
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

  const handleVerifyLocation = () => {
    if (!gpsDisclosureAccepted) {
      setGpsDisclosureOpen(true);
      return;
    }
    executeGpsLookup();
  };

  const handleAcceptGpsDisclosure = () => {
    saveGpsDisclosureAccepted();
    setGpsDisclosureAccepted(true);
    setGpsDisclosureOpen(false);
    executeGpsLookup();
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

  const bill = useMemo(
    () =>
      calculateOrderBillBreakdown(subtotal, floorLevel, hasLift, storeSettings),
    [subtotal, floorLevel, hasLift, storeSettings]
  );

  const hasValidGps = isValidGeoPoint(customerLocation);
  const radiusCheck = useMemo<DeliveryRadiusCheck | null>(() => {
    if (!hasValidGps || !customerLocation) return null;
    return checkDeliveryRadius(
      customerLocation.lat,
      customerLocation.lng,
      storeSettings
    );
  }, [hasValidGps, customerLocation, storeSettings]);

  const isOutsideDeliveryRadius = Boolean(radiusCheck?.blocked);

  // Close outside-radius modal automatically if Owner disables radius limit or increases radius
  useEffect(() => {
    if (!radiusCheck?.blocked && outsideRadiusModal) {
      setOutsideRadiusModal(null);
    }
  }, [radiusCheck?.blocked, outsideRadiusModal]);

  const paymentAvailability = useMemo(
    () => getAvailablePaymentOptions(storeSettings),
    [storeSettings]
  );

  // Keep selected payment method synced with Owner's active UPI / COD switches
  useEffect(() => {
    if (paymentAvailability.checkoutDisabled) return;
    if (
      selectedPaymentMethod === 'UPI' &&
      !paymentAvailability.upiEnabled &&
      paymentAvailability.codEnabled
    ) {
      setSelectedPaymentMethod('Cash on Delivery');
    } else if (
      selectedPaymentMethod === 'Cash on Delivery' &&
      !paymentAvailability.codEnabled &&
      paymentAvailability.upiEnabled
    ) {
      setSelectedPaymentMethod('UPI');
    }
  }, [
    paymentAvailability.checkoutDisabled,
    paymentAvailability.codEnabled,
    paymentAvailability.upiEnabled,
    selectedPaymentMethod,
  ]);

  const upiPaymentUri = useMemo(() => {
    if (!paymentAvailability.upiEnabled) return '';
    return buildUpiPaymentUri(
      storeSettings.upiId,
      storeSettings.upiName,
      bill.totalAmount
    );
  }, [
    paymentAvailability.upiEnabled,
    storeSettings.upiId,
    storeSettings.upiName,
    bill.totalAmount,
  ]);

  const isGpsRequiredAndMissing = storeSettings.radiusEnabled && !hasValidGps;
  const isUpiMissingOrInvalidUtr =
    selectedPaymentMethod === 'UPI' &&
    paymentAvailability.upiEnabled &&
    !isValidUtr(upiUtr);

  const hasRequiredCheckoutFields =
    storeSettings.isOpen &&
    !paymentAvailability.checkoutDisabled &&
    customerName.trim().length >= 2 &&
    /^\d{10}$/.test(customerMobile.replace(/\D/g, '')) &&
    address.trim().length >= 8 &&
    Boolean(floorLevel) &&
    typeof hasLift === 'boolean' &&
    (serviceMode !== 'events' || Boolean(eventDate.trim() && timeSlot.trim()));

  // Only attempt automatic GPS capture when checkout opens AFTER prominent GPS disclosure is accepted
  useEffect(() => {
    if (!checkoutOpen || !gpsDisclosureAccepted || hasValidGps || locating) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!active) return;
        const coords: GeoPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        setCustomerLocation(coords);
        resolveAreaFromCoords(coords);
        const check = checkDeliveryRadius(coords.lat, coords.lng, storeSettings);
        if (check.blocked) {
          setOutsideRadiusModal(check);
        }
      },
      () => {
        // User can tap "Share Current Location" manually
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
    );
    return () => {
      active = false;
    };
  }, [checkoutOpen, gpsDisclosureAccepted, hasValidGps, locating, storeSettings]);

  const handleSaveCustomerProfile = (
    draft: Omit<CustomerProfile, 'updatedAt'>
  ) => {
    const saved = saveCustomerProfile(draft);
    if (saved) {
      setCustomerProfile(saved);
      setCustomerName(saved.name);
      setCustomerMobile(saved.mobile);
      setAddress(saved.address);
      setTrackMobile(saved.mobile);
      try {
        window.sessionStorage.setItem(CUSTOMER_MOBILE_KEY, saved.mobile);
      } catch {
        // ignore storage errors
      }
      showCopyToast('Profile saved!');
    }
  };

  const handleCustomerLogout = () => {
    clearCustomerProfile();
    setCustomerProfile(null);
    setCustomerName('');
    setCustomerMobile('');
    setAddress('');
    setTrackMobile('');
    setActiveMenuPage(null);
    setActiveTab('shop');
    try {
      window.sessionStorage.removeItem(CUSTOMER_MOBILE_KEY);
    } catch {
      // ignore storage errors
    }
    showCopyToast('Logged out successfully.');
  };

  const handleDeleteCustomerProfileData = async (rawMobile: string) => {
    const cleanMobile = sanitizePhone10(rawMobile);
    if (/^\d{10}$/.test(cleanMobile)) {
      await deleteCustomerProfileData(cleanMobile);
    }
    clearCustomerProfile();
    setCustomerProfile(null);
    setCustomerName('');
    setCustomerMobile('');
    setAddress('');
    setTrackMobile('');
    setCustomerLocation(null);
    setLiveAreaName(null);
    try {
      window.sessionStorage.removeItem(CUSTOMER_MOBILE_KEY);
    } catch {
      // ignore storage errors
    }
    showCopyToast('Profile & personal data deleted.');
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudioContext();

    if (!storeSettings.isOpen) {
      setFormErrors({ submit: STORE_CLOSED_BANNER_MESSAGE });
      return;
    }

    if (paymentAvailability.checkoutDisabled) {
      setFormErrors({
        submit:
          'Online ordering is temporarily paused because all payment methods are turned OFF by the store.',
      });
      return;
    }

    // Strict Delivery Radius enforcement: NEVER bypass validation if GPS is unavailable when radiusEnabled is ON
    if (storeSettings.radiusEnabled) {
      if (!customerLocation || !isValidGeoPoint(customerLocation)) {
        setFormErrors({
          location: `GPS location is required to verify you are within our ${storeSettings.deliveryRadiusKm} km delivery radius. Tap "Share Current Location" first.`,
          submit: `Please share your live GPS location to verify you are within our ${storeSettings.deliveryRadiusKm} km delivery radius.`,
        });
        return;
      }
      const localRadiusCheck = checkDeliveryRadius(
        customerLocation.lat,
        customerLocation.lng,
        storeSettings
      );
      if (localRadiusCheck.blocked) {
        setOutsideRadiusModal(localRadiusCheck);
        setFormErrors({ submit: localRadiusCheck.modalMessage });
        return;
      }
    }

    const errors = validateCheckoutInput({
      customerName,
      customerMobile,
      address,
      customerLat: customerLocation?.lat ?? null,
      customerLng: customerLocation?.lng ?? null,
      floorLevel,
      hasLift,
      serviceMode,
      eventDate,
      timeSlot,
      itemCount,
    });

    const activePaymentMethod: PaymentMethod =
      selectedPaymentMethod === 'UPI' && paymentAvailability.upiEnabled
        ? 'UPI'
        : 'Cash on Delivery';

    const cleanUtr = sanitizeUtrInput(upiUtr);
    if (activePaymentMethod === 'UPI' && !isValidUtr(cleanUtr)) {
      errors.upiUtr =
        'Enter the exact 12-digit UTR / transaction reference number after paying via UPI.';
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const cleanMobile = sanitizeFirebaseKey(sanitizePhone10(customerMobile));
    setSubmittingOrder(true);
    try {
      const [
        freshSettings,
        freshProductsRaw,
        existingCustomer,
        freshRidersRaw,
        freshOrdersRaw,
      ] = await Promise.all([
        getStoreSettings().catch(() => storeSettings),
        dbGet<Record<string, Product>>('products').catch(() => null),
        dbGet<CustomerRecord>(`customers/${cleanMobile}`).catch(() => null),
        dbGet<Record<string, RiderRecord>>('riders').catch(() => ridersMap),
        dbGet<Record<string, Order>>('orders').catch(() => null),
      ]);

      setStoreSettings(freshSettings);

      const authoritativeCatalog: Product[] =
        freshProductsRaw && Object.keys(freshProductsRaw).length > 0
          ? Object.entries(freshProductsRaw).map(([id, p]) => ({
              ...p,
              id: p.id || id,
            }))
          : products;

      const ridersList = freshRidersRaw
        ? Object.entries(freshRidersRaw).map(([id, r]) => ({
            ...r,
            id: r.id || id,
          }))
        : Object.entries(ridersMap).map(([id, r]) => ({
            ...r,
            id: r.id || id,
          }));

      const ordersList = freshOrdersRaw
        ? Object.entries(freshOrdersRaw).map(([id, o]) => ({
            ...o,
            id: o.id || id,
          }))
        : allOrders;

      if (freshSettings.radiusEnabled && customerLocation && isValidGeoPoint(customerLocation)) {
        const freshRadiusCheck = checkDeliveryRadius(
          customerLocation.lat,
          customerLocation.lng,
          freshSettings
        );
        if (freshRadiusCheck.blocked) {
          setOutsideRadiusModal(freshRadiusCheck);
          setFormErrors({ submit: freshRadiusCheck.modalMessage });
          return;
        }
      }

      const canonical = validateAndBuildCanonicalOrder({
        cart,
        catalog: authoritativeCatalog,
        storeSettings: freshSettings,
        customerName,
        customerMobile: cleanMobile,
        address,
        customerLocation,
        floorLevel,
        hasLift,
        serviceMode,
        eventDate,
        timeSlot,
        eventNotes,
        paymentMethod: activePaymentMethod,
        upiUtr: cleanUtr,
        riders: ridersList,
        existingOrders: ordersList,
      });

      if (!canonical.ok) {
        setFormErrors({
          [canonical.field || 'submit']: canonical.error,
          submit: canonical.error,
        });
        return;
      }

      const { order: newOrder, autoAssignedRider } = canonical;

      await placeCustomerOrder(newOrder, existingCustomer, authoritativeCatalog);

      const savedProfile = saveCustomerProfile({
        name: newOrder.customerName,
        mobile: newOrder.customerMobile,
        address: newOrder.address,
      });
      if (savedProfile) {
        setCustomerProfile(savedProfile);
      }

      try {
        window.sessionStorage.setItem(CUSTOMER_MOBILE_KEY, newOrder.customerMobile);
      } catch {
        // ignore storage restrictions
      }

      const orderSavings =
        typeof newOrder.totalSavings === 'number'
          ? newOrder.totalSavings
          : calculateOrderSavings(newOrder.items);

      setTrackMobile(newOrder.customerMobile);
      setCart({});
      setUpiUtr('');
      setCheckoutOpen(false);
      const paySummary =
        newOrder.paymentMethod === 'UPI'
          ? `UPI PAYMENT PENDING (UTR: ${newOrder.upiUtr})`
          : COD_DISPLAY_LABEL;
      setOrderBanner(
        autoAssignedRider
          ? `Order ${newOrder.id} placed & assigned to ${autoAssignedRider.name} (${autoAssignedRider.id})! ${paySummary} · Total ${formatRupees(newOrder.totalAmount)}.`
          : `Order ${newOrder.id} placed! ${paySummary} · Total ${formatRupees(newOrder.totalAmount)}.`
      );
      if (orderSavings > 0) {
        setCelebrationSavings(orderSavings);
      } else {
        setActiveTab('orders');
      }
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

  if (activeMenuPage) {
    return (
      <div className="app-scroll-page bg-slate-50">
        <NetworkStatusBanner />
        <CustomerMenuPages
          page={activeMenuPage}
          profile={customerProfile}
          orders={customerHistoryOrders}
          trackMobile={customerProfile?.mobile || trackQueryDigits}
          supportMobile={storeSettings.supportMobile}
          supportEmail={storeSettings.supportEmail}
          onBack={() => setActiveMenuPage(null)}
          onSaveProfile={handleSaveCustomerProfile}
          onLogout={handleCustomerLogout}
          onDeleteProfileData={handleDeleteCustomerProfileData}
          onCopyFeedback={showCopyToast}
          onOpenFullPrivacy={onOpenPrivacy}
        />
        <CopyToast message={copyToast} />
        <BackExitToast visible={exitPromptVisible} />
      </div>
    );
  }

  return (
    <div className="app-scroll-page bg-slate-50 pb-safe-bar">
      <NetworkStatusBanner />
      {/* Compact Sticky Top Header (Brand + Order Now / My Orders + Three-Dots Menu) */}
      <header className="sticky top-0 z-30 bg-blue-800 text-white shadow-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 min-h-[60px] py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <span className="font-display text-base sm:text-xl font-extrabold tracking-tight block leading-tight truncate">
                DailyDrop Water
              </span>
              <span className="text-[10px] sm:text-xs text-cyan-200 font-medium block leading-tight truncate">
                {liveAreaName
                  ? `Water & Cold Drinks · ${liveAreaName}`
                  : 'Water & Cold Drinks Delivery'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <nav aria-label="DailyDrop Water sections" className="flex items-center gap-0.5 sm:gap-1 bg-blue-900/70 p-0.5 sm:p-1 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('shop')}
                className={`min-h-[36px] px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
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
                className={`min-h-[36px] px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                  activeTab === 'orders'
                    ? 'bg-white text-blue-900'
                    : 'text-blue-100 hover:text-white'
                }`}
              >
                <span>My Orders</span>
                {activeOrderCount > 0 && (
                  <span className="tabular-nums text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded bg-cyan-500 text-white">
                    {activeOrderCount}
                  </span>
                )}
              </button>
            </nav>

            {/* Customer Three-Dots Menu (⋮) */}
            <div ref={menuContainerRef} className="relative">
              <button
                type="button"
                data-testid="customer-menu-btn"
                aria-label="Open customer menu"
                aria-haspopup="menu"
                aria-expanded={menuDropdownOpen}
                onClick={() => setMenuDropdownOpen((prev) => !prev)}
                className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl bg-blue-900/70 hover:bg-blue-900 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <MoreVertical className="w-5 h-5" aria-hidden="true" />
              </button>

              {menuDropdownOpen && (
                <div
                  role="menu"
                  data-testid="customer-menu-dropdown"
                  className="absolute right-0 mt-2 w-60 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-xl py-1.5 z-50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-item-profile"
                    onClick={() => {
                      setMenuDropdownOpen(false);
                      setActiveMenuPage('profile');
                    }}
                    className="w-full min-h-[44px] px-4 text-left text-sm font-semibold text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <User className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                    <span>Profile &amp; Login / Logout</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-item-history"
                    onClick={() => {
                      setMenuDropdownOpen(false);
                      setActiveMenuPage('history');
                    }}
                    className="w-full min-h-[44px] px-4 text-left text-sm font-semibold text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <History className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                    <span>Order History</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-item-privacy"
                    onClick={() => {
                      setMenuDropdownOpen(false);
                      setActiveMenuPage('privacy');
                    }}
                    className="w-full min-h-[44px] px-4 text-left text-sm font-semibold text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span>Privacy &amp; Data Policy</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-item-support"
                    onClick={() => {
                      setMenuDropdownOpen(false);
                      setActiveMenuPage('support');
                    }}
                    className="w-full min-h-[44px] px-4 text-left text-sm font-semibold text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Headphones className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                    <span>Customer Support</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Manual Store Closed Red Banner */}
      {!storeSettings.isOpen && (
        <div
          role="alert"
          data-testid="store-closed-banner"
          className="bg-red-600 text-white border-b border-red-700"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2.5 text-sm font-bold">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-100" aria-hidden="true" />
            <span>{STORE_CLOSED_BANNER_MESSAGE}</span>
          </div>
        </div>
      )}

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

      {/* Live GPS Area Banner & Delivery Radius Check */}
      <section className="bg-gradient-to-b from-blue-800 to-blue-700 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-3 pb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p
                data-testid="live-area-banner"
                className="text-cyan-200 text-xs sm:text-sm font-semibold flex items-center gap-1.5"
              >
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {resolvingAreaName
                    ? 'Detecting your live GPS area…'
                    : liveAreaName
                      ? storeSettings.radiusEnabled
                        ? `Delivering in ${liveAreaName} (Within ${storeSettings.deliveryRadiusKm} km Radius)`
                        : `Delivering in ${liveAreaName}`
                      : storeSettings.radiusEnabled
                        ? `Delivering Near You (Within ${storeSettings.deliveryRadiusKm} km Radius)`
                        : 'Fast Local Water & Cold Drinks Delivery'}
                </span>
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 text-balance">
                Pure Water Cans &amp; Chilled Drinks at Your Door
              </h1>
            </div>

            <button
              type="button"
              data-testid="verify-location-btn"
              onClick={handleVerifyLocation}
              disabled={locating}
              className="min-h-[46px] px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] text-blue-950 font-bold text-sm flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer disabled:opacity-70"
            >
              <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{locating ? 'Checking GPS…' : 'Verify My Location'}</span>
            </button>
          </div>

          {radiusCheck && (
            <div
              role="status"
              className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2.5 ${
                !radiusCheck.blocked
                  ? 'bg-emerald-500/20 border border-emerald-300/50 text-emerald-50'
                  : 'bg-red-500/25 border border-red-300/60 text-red-50'
              }`}
            >
              {!radiusCheck.blocked ? (
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              )}
              {!radiusCheck.radiusEnabled ? (
                <span>
                  Delivery Radius Limit is OFF · You are{' '}
                  <strong className="tabular-nums">{radiusCheck.formattedDistance}</strong>{' '}
                  from our store.
                </span>
              ) : radiusCheck.withinRadius ? (
                <span>
                  Within {radiusCheck.maxRadiusKm} km Fast Delivery Zone · You are{' '}
                  <strong className="tabular-nums">{radiusCheck.formattedDistance}</strong>{' '}
                  from our store.
                </span>
              ) : (
                <span>
                  🚫 Outside Delivery Radius — We currently deliver only within a{' '}
                  <strong className="tabular-nums">{radiusCheck.maxRadiusKm} km</strong>{' '}
                  radius. Your location is{' '}
                  <strong className="tabular-nums">{radiusCheck.formattedDistance}</strong>{' '}
                  away.
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
            {/* Compact Owner-Controlled Promo / Ad Banner (hidden completely when OFF) */}
            <PromoBanner settings={storeSettings} />

            {/* Non-blocking live strip when customer already has 1+ active orders (never blocks placing another order) */}
            {activeOrderCount > 0 && (
              <div
                data-testid="customer-active-orders-strip"
                className="mb-4 rounded-2xl bg-blue-50 border border-blue-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Truck className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
                  <p className="text-xs sm:text-sm font-bold text-blue-950">
                    {activeOrderCount === 1
                      ? '1 active order in progress'
                      : `${activeOrderCount} active orders in progress`}{' '}
                    <span className="font-medium text-blue-800">
                      — you can place another order anytime
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="customer-strip-track-btn"
                  onClick={() => setActiveTab('orders')}
                  className="min-h-[38px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs whitespace-nowrap cursor-pointer"
                >
                  Track Active ({activeOrderCount})
                </button>
              </div>
            )}

            {/* Repeat Last Order Card (shown whenever customer has previous orders) */}
            {latestCustomerOrder && (
              <RepeatLastOrderCard
                lastOrder={latestCustomerOrder}
                onReorderNow={handleReorderNow}
                disabled={loadingProducts || products.length === 0}
              />
            )}

            {/* Two Service Modes Switcher */}
            <section aria-label="Service mode" className="mb-6">
              <div
                className={`grid grid-cols-1 ${
                  storeSettings.bulkOrdersEnabled ? 'sm:grid-cols-2' : ''
                } gap-3`}
              >
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

                {storeSettings.bulkOrdersEnabled && (
                  <button
                    type="button"
                    data-testid="events-bulk-order-card"
                    onClick={() => setBulkModalOpen(true)}
                    className="min-h-[68px] p-4 rounded-2xl border border-cyan-300 bg-gradient-to-r from-cyan-50 via-white to-blue-50 text-slate-900 hover:border-cyan-500 hover:shadow-sm text-left transition-all flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-cyan-700 text-white flex items-center justify-center shrink-0">
                        <Sparkles className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-display font-bold text-base leading-snug text-slate-900">
                          Events / Function Bulk Order
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          Book 10, 20, 50+ water cans for functions &amp; gatherings
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-extrabold text-cyan-800 bg-cyan-100 px-2.5 py-1.5 rounded-lg shrink-0">
                      Book Now
                    </span>
                  </button>
                )}
              </div>

              {storeSettings.bulkOrdersEnabled && serviceMode === 'events' && (
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
            <div
              id="customer-catalog"
              className="scroll-mt-24 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-4"
            >
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
                  const pricing = resolveProductPricing(product);
                  return (
                    <article
                      key={product.id}
                      data-testid={`customer-product-card-${product.id}`}
                      className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between transition-shadow hover:shadow-sm"
                    >
                      <div>
                        <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                          <ProductImage product={product} />
                          {pricing.isDiscountActive && (
                            <span
                              data-testid={`product-save-badge-${product.id}`}
                              className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-extrabold tracking-wide shadow-sm tabular-nums"
                            >
                              SAVE {formatRupees(pricing.savingsPerUnit)}
                            </span>
                          )}
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

                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex items-center justify-between gap-2.5">
                        <div className="flex flex-col min-w-0">
                          {pricing.isDiscountActive && pricing.savingsPerUnit > 0 ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                data-testid={`product-offer-price-${product.id}`}
                                className="font-display text-xl font-extrabold text-slate-900 tabular-nums leading-none"
                              >
                                {formatRupees(pricing.effectivePrice)}
                              </span>
                              <span
                                data-testid={`product-mrp-price-${product.id}`}
                                className="text-sm font-semibold text-slate-400 line-through tabular-nums leading-none"
                              >
                                {formatRupees(pricing.originalPrice)}
                              </span>
                              {formatDiscountAmountBadge(pricing.savingsPerUnit) && (
                                <span
                                  data-testid={`product-discount-badge-${product.id}`}
                                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-extrabold tabular-nums whitespace-nowrap leading-tight"
                                >
                                  {formatDiscountAmountBadge(pricing.savingsPerUnit)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                              {formatRupees(pricing.effectivePrice)}
                            </div>
                          )}
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
                Live Order Tracking
              </h2>
              <p className="text-sm text-slate-600 mb-4">
                Enter your 10-digit mobile number or Order ID (e.g. DD-...) to follow
                live delivery status and contact your assigned delivery rider.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <label htmlFor="track-mobile-input" className="sr-only">
                  10-digit mobile number or Order ID
                </label>
                <input
                  id="track-mobile-input"
                  type="text"
                  value={trackMobile}
                  onChange={(e) => setTrackMobile(e.target.value.slice(0, 32))}
                  placeholder="Enter 10-digit phone number or Order ID (DD-...)"
                  className="flex-1 min-h-[46px] px-4 rounded-xl border border-slate-300 text-base text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                />
                <button
                  type="button"
                  data-testid="my-orders-place-another-btn"
                  onClick={() => setActiveTab('shop')}
                  className="min-h-[46px] px-5 rounded-xl bg-blue-700 text-white hover:bg-blue-800 font-bold text-sm whitespace-nowrap cursor-pointer"
                >
                  + Place Another Order
                </button>
              </div>
            </div>

            {!isTrackQueryValid ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <Truck className="w-10 h-10 text-blue-700 mx-auto mb-3" aria-hidden="true" />
                <p className="font-semibold text-slate-900">
                  Enter your 10-digit phone number or Order ID above
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Orders placed from this phone appear here automatically in real time.
                </p>
              </div>
            ) : myOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <ShoppingBag className="w-10 h-10 text-slate-400 mx-auto mb-3" aria-hidden="true" />
                <p className="font-semibold text-slate-900">
                  No orders found for &ldquo;{normalizedTrackQuery}&rdquo;
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Place a fast home delivery or event water supply order to track it live.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary Bar for Active vs Past Orders */}
                <div
                  data-testid="my-orders-summary-bar"
                  className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold tabular-nums">
                    <span
                      data-testid="my-orders-active-count-badge"
                      className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-800"
                    >
                      Active Orders: {myActiveOrders.length}
                    </span>
                    <span
                      data-testid="my-orders-past-count-badge"
                      className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700"
                    >
                      Past Orders: {myPastOrders.length}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    Live status updates automatically
                  </p>
                </div>

                {[
                  {
                    key: 'active',
                    heading: `Active Orders (${myActiveOrders.length})`,
                    testId: 'my-orders-active-section',
                    list: myActiveOrders,
                  },
                  {
                    key: 'past',
                    heading: `Past Orders (${myPastOrders.length})`,
                    testId: 'my-orders-past-section',
                    list: myPastOrders,
                  },
                ]
                  .filter((group) => group.list.length > 0)
                  .map((group) => (
                    <div
                      key={group.key}
                      data-testid={group.testId}
                      className="space-y-4"
                    >
                      <h3 className="font-display text-base font-extrabold text-slate-900 flex items-center gap-2">
                        <span>{group.heading}</span>
                      </h3>
                      {group.list.map((order) => {
                  const canonicalStatus = normalizeOrderStatus(order.status);
                  const liveStepIdx =
                    canonicalStatus === 'delivered'
                      ? 2
                      : canonicalStatus === 'out_for_delivery'
                        ? 1
                        : 0;
                  const paymentBadge = getOrderPaymentBadge(order);
                  const riderMobile =
                    order.assignedRiderPhone ||
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
                      data-testid={`customer-order-card-${order.id}`}
                      className="bg-white rounded-2xl border border-slate-200 p-5"
                    >
                      <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-500 font-medium tabular-nums">
                            Order ID: <strong className="text-slate-700">{order.id}</strong> ·{' '}
                            {formatTimestamp(order.createdAt)} ·{' '}
                            {order.serviceMode === 'events'
                              ? 'Events Supply'
                              : 'Fast Delivery'}
                          </div>
                          <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                            {getStatusLabel(order.status)}
                          </h3>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display text-lg font-extrabold text-blue-800 tabular-nums">
                            {formatRupees(order.totalAmount)}
                          </div>
                          <span
                            data-testid={`customer-payment-badge-${order.id}`}
                            className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold border whitespace-nowrap ${
                              paymentBadge.kind === 'upi_pending'
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            }`}
                          >
                            {paymentBadge.label}
                          </span>
                        </div>
                      </div>

                      {/* Live 3-Step Order Progress Tracker */}
                      {canonicalStatus !== 'rejected' ? (
                        <div
                          data-testid={`customer-order-steps-${order.id}`}
                          className="py-4"
                        >
                          <div className="grid grid-cols-3 gap-2">
                            {LIVE_TRACKING_STEPS.map((step, idx) => {
                              const completed = liveStepIdx >= idx;
                              const isCurrent = liveStepIdx === idx;
                              return (
                                <div key={step.key} className="text-center">
                                  <div
                                    className={`h-2.5 rounded-full mb-2 transition-colors ${
                                      completed ? 'bg-blue-700' : 'bg-slate-200'
                                    }`}
                                  />
                                  <span
                                    className={`text-xs font-bold block leading-tight ${
                                      isCurrent
                                        ? 'text-blue-700'
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

                      {/* Prominent "Track Rider on Map" HTTPS link during out_for_delivery */}
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
                          <a
                            href={buildTrackRiderMapUrl(
                              liveRiderCoords.lat,
                              liveRiderCoords.lng
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-colors"
                          >
                            <Navigation className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Track Rider on Map</span>
                          </a>
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
                          onCallFeedback={showCopyToast}
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
                            {riderMobile && (
                              <p className="text-xs font-semibold text-slate-700 tabular-nums mt-0.5">
                                Mobile: {formatDisplayPhone10(riderMobile)}
                              </p>
                            )}
                          </div>
                          {riderE164 && riderMobile && (
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={buildPhoneCallUrl(riderMobile)}
                                className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm flex items-center gap-2 transition-colors"
                              >
                                <Phone className="w-4 h-4" aria-hidden="true" />
                                <span>Call Rider ({formatDisplayPhone10(riderMobile)})</span>
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  void copyPhoneNumber(riderMobile, showCopyToast)
                                }
                                className="min-h-[44px] px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Copy className="w-4 h-4 text-blue-700" aria-hidden="true" />
                                <span>Copy Number</span>
                              </button>
                            </div>
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

                      {/* Item-wise Bill Breakdown & Delivery Details */}
                      <div className="pt-3 border-t border-slate-100 text-sm text-slate-700 space-y-2.5">
                        <div
                          data-testid={`customer-order-bill-${order.id}`}
                          className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-xs"
                        >
                          <p className="font-bold text-slate-800 uppercase tracking-wide text-[11px]">
                            Item-wise Bill Breakdown
                          </p>
                          {order.items.map((item) => (
                            <div
                              key={`${order.id}-${item.productId}`}
                              className="flex items-center justify-between text-slate-800 font-medium"
                            >
                              <span>
                                {item.quantity} × {item.name}
                              </span>
                              <span className="font-semibold tabular-nums">
                                {formatRupees(item.price * item.quantity)}
                              </span>
                            </div>
                          ))}

                          <div className="pt-1.5 mt-1.5 border-t border-slate-200 space-y-1 text-slate-600">
                            {(order.platformFee ?? 0) > 0 && (
                              <div className="flex items-center justify-between">
                                <span>Platform Fee</span>
                                <span className="font-semibold text-slate-800 tabular-nums">
                                  {formatRupees(order.platformFee!)}
                                </span>
                              </div>
                            )}
                            {(order.deliveryFee ?? 0) > 0 && (
                              <div className="flex items-center justify-between">
                                <span>Delivery Fee</span>
                                <span className="font-semibold text-slate-800 tabular-nums">
                                  {formatRupees(order.deliveryFee!)}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span>
                                Floor Charge
                                {formatFloorLiftSummary(order)
                                  ? ` (${formatFloorLiftSummary(order)})`
                                  : ''}
                              </span>
                              <span
                                className={`font-semibold tabular-nums ${
                                  (order.floorCharge ?? 0) > 0
                                    ? 'text-amber-800 font-bold'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {(order.floorCharge ?? 0) > 0
                                  ? `+${formatRupees(order.floorCharge!)}`
                                  : '₹0'}
                              </span>
                            </div>
                          </div>

                          <div className="pt-1.5 mt-1.5 border-t border-slate-200 flex items-center justify-between text-sm font-extrabold text-slate-900">
                            <span>Total Payable Amount</span>
                            <span className="text-blue-800 tabular-nums">
                              {formatRupees(order.totalAmount)}
                            </span>
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{order.address}</span>
                        </div>
                        {formatFloorLiftSummary(order) && (
                          <div className="text-xs text-slate-700 font-semibold flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
                            <span>Floor &amp; Lift: {formatFloorLiftSummary(order)}</span>
                          </div>
                        )}
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
                        <div className="text-xs text-slate-700 font-semibold flex items-center gap-1.5">
                          <Banknote
                            className={`w-3.5 h-3.5 shrink-0 ${
                              paymentBadge.kind === 'upi_pending'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                            aria-hidden="true"
                          />
                          <span>Payment: {paymentBadge.label}</span>
                        </div>

                        <p className="rounded-xl bg-blue-50/80 border border-blue-200 px-3 py-2 text-[11px] font-medium text-blue-950 leading-relaxed">
                          {FLOOR_CHARGE_NOTE}
                        </p>
                      </div>
                    </article>
                  );
                })}
                    </div>
                  ))}
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
              Water &amp; Cold Drinks Delivery · Fast Doorstep Supply
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
          <div className="max-w-6xl mx-auto space-y-2">
            {!minOrderCheck.met && minOrderCheck.message && (
              <div
                role="alert"
                data-testid="min-order-warning-banner"
                className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs sm:text-sm font-bold text-amber-950 flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span>{minOrderCheck.message}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
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
                data-testid="sticky-checkout-btn"
                disabled={!minOrderCheck.met}
                onClick={() => {
                  if (!minOrderCheck.met) return;
                  setFormErrors({});
                  setLocationError(null);
                  setCheckoutOpen(true);
                }}
                className="min-h-[48px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.98] text-white font-bold text-sm sm:text-base flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                <span>{minOrderCheck.met ? 'Checkout' : `Add ₹${minOrderCheck.remaining} More`}</span>
              </button>
            </div>
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
                  {itemCount} items · Total {formatRupees(bill.totalAmount)}
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
              {!storeSettings.isOpen && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-300 px-3.5 py-3 text-xs sm:text-sm font-bold text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" aria-hidden="true" />
                  <span>{STORE_CLOSED_BANNER_MESSAGE}</span>
                </div>
              )}

              {/* Cart Items & Full Bill Breakdown */}
              <div
                data-testid="checkout-bill-breakdown"
                className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-1.5"
              >
                {Object.entries(cart).map(([productId, qty]) => {
                  const p = products.find((item) => item.id === productId);
                  if (!p || qty <= 0) return null;
                  const pricing = resolveProductPricing(p);
                  return (
                    <div
                      key={productId}
                      className="flex items-center justify-between text-sm gap-2"
                    >
                      <span className="text-slate-700 font-medium">
                        {qty} × {p.name}
                      </span>
                      <span className="flex items-baseline gap-1.5 tabular-nums">
                        {pricing.isDiscountActive && (
                          <span className="text-xs text-slate-400 line-through">
                            {formatRupees(pricing.originalPrice * qty)}
                          </span>
                        )}
                        <span className="font-semibold text-slate-900">
                          {formatRupees(pricing.effectivePrice * qty)}
                        </span>
                      </span>
                    </div>
                  );
                })}

                <div className="pt-2 mt-2 border-t border-slate-200 space-y-1 text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Items Subtotal</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {formatRupees(bill.itemsSubtotal)}
                    </span>
                  </div>
                  {totalSavings > 0 && (
                    <div
                      data-testid="checkout-discount-savings"
                      className="flex items-center justify-between text-emerald-700 font-bold"
                    >
                      <span>Discount Savings</span>
                      <span className="tabular-nums">
                        SAVE {formatRupees(totalSavings)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Platform Fee</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {bill.platformFee > 0 ? formatRupees(bill.platformFee) : '₹0'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Delivery Fee</span>
                    <span className="font-semibold text-slate-800 tabular-nums">
                      {bill.deliveryFee > 0 ? formatRupees(bill.deliveryFee) : '₹0'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Floor Charge</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        bill.floorCharge > 0 ? 'text-amber-800 font-bold' : 'text-emerald-700'
                      }`}
                    >
                      {bill.floorCharge > 0
                        ? `+${formatRupees(bill.floorCharge)}`
                        : '₹0 (No extra charge)'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 mt-2 border-t border-slate-200 flex items-center justify-between font-bold text-slate-900">
                  <span>Payable Total</span>
                  <span className="font-display text-lg text-blue-800 tabular-nums">
                    {formatRupees(bill.totalAmount)}
                  </span>
                </div>

                <p className="pt-1.5 text-[11px] text-blue-900 font-medium leading-relaxed">
                  {FLOOR_CHARGE_NOTE}
                </p>
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
                  House/Flat No. &amp; Nearby Landmark
                </label>
                <textarea
                  id="checkout-address"
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Flat 204, Green View Apartments, Near Main Road"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
                />
                {formErrors.address && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.address}</p>
                )}

                {/* GPS Location Capture — Required when Delivery Radius Limit is ON */}
                <div
                  className={`mt-3 rounded-xl border p-3.5 space-y-2.5 ${
                    isOutsideDeliveryRadius
                      ? 'bg-red-50 border-red-300'
                      : hasValidGps
                        ? 'bg-emerald-50 border-emerald-300'
                        : storeSettings.radiusEnabled
                          ? 'bg-amber-50 border-amber-300'
                          : 'bg-blue-50/70 border-blue-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-bold flex items-center gap-1.5 ${
                          isOutsideDeliveryRadius
                            ? 'text-red-900'
                            : hasValidGps
                              ? 'text-emerald-900'
                              : storeSettings.radiusEnabled
                                ? 'text-amber-950'
                                : 'text-blue-950'
                        }`}
                      >
                        <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>
                          {isOutsideDeliveryRadius
                            ? `Outside ${radiusCheck?.maxRadiusKm ?? storeSettings.deliveryRadiusKm} km delivery radius`
                            : hasValidGps
                              ? 'Current GPS Location Captured'
                              : storeSettings.radiusEnabled
                                ? `GPS Location Required (${storeSettings.deliveryRadiusKm} km Radius Check)`
                                : 'GPS Location (Optional — Helps Faster Delivery)'}
                        </span>
                      </p>
                      {hasValidGps && customerLocation ? (
                        <p
                          className={`text-xs tabular-nums mt-0.5 ${
                            isOutsideDeliveryRadius
                              ? 'text-red-800 font-semibold'
                              : 'text-emerald-800'
                          }`}
                        >
                          Coordinates: {customerLocation.lat.toFixed(5)},{' '}
                          {customerLocation.lng.toFixed(5)}
                          {radiusCheck
                            ? ` · ${radiusCheck.formattedDistance} from store`
                            : ''}
                        </p>
                      ) : (
                        <p
                          className={`text-xs mt-0.5 ${
                            storeSettings.radiusEnabled
                              ? 'text-amber-900 font-medium'
                              : 'text-blue-900'
                          }`}
                        >
                          {storeSettings.radiusEnabled
                            ? `Tap "Share Current Location" to verify you are within our ${storeSettings.deliveryRadiusKm} km delivery zone.`
                            : 'Share your GPS pin if available, or place your order directly using your written address.'}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={locating}
                    onClick={handleVerifyLocation}
                    data-testid="checkout-share-gps-btn"
                    className={`w-full min-h-[46px] px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      hasValidGps
                        ? 'bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-100'
                        : storeSettings.radiusEnabled
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-white border border-blue-300 text-blue-800 hover:bg-blue-100'
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

                  {formErrors.location && (
                    <p
                      role="alert"
                      data-testid="gps-required-alert"
                      className="text-xs text-red-700 font-bold"
                    >
                      {formErrors.location}
                    </p>
                  )}

                  {locationError && (
                    <p role="status" className="text-xs text-amber-900 font-medium">
                      {locationError}
                      {!storeSettings.radiusEnabled
                        ? ' You can still place your order using your address.'
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Floor & Lift Policy + Required Selectors */}
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div
                  data-testid="floor-policy-notice"
                  className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-950 font-medium leading-relaxed"
                >
                  ℹ️ Delivery Policy: Ground/1st Floor (or any floor with Lift) has
                  NO extra floor charge. Without lift: 2nd Floor (+₹
                  {storeSettings.floor2Charge}), 3rd+ Floor (+₹
                  {storeSettings.floor3PlusCharge}).
                </div>

                <div>
                  <span className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Select Floor <span className="text-red-600">*</span>
                  </span>
                  <div
                    role="group"
                    aria-label="Select Floor"
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                  >
                    {FLOOR_OPTIONS.map((opt) => {
                      const active = floorLevel === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setFloorLevel(opt.value);
                            setFormErrors((prev) => {
                              if (!prev.floorLevel) return prev;
                              const next = { ...prev };
                              delete next.floorLevel;
                              return next;
                            });
                          }}
                          className={`min-h-[44px] px-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                            active
                              ? 'bg-blue-700 border-blue-700 text-white'
                              : 'bg-white border-slate-300 text-slate-800 hover:bg-blue-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {formErrors.floorLevel && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.floorLevel}</p>
                  )}
                </div>

                <div>
                  <span className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Lift Available? <span className="text-red-600">*</span>
                  </span>
                  <div
                    role="group"
                    aria-label="Lift Available"
                    className="grid grid-cols-2 gap-2"
                  >
                    <button
                      type="button"
                      aria-pressed={hasLift === true}
                      onClick={() => {
                        setHasLift(true);
                        setFormErrors((prev) => {
                          if (!prev.hasLift) return prev;
                          const next = { ...prev };
                          delete next.hasLift;
                          return next;
                        });
                      }}
                      className={`min-h-[44px] px-3 rounded-xl border text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                        hasLift === true
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-slate-800 hover:bg-emerald-50'
                      }`}
                    >
                      Lift: Yes
                    </button>
                    <button
                      type="button"
                      aria-pressed={hasLift === false}
                      onClick={() => {
                        setHasLift(false);
                        setFormErrors((prev) => {
                          if (!prev.hasLift) return prev;
                          const next = { ...prev };
                          delete next.hasLift;
                          return next;
                        });
                      }}
                      className={`min-h-[44px] px-3 rounded-xl border text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                        hasLift === false
                          ? 'bg-amber-600 border-amber-600 text-white'
                          : 'bg-white border-slate-300 text-slate-800 hover:bg-amber-50'
                      }`}
                    >
                      Lift: No
                    </button>
                  </div>
                  {formErrors.hasLift && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.hasLift}</p>
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

              {/* Owner-Controlled Payment Method (COD / UPI / Both / Disabled) */}
              <div className="space-y-3">
                <span className="block text-sm font-semibold text-slate-800">
                  Payment Method
                </span>

                {paymentAvailability.checkoutDisabled ? (
                  <div
                    role="alert"
                    data-testid="payment-disabled-banner"
                    className="rounded-xl bg-red-50 border border-red-300 px-4 py-3 text-xs sm:text-sm font-bold text-red-900 flex items-start gap-2.5"
                  >
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      Ordering is temporarily unavailable because all payment methods
                      (UPI &amp; COD) are turned OFF by the store.
                    </span>
                  </div>
                ) : (
                  <>
                    {paymentAvailability.upiEnabled &&
                      paymentAvailability.codEnabled && (
                        <div
                          role="group"
                          aria-label="Select Payment Method"
                          className="grid grid-cols-2 gap-2"
                        >
                          <button
                            type="button"
                            data-testid="pay-option-cod"
                            aria-pressed={selectedPaymentMethod === 'Cash on Delivery'}
                            onClick={() => setSelectedPaymentMethod('Cash on Delivery')}
                            className={`min-h-[46px] px-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                              selectedPaymentMethod === 'Cash on Delivery'
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white border-slate-300 text-slate-800 hover:bg-emerald-50'
                            }`}
                          >
                            <Banknote className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Cash on Delivery</span>
                          </button>

                          <button
                            type="button"
                            data-testid="pay-option-upi"
                            aria-pressed={selectedPaymentMethod === 'UPI'}
                            onClick={() => setSelectedPaymentMethod('UPI')}
                            className={`min-h-[46px] px-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                              selectedPaymentMethod === 'UPI'
                                ? 'bg-blue-700 border-blue-700 text-white'
                                : 'bg-white border-slate-300 text-slate-800 hover:bg-blue-50'
                            }`}
                          >
                            <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>UPI Payment</span>
                          </button>
                        </div>
                      )}

                    {selectedPaymentMethod === 'Cash on Delivery' &&
                      paymentAvailability.codEnabled && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-300 px-4 py-3 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                            <Banknote className="w-5 h-5" aria-hidden="true" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-emerald-950">
                              {COD_DISPLAY_LABEL}
                            </p>
                            <p className="text-xs text-emerald-800">
                              Pay {formatRupees(bill.totalAmount)} in cash when your water cans arrive.
                            </p>
                          </div>
                        </div>
                      )}

                    {selectedPaymentMethod === 'UPI' &&
                      paymentAvailability.upiEnabled && (
                        <div
                          data-testid="checkout-upi-section"
                          className="rounded-2xl bg-blue-50/70 border border-blue-200 p-4 space-y-3.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                                Pay via UPI ({storeSettings.upiName})
                              </p>
                              <p
                                data-testid="checkout-upi-id"
                                className="text-sm font-extrabold text-slate-900 font-mono mt-0.5 break-all"
                              >
                                {storeSettings.upiId}
                              </p>
                            </div>
                            <button
                              type="button"
                              data-testid="copy-upi-id-btn"
                              onClick={() =>
                                void copyPlainText(
                                  storeSettings.upiId,
                                  'UPI ID copied!',
                                  showCopyToast
                                )
                              }
                              className="min-h-[38px] px-3 rounded-xl bg-white hover:bg-blue-100 border border-blue-300 text-blue-900 font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Copy UPI ID</span>
                            </button>
                          </div>

                          <div className="bg-white rounded-xl border border-blue-200 p-3 text-center space-y-2">
                            <UpiQrCode upiUri={upiPaymentUri} />
                            <p className="text-xs font-semibold text-slate-700 tabular-nums">
                              Scan QR to pay{' '}
                              <strong className="text-blue-800">
                                {formatRupees(bill.totalAmount)}
                              </strong>
                            </p>
                            <a
                              href={upiPaymentUri}
                              data-testid="open-upi-app-btn"
                              className="w-full min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-colors"
                            >
                              <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                              <span>Open UPI App ({formatRupees(bill.totalAmount)})</span>
                            </a>
                          </div>

                          <div>
                            <label
                              htmlFor="checkout-upi-utr"
                              className="block text-xs font-bold text-slate-900 mb-1"
                            >
                              Enter 12-Digit UTR Number <span className="text-red-600">*</span>
                            </label>
                            <input
                              id="checkout-upi-utr"
                              type="text"
                              inputMode="numeric"
                              maxLength={12}
                              required
                              value={upiUtr}
                              onChange={(e) => {
                                setUpiUtr(sanitizeUtrInput(e.target.value));
                                setFormErrors((prev) => {
                                  if (!prev.upiUtr) return prev;
                                  const next = { ...prev };
                                  delete next.upiUtr;
                                  return next;
                                });
                              }}
                              placeholder="Enter 12-digit UTR after payment"
                              className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-mono font-bold text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                            />
                            <p className="text-[11px] text-slate-600 mt-1">
                              Your order will show <strong>UPI PAYMENT PENDING</strong> until
                              DailyDrop Owner verifies your UTR.
                            </p>
                            {formErrors.upiUtr && (
                              <p
                                role="alert"
                                className="text-xs font-semibold text-red-600 mt-1"
                              >
                                {formErrors.upiUtr}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>

              {isOutsideDeliveryRadius && radiusCheck && (
                <div
                  role="alert"
                  data-testid="outside-radius-inline-alert"
                  className="rounded-xl bg-red-50 border border-red-300 px-3.5 py-3 text-xs font-semibold text-red-900 leading-relaxed"
                >
                  {radiusCheck.modalMessage}
                </div>
              )}

              {formErrors.submit && !isOutsideDeliveryRadius && (
                <p role="alert" className="text-sm text-red-600 font-medium">
                  {formErrors.submit}
                </p>
              )}

              {!minOrderCheck.met && minOrderCheck.message && (
                <div
                  role="alert"
                  data-testid="checkout-min-order-warning"
                  className="rounded-xl bg-amber-50 border border-amber-300 px-3.5 py-3 text-xs sm:text-sm font-bold text-amber-950 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{minOrderCheck.message}</span>
                </div>
              )}

              <div className="pb-safe">
                <button
                  type="submit"
                  data-testid="place-order-submit-btn"
                  disabled={
                    !storeSettings.isOpen ||
                    paymentAvailability.checkoutDisabled ||
                    !minOrderCheck.met ||
                    submittingOrder ||
                    !hasRequiredCheckoutFields
                  }
                  className={`w-full min-h-[52px] rounded-xl active:scale-[0.99] text-white font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                    isOutsideDeliveryRadius
                      ? 'bg-red-600 hover:bg-red-700'
                      : !minOrderCheck.met || isGpsRequiredAndMissing
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-blue-700 hover:bg-blue-800'
                  }`}
                >
                  {!storeSettings.isOpen
                    ? 'Store Closed — Ordering Paused'
                    : paymentAvailability.checkoutDisabled
                      ? 'Checkout Disabled (No Payment Mode Active)'
                      : !minOrderCheck.met
                        ? `Add ₹${minOrderCheck.remaining} more to reach ₹${minOrderCheck.minOrderAmount} min order`
                        : isOutsideDeliveryRadius
                          ? `Outside ${radiusCheck?.maxRadiusKm ?? storeSettings.deliveryRadiusKm} km delivery radius`
                          : isGpsRequiredAndMissing
                            ? 'Share GPS Location to Place Order'
                            : isUpiMissingOrInvalidUtr
                              ? 'Enter 12-Digit UTR to Place Order'
                              : submittingOrder
                                ? 'Placing Order…'
                                : `Place Order · ${formatRupees(bill.totalAmount)}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Outside Delivery Radius Blocking Modal Pop-up */}
      {outsideRadiusModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="outside-radius-modal-title"
          data-testid="outside-radius-modal"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-red-200 shadow-2xl overflow-hidden">
            <div className="bg-red-600 text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <h3
                  id="outside-radius-modal-title"
                  className="font-display text-lg font-extrabold leading-tight"
                >
                  🚫 Outside Delivery Radius
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOutsideRadiusModal(null)}
                aria-label="Close delivery radius notice"
                className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-red-700 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p
                data-testid="outside-radius-modal-message"
                className="text-sm font-semibold text-slate-800 leading-relaxed"
              >
                {outsideRadiusModal.modalMessage}
              </p>
              <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-900 flex items-center justify-between gap-2 tabular-nums">
                <span>Max Delivery Radius: {outsideRadiusModal.maxRadiusKm} km</span>
                <span className="font-extrabold">
                  Your Distance: {outsideRadiusModal.formattedDistance}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOutsideRadiusModal(null);
                    handleVerifyLocation();
                  }}
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LocateFixed className="w-4 h-4" aria-hidden="true" />
                  <span>Retry GPS</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOutsideRadiusModal(null)}
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm cursor-pointer"
                >
                  Okay, Got It
                </button>
              </div>
            </div>
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

      <GpsDisclosureModal
        open={gpsDisclosureOpen}
        deliveryRadiusKm={storeSettings.deliveryRadiusKm}
        onAccept={handleAcceptGpsDisclosure}
        onDecline={() => setGpsDisclosureOpen(false)}
      />

      <BulkBookingModal
        open={bulkModalOpen}
        supportMobile={storeSettings.supportMobile}
        supportEmail={storeSettings.supportEmail}
        customerProfile={customerProfile}
        onClose={() => setBulkModalOpen(false)}
        onSubmitted={(booking) => {
          showCopyToast(`Bulk booking ${booking.id} sent to Owner!`);
        }}
      />

      <DiscountCelebrationOverlay
        totalSavings={celebrationSavings}
        durationSeconds={storeSettings.congratsPopupSeconds}
        onComplete={() => {
          setCelebrationSavings(null);
          setActiveTab('orders');
        }}
      />

      <CopyToast message={copyToast} />
      <BackExitToast visible={exitPromptVisible} />
    </div>
  );
}
