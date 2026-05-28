import { describe, expect, it } from 'vitest';
import {
  renderCroppedPhoto,
  renderPrintableSheet,
  CanvasRendererError,
  getExportMimeType,
  normalizeJpegQuality,
} from './canvas-renderer';
import { calculateSheetLayout, mmToPixels, FOUR_BY_SIX_SHEET } from './dimensions';

describe('getExportMimeType', () => {
  it('returns image/png for png format', () => {
    expect(getExportMimeType('png')).toBe('image/png');
    expect(getExportMimeType()).toBe('image/png');
  });

  it('returns image/jpeg for jpeg format', () => {
    expect(getExportMimeType('jpeg')).toBe('image/jpeg');
  });
});

describe('normalizeJpegQuality', () => {
  it('uses default 0.92 for undefined or invalid values', () => {
    expect(normalizeJpegQuality(undefined)).toBe(0.92);
    expect(normalizeJpegQuality(NaN)).toBe(0.92);
    expect(normalizeJpegQuality(Infinity)).toBe(0.92);
  });

  it('converts percentage values to 0-1 range', () => {
    expect(normalizeJpegQuality(80)).toBe(0.8);
    expect(normalizeJpegQuality(100)).toBe(1);
    expect(normalizeJpegQuality(50)).toBe(0.5);
  });

  it('clamps values to 0-1 range', () => {
    expect(normalizeJpegQuality(0)).toBe(0);
    expect(normalizeJpegQuality(-10)).toBe(0);
    expect(normalizeJpegQuality(150)).toBe(1);
    expect(normalizeJpegQuality(1.5)).toBe(1);
  });

  it('preserves decimal values in 0-1 range', () => {
    expect(normalizeJpegQuality(0.85)).toBe(0.85);
    expect(normalizeJpegQuality(0.75)).toBe(0.75);
  });
});

describe('renderCroppedPhoto rejection tests', () => {
  it('rejects missing images with typed error', async () => {
    await expect(
      renderCroppedPhoto({
        image: null,
        croppedAreaPixels: { x: 0, y: 0, width: 100, height: 100 },
        size: { widthMm: 35, heightMm: 45, dpi: 300 },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_IMAGE' });
  });

  it('rejects missing croppedAreaPixels with typed error', async () => {
    const mockImage = { width: 500, height: 500 } as unknown as HTMLImageElement;

    await expect(
      renderCroppedPhoto({
        image: mockImage,
        croppedAreaPixels: null,
        size: { widthMm: 35, heightMm: 45, dpi: 300 },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CROP_AREA' });
  });

  it('rejects undefined croppedAreaPixels with typed error', async () => {
    const mockImage = { width: 500, height: 500 } as unknown as HTMLImageElement;

    await expect(
      renderCroppedPhoto({
        image: mockImage,
        croppedAreaPixels: undefined,
        size: { widthMm: 35, heightMm: 45, dpi: 300 },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CROP_AREA' });
  });
});

describe('Sheet layout and dimension calculations', () => {
  it('calculates sheet fit for US passport size (51x51mm) on 4x6 sheet', () => {
    const photo = { widthMm: 51, heightMm: 51 };
    const layout = calculateSheetLayout(photo);

    expect(layout.sheetWidthMm).toBe(101.6);
    expect(layout.sheetHeightMm).toBe(152.4);
    expect(layout.marginMm).toBe(3);
    expect(layout.gapMm).toBe(2);
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(2);
    expect(layout.count).toBe(2);
    expect(layout.printableWidthMm).toBeCloseTo(95.6, 1);
    expect(layout.printableHeightMm).toBeCloseTo(146.4, 1);
  });

  it('calculates sheet fit for UK passport size (35x45mm) on 4x6 sheet', () => {
    const photo = { widthMm: 35, heightMm: 45 };
    const layout = calculateSheetLayout(photo);

    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(3);
    expect(layout.count).toBe(6);
  });

  it('calculates sheet fit for China visa (33x48mm) using mmToPixels', () => {
    const photo = { widthMm: 33, heightMm: 48 };
    const dpi = 300;
    const layout = calculateSheetLayout(photo);

    expect(mmToPixels(photo.widthMm, dpi)).toBe(390);
    expect(mmToPixels(photo.heightMm, dpi)).toBe(567);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(3);
    expect(layout.count).toBe(6);
  });

  it('rejects photo dimensions exceeding sheet area', async () => {
    const mockImage = { width: 1000, height: 1000 } as unknown as HTMLImageElement;

    await expect(
      renderPrintableSheet({
        image: mockImage,
        croppedAreaPixels: { x: 0, y: 0, width: 500, height: 500 },
        photoSize: { widthMm: 100, heightMm: 100, dpi: 300 },
        sheet: { dpi: 300 },
      }),
    ).rejects.toMatchObject({ code: 'PHOTO_DOES_NOT_FIT' });
  });

  it('rejects photos that compute to zero rows or columns', async () => {
    const mockImage = { width: 1000, height: 1000 } as unknown as HTMLImageElement;

    const layout = calculateSheetLayout({ widthMm: 90, heightMm: 90 });
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.count).toBe(1);

    await expect(
      renderPrintableSheet({
        image: mockImage,
        croppedAreaPixels: { x: 0, y: 0, width: 500, height: 500 },
        photoSize: { widthMm: 96, heightMm: 147, dpi: 300 },
        sheet: { dpi: 300 },
      }),
    ).rejects.toMatchObject({ code: 'PHOTO_DOES_NOT_FIT' });
  });
});

describe('Dimension calculations', () => {
  it('calculates exact pixel dimensions preset/custom resolution', () => {
    const cases = [
      { widthMm: 35, heightMm: 45, dpi: 300, expected: { widthPx: 414, heightPx: 531 } },
      { widthMm: 51, heightMm: 51, dpi: 300, expected: { widthPx: 602, heightPx: 602 } },
      { widthMm: 50, heightMm: 70, dpi: 300, expected: { widthPx: 591, heightPx: 827 } },
    ];

    for (const { widthMm, heightMm, dpi, expected } of cases) {
      expect(mmToPixels(widthMm, dpi)).toBe(expected.widthPx);
      expect(mmToPixels(heightMm, dpi)).toBe(expected.heightPx);
    }
  });

  it('rounds pixel dimensions to nearest integer', () => {
    expect(mmToPixels(35.5, 300)).toBe(419);
    expect(mmToPixels(29, 300)).toBe(343);
    expect(mmToPixels(40.5, 600)).toBe(957);
  });
});

describe('FOUR_BY_SIX_SHEET constants', () => {
  it('has correct default values for US standard 4x6 sheet', () => {
    expect(FOUR_BY_SIX_SHEET.widthMm).toBe(101.6);
    expect(FOUR_BY_SIX_SHEET.heightMm).toBe(152.4);
    expect(FOUR_BY_SIX_SHEET.marginMm).toBe(3);
    expect(FOUR_BY_SIX_SHEET.gapMm).toBe(2);

    const layout = calculateSheetLayout({ widthMm: 35, heightMm: 45 });
    expect(layout.sheetWidthMm).toBe(101.6);
    expect(layout.sheetHeightMm).toBe(152.4);
  });
});

describe('CanvasRendererError', () => {
  it('initializes with code and message', () => {
    const error = new CanvasRendererError('MISSING_IMAGE', 'Test message');
    expect(error.code).toBe('MISSING_IMAGE');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('CanvasRendererError');
  });
});
