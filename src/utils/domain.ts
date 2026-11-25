import type {
  AppRole,
  Order,
  OrderStatus,
  Product,
  ProductCategory,
  RiderRecord,
  ServiceMode,
} from '../types';

export const PRODUCT_IMAGES = {
  waterCan: '/src/assets/images/product_water_can_20l_1795644635337.jpg',
  bottlePack: '/src/assets/images/product_water_bottles_pack_1795644632657.jpg',
  cola: '/src/assets/images/product_cola_2l_1795644635108.jpg',
  limeSoda: '/src/assets/images/product_lime_soda_2l_1795644634074.jpg',
} as const;

export const DEFAULT_PRODUCTS: Record<string, Product> = {
  bisleri_20l: {
    id: 'bisleri_20l',
    name: 'Bisleri 20L Water Can',
    category: 'Water Cans',
    price: 90,
    stock: 50,
    inStock: true,
    unit: '20 Litre Dispenser Can',
    image: PRODUCT_IMAGES.waterCan,
    createdAt: 1700000001000,
  },
  aquafina_20l: {
    id: 'aquafina_20l',
    name: 'Aquafina 20L Water Can',
    category: 'Water Cans',
    price: 85,
    stock: 50,
    inStock: true,
    unit: '20 Litre Dispenser Can',
    image: PRODUCT_IMAGES.waterCan,
    createdAt: 1700000002000,
  },
  kinley_20l: {
    id: 'kinley_20l',
    name: 'Kinley 20L Water Can',
    category: 'Water Cans',
    price: 85,
    stock: 50,
    inStock: true,
    unit: '20 Litre Dispenser Can',
    image: PRODUCT_IMAGES.waterCan,
    createdAt: 1700000003000,
  },
  bisleri_1l_box: {
    id: 'bisleri_1l_box',
    name: 'Bisleri 1L Bottle Box (12 Pack)',
    category: 'Water Bottles',
    price: 220,
    stock: 30,
    inStock: true,
    unit: '12 x 1L Sealed Case',
    image: PRODUCT_IMAGES.bottlePack,
    createdAt: 1700000004000,
  },
  campa_cola_2l: {
    id: 'campa_cola_2l',
    name: 'Campa Cola 2L Bottle',
    category: 'Cold Drinks',
    price: 80,
    stock: 40,
    inStock: true,
    unit: '2 Litre Chilled Bottle',
    image: PRODUCT_IMAGES.cola,
    createdAt: 1700000005000,
  },
  sprite_2l: {
    id: 'sprite_2l',
    name: 'Sprite 2L Bottle',
    category: 'Cold Drinks',
    price: 95,
    stock: 40,
    inStock: true,
    unit: '2 Litre Chilled Bottle',
    image: PRODUCT_IMAGES.limeSoda,
    createdAt: 1700000006000,
  },
  thums_up_2l: {
    id: 'thums_up_2l',
    name: 'Thums Up 2L Bottle',
    category: 'Cold Drinks',
    price: 95,
    stock: 40,
    inStock: true,
    unit: '2 Litre Chilled Bottle',
    image: PRODUCT_IMAGES.cola,
    createdAt: 1700000007000,
  },
};

export const PRODUCT_CATEGORIES: Array<'All' | ProductCategory> = [
  'All',
  'Water Cans',
  'Water Bottles',
  'Cold Drinks',
];

export const EVENT_TIME_SLOTS = [
  'Morning (7:00 AM - 11:00 AM)',
  'Afternoon (12:00 PM - 4:00 PM)',
  'Evening (5:00 PM - 9:00 PM)',
  'Late Night (9:00 PM - 11:30 PM)',
] as const;

export function parseAppRole(search: string): AppRole {
  const params = new URLSearchParams(search);
  const role = params.get('app')?.toLowerCase().trim();
  if (
    role === 'customer' ||
    role === 'rider' ||
    role === 'owner' ||
    role === 'privacy'
  ) {
    return role;
  }
  return 'launcher';
}

export function resolveProductImage(product: Pick<Product, 'name' | 'category' | 'image'>): string {
  if (
    product.image &&
    (isSafeImageDataUrl(product.image) ||
      product.image.startsWith('/src/assets/images/') ||
      product.image.startsWith('/assets/') ||
      product.image.startsWith('https://'))
  ) {
    return product.image;
  }

  const lower = product.name.toLowerCase();
  if (product.category === 'Water Cans') {
    return PRODUCT_IMAGES.waterCan;
  }
  if (product.category === 'Water Bottles') {
    return PRODUCT_IMAGES.bottlePack;
  }
  if (
    lower.includes('sprite') ||
    lower.includes('7up') ||
    lower.includes('limca') ||
    lower.includes('mountain dew') ||
    lower.includes('lime')
  ) {
    return PRODUCT_IMAGES.limeSoda;
  }
  return PRODUCT_IMAGES.cola;
}

export function getNextRiderId(existingRiders: RiderRecord[]): string {
  let maxNumber = 0;
  for (const rider of existingRiders) {
    const match = /^DD(\d+)$/i.exec(rider.id.trim());
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }
  const next = maxNumber + 1;
  return `DD${String(next).padStart(3, '0')}`;
}

export function calculateCartTotals(
  cart: Record<string, number>,
  products: Product[]
): { itemCount: number; subtotal: number } {
  const productMap = new Map(products.map((p) => [p.id, p]));
  let itemCount = 0;
  let subtotal = 0;

  for (const [productId, qty] of Object.entries(cart)) {
    if (qty <= 0) continue;
    const product = productMap.get(productId);
    if (!product) continue;
    itemCount += qty;
    subtotal += product.price * qty;
  }

  return { itemCount, subtotal };
}

export interface CheckoutValidationInput {
  customerName: string;
  customerMobile: string;
  address: string;
  serviceMode: ServiceMode;
  eventDate?: string;
  timeSlot?: string;
  itemCount: number;
}

export function validateCheckoutInput(
  input: CheckoutValidationInput
): Record<string, string> {
  const errors: Record<string, string> = {};
  const trimmedName = input.customerName.trim();
  const digits = input.customerMobile.replace(/\D/g, '');
  const trimmedAddress = input.address.trim();

  if (input.itemCount <= 0) {
    errors.cart = 'Please add at least one item to your cart.';
  }
  if (trimmedName.length < 2) {
    errors.customerName = 'Enter your full name (at least 2 characters).';
  }
  if (!/^\d{10}$/.test(digits)) {
    errors.customerMobile = 'Enter a valid 10-digit mobile number.';
  }
  if (trimmedAddress.length < 8) {
    errors.address = 'Enter your House/Flat No. and a Tolichowki landmark.';
  }
  if (input.serviceMode === 'events') {
    if (!input.eventDate?.trim()) {
      errors.eventDate = 'Select your event date for bulk water supply.';
    }
    if (!input.timeSlot?.trim()) {
      errors.timeSlot = 'Select a preferred delivery time slot.';
    }
  }

  return errors;
}

export interface SalesMetrics {
  todayRevenue: number;
  totalRevenue: number;
  deliveredCount: number;
  pendingCount: number;
  activeCount: number;
}

export function computeSalesMetrics(
  orders: Order[],
  nowMs: number = Date.now()
): SalesMetrics {
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const startOfDayMs = todayStart.getTime();

  let todayRevenue = 0;
  let totalRevenue = 0;
  let deliveredCount = 0;
  let pendingCount = 0;
  let activeCount = 0;

  for (const order of orders) {
    const amount = Number(order.totalAmount) || 0;
    if (order.status === 'DELIVERED') {
      deliveredCount += 1;
      totalRevenue += amount;
      const revenueTimestamp = order.deliveredAt ?? order.updatedAt ?? order.createdAt;
      if (revenueTimestamp >= startOfDayMs) {
        todayRevenue += amount;
      }
    } else if (order.status === 'PENDING') {
      pendingCount += 1;
      activeCount += 1;
    } else if (order.status === 'ACCEPTED' || order.status === 'OUT_FOR_DELIVERY') {
      activeCount += 1;
    }
  }

  return {
    todayRevenue,
    totalRevenue,
    deliveredCount,
    pendingCount,
    activeCount,
  };
}

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function formatTimestamp(ts?: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

export function getStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending Confirmation';
    case 'ACCEPTED':
      return 'Accepted & Packing';
    case 'OUT_FOR_DELIVERY':
      return 'Out for Delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'REJECTED':
      return 'Order Declined';
    default:
      return status;
  }
}

export function sanitizePhoneForTel(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  return cleaned;
}

export function buildGoogleMapsUrl(address: string): string {
  const query = address.toLowerCase().includes('tolichowki')
    ? `${address}, Hyderabad`
    : `${address}, Tolichowki, Hyderabad`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function isSafeImageDataUrl(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  return (
    value.startsWith('data:image/jpeg;base64,') ||
    value.startsWith('data:image/png;base64,') ||
    value.startsWith('data:image/webp;base64,')
  );
}

export function createOrderId(nowMs: number = Date.now()): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const shortTime = String(nowMs).slice(-5);
  return `DD-${shortTime}${suffix}`;
}

export function slugifyProductId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `${base || 'item'}_${String(Date.now()).slice(-4)}`;
}

export interface CustomerOrderSnapshot {
  status: OrderStatus;
  paymentStatus?: 'PENDING' | 'SUCCESSFUL';
}

export interface CustomerOrderAlertEvent {
  orderId: string;
  headline: string;
  detail: string;
}

/**
 * Compares previous tracked customer order states with the latest Firebase orders
 * and returns a clear user-facing alert whenever an order changes status or
 * UPI payment is verified as SUCCESSFUL.
 */
export function detectCustomerOrderChanges(
  previous: Record<string, CustomerOrderSnapshot>,
  currentOrders: Order[]
): CustomerOrderAlertEvent | null {
  for (const order of currentOrders) {
    const prev = previous[order.id];
    if (!prev) continue;

    if (prev.status !== order.status) {
      switch (order.status) {
        case 'ACCEPTED':
          return {
            orderId: order.id,
            headline: `Order ${order.id} Accepted!`,
            detail: order.assignedRiderName
              ? `Assigned to ${order.assignedRiderName}. Preparing your delivery now.`
              : 'DailyDrop Tolichowki accepted your order and is packing it now.',
          };
        case 'OUT_FOR_DELIVERY':
          return {
            orderId: order.id,
            headline: `Order ${order.id} is Out for Delivery!`,
            detail: order.assignedRiderName
              ? `${order.assignedRiderName} is on the way to your doorstep.`
              : 'Your rider is on the way — track live on the map.',
          };
        case 'DELIVERED':
          return {
            orderId: order.id,
            headline: `Order ${order.id} Delivered!`,
            detail: 'Thank you for ordering with DailyDrop Tolichowki.',
          };
        case 'REJECTED':
          return {
            orderId: order.id,
            headline: `Order ${order.id} Update`,
            detail: 'Your order could not be fulfilled. Please check My Orders.',
          };
        default:
          break;
      }
    }

    if (prev.paymentStatus !== 'SUCCESSFUL' && order.paymentStatus === 'SUCCESSFUL') {
      return {
        orderId: order.id,
        headline: `UPI Payment Verified for ${order.id}`,
        detail: `Payment of ${formatRupees(order.totalAmount)} marked SUCCESSFUL.`,
      };
    }
  }

  return null;
}

/**
 * Selects all completed orders (DELIVERED or REJECTED) eligible for weekly cleanup,
 * leaving active orders (PENDING, ACCEPTED, OUT_FOR_DELIVERY) untouched.
 */
export function getCompletedOrdersForCleanup(orders: Order[]): Order[] {
  return orders.filter(
    (order) => order.status === 'DELIVERED' || order.status === 'REJECTED'
  );
}

/**
 * Identifies customer mobile numbers that have no remaining active orders so
 * their stored personal records can be removed during weekly cleanup.
 */
export function getInactiveCustomerMobilesForCleanup(
  orders: Order[],
  customerMobiles: string[]
): string[] {
  const activeMobiles = new Set<string>();
  for (const order of orders) {
    if (
      order.status === 'PENDING' ||
      order.status === 'ACCEPTED' ||
      order.status === 'OUT_FOR_DELIVERY'
    ) {
      activeMobiles.add(order.customerMobile.replace(/\D/g, ''));
    }
  }

  const completedMobiles = new Set<string>();
  for (const order of orders) {
    if (order.status === 'DELIVERED' || order.status === 'REJECTED') {
      completedMobiles.add(order.customerMobile.replace(/\D/g, ''));
    }
  }
  for (const m of customerMobiles) {
    const cleaned = m.replace(/\D/g, '');
    if (cleaned) completedMobiles.add(cleaned);
  }

  return Array.from(completedMobiles).filter((m) => m && !activeMobiles.has(m));
}


