export type AppRole = 'launcher' | 'customer' | 'rider' | 'owner' | 'privacy';

export type ProductCategory = 'Water Cans' | 'Water Bottles' | 'Cold Drinks';

export type ServiceMode = 'fast' | 'events';

export type PaymentMethod = 'Cash on Delivery' | 'UPI';

export type FloorLevel = 'ground_1st' | 'floor_2' | 'floor_3_plus';

export interface StoreSettings {
  isOpen: boolean;
  autoAssign: boolean;
  platformFee: number;
  deliveryFee: number;
  floor2Charge: number;
  floor3PlusCharge: number;
  radiusEnabled: boolean;
  deliveryRadiusKm: number;
  storeLat: number;
  storeLng: number;
  upiEnabled: boolean;
  codEnabled: boolean;
  upiId: string;
  upiName: string;
  minOrderAmount: number;
  bulkOrdersEnabled: boolean;
  supportMobile: string;
  supportEmail: string;
  congratsPopupSeconds: number;
  promoBannerEnabled: boolean;
  promoBannerText: string;
  promoBannerButtonText: string;
  promoBannerActionUrl: string;
  promoBannerIntervalMinutes: number;
  promoBannerPhone: string;
  updatedAt?: number;
}

export type BulkBookingStatus = 'pending' | 'accepted' | 'rejected';

export interface BulkBookingRequest {
  id: string;
  customerName: string;
  customerMobile: string;
  address: string;
  quantity: number;
  eventDate: string;
  timeSlot: string;
  notes?: string;
  status: BulkBookingStatus;
  createdAt: number;
  updatedAt: number;
}

export type CanonicalOrderStatus =
  | 'pending'
  | 'assigned'
  | 'unassigned'
  | 'accepted'
  | 'reached_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected';

export type OrderStatus =
  | CanonicalOrderStatus
  | 'placed'
  | 'PLACED'
  | 'PENDING'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'ACCEPTED'
  | 'REACHED_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'REJECTED';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  originalPrice?: number;
  offerPrice?: number;
  discountEnabled?: boolean;
  stock: number;
  inStock: boolean;
  unit?: string;
  image?: string;
  createdAt?: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  originalPrice?: number;
  savingsPerUnit?: number;
  quantity: number;
  category: ProductCategory;
}

export interface EventDetails {
  eventDate: string;
  timeSlot: string;
  notes: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RiderLiveLocation extends GeoPoint {
  updatedAt: number;
}

export interface DailyOrderCounterState {
  date: string; // YYYY-MM-DD in IST (UTC+5:30)
  count: number;
  updatedAt: number;
}

export interface Order {
  id: string;
  orderNumber?: number | null;
  orderDateIst?: string | null;
  customerName: string;
  customerMobile: string;
  address: string;
  customerLat?: number | null;
  customerLng?: number | null;
  customerLocation?: GeoPoint | null;
  gpsStatus?: 'captured' | 'address_only';
  riderLat?: number | null;
  riderLng?: number | null;
  riderLocationUpdatedAt?: number | null;
  deliveryPhoto?: string | null;
  ownerApproved?: boolean;
  assignedAt?: number | null;
  timedOutAt?: number | null;
  lastTimedOutRiderId?: string | null;
  lastTimedOutRiderName?: string | null;
  riderAcceptedAt?: number | null;
  reachedPickupAt?: number | null;
  pickedUpAt?: number | null;
  serviceMode: ServiceMode;
  eventDetails?: EventDetails | null;
  paymentMethod: PaymentMethod | string;
  upiUtr?: string | null;
  upiVerified?: boolean;
  upiVerifiedAt?: number | null;
  floorLevel?: FloorLevel | null;
  hasLift?: boolean | null;
  itemsSubtotal?: number;
  totalSavings?: number;
  platformFee?: number;
  deliveryFee?: number;
  floorCharge?: number;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  autoAssigned?: boolean;
  assignedRiderId?: string | null;
  assignedRiderName?: string | null;
  assignedRiderPhone?: string | null;
  assignedRiderMobile?: string | null;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number | null;
}

export interface CustomerRecord {
  mobile: string;
  name: string;
  lastAddress: string;
  totalOrders: number;
  lastOrderAt: number;
}

export interface RiderRecord {
  id: string;
  name: string;
  mobile: string;
  password: string;
  isActive: boolean;
  isOnline: boolean;
  lastSelfie?: string | null;
  dutyOnTime?: number | null;
  liveLocation?: RiderLiveLocation | null;
  createdAt: number;
}

export interface OwnerAuthConfig {
  password: string;
  updatedAt?: number;
}

export interface CustomerProfile {
  name: string;
  mobile: string;
  address: string;
  updatedAt: number;
}

export interface ArchivedTransactionSummary {
  orderId: string;
  orderNumber?: number | null;
  createdAt: number;
  deliveredAt?: number | null;
  status: string;
  paymentMethod: string;
  upiUtr?: string | null;
  upiVerified?: boolean;
  totalAmount: number;
  floorCharge: number;
  assignedRiderId?: string | null;
  assignedRiderName?: string | null;
}

export interface WeeklyArchiveRecord {
  id: string;
  archivedAt: number;
  trigger: 'auto_7_day' | 'owner_manual_weekly' | 'owner_manual_rider';
  riderIdScope?: string | null;
  orderCount: number;
  deliveredCount: number;
  rejectedCount: number;
  totalRevenue: number;
  codRevenue: number;
  upiRevenue: number;
  transactions: ArchivedTransactionSummary[];
}
