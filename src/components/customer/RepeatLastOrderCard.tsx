import { RotateCcw, ShoppingBag } from 'lucide-react';
import type { Order } from '../../types';
import { formatTimestamp } from '../../utils/domain';
import { formatOrderIdLabel } from '../../utils/orderSequence';

interface RepeatLastOrderCardProps {
  lastOrder: Order;
  onReorderNow: () => void;
  disabled?: boolean;
}

export function RepeatLastOrderCard({
  lastOrder,
  onReorderNow,
  disabled = false,
}: RepeatLastOrderCardProps) {
  const itemSummary = lastOrder.items
    .map((item) => `${item.quantity} × ${item.name}`)
    .join(', ');

  return (
    <section
      aria-label="Repeat Last Order"
      data-testid="repeat-last-order-card"
      className="mb-5 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-cyan-50 p-4 sm:p-5 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900">
                Repeat Last Order
              </h2>
              <span className="text-[11px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-md tabular-nums">
                {formatOrderIdLabel(lastOrder)} · {formatTimestamp(lastOrder.createdAt)}
              </span>
            </div>
            <p
              data-testid="repeat-last-order-summary"
              className="text-xs sm:text-sm text-slate-700 font-medium mt-1 line-clamp-2"
            >
              {itemSummary}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Verifies latest live prices &amp; stock before checkout
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          data-testid="repeat-last-order-btn"
          onClick={onReorderNow}
          className="min-h-[46px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-2 shrink-0 cursor-pointer transition-all disabled:opacity-50"
        >
          <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Reorder Now</span>
        </button>
      </div>
    </section>
  );
}
