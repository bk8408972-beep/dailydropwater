import React, { useState } from 'react';
import { ImagePlus, Plus, Save, Tag, Trash2, X } from 'lucide-react';
import type { Product, ProductCategory } from '../../types';
import {
  ownerDeleteProduct,
  ownerPatchProduct,
  ownerSaveProduct,
} from '../../services/firebaseDb';
import {
  formatRupees,
  resolveProductImage,
  slugifyProductId,
} from '../../utils/domain';
import {
  resolveProductPricing,
  validateProductDiscountDraft,
} from '../../utils/discounts';
import { sanitizeTextInput } from '../../utils/security';
import { compressProductImageFile } from '../../utils/imageCompress';
import { ProductImage } from '../ProductImage';

interface StockTabProps {
  products: Product[];
  onNotify: (msg: string) => void;
}

interface ProductDraft {
  originalPrice: string;
  offerPrice: string;
  discountEnabled: boolean;
  stock: string;
}

const CATEGORIES: ProductCategory[] = [
  'Water Cans',
  'Water Bottles',
  'Cold Drinks',
];

export function StockTab({ products, onNotify }: StockTabProps) {
  // Add new product form
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ProductCategory>('Water Cans');
  const [newOriginalPrice, setNewOriginalPrice] = useState('');
  const [newOfferPrice, setNewOfferPrice] = useState('');
  const [newDiscountEnabled, setNewDiscountEnabled] = useState(false);
  const [newStock, setNewStock] = useState('50');
  const [newImageDataUrl, setNewImageDataUrl] = useState<string | null>(null);
  const [newImageSizeKb, setNewImageSizeKb] = useState<number | null>(null);
  const [compressingNewPhoto, setCompressingNewPhoto] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-item draft edits & photo upload busy state
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleNewProductPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFormError(null);
    setCompressingNewPhoto(true);
    try {
      const compressed = await compressProductImageFile(file);
      setNewImageDataUrl(compressed.dataUrl);
      setNewImageSizeKb(compressed.sizeKb);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to compress selected photo.'
      );
    } finally {
      setCompressingNewPhoto(false);
    }
  };

  const handleUploadCardPhoto = async (
    product: Product,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingPhotoId(product.id);
    try {
      const compressed = await compressProductImageFile(file);
      await ownerPatchProduct(product.id, {
        image: compressed.dataUrl,
      });
      onNotify(
        `Updated photo for ${product.name} (${compressed.sizeKb} KB, synced live).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error
          ? err.message
          : 'Failed to upload product photo from gallery.'
      );
    } finally {
      setUploadingPhotoId(null);
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmed = sanitizeTextInput(newName, 100);
    const stockNum = Number(newStock);

    if (trimmed.length < 2) {
      setFormError('Enter a product name.');
      return;
    }

    const mrpNum = Number(newOriginalPrice);
    const offerNum = newOfferPrice.trim() ? Number(newOfferPrice) : mrpNum;
    const validatedPricing = validateProductDiscountDraft({
      originalPrice: mrpNum,
      offerPrice: offerNum,
      discountEnabled: newDiscountEnabled,
    });
    if (!validatedPricing.ok) {
      setFormError(validatedPricing.error);
      return;
    }

    if (!Number.isFinite(stockNum) || stockNum < 0 || stockNum > 100000) {
      setFormError('Enter a valid stock count.');
      return;
    }

    setAdding(true);
    try {
      const id = slugifyProductId(trimmed);
      const item: Product = {
        id,
        name: trimmed,
        category: newCategory,
        price: validatedPricing.activePrice,
        originalPrice: validatedPricing.originalPrice,
        offerPrice: validatedPricing.offerPrice,
        discountEnabled: validatedPricing.discountEnabled,
        stock: Math.round(stockNum),
        inStock: stockNum > 0,
        image:
          newImageDataUrl ||
          resolveProductImage({ name: trimmed, category: newCategory }),
        createdAt: Date.now(),
      };
      await ownerSaveProduct(item);
      setNewName('');
      setNewOriginalPrice('');
      setNewOfferPrice('');
      setNewDiscountEnabled(false);
      setNewStock('50');
      setNewImageDataUrl(null);
      setNewImageSizeKb(null);
      onNotify(`Added "${trimmed}" to live catalog.`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to add product.'
      );
    } finally {
      setAdding(false);
    }
  };

  const getDraft = (product: Product): ProductDraft => {
    if (drafts[product.id]) return drafts[product.id];
    const pricing = resolveProductPricing(product);
    return {
      originalPrice: String(pricing.originalPrice),
      offerPrice: String(pricing.offerPrice),
      discountEnabled: Boolean(product.discountEnabled),
      stock: String(product.stock),
    };
  };

  const setDraftField = <K extends keyof ProductDraft>(
    product: Product,
    field: K,
    value: ProductDraft[K]
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [product.id]: {
        ...getDraft(product),
        [field]: value,
      },
    }));
  };

  const handleToggleDiscount = async (product: Product) => {
    const draft = getDraft(product);
    const nextEnabled = !draft.discountEnabled;

    const mrpNum = Number(draft.originalPrice);
    const offerNum = draft.offerPrice.trim() ? Number(draft.offerPrice) : mrpNum;
    const validated = validateProductDiscountDraft({
      originalPrice: mrpNum,
      offerPrice: offerNum,
      discountEnabled: nextEnabled,
    });

    if (!validated.ok) {
      onNotify(validated.error);
      return;
    }

    setSavingId(product.id);
    try {
      await ownerPatchProduct(product.id, {
        price: validated.activePrice,
        originalPrice: validated.originalPrice,
        offerPrice: validated.offerPrice,
        discountEnabled: validated.discountEnabled,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        if (next[product.id]) {
          next[product.id] = {
            ...next[product.id],
            originalPrice: String(validated.originalPrice),
            offerPrice: String(validated.offerPrice),
            discountEnabled: validated.discountEnabled,
          };
        }
        return next;
      });
      const savings = validated.originalPrice - validated.offerPrice;
      onNotify(
        validated.discountEnabled
          ? `Discount ON for ${product.name}: ${formatRupees(validated.originalPrice)} → ${formatRupees(validated.offerPrice)} (SAVE ${formatRupees(savings)}).`
          : `Discount OFF for ${product.name}: Selling at MRP ${formatRupees(validated.originalPrice)}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update discount.'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveProduct = async (product: Product) => {
    const draft = getDraft(product);
    const mrpNum = Number(draft.originalPrice);
    const offerNum = draft.offerPrice.trim() ? Number(draft.offerPrice) : mrpNum;
    const validated = validateProductDiscountDraft({
      originalPrice: mrpNum,
      offerPrice: offerNum,
      discountEnabled: draft.discountEnabled,
    });
    if (!validated.ok) {
      onNotify(validated.error);
      return;
    }

    const stockNum = Number(draft.stock);
    if (!Number.isFinite(stockNum) || stockNum < 0) {
      onNotify('Stock cannot be negative.');
      return;
    }

    setSavingId(product.id);
    try {
      await ownerPatchProduct(product.id, {
        price: validated.activePrice,
        originalPrice: validated.originalPrice,
        offerPrice: validated.offerPrice,
        discountEnabled: validated.discountEnabled,
        stock: Math.round(stockNum),
        inStock: stockNum > 0 ? product.inStock : false,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      onNotify(`Updated ${product.name}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save product.'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleStock = async (product: Product) => {
    setSavingId(product.id);
    try {
      const nextInStock = !product.inStock;
      await ownerPatchProduct(product.id, {
        inStock: nextInStock,
        stock: nextInStock && product.stock === 0 ? 10 : product.stock,
      });
      onNotify(
        `${product.name} marked ${nextInStock ? 'In Stock' : 'Out of Stock'}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to toggle availability.'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    setSavingId(product.id);
    try {
      await ownerDeleteProduct(product.id);
      setConfirmDeleteId(null);
      onNotify(`Deleted "${product.name}".`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to delete product.'
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section aria-label="Stock and Prices" className="space-y-6">
      {/* Add New Brand / Item */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-3">
          Add New Water or Cold Drink Item
        </h2>
        <form onSubmit={handleAddProduct} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label
                htmlFor="new-prod-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Product / Brand Name
              </label>
              <input
                id="new-prod-name"
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Bailey 20L Water Can"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label
                htmlFor="new-prod-cat"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Category
              </label>
              <select
                id="new-prod-cat"
                value={newCategory}
                onChange={(e) =>
                  setNewCategory(e.target.value as ProductCategory)
                }
                className="w-full min-h-[44px] pl-3 pr-8 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-700"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="new-prod-mrp"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Original Price (MRP ₹)
              </label>
              <input
                id="new-prod-mrp"
                type="number"
                min={1}
                required
                value={newOriginalPrice}
                onChange={(e) => setNewOriginalPrice(e.target.value)}
                placeholder="60"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label
                htmlFor="new-prod-offer"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Offer Price (₹)
              </label>
              <input
                id="new-prod-offer"
                type="number"
                min={1}
                value={newOfferPrice}
                onChange={(e) => setNewOfferPrice(e.target.value)}
                placeholder="40"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label
                htmlFor="new-prod-stock"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Stock Qty
              </label>
              <input
                id="new-prod-stock"
                type="number"
                min={0}
                required
                value={newStock}
                onChange={(e) => setNewStock(e.target.value)}
                placeholder="50"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          {/* Discount toggle + Gallery Photo Upload + Submit row */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={newDiscountEnabled}
                onClick={() => setNewDiscountEnabled((prev) => !prev)}
                className={`min-h-[42px] px-3.5 rounded-xl border font-bold text-xs sm:text-sm inline-flex items-center gap-2 cursor-pointer transition-colors ${
                  newDiscountEnabled
                    ? 'bg-emerald-600 border-emerald-700 text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Tag className="w-4 h-4" aria-hidden="true" />
                <span>Discount: {newDiscountEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <label className="min-h-[42px] px-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-950 font-semibold text-xs sm:text-sm inline-flex items-center gap-2 cursor-pointer transition-colors">
                <ImagePlus className="w-4 h-4 text-cyan-700" aria-hidden="true" />
                <span>
                  {compressingNewPhoto
                    ? 'Compressing photo…'
                    : 'Upload Photo from Gallery'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleNewProductPhoto}
                  className="sr-only"
                />
              </label>

              {newImageDataUrl ? (
                <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                  <img
                    src={newImageDataUrl}
                    alt="Compressed product preview"
                    className="w-10 h-10 rounded-lg object-cover border border-slate-200"
                  />
                  <span className="text-xs font-semibold text-emerald-700 tabular-nums">
                    Ready ({newImageSizeKb ?? '<50'} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNewImageDataUrl(null);
                      setNewImageSizeKb(null);
                    }}
                    aria-label="Remove uploaded new product photo"
                    className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <span className="text-xs text-slate-500">
                  Auto-compressed (&lt;50 KB) for instant Customer App loading
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={adding || compressingNewPhoto}
              className="min-h-[44px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{adding ? 'Adding…' : 'Add Item'}</span>
            </button>
          </div>
        </form>

        {formError && (
          <p role="alert" className="text-xs text-red-600 font-semibold mt-2">
            {formError}
          </p>
        )}
      </div>

      {/* Live Inventory Grid */}
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900 mb-3">
          Live Catalog Inventory ({products.length})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {products.map((product) => {
            const pricing = resolveProductPricing(product);
            const draft = getDraft(product);
            const dirty =
              Number(draft.originalPrice) !== pricing.originalPrice ||
              Number(draft.offerPrice) !== pricing.offerPrice ||
              draft.discountEnabled !== Boolean(product.discountEnabled) ||
              Number(draft.stock) !== product.stock;
            const busy = savingId === product.id;
            const uploadingPhoto = uploadingPhotoId === product.id;
            const draftMrpNum = Number(draft.originalPrice);
            const draftOfferNum = Number(draft.offerPrice);
            const draftSavings =
              Number.isFinite(draftMrpNum) &&
              Number.isFinite(draftOfferNum) &&
              draftOfferNum > 0 &&
              draftOfferNum < draftMrpNum
                ? Math.round(draftMrpNum - draftOfferNum)
                : 0;

            return (
              <article
                key={product.id}
                data-testid={`owner-product-card-${product.id}`}
                className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                    <ProductImage product={product} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-500 font-medium">
                      {product.category} ·{' '}
                      <span
                        className={
                          product.inStock && product.stock > 0
                            ? 'text-emerald-700 font-bold'
                            : 'text-red-600 font-bold'
                        }
                      >
                        {product.inStock && product.stock > 0
                          ? 'In Stock'
                          : 'Out of Stock'}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-900 leading-snug mt-0.5">
                      {product.name}
                    </h3>
                    <div className="text-xs text-slate-600 tabular-nums mt-0.5 flex flex-wrap items-center gap-1.5">
                      {pricing.isDiscountActive ? (
                        <>
                          <span className="line-through text-slate-400">
                            {formatRupees(pricing.originalPrice)}
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatRupees(pricing.effectivePrice)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold text-[11px]">
                            SAVE {formatRupees(pricing.savingsPerUnit)}
                          </span>
                        </>
                      ) : (
                        <span>
                          Selling: <strong>{formatRupees(pricing.effectivePrice)}</strong>
                        </span>
                      )}
                      <span>· Qty {product.stock}</span>
                    </div>

                    <label className="mt-2 min-h-[38px] px-3 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-950 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors">
                      <ImagePlus className="w-3.5 h-3.5 text-cyan-700" aria-hidden="true" />
                      <span>
                        {uploadingPhoto
                          ? 'Uploading…'
                          : 'Upload Photo from Gallery'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingPhoto}
                        onChange={(e) => void handleUploadCardPhoto(product, e)}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                {/* Owner-Only Discount & Pricing Controls */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <Tag className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>Product Pricing &amp; Offer Discount</span>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.discountEnabled}
                      disabled={busy}
                      data-testid={`owner-discount-toggle-${product.id}`}
                      onClick={() => void handleToggleDiscount(product)}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 ${
                        draft.discountEnabled
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                      }`}
                    >
                      <span>Discount: {draft.discountEnabled ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label
                        htmlFor={`mrp-${product.id}`}
                        className="block text-[11px] font-semibold text-slate-600 mb-1"
                      >
                        Original Price (MRP ₹)
                      </label>
                      <input
                        id={`mrp-${product.id}`}
                        data-testid={`owner-mrp-input-${product.id}`}
                        type="number"
                        min={1}
                        value={draft.originalPrice}
                        onChange={(e) =>
                          setDraftField(product, 'originalPrice', e.target.value)
                        }
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold tabular-nums text-slate-900"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`offer-${product.id}`}
                        className="block text-[11px] font-semibold text-slate-600 mb-1"
                      >
                        Offer Price (₹)
                      </label>
                      <input
                        id={`offer-${product.id}`}
                        data-testid={`owner-offer-input-${product.id}`}
                        type="number"
                        min={1}
                        value={draft.offerPrice}
                        onChange={(e) =>
                          setDraftField(product, 'offerPrice', e.target.value)
                        }
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold tabular-nums text-slate-900"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`stock-${product.id}`}
                        className="block text-[11px] font-semibold text-slate-600 mb-1"
                      >
                        Stock Qty
                      </label>
                      <input
                        id={`stock-${product.id}`}
                        type="number"
                        min={0}
                        value={draft.stock}
                        onChange={(e) =>
                          setDraftField(product, 'stock', e.target.value)
                        }
                        className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold tabular-nums text-slate-900"
                      />
                    </div>
                  </div>

                  {draft.discountEnabled && draftSavings > 0 ? (
                    <p className="text-[11px] font-bold text-emerald-700 tabular-nums">
                      Customer sees: <span className="line-through text-slate-400">{formatRupees(draftMrpNum)}</span>{' '}
                      <span className="text-slate-900">{formatRupees(draftOfferNum)}</span> ·{' '}
                      SAVE {formatRupees(draftSavings)} badge
                    </p>
                  ) : draft.discountEnabled && draftSavings <= 0 ? (
                    <p className="text-[11px] font-semibold text-amber-700">
                      Set Offer Price lower than MRP to activate savings badge.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Turn Discount ON to show strikethrough MRP, Offer Price &amp; SAVE badge to customers.
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleStock(product)}
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-bold cursor-pointer ${
                        product.inStock
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {product.inStock ? 'Mark Out of Stock' : 'Mark In Stock'}
                    </button>

                    {dirty && (
                      <button
                        type="button"
                        disabled={busy}
                        data-testid={`owner-save-product-${product.id}`}
                        onClick={() => void handleSaveProduct(product)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Save</span>
                      </button>
                    )}
                  </div>

                  {confirmDeleteId === product.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteProduct(product)}
                        className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[36px] px-2.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(product.id)}
                      aria-label={`Delete ${product.name}`}
                      className="min-h-[40px] px-2.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

