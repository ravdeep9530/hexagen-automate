'use client';

import React from 'react';
import type { ExportFormat } from '../../types/editor';

interface ExportFormatControlsProps {
  format: ExportFormat;
  quality: number;
  disabled?: boolean;
  onFormatChange: (format: ExportFormat) => void;
  onQualityChange: (quality: number) => void;
}

const QUALITY_MIN = 0.5;
const QUALITY_MAX = 1;
const QUALITY_STEP = 0.01;

export function ExportFormatControls({
  format,
  quality,
  disabled = false,
  onFormatChange,
  onQualityChange,
}: ExportFormatControlsProps): React.JSX.Element {
  const qualityPercent = Math.round(normalizeQuality(quality) * 100);

  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-slate-950">Output format</legend>

      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Export output format">
        <label className={formatOptionClass(format === 'png', disabled)}>
          <input
            type="radio"
            name="export-format"
            value="png"
            checked={format === 'png'}
            disabled={disabled}
            onChange={() => onFormatChange('png')}
            className="sr-only"
          />
          <span className="text-sm font-semibold">PNG</span>
          <span className="text-xs text-slate-500">Best for transparent or lossless output</span>
        </label>

        <label className={formatOptionClass(format === 'jpeg', disabled)}>
          <input
            type="radio"
            name="export-format"
            value="jpeg"
            checked={format === 'jpeg'}
            disabled={disabled}
            onChange={() => onFormatChange('jpeg')}
            className="sr-only"
          />
          <span className="text-sm font-semibold">JPEG</span>
          <span className="text-xs text-slate-500">Smaller file for uploads and print labs</span>
        </label>
      </div>

      {format === 'jpeg' ? (
        <div className="mt-4 rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="jpeg-quality" className="text-sm font-semibold text-slate-950">
              JPEG quality
            </label>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700" aria-live="polite">
              {qualityPercent}%
            </span>
          </div>
          <input
            id="jpeg-quality"
            type="range"
            min={QUALITY_MIN}
            max={QUALITY_MAX}
            step={QUALITY_STEP}
            value={normalizeQuality(quality)}
            disabled={disabled}
            onChange={(event) => onQualityChange(Number(event.currentTarget.value))}
            className="mt-3 w-full accent-blue-600"
            aria-describedby="jpeg-quality-help"
          />
          <p id="jpeg-quality-help" className="mt-2 text-xs leading-5 text-slate-500">
            Higher quality keeps more detail and creates a larger file.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

const normalizeQuality = (quality: number): number => {
  if (!Number.isFinite(quality)) {
    return 0.92;
  }

  if (quality > 1) {
    return clamp(quality / 100, QUALITY_MIN, QUALITY_MAX);
  }

  return clamp(quality, QUALITY_MIN, QUALITY_MAX);
};

const formatOptionClass = (selected: boolean, disabled: boolean): string =>
  [
    'flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600',
    selected ? 'border-blue-500 bg-blue-50 text-blue-950 shadow-sm' : 'border-slate-200 bg-white text-slate-800',
    disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-blue-300',
  ].join(' ');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
