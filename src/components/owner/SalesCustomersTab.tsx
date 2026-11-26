import { useMemo, useState } from 'react';
import { Copy, Phone, Trash2 } from 'lucide-react';
import type { CustomerRecord, Order } from '../../types';
import { ownerDeleteCustomer } from '../../services/firebaseDb';
import {
  computeSalesMetrics,
  formatRupees,
  formatTimestamp,
} from '../../utils/domain';
import {
  buildPhoneCallUrl,
  copyPhoneNumber,
  formatDisplayPhone10,
} from '../../utils/androidIntents';

interface SalesCustomersTabProps {
  orders: Order[];
  customers: CustomerRecord[];
  onNotify: (msg: string) => void;
}

export function SalesCustomersTab({
  orders,
  customers,
  onNotify,
}: SalesCustomersTabProps) {
  const [confirmDeleteMobile, setConfirmDeleteMobile] = useState<string | null>(
    null
  );

  const metrics = useMemo(() => computeSalesMetrics(orders), [orders]);

  const handleDeleteCustomer = async (customer: CustomerRecord) => {
    try {
      await ownerDeleteCustomer(customer.mobile);
      setConfirmDeleteMobile(null);
      onNotify(`Removed customer ${customer.name} (${customer.mobile}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to delete customer.'
      );
    }
  };

  return (
    <section aria-label="Sales and Customers" className="space-y-6">
      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-500">
            Today&apos;s Revenue
          </p>
          <p className="font-display text-3xl font-extrabold text-blue-800 tabular-nums mt-1">
            {formatRupees(metrics.todayRevenue)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            All-time delivered: {formatRupees(metrics.totalRevenue)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-500">
            Delivered Orders
          </p>
          <p className="font-display text-3xl font-extrabold text-emerald-700 tabular-nums mt-1">
            {metrics.deliveredCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Completed local drops
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-500">
            Pending Orders
          </p>
          <p className="font-display text-3xl font-extrabold text-amber-600 tabular-nums mt-1">
            {metrics.pendingCount}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Total active pipeline: {metrics.activeCount}
          </p>
        </div>
      </div>

      {/* Customer Directory */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Customer Directory ({customers.length})
            </h2>
            <p className="text-xs text-slate-500">
              Saved automatically from customer orders · 1-tap call
            </p>
          </div>
        </div>

        {customers.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No customer records yet. Customers are saved automatically when an
            order is placed.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {customers.map((customer) => {
              return (
                <div
                  key={customer.mobile}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {customer.name}
                      </h3>
                      <span className="text-xs font-semibold text-blue-700 tabular-nums">
                        {customer.mobile}
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {customer.totalOrders}{' '}
                        {customer.totalOrders === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {customer.lastAddress}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Last order: {formatTimestamp(customer.lastOrderAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <a
                      href={buildPhoneCallUrl(customer.mobile)}
                      className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Call {formatDisplayPhone10(customer.mobile)}</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => void copyPhoneNumber(customer.mobile, onNotify)}
                      aria-label={`Copy phone number for ${customer.name}`}
                      className="min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                      <span>Copy Number</span>
                    </button>

                    {confirmDeleteMobile === customer.mobile ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDeleteCustomer(customer)}
                          className="min-h-[42px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteMobile(null)}
                          className="min-h-[42px] px-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMobile(customer.mobile)}
                        aria-label={`Delete customer ${customer.name}`}
                        className="min-h-[42px] px-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
