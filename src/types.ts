export type AppRole = 'launcher' | 'customer' | 'rider' | 'owner' | 'privacy';

export type ProductCategory = 'Water Cans' | 'Water Bottles' | 'Cold Drinks';

export type ServiceMode = 'fast' | 'events';

export type PaymentMethod = 'Cash on Delivery' | 'UPI on Delivery';

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'REJECTED';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
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

export interface Order {
  id: string;
  customerName: string;
  customerMobile: string;
  address: string;
  customerLocation?: GeoPoint | null;
  serviceMode: ServiceMode;
  eventDetails?: EventDetails | null;
  paymentMethod: PaymentMethod;
  paymentStatus?: 'PENDING' | 'SUCCESSFUL';
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  assignedRiderId?: string | null;
  assignedRiderName?: string | null;
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
