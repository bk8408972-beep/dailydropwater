import React, { useState } from 'react';
import { ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import type { Product, ProductCategory } from '../../types';
import {
  dbDelete,
  dbPatch,
  dbSet,
  sanitizeFirebaseKey,
} from '../../services/firebaseDb';
import {
  formatRupees,
  resolveProductImage,
  slugifyProductId,
} from '../../utils/domain';
import { compressProductImageFile } from '../../utils/imageCompress';
import { ProductImage } from '../ProductImage';

interface StockTabProps {
  products: Product[];
  onNotify: (msg: string) => void;
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
  const [newPrice, setNewPrice] = useState('');
  const [newStock, setNewStock] = useState('50');
  const [newImageDataUrl, setNewImageDataUrl] = useState<string | null>(null);
  const [newImageSizeKb, setNewImageSizeKb] = useState<number | null>(null);
  const [compressingNewPhoto, setCompressingNewPhoto] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-item draft edits & photo upload busy state
  const [drafts, setDrafts] = useState<
    Record<string, { price: string; stock: string }>
  >({});
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
      await dbPatch(`products/${sanitizeFirebaseKey(product.id)}`, {
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

    const trimmed = newName.trim();
    const priceNum = Number(newPrice);
    const stockNum = Number(newStock);

    if (trimmed.length < 2) {
      setFormError('Enter a product name.');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setFormError('Enter a valid price in ₹.');
      return;
    }
    if (!Number.isFinite(stockNum) || stockNum < 0) {
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
        price: Math.round(priceNum),
        stock: Math.round(stockNum),
        inStock: stockNum > 0,
        image:
          newImageDataUrl ||
          resolveProductImage({ name: trimmed, category: newCategory }),
        createdAt: Date.now(),
      };
      await dbSet(`products/${sanitizeFirebaseKey(id)}`, item);
      setNewName('');
      setNewPrice('');
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

  const getDraft = (product: Product) =>
    drafts[product.id] ?? {
      price: String(product.price),
      stock: String(product.stock),
    };

  const setDraftField = (
    product: Product,
    field: 'price' | 'stock',
    value: string
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [product.id]: {
        ...getDraft(product),
        [field]: value,
      },
    }));
  };

  const handleSaveProduct = async (product: Product) => {
    const draft = getDraft(product);
    const priceNum = Number(draft.price);
    const stockNum = Number(draft.stock);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      onNotify('Price must be greater than ₹0.');
      return;
    }
    if (!Number.isFinite(stockNum) || stockNum < 0) {
      onNotify('Stock cannot be negative.');
      return;
    }

    setSavingId(product.id);
    try {
      await dbPatch(`products/${sanitizeFirebaseKey(product.id)}`, {
        price: Math.round(priceNum),
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
      await dbPatch(`products/${sanitizeFirebaseKey(product.id)}`, {
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
      await dbDelete(`products/${sanitizeFirebaseKey(product.id)}`);
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="new-prod-price"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Price (₹)
                </label>
                <input
                  id="new-prod-price"
                  type="number"
                  min={1}
                  required
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="90"
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>
              <div>
                <label
                  htmlFor="new-prod-stock"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Stock
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

            <button
              type="submit"
              disabled={adding || compressingNewPhoto}
              className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{adding ? 'Adding…' : 'Add Item'}</span>
            </button>
          </div>

          {/* Gallery Photo Upload row for New Product */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
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
                Auto-compressed to max 300×300px (&lt;50 KB) for instant Customer
                App loading
              </span>
            )}
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
            const draft = getDraft(product);
            const dirty =
              Number(draft.price) !== product.price ||
              Number(draft.stock) !== product.stock;
            const busy = savingId === product.id;
            const uploadingPhoto = uploadingPhotoId === product.id;

            return (
              <article
                key={product.id}
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
                    <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                      Current: {formatRupees(product.price)} · Qty {product.stock}
                    </p>

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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor={`price-${product.id}`}
                      className="block text-xs font-semibold text-slate-600 mb-1"
                    >
                      Price (₹)
                    </label>
                    <input
                      id={`price-${product.id}`}
                      type="number"
                      min={1}
                      value={draft.price}
                      onChange={(e) =>
                        setDraftField(product, 'price', e.target.value)
                      }
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm font-semibold tabular-nums"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`stock-${product.id}`}
                      className="block text-xs font-semibold text-slate-600 mb-1"
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
                      className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm font-semibold tabular-nums"
                    />
                  </div>
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
