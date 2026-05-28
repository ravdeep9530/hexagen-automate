import { describe, it, expect } from 'vitest';
import {
  mmToInches,
  inchesToMm,
  mmToPixels,
  calculateAspectRatio,
  calculateCustomDimensions,
  calculatePresetDimensions,
  calculateCustomPresetDimensions,
  formatInches,
  formatMillimeters,
  formatDimensionSummary,
  calculateSheetLayout,
  FOUR_BY_SIX_SHEET,
  DimensionError,
} from './dimensions';
import type { PhotoPreset } from '../types/editor';

describe('mmToInches', () => {
  it('converts millimeters to inches', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1);
    expect(mmToInches(50.8)).toBeCloseTo(2);
    expect(mmToInches(101.6)).toBeCloseTo(4);
  });

  it('throws for non-positive values', () => {
    expect(() => mmToInches(0)).toThrow(DimensionError);
    expect(() => mmToInches(-10)).toThrow(DimensionError);
    expect(() => mmToInches(NaN)).toThrow(DimensionError);
    expect(() => mmToInches(Infinity)).toThrow(DimensionError);
  });
});

describe('inchesToMm', () => {
  it('converts inches to millimeters', () => {
    expect(inchesToMm(1)).toBeCloseTo(25.4);
    expect(inchesToMm(2)).toBeCloseTo(50.8);
    expect(inchesToMm(4)).toBeCloseTo(101.6);
  });

  it('throws for non-positive values', () => {
    expect(() => inchesToMm(0)).toThrow(DimensionError);
    expect(() => inchesToMm(-1)).toThrow(DimensionError);
  });
});

describe('mmToPixels', () => {
  it('converts millimeters to pixels at given DPI', () => {
    expect(mmToPixels(25.4, 72)).toBe(72);
    expect(mmToPixels(25.4, 300)).toBe(300);
    expect(mmToPixels(50.8, 300)).toBe(600);
  });

  it('throws for invalid DPI', () => {
    expect(() => mmToPixels(10, 50)).toThrow(DimensionError);
    expect(() => mmToPixels(10, 1300)).toThrow(DimensionError);
  });
});

describe('calculateAspectRatio', () => {
  it('calculates the aspect ratio', () => {
    expect(calculateAspectRatio(35, 45)).toBeCloseTo(0.778, 2);
    expect(calculateAspectRatio(51, 51)).toBe(1);
    expect(calculateAspectRatio(609.6, 457.2)).toBeCloseTo(1.333, 2);
  });
});

describe('calculateCustomDimensions', () => {
  it('calculates all dimension variants', () => {
    const result = calculateCustomDimensions(35, 45, 300);

    expect(result.widthMm).toBe(35);
    expect(result.heightMm).toBe(45);
    expect(result.widthIn).toBeCloseTo(1.378, 2);
    expect(result.heightIn).toBeCloseTo(1.772, 2);
    expect(result.widthPx).toBe(414);
    expect(result.heightPx).toBe(531);
    expect(result.dpi).toBe(300);
    expect(result.aspectRatio).toBeCloseTo(0.778, 2);
  });

  it('throws for invalid values', () => {
    expect(() => calculateCustomDimensions(0, 45, 300)).toThrow(DimensionError);
    expect(() => calculateCustomDimensions(35, 0, 300)).toThrow(DimensionError);
    expect(() => calculateCustomDimensions(35, 45, 50)).toThrow(DimensionError);
  });
});

describe('calculatePresetDimensions', () => {
  it('uses preset DPI by default', () => {
    const preset: Pick<PhotoPreset, 'widthMm' | 'heightMm' | 'dpi'> = {
      widthMm: 51,
      heightMm: 51,
      dpi: 300,
    };
    const result = calculatePresetDimensions(preset);
    expect(result.dpi).toBe(300);
    expect(result.widthPx).toBe(603);
    expect(result.heightPx).toBe(603);
  });

  it('accepts custom DPI', () => {
    const preset: Pick<PhotoPreset, 'widthMm' | 'heightMm' | 'dpi'> = {
      widthMm: 51,
      heightMm: 51,
      dpi: 300,
    };
    const result = calculatePresetDimensions(preset, 600);
    expect(result.dpi).toBe(600);
    expect(result.widthPx).toBe(1206);
    expect(result.heightPx).toBe(1206);
  });
});

describe('calculateCustomPresetDimensions', () => {
  it('calculates from custom preset values', () => {
    const customPreset = { widthMm: 40, heightMm: 50, dpi: 600 };
    const result = calculateCustomPresetDimensions(customPreset);

    expect(result.dpi).toBe(600);
    expect(result.widthPx).toBe(945);
    expect(result.heightPx).toBe(1181);
  });
});

describe('formatInches', () => {
  it('formats inches with 2 decimals', () => {
    expect(formatInches(2)).toBe('2 in');
    expect(formatInches(2.5)).toBe('2.5 in');
    expect(formatInches(1.37795)).toBe('1.38 in');
  });

  it('handles edge cases', () => {
    expect(formatInches(NaN)).toBe('0 in');
    expect(formatInches(0)).toBe('0 in');
  });
});

describe('formatMillimeters', () => {
  it('formats millimeters with 1 decimal', () => {
    expect(formatMillimeters(35)).toBe('35 mm');
    expect(formatMillimeters(35.5)).toBe('35.5 mm');
    expect(formatMillimeters(51.04)).toBe('51 mm');
  });

  it('handles edge cases', () => {
    expect(formatMillimeters(NaN)).toBe('0 mm');
    expect(formatMillimeters(0)).toBe('0 mm');
  });
});

describe('formatDimensionSummary', () => {
  it('formats a complete dimension summary', () => {
    const dimensions = calculateCustomDimensions(35, 45, 300);
    const summary = formatDimensionSummary(dimensions);

    expect(summary).toContain('35 mm');
    expect(summary).toContain('45 mm');
    expect(summary).toContain('1.38 in');
    expect(summary).toContain('1.77 in');
    expect(summary).toContain('414');
    expect(summary).toContain('531');
    expect(summary).toContain('300 DPI');
  });
});

describe('calculateSheetLayout', () => {
  it('calculates layout for US passport on 4x6', () => {
    const photo = { widthMm: 51, heightMm: 51 };
    const layout = calculateSheetLayout(photo);

    expect(layout.sheetWidthMm).toBe(101.6);
    expect(layout.sheetHeightMm).toBe(152.4);
    expect(layout.marginMm).toBe(3);
    expect(layout.gapMm).toBe(2);
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(2);
    expect(layout.count).toBe(2);
  });

  it('calculates layout for smaller photos', () => {
    const photo = { widthMm: 25, heightMm: 35 };
    const layout = calculateSheetLayout(photo);

    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(4);
    expect(layout.count).toBe(12);
  });

  it('handles photos that do not fit', () => {
    const photo = { widthMm: 100, heightMm: 100 };
    const layout = calculateSheetLayout(photo);

    expect(layout.columns).toBe(0);
    expect(layout.rows).toBe(0);
    expect(layout.count).toBe(0);
  });

  it('respects custom options', () => {
    const photo = { widthMm: 30, heightMm: 40 };
    const layout = calculateSheetLayout(photo, {
      sheetWidthMm: 200,
      sheetHeightMm: 300,
      marginMm: 5,
      gapMm: 4,
    });

    expect(layout.sheetWidthMm).toBe(200);
    expect(layout.sheetHeightMm).toBe(300);
    expect(layout.marginMm).toBe(5);
    expect(layout.gapMm).toBe(4);
  });

  it('throws for invalid photo dimensions', () => {
    expect(() => calculateSheetLayout({ widthMm: 0, heightMm: 40 })).toThrow(DimensionError);
    expect(() => calculateSheetLayout({ widthMm: 30, heightMm: 0 })).toThrow(DimensionError);
  });

  it('throws for invalid options', () => {
    expect(() => calculateSheetLayout({ widthMm: 30, heightMm: 40 }, { sheetWidthMm: 0 })).toThrow(DimensionError);
    expect(() => calculateSheetLayout({ widthMm: 30, heightMm: 40 }, { marginMm: -1 })).toThrow(DimensionError);
  });
});

describe('FOUR_BY_SIX_SHEET', () => {
  it('has correct constants', () => {
    expect(FOUR_BY_SIX_SHEET.widthMm).toBeCloseTo(101.6);
    expect(FOUR_BY_SIX_SHEET.heightMm).toBeCloseTo(152.4);
    expect(FOUR_BY_SIX_SHEET.marginMm).toBe(3);
    expect(FOUR_BY_SIX_SHEET.gapMm).toBe(2);
  });
});
