import { useState } from 'react';
import { CupSoda, Droplets, Package } from 'lucide-react';
import type { Product } from '../types';
import { resolveProductImage } from '../utils/domain';

interface ProductImageProps {
  product: Pick<Product, 'name' | 'category' | 'image'>;
  className?: string;
}

export function ProductImage({ product, className = '' }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const src = resolveProductImage(product);

  if (failed || !src) {
    const FallbackIcon =
      product.category === 'Cold Drinks'
        ? CupSoda
        : product.category === 'Water Bottles'
          ? Package
          : Droplets;

    return (
      <div
        className={`w-full h-full bg-gradient-to-br from-blue-50 via-cyan-50 to-slate-100 flex flex-col items-center justify-center p-4 text-center ${className}`}
        aria-label={product.name}
      >
        <FallbackIcon className="w-10 h-10 text-blue-700 mb-2" aria-hidden="true" />
        <span className="text-xs font-semibold text-blue-900 line-clamp-2">
          {product.name}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={product.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`w-full h-full object-cover ${className}`}
    />
  );
}
