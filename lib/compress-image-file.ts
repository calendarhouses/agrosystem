/**
 * Стискає фото на клієнті перед відправкою в /api/agent
 * (Vercel body ≈ 4.5 МБ — два iPhone-фото без стиснення легко перевищують).
 */

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_TARGET_BYTES = 450 * 1024;
const DEFAULT_QUALITY = 0.72;
const MIN_QUALITY = 0.45;

function renameToJpeg(name: string): string {
  const base = name.replace(/\.[^.]+$/i, "") || "photo";
  return `${base}.jpg`;
}

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

function drawToCanvas(
  source: ImageBitmap | HTMLImageElement,
  maxEdge: number
): HTMLCanvasElement {
  const w = "width" in source ? source.width : 0;
  const h = "height" in source ? source.height : 0;
  const longest = Math.max(w, h) || 1;
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D недоступний");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("toBlob повернув null"));
        else resolve(blob);
      },
      type,
      quality
    );
  });
}

/**
 * Повертає JPEG (або дрібний оригінал). PDF / не-зображення — без змін.
 * Якщо декодування не вдалось (HEIC тощо) — оригінал.
 */
export async function compressImageFile(
  file: File,
  options?: {
    maxEdge?: number;
    targetBytes?: number;
    quality?: number;
  }
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (
    file.type === "image/gif" ||
    file.type === "image/svg+xml" ||
    file.type === "image/heic" ||
    file.type === "image/heif"
  ) {
    return file;
  }

  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const targetBytes = options?.targetBytes ?? DEFAULT_TARGET_BYTES;
  const startQuality = options?.quality ?? DEFAULT_QUALITY;

  // Вже досить маленьке і не гігантське по стороні — лишаємо
  // (все одно прогоняємо через canvas, якщо > target, щоб зняти EXIF/вагу)
  if (file.size <= targetBytes) {
    try {
      const bitmap = await blobToImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      bitmap.close();
      if (longest <= maxEdge) return file;
    } catch {
      return file;
    }
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await blobToImageBitmap(file);
    const canvas = drawToCanvas(bitmap, maxEdge);
    bitmap.close();
    bitmap = null;

    const outType = "image/jpeg";
    let quality = startQuality;
    let blob = await canvasToBlob(canvas, outType, quality);

    while (blob.size > targetBytes && quality > MIN_QUALITY + 0.01) {
      quality = Math.max(MIN_QUALITY, quality - 0.08);
      blob = await canvasToBlob(canvas, outType, quality);
    }

    // Якщо стиснення вийшло більше за оригінал — лишаємо оригінал
    if (blob.size >= file.size) return file;

    return new File([blob], renameToJpeg(file.name), {
      type: outType,
      lastModified: Date.now(),
    });
  } catch {
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
    return file;
  }
}

export async function compressAgentFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      out.push(await compressImageFile(file));
    } else {
      out.push(file);
    }
  }
  return out;
}

/** Для UI / дебагу */
export function formatFileKib(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} КБ`;
}
