import { calculateCustomDimensions, calculateSheetLayout, mmToPixels } from './dimensions';
import type { AdjustmentSettings, BackgroundSettings, CropAreaPixels, ExportFormat } from '../types/editor';

export type CanvasRendererErrorCode =
  | 'MISSING_IMAGE'
  | 'MISSING_CROP_AREA'
  | 'CANVAS_UNAVAILABLE'
  | 'BLOB_EXPORT_FAILED'
  | 'PHOTO_DOES_NOT_FIT'
  | 'IMAGE_LOAD_FAILED';

export class CanvasRendererError extends Error {
  constructor(
    public readonly code: CanvasRendererErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasRendererError';
  }
}

export interface PhysicalPhotoSize {
  widthMm: number;
  heightMm: number;
  dpi: number;
}

export interface SheetOptions {
  dpi: number;
  marginMm?: number;
  gapMm?: number;
  sheetWidthMm?: number;
  sheetHeightMm?: number;
}

export interface RenderCroppedPhotoOptions {
  image: CanvasImageSource | string | null | undefined;
  croppedAreaPixels: CropAreaPixels | null | undefined;
  size: PhysicalPhotoSize;
  rotation?: number;
  background?: Pick<BackgroundSettings, 'mode' | 'color'>;
  adjustments?: Partial<Pick<AdjustmentSettings, 'brightness' | 'contrast'>>;
  format?: ExportFormat;
  jpegQuality?: number;
}

export interface RenderPrintableSheetOptions extends Omit<RenderCroppedPhotoOptions, 'size'> {
  photoSize: PhysicalPhotoSize;
  sheet: SheetOptions;
}

export interface RenderedCanvasExport {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  mimeType: 'image/png' | 'image/jpeg';
}

export const getExportMimeType = (format: ExportFormat = 'png'): 'image/png' | 'image/jpeg' =>
  format === 'jpeg' ? 'image/jpeg' : 'image/png';

export const normalizeJpegQuality = (quality: number | undefined): number => {
  if (typeof quality !== 'number' || !Number.isFinite(quality)) {
    return 0.92;
  }

  if (quality > 1) {
    return clamp(quality / 100, 0, 1);
  }

  return clamp(quality, 0, 1);
};

export const renderCroppedPhoto = async ({
  image,
  croppedAreaPixels,
  size,
  rotation = 0,
  background = { mode: 'original', color: '#ffffff' },
  adjustments,
  format = 'png',
  jpegQuality,
}: RenderCroppedPhotoOptions): Promise<RenderedCanvasExport> => {
  if (!image) {
    throw new CanvasRendererError('MISSING_IMAGE', 'An image is required before rendering.');
  }

  if (!croppedAreaPixels) {
    throw new CanvasRendererError('MISSING_CROP_AREA', 'A completed crop area is required before rendering.');
  }

  const resolvedImage = await resolveCanvasImage(image);
  const dimensions = calculateCustomDimensions(size.widthMm, size.heightMm, size.dpi);
  const canvas = createCanvas(dimensions.widthPx, dimensions.heightPx);
  const context = get2dContext(canvas);

  paintCroppedPhoto(context, resolvedImage, croppedAreaPixels, dimensions.widthPx, dimensions.heightPx, {
    rotation,
    background,
    adjustments,
    forceOpaqueBackground: format === 'jpeg',
  });

  const mimeType = getExportMimeType(format);
  const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/jpeg' ? normalizeJpegQuality(jpegQuality) : undefined);

  return {
    blob,
    widthPx: dimensions.widthPx,
    heightPx: dimensions.heightPx,
    mimeType,
  };
};

export const renderPrintableSheet = async ({
  image,
  croppedAreaPixels,
  photoSize,
  sheet,
  rotation = 0,
  background = { mode: 'original', color: '#ffffff' },
  adjustments,
  format = 'png',
  jpegQuality,
}: RenderPrintableSheetOptions): Promise<RenderedCanvasExport> => {
  if (!image) {
    throw new CanvasRendererError('MISSING_IMAGE', 'An image is required before rendering.');
  }

  if (!croppedAreaPixels) {
    throw new CanvasRendererError('MISSING_CROP_AREA', 'A completed crop area is required before rendering.');
  }

  const layout = calculateSheetLayout(photoSize, sheet);
  if (layout.count < 1) {
    throw new CanvasRendererError('PHOTO_DOES_NOT_FIT', 'The selected photo size does not fit inside the printable sheet area.');
  }

  const resolvedImage = await resolveCanvasImage(image);
  const sheetWidthPx = mmToPixels(layout.sheetWidthMm, sheet.dpi);
  const sheetHeightPx = mmToPixels(layout.sheetHeightMm, sheet.dpi);
  const photoWidthPx = mmToPixels(photoSize.widthMm, sheet.dpi);
  const photoHeightPx = mmToPixels(photoSize.heightMm, sheet.dpi);
  const marginPx = mmToPixels(layout.marginMm || 0.0001, sheet.dpi) - (layout.marginMm === 0 ? 1 : 0);
  const gapPx = mmToPixels(layout.gapMm || 0.0001, sheet.dpi) - (layout.gapMm === 0 ? 1 : 0);

  const canvas = createCanvas(sheetWidthPx, sheetHeightPx);
  const context = get2dContext(canvas);
  context.save();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, sheetWidthPx, sheetHeightPx);
  context.restore();

  const startX = marginPx + Math.max(0, mmToPixels((layout.printableWidthMm - layout.usedWidthMm) / 2 || 0.0001, sheet.dpi) - (((layout.printableWidthMm - layout.usedWidthMm) / 2) === 0 ? 1 : 0));
  const startY = marginPx + Math.max(0, mmToPixels((layout.printableHeightMm - layout.usedHeightMm) / 2 || 0.0001, sheet.dpi) - (((layout.printableHeightMm - layout.usedHeightMm) / 2) === 0 ? 1 : 0));

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const x = startX + column * (photoWidthPx + gapPx);
      const y = startY + row * (photoHeightPx + gapPx);
      context.save();
      context.translate(x, y);
      paintCroppedPhoto(context, resolvedImage, croppedAreaPixels, photoWidthPx, photoHeightPx, {
        rotation,
        background,
        adjustments,
        forceOpaqueBackground: true,
      });
      context.restore();
    }
  }

  const mimeType = getExportMimeType(format);
  const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/jpeg' ? normalizeJpegQuality(jpegQuality) : undefined);

  return {
    blob,
    widthPx: sheetWidthPx,
    heightPx: sheetHeightPx,
    mimeType,
  };
};

interface PaintOptions {
  rotation: number;
  background: Pick<BackgroundSettings, 'mode' | 'color'>;
  adjustments?: Partial<Pick<AdjustmentSettings, 'brightness' | 'contrast'>>;
  forceOpaqueBackground: boolean;
}

const paintCroppedPhoto = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  crop: CropAreaPixels,
  outputWidth: number,
  outputHeight: number,
  options: PaintOptions,
): void => {
  fillBackground(context, outputWidth, outputHeight, options.background, options.forceOpaqueBackground);

  context.save();
  context.beginPath();
  context.rect(0, 0, outputWidth, outputHeight);
  context.clip();
  applyFilters(context, options.adjustments);

  const scaleX = outputWidth / crop.width;
  const scaleY = outputHeight / crop.height;
  const cropCenterX = crop.x + crop.width / 2;
  const cropCenterY = crop.y + crop.height / 2;

  context.translate(outputWidth / 2, outputHeight / 2);
  context.scale(scaleX, scaleY);
  context.rotate(degreesToRadians(options.rotation));
  context.drawImage(image, -cropCenterX, -cropCenterY);
  context.restore();
};

const fillBackground = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: Pick<BackgroundSettings, 'mode' | 'color'>,
  forceOpaqueBackground: boolean,
): void => {
  if (background.mode === 'original' && !forceOpaqueBackground) {
    return;
  }

  context.save();
  context.fillStyle = background.mode === 'solid' ? sanitizeCanvasColor(background.color) : '#ffffff';
  context.fillRect(0, 0, width, height);
  context.restore();
};

const applyFilters = (
  context: CanvasRenderingContext2D,
  adjustments?: Partial<Pick<AdjustmentSettings, 'brightness' | 'contrast'>>,
): void => {
  if (!('filter' in context)) {
    return;
  }

  const brightness = normalizeFilterPercent(adjustments?.brightness, 100);
  const contrast = normalizeFilterPercent(adjustments?.contrast, 100);
  context.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
};

const normalizeFilterPercent = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(value <= 3 ? value * 100 : value);
};

const sanitizeCanvasColor = (color: string): string => {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || /^rgba?\([\d\s.,%]+\)$/i.test(color)) {
    return color;
  }

  return '#ffffff';
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new CanvasRendererError('CANVAS_UNAVAILABLE', 'Canvas rendering is only available in a browser environment.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const get2dContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new CanvasRendererError('CANVAS_UNAVAILABLE', 'Unable to create a 2D canvas rendering context.');
  }

  return context;
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new CanvasRendererError('BLOB_EXPORT_FAILED', 'The canvas export did not produce a Blob.'));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });

const resolveCanvasImage = async (image: CanvasImageSource | string): Promise<CanvasImageSource> => {
  if (typeof image !== 'string') {
    return image;
  }

  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    throw new CanvasRendererError('IMAGE_LOAD_FAILED', 'Image URLs can only be loaded in a browser environment.');
  }

  return new Promise((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = () => reject(new CanvasRendererError('IMAGE_LOAD_FAILED', 'Unable to load the requested image URL.'));
    element.src = image;
  });
};

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
