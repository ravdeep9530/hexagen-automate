import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PRESET_ID,
  PHOTO_PRESET_CATEGORIES,
  PHOTO_PRESETS,
  getPresetById,
  getPresetsByCategory,
  getResolvedPreset,
} from './photo-presets';

describe('photo presets', () => {
  it('includes presets for every supported category and a custom option', () => {
    const categories = new Set(PHOTO_PRESETS.map((preset) => preset.category));

    for (const category of PHOTO_PRESET_CATEGORIES) {
      expect(categories.has(category.id)).toBe(true);
      expect(getPresetsByCategory(category.id).length).toBeGreaterThan(0);
    }

    expect(getPresetById(CUSTOM_PRESET_ID)?.category).toBe('custom');
  });

  it('provides compliance details for each preset', () => {
    for (const preset of PHOTO_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.widthMm).toBeGreaterThan(0);
      expect(preset.heightMm).toBeGreaterThan(0);
      expect(preset.dpi).toBeGreaterThan(0);
      expect(preset.notes.length).toBeGreaterThan(0);
    }
  });

  it('resolves custom dimensions from store values only for the custom preset', () => {
    const custom = getResolvedPreset(CUSTOM_PRESET_ID, { widthMm: 40, heightMm: 50, dpi: 600 });
    const standard = getResolvedPreset('us-passport', { widthMm: 40, heightMm: 50, dpi: 600 });

    expect(custom).toMatchObject({ id: CUSTOM_PRESET_ID, widthMm: 40, heightMm: 50, dpi: 600 });
    expect(standard).toMatchObject({ id: 'us-passport', widthMm: 51, heightMm: 51, dpi: 300 });
  });
});
