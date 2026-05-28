'use client';

import React, { useId } from 'react';
import { ColorField } from './color-field';
import {
  DEFAULT_ADJUSTMENT_SETTINGS,
  DEFAULT_BACKGROUND_SETTINGS,
  useEditorStore,
} from '../../store/editor-store';
import type { AdjustmentSettings, BackgroundMode } from '../../types/editor';

const BACKGROUND_OPTIONS: Array<{ value: BackgroundMode; label: string; description: string }> = [
  {
    value: 'original',
    label: 'Original',
    description: 'Keep the uploaded photo background visible.',
  },
  {
    value: 'white',
    label: 'White',
    description: 'Compose the crop on a plain white background.',
  },
  {
    value: 'solid',
    label: 'Solid color',
    description: 'Compose the crop on your selected solid color.',
  },
];

const ADJUSTMENT_CONTROLS: Array<{
  key: keyof Pick<AdjustmentSettings, 'brightness' | 'contrast'>;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  description: string;
}> = [
  {
    key: 'brightness',
    label: 'Brightness',
    min: -100,
    max: 100,
    step: 1,
    unit: '%',
    description: 'Negative values darken the photo and positive values brighten it.',
  },
  {
    key: 'contrast',
    label: 'Contrast',
    min: -100,
    max: 100,
    step: 1,
    unit: '%',
    description: 'Negative values soften contrast and positive values increase it.',
  },
];

const clampNumericValue = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
};

export function BackgroundAdjustmentControls(): React.JSX.Element {
  const background = useEditorStore((state) => state.background);
  const adjustments = useEditorStore((state) => state.adjustments);
  const setBackgroundSettings = useEditorStore((state) => state.setBackgroundSettings);
  const setAdjustments = useEditorStore((state) => state.setAdjustments);
  const baseId = useId();

  const resetControls = () => {
    setBackgroundSettings(DEFAULT_BACKGROUND_SETTINGS);
    setAdjustments(DEFAULT_ADJUSTMENT_SETTINGS);
  };

  return (
    <section aria-labelledby={`${baseId}-title`} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={`${baseId}-title`} className="text-base font-semibold text-slate-950">
            Background & adjustments
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Choose the composition background and tune the exported photo preview.
          </p>
        </div>
        <button
          type="button"
          onClick={resetControls}
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          Reset controls
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-950">Background mode</legend>
          <div className="mt-3 grid gap-2">
            {BACKGROUND_OPTIONS.map((option) => {
              const optionId = `${baseId}-background-${option.value}`;
              const descriptionId = `${optionId}-description`;
              const isSelected = background.mode === option.value;

              return (
                <label
                  key={option.value}
                  htmlFor={optionId}
                  className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition ${
                    isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:border-blue-200'
                  }`}
                >
                  <input
                    id={optionId}
                    type="radio"
                    name={`${baseId}-background-mode`}
                    value={option.value}
                    checked={isSelected}
                    aria-describedby={descriptionId}
                    onChange={() => setBackgroundSettings({ mode: option.value })}
                    className="mt-1 h-4 w-4 border-slate-300 text-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-950">{option.label}</span>
                    <span id={descriptionId} className="mt-0.5 block text-xs leading-5 text-slate-600">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-5 text-blue-900">
            Background replacement is solid composition only. This tool does not perform AI background removal.
          </div>

          <div className="mt-4">
            <ColorField
              label="Solid background color"
              value={background.color || '#ffffff'}
              disabled={background.mode !== 'solid'}
              onChange={(color) => setBackgroundSettings({ color })}
            />
          </div>
        </fieldset>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Image adjustments</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Values are stored numerically for preview and canvas rendering.
          </p>

          <div className="mt-4 space-y-5">
            {ADJUSTMENT_CONTROLS.map(({ key, label, min, max, step, unit, description }) => {
              const inputId = `${baseId}-${key}`;
              const descriptionId = `${inputId}-description`;
              const value = clampNumericValue(adjustments[key], min, max);

              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={inputId} className="text-xs font-medium text-slate-700">
                      {label}
                    </label>
                    <output htmlFor={inputId} aria-live="polite" className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">
                      {value}{unit}
                    </output>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={value}
                    aria-valuetext={`${value}${unit}`}
                    aria-describedby={descriptionId}
                    onChange={(event) => {
                      const nextValue = clampNumericValue(Number(event.currentTarget.value), min, max);
                      setAdjustments({ [key]: nextValue });
                    }}
                    className="w-full accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  />
                  <p id={descriptionId} className="text-[11px] leading-4 text-slate-500">
                    {description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
