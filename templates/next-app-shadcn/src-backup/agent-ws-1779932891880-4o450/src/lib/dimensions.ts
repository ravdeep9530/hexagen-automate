import type { CustomPresetValues, PhotoPreset } from '../types/editor';

const MM_PER_INCH = 25.4;
const MIN_DPI = 72;
const MAX_DPI = 1200;

export const FOUR_BY_SIX_SHEET = {
  widthMm: 101.6,
  heightMm: 152.4,
  marginMm: 3,
  gapMm: 2,
} as const;

export class DimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DimensionError';
  }
}

export interface PixelDimensions {
  widthMm: number;
  heightMm: number;
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  aspectRatio: number;
}

export interface SheetLayoutOptions {
  sheetWidthMm?: number;
  sheetHeightMm?: number;
  marginMm?: number;
  gapMm?: number;
}

export interface SheetLayout {
  sheetWidthMm: number;
  sheetHeightMm: number;
  marginMm: number;
  gapMm: number;
  columns: number;
  rows: number;
  count: number;
  photoWidthMm: number;
  photoHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
  usedWidthMm: number;
  usedHeightMm: number;
}

export const mmToInches = (millimeters: number): number => {
  assertPositiveFinite(millimeters, 'Dimension');
  return millimeters / MM_PER_INCH;
};

export const inchesToMm = (inches: number): number => {
  assertPositiveFinite(inches, 'Dimension');
  return inches * MM_PER_INCH;
};

export const mmToPixels = (millimeters: number, dpi: number): number => {
  assertPositiveFinite(millimeters, 'Dimension');
  assertValidDpi(dpi);
  return Math.round(mmToInches(millimeters) * dpi);
};

export const calculateAspectRatio = (widthMm: number, heightMm: number): number => {
  assertPositiveFinite(widthMm, 'Width');
  assertPositiveFinite(heightMm, 'Height');
  return widthMm / heightMm;
};

export const calculateCustomDimensions = (
  widthMm: number,
  heightMm: number,
  dpi: number,
): PixelDimensions => {
  assertPositiveFinite(widthMm, 'Width');
  assertPositiveFinite(heightMm, 'Height');
  assertValidDpi(dpi);

  const widthIn = widthMm / MM_PER_INCH;
  const heightIn = heightMm / MM_PER_INCH;

  return {
    widthMm,
    heightMm,
    widthIn,
    heightIn,
    widthPx: Math.round(widthIn * dpi),
    heightPx: Math.round(heightIn * dpi),
    dpi,
    aspectRatio: widthMm / heightMm,
  };
};

export const calculatePresetDimensions = (
  preset: Pick<PhotoPreset, 'widthMm' | 'heightMm' | 'dpi'>,
  targetDpi = preset.dpi,
): PixelDimensions => calculateCustomDimensions(preset.widthMm, preset.heightMm, targetDpi);

export const calculateCustomPresetDimensions = (customPreset: CustomPresetValues): PixelDimensions =>
  calculateCustomDimensions(customPreset.widthMm, customPreset.heightMm, customPreset.dpi);

export const formatInches = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0 in';
  }

  return `${trimTrailingZeros(value.toFixed(2))} in`;
};

export const formatMillimeters = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0 mm';
  }

  return `${trimTrailingZeros(value.toFixed(1))} mm`;
};

export const formatDimensionSummary = (dimensions: PixelDimensions): string =>
  `${formatMillimeters(dimensions.widthMm)} × ${formatMillimeters(dimensions.heightMm)} (${formatInches(
    dimensions.widthIn,
  )} × ${formatInches(dimensions.heightIn)}) · ${dimensions.widthPx} × ${dimensions.heightPx} px · ${dimensions.dpi} DPI`;

export const calculateSheetLayout = (
  photo: Pick<PhotoPreset, 'widthMm' | 'heightMm'>,
  options: SheetLayoutOptions = {},
): SheetLayout => {
  assertPositiveFinite(photo.widthMm, 'Photo width');
  assertPositiveFinite(photo.heightMm, 'Photo height');

  const sheetWidthMm = options.sheetWidthMm ?? FOUR_BY_SIX_SHEET.widthMm;
  const sheetHeightMm = options.sheetHeightMm ?? FOUR_BY_SIX_SHEET.heightMm;
  const marginMm = options.marginMm ?? FOUR_BY_SIX_SHEET.marginMm;
  const gapMm = options.gapMm ?? FOUR_BY_SIX_SHEET.gapMm;

  assertPositiveFinite(sheetWidthMm, 'Sheet width');
  assertPositiveFinite(sheetHeightMm, 'Sheet height');
  assertNonNegativeFinite(marginMm, 'Sheet margin');
  assertNonNegativeFinite(gapMm, 'Photo gap');

  const printableWidthMm = Math.max(0, sheetWidthMm - marginMm * 2);
  const printableHeightMm = Math.max(0, sheetHeightMm - marginMm * 2);
  const columns = calculateFitCount(printableWidthMm, photo.widthMm, gapMm);
  const rows = calculateFitCount(printableHeightMm, photo.heightMm, gapMm);
  const count = columns * rows;
  const usedWidthMm = columns > 0 ? columns * photo.widthMm + Math.max(0, columns - 1) * gapMm : 0;
  const usedHeightMm = rows > 0 ? rows * photo.heightMm + Math.max(0, rows - 1) * gapMm : 0;

  return {
    sheetWidthMm,
    sheetHeightMm,
    marginMm,
    gapMm,
    columns,
    rows,
    count,
    photoWidthMm: photo.widthMm,
    photoHeightMm: photo.heightMm,
    printableWidthMm,
    printableHeightMm,
    usedWidthMm,
    usedHeightMm,
  };
};

const calculateFitCount = (availableMm: number, itemMm: number, gapMm: number): number => {
  if (availableMm <= 0 || itemMm > availableMm) {
    return 0;
  }

  return Math.floor((availableMm + gapMm) / (itemMm + gapMm));
};

const trimTrailingZeros = (value: string): string => value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

const assertPositiveFinite = (value: number, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DimensionError(`${label} must be a positive number.`);
  }
};

const assertNonNegativeFinite = (value: number, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DimensionError(`${label} must be zero or a positive number.`);
  }
};

const assertValidDpi = (dpi: number): void => {
  if (!Number.isInteger(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    throw new DimensionError(`DPI must be an integer between ${MIN_DPI} and ${MAX_DPI}.`);
  }
};
