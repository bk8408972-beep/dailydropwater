export interface CompressedImageResult {
  dataUrl: string;
  sizeBytes: number;
  sizeKb: number;
  width: number;
  height: number;
}

const MAX_DIMENSION = 300;
const MAX_TARGET_BYTES = 50 * 1024; // 50 KB cap

export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const base64 = dataUrl.slice(commaIdx + 1);
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * Compresses an uploaded gallery photo via HTML5 Canvas to max 300x300px,
 * JPEG quality 0.7 (stepping down automatically if needed to guarantee < 50 KB).
 */
export async function compressProductImageFile(
  file: File
): Promise<CompressedImageResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPG, PNG, or WebP).');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the selected photo.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read photo from gallery.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Selected image could not be decoded.'));
    element.src = rawDataUrl;
  });

  let maxDim = MAX_DIMENSION;
  const qualities = [0.7, 0.58, 0.46, 0.35];

  let bestDataUrl = '';
  let bestWidth = 0;
  let bestHeight = 0;
  let bestBytes = Infinity;

  for (let pass = 0; pass < 2; pass++) {
    const scale = Math.min(
      1,
      maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)
    );
    const width = Math.max(48, Math.round((img.naturalWidth || maxDim) * scale));
    const height = Math.max(48, Math.round((img.naturalHeight || maxDim) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas compression is unavailable on this browser.');
    }

    // White background so transparent PNGs convert cleanly to JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualities) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      const bytes = estimateDataUrlBytes(candidate);
      bestDataUrl = candidate;
      bestWidth = width;
      bestHeight = height;
      bestBytes = bytes;
      if (bytes <= MAX_TARGET_BYTES) {
        return {
          dataUrl: candidate,
          sizeBytes: bytes,
          sizeKb: Math.max(1, Math.round(bytes / 1024)),
          width,
          height,
        };
      }
    }

    maxDim = 220;
  }

  return {
    dataUrl: bestDataUrl,
    sizeBytes: bestBytes,
    sizeKb: Math.max(1, Math.round(bestBytes / 1024)),
    width: bestWidth,
    height: bestHeight,
  };
}
