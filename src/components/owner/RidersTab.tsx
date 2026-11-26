import React, { useState } from 'react';
import {
  Camera,
  Copy,
  MapPin,
  Phone,
  Plus,
  ShieldBan,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { RiderRecord } from '../../types';
import {
  dbDelete,
  dbPatch,
  dbSet,
  sanitizeFirebaseKey,
} from '../../services/firebaseDb';
import {
  formatTimestamp,
  getNextRiderId,
  isSafeImageDataUrl,
} from '../../utils/domain';
import { formatRelativeTime, isValidGeoPoint } from '../../utils/geo';
import {
  buildPhoneCallUrl,
  copyPhoneNumber,
  formatDisplayPhone10,
} from '../../utils/androidIntents';
import { LiveFleetMap } from './LiveFleetMap';

interface RidersTabProps {
  riders: RiderRecord[];
  onNotify: (msg: string) => void;
}

export function RidersTab({ riders, onNotify }: RidersTabProps) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [zoomSelfie, setZoomSelfie] = useState<{
    name: string;
    id: string;
    src: string;
    time?: number | null;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [focusedRiderId, setFocusedRiderId] = useState<string | null>(null);

  const nextId = getNextRiderId(riders);

  const handleAddRider = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const digits = mobile.replace(/\D/g, '');
    const trimmedPassword = password.trim();

    if (trimmedName.length < 2) {
      setFormError('Enter rider full name.');
      return;
    }
    if (!/^\d{10}$/.test(digits)) {
      setFormError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (trimmedPassword.length < 4) {
      setFormError('Password must be at least 4 characters.');
      return;
    }

    setSaving(true);
    try {
      const id = getNextRiderId(riders);
      const record: RiderRecord = {
        id,
        name: trimmedName,
        mobile: digits,
        password: trimmedPassword,
        isActive: true,
        isOnline: false,
        lastSelfie: null,
        dutyOnTime: null,
        createdAt: Date.now(),
      };
      await dbSet(`riders/${sanitizeFirebaseKey(id)}`, record);
      setName('');
      setMobile('');
      setPassword('');
      onNotify(`Added Rider ${trimmedName} with ID ${id}.`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to create rider.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rider: RiderRecord) => {
    try {
      const nextActive = !rider.isActive;
      await dbPatch(`riders/${sanitizeFirebaseKey(rider.id)}`, {
        isActive: nextActive,
        ...(nextActive ? {} : { isOnline: false }),
      });
      onNotify(
        nextActive
          ? `Unblocked Rider ${rider.name} (${rider.id}).`
          : `Blocked Rider ${rider.name} (${rider.id}).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update rider status.'
      );
    }
  };

  const handleDeleteRider = async (rider: RiderRecord) => {
    try {
      await dbDelete(`riders/${sanitizeFirebaseKey(rider.id)}`);
      setConfirmDeleteId(null);
      onNotify(`Removed Rider ${rider.name} (${rider.id}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to remove rider.'
      );
    }
  };

  return (
    <section aria-label="Riders and Live Duty" className="space-y-6">
      {/* Embedded Live Fleet Map for all Duty-ON riders */}
      <LiveFleetMap
        riders={riders}
        focusedRiderId={focusedRiderId}
        onFocusRider={setFocusedRiderId}
      />

      {/* Add New Rider Form */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Add Delivery Rider
            </h2>
            <p className="text-xs text-slate-500">
              Next auto-assigned Rider ID:{' '}
              <strong className="font-mono text-blue-700">{nextId}</strong>
            </p>
          </div>
        </div>

        <form
          onSubmit={handleAddRider}
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label
              htmlFor="new-rider-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Rider Name
            </label>
            <input
              id="new-rider-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mohammed Imran"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label
              htmlFor="new-rider-mobile"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              10-Digit Mobile
            </label>
            <input
              id="new-rider-mobile"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              required
              value={mobile}
              onChange={(e) =>
                setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
              }
              placeholder="9848012345"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label
              htmlFor="new-rider-password"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Login Password
            </label>
            <input
              id="new-rider-password"
              type="text"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 4 characters"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{saving ? 'Adding…' : `Add ${nextId}`}</span>
          </button>
        </form>

        {formError && (
          <p role="alert" className="text-xs text-red-600 font-semibold mt-2">
            {formError}
          </p>
        )}
      </div>

      {/* Live Riders & Duty Selfie Directory */}
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900 mb-3">
          Riders &amp; Live Duty Selfies ({riders.length})
        </h2>

        {riders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <p className="font-semibold text-slate-900">No riders added yet.</p>
            <p className="text-sm text-slate-500 mt-1">
              Add your first rider above to generate ID DD001 and enable live
              order dispatch.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {riders.map((rider) => {
              const hasSelfie = isSafeImageDataUrl(rider.lastSelfie);

              return (
                <article
                  key={rider.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start gap-4">
                    {hasSelfie ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomSelfie({
                            name: rider.name,
                            id: rider.id,
                            src: rider.lastSelfie!,
                            time: rider.dutyOnTime,
                          })
                        }
                        aria-label={`View full duty selfie for ${rider.name}`}
                        className="w-20 h-20 rounded-2xl overflow-hidden border border-slate-200 shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                      >
                        <img
                          src={rider.lastSelfie!}
                          alt={`${rider.name} duty selfie`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-slate-100 text-slate-400 flex flex-col items-center justify-center shrink-0 text-[11px] font-medium text-center p-1">
                        <Camera className="w-5 h-5 mb-1" aria-hidden="true" />
                        <span>No Selfie</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">
                          {rider.id}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            !rider.isActive
                              ? 'text-red-600'
                              : rider.isOnline
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {!rider.isActive
                            ? 'Blocked'
                            : rider.isOnline
                              ? 'Duty ON'
                              : 'Duty OFF'}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-bold text-slate-900 truncate">
                        {rider.name}
                      </h3>
                      <p className="text-xs text-slate-600 tabular-nums mt-0.5">
                        Mobile: {rider.mobile} · Pass: {rider.password}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Duty Check-In: {formatTimestamp(rider.dutyOnTime)}
                      </p>
                      {rider.isOnline && (
                        <p className="text-xs font-semibold text-cyan-700 mt-0.5 tabular-nums">
                          Live GPS:{' '}
                          {isValidGeoPoint(rider.liveLocation)
                            ? formatRelativeTime(rider.liveLocation.updatedAt)
                            : 'Waiting for rider GPS…'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {rider.isOnline && isValidGeoPoint(rider.liveLocation) && (
                        <button
                          type="button"
                          onClick={() => {
                            setFocusedRiderId(rider.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="min-h-[40px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Focus Map</span>
                        </button>
                      )}
                      <a
                        href={buildPhoneCallUrl(rider.mobile)}
                        className="min-h-[40px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold tabular-nums flex items-center gap-1.5 transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                        <span>Call {formatDisplayPhone10(rider.mobile)}</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => void copyPhoneNumber(rider.mobile, onNotify)}
                        aria-label={`Copy phone number for ${rider.name}`}
                        className="min-h-[40px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                        <span>Copy Number</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleToggleActive(rider)}
                        className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                          rider.isActive
                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-900'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {rider.isActive ? (
                          <>
                            <ShieldBan className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Block Rider</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Activate</span>
                          </>
                        )}
                      </button>
                    </div>

                    {confirmDeleteId === rider.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleDeleteRider(rider)}
                          className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                        >
                          Remove
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
                        onClick={() => setConfirmDeleteId(rider.id)}
                        aria-label={`Delete rider ${rider.name}`}
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
        )}
      </div>

      {/* Selfie Lightbox */}
      {zoomSelfie && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Rider Duty Selfie Preview"
        >
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-slate-900">
                  {zoomSelfie.name} ({zoomSelfie.id})
                </p>
                <p className="text-xs text-slate-500">
                  Duty ON: {formatTimestamp(zoomSelfie.time)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomSelfie(null)}
                aria-label="Close selfie preview"
                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={zoomSelfie.src}
              alt={`${zoomSelfie.name} live duty selfie`}
              className="w-full aspect-square object-cover"
            />
          </div>
        </div>
      )}
    </section>
  );
}
