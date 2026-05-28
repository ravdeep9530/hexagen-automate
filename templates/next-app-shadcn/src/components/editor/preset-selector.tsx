'use client';

import { useMemo, useState } from 'react';
import { CustomSizeControls } from './custom-size-controls';
import { PresetSummary } from './preset-summary';
import {
  CUSTOM_PRESET_ID,
  PHOTO_PRESET_CATEGORIES,
  PHOTO_PRESETS,
  getPresetsByCategory,
} from '../../data/photo-presets';
import { useEditorStore } from '../../store/editor-store';
import type { PhotoPresetCategory } from '../../types/editor';

const CATEGORY_FILTERS: Array<{ id: PhotoPresetCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  ...PHOTO_PRESET_CATEGORIES,
];

const CATEGORY_LABELS = Object.fromEntries(
  PHOTO_PRESET_CATEGORIES.map((category) => [category.id, category.label]),
) as Record<PhotoPresetCategory, string>;

const BACKGROUND_LABELS = {
  white: 'White background',
  'off-white': 'Off-white background',
  'light-gray': 'Light gray background',
  custom: 'Custom background',
} as const;

export function PresetSelector(): JSX.Element {
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const setSelectedPresetId = useEditorStore((state) => state.setSelectedPresetId);
  const [activeCategory, setActiveCategory] = useState<PhotoPresetCategory | 'all'>('all');

  const visibleGroups = useMemo(() => {
    const categories = activeCategory === 'all' ? PHOTO_PRESET_CATEGORIES : PHOTO_PRESET_CATEGORIES.filter((category) => category.id === activeCategory);

    return categories
      .map((category) => ({
        category,
        presets: activeCategory === 'all' ? getPresetsByCategory(category.id) : PHOTO_PRESETS.filter((preset) => preset.category === category.id),
      }))
      .filter((group) => group.presets.length > 0);
  }, [activeCategory]);

  const selectedPreset = PHOTO_PRESETS.find((preset) => preset.id === selectedPresetId);
  const showCustomControls = selectedPresetId === CUSTOM_PRESET_ID;

  return (
    <section aria-labelledby="preset-selector-title" className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 id="preset-selector-title" className="text-base font-semibold text-slate-950">
            Choose photo preset
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Select an official photo size, review the requirements, or enter a custom output size.
          </p>
        </div>
        <div className="min-w-44">
          <label htmlFor="preset-category-filter" className="mb-1 block text-xs font-medium text-slate-700">
            Filter by category
          </label>
          <select
            id="preset-category-filter"
            value={activeCategory}
            onChange={(event) => setActiveCategory(event.currentTarget.value as PhotoPresetCategory | 'all')}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          >
            {CATEGORY_FILTERS.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-4" role="listbox" aria-label="Photo size presets" aria-activedescendant={selectedPreset ? `preset-option-${selectedPreset.id}` : undefined}>
          {visibleGroups.map(({ category, presets }) => (
            <div key={category.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{category.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  {presets.length}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {presets.map((preset) => {
                  const isSelected = preset.id === selectedPresetId;

                  return (
                    <button
                      key={preset.id}
                      id={`preset-option-${preset.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`rounded-2xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500'
                          : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-sm font-semibold text-slate-950">{preset.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {preset.country ?? CATEGORY_LABELS[preset.category]}
                          </span>
                        </span>
                        <span
                          className={`mt-0.5 h-3 w-3 shrink-0 rounded-full border ${
                            isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                          }`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                        <span className="rounded-lg bg-slate-100 px-2 py-1">{preset.widthMm}×{preset.heightMm} mm</span>
                        <span className="rounded-lg bg-slate-100 px-2 py-1">{preset.dpi} DPI</span>
                        <span className="rounded-lg bg-slate-100 px-2 py-1">{BACKGROUND_LABELS[preset.background]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <PresetSummary />
          {showCustomControls ? <CustomSizeControls /> : null}
        </div>
      </div>
    </section>
  );
}
