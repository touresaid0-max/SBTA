/**
 * Photos of the parcels (audit m3).
 *
 * Before: the photo component sent the raw photo (up to 10 MB) straight to a PUBLIC storage
 * space, online only; the photos could be read by anyone who had their link.
 *
 * Now:
 * - the photo is reduced on the device (utils/imageCompression.ts) and kept in the device's
 *   database with the parcel (table photos), so that a parcel can be registered with its photos
 *   without network;
 * - it is sent by the courrier's sending queue (entity "photos"), after the parcel, to the
 *   PRIVATE storage space courrier-photos; once sent, the image is removed from the device;
 * - the parcel keeps the paths of its photos (parcel_photos); they are shown with signed links
 *   valid for one hour, and from the device's copy while it has not been sent.
 */
import { useEffect, useState } from 'react';
import { db } from './db';
import { supabase } from '@/services/supabase';
import { RefusedByServer } from '@/services/offline/queueRules';

export const PHOTO_BUCKET = 'courrier-photos';
export const MAX_PARCEL_PHOTOS = 3;
const SIGNED_URL_SECONDS = 3600;

/** <author id>/<parcel id>/<photo id>.jpg — the author's folder is required by the storage rules. */
export function photoPath(authorId: string, parcelId: string, photoId: string): string {
  return `${authorId}/${parcelId}/${photoId}.jpg`;
}

/** Id of a photo from its path (the file name without .jpg). */
export function photoIdOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.jpg$/, '');
}

function isAlreadyStored(err: { statusCode?: string; status?: number; message?: string }): boolean {
  return err.statusCode === '409' || err.status === 409 || /already exists|duplicate/i.test(err.message ?? '');
}

/**
 * Sends one queued photo. A second attempt after an interrupted send is harmless: a photo already
 * stored is taken as sent. A refusal of the storage rules is final (not sent again by itself).
 */
export async function uploadQueuedPhoto(photoId: string): Promise<void> {
  const record = await db.photos.get(photoId);
  if (!record || record.uploaded) return;
  if (!record.blob) throw new RefusedByServer('Photo absente de ce poste (données effacées) : impossible de l\'envoyer');

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(record.path, record.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error && !isAlreadyStored(error as never)) {
    const status = Number((error as { status?: number; statusCode?: string }).status ?? (error as { statusCode?: string }).statusCode ?? 0);
    // 4xx other than timeout / too many requests: the same photo would be refused again
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw new RefusedByServer(`Photo refusée par le serveur : ${error.message}`);
    }
    throw error;
  }
  // Sent: the image leaves the device (its storage is limited), the path stays
  await db.photos.update(photoId, { uploaded: true, blob: undefined });
}

/**
 * Links to show the photos of a parcel, in the same order: the device's copy while it has not
 * been sent, a signed link (1 h) for a photo of the private space, and the link itself for an
 * older public photo. '' when a photo cannot be shown (not sent yet from another device, no network).
 */
export async function resolvePhotoUrls(entries: string[]): Promise<{ urls: string[]; revoke: () => void }> {
  const urls = entries.map(() => '');
  const objectUrls: string[] = [];
  const toSign: { index: number; path: string }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (/^https?:\/\//.test(entry)) { urls[i] = entry; continue; }
    const local = await db.photos.get(photoIdOf(entry)).catch(() => undefined);
    if (local?.blob) {
      const url = URL.createObjectURL(local.blob);
      objectUrls.push(url);
      urls[i] = url;
    } else {
      toSign.push({ index: i, path: entry });
    }
  }

  if (toSign.length > 0) {
    try {
      const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(toSign.map(t => t.path), SIGNED_URL_SECONDS);
      (data ?? []).forEach((d, k) => { if (d?.signedUrl) urls[toSign[k].index] = d.signedUrl; });
    } catch { /* no network: those photos are shown as unavailable */ }
  }

  return { urls, revoke: () => objectUrls.forEach(u => URL.revokeObjectURL(u)) };
}

/** React hook around resolvePhotoUrls. */
export function usePhotoUrls(entries: string[] | null | undefined): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const key = (entries ?? []).join('|');
  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (list.length === 0) { setUrls([]); return; }
    let cancelled = false;
    let revoke = () => {};
    void resolvePhotoUrls(list).then(r => {
      if (cancelled) { r.revoke(); return; }
      revoke = r.revoke;
      setUrls(r.urls);
    });
    return () => { cancelled = true; revoke(); };
  }, [key]);
  return urls;
}
