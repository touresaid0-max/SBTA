/**
 * Photos taken at the counter (audit m3): a phone photo weighs 3 to 12 MB, which a station's
 * connection takes minutes to send and the device's storage keeps until it is sent. Photos are
 * reduced on the device before being kept: longest side PHOTO_MAX_SIDE pixels, JPEG — about
 * 200 to 600 kB, enough to read a label or check the state of a parcel.
 */

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Larger files are refused before decoding (they would freeze a low-end device). */
export const PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap applies the photo's orientation (portrait photos from a phone)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall back to an <img> element */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Reduced JPEG copy of a photo. Throws a message for the guichetier when it cannot be read. */
export async function compressImage(file: Blob, maxSide = PHOTO_MAX_SIDE, quality = PHOTO_JPEG_QUALITY): Promise<Blob> {
  if (file.size > PHOTO_MAX_INPUT_BYTES) {
    throw new Error('Photo trop lourde (25 Mo au maximum).');
  }
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(file);
  } catch {
    throw new Error('Format de photo non pris en charge : utilisez une photo JPEG ou PNG.');
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Réduction de la photo impossible sur cet appareil.');
    // White behind transparent PNGs (JPEG has no transparency)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Réduction de la photo impossible sur cet appareil.');
    return blob;
  } finally {
    image.close();
  }
}
