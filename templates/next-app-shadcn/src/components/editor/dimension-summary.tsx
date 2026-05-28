'use client';

import React from 'react';
import { getResolvedPreset } from '../../data/photo-presets';
import {
  calculatePresetDimensions,
  formatDimensionSummary,
  formatInches,
  formatMillimeters,
} from '../../lib/dimensions';
import { useEditorStore } from '../../store/editor-store';
import type { PhotoPreset } from '../../types/editor';

interface DimensionSummaryProps {
  preset?: Pick<PhotoPreset, 'widthMm' | 'heightMm' | 'dpi'>;
  compact?: boolean;
}

export function DimensionSummary({ preset, compact = false }: DimensionSummaryProps): React.JSX.Element {
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const exportDpi = useEditorStore((state) => state.exportConfig.dpi);
  const resolvedPreset = preset ?? getResolvedPreset(selectedPresetId, customPreset);
  const dimensions = calculatePresetDimensions(resolvedPreset, exportDpi || resolvedPreset.dpi);

  if (compact) {
    return (
      <p className="text-sm font-medium text-slate-700" data-testid="dimension-summary-compact">
        {formatDimensionSummary(dimensions)}
      </p>
    );
  }

  return (
    <section aria-label="Dimension summary" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Output dimensions</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">Physical, digital, and export density for the selected crop.</p>
        </div>
        <span className="w-fit rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {dimensions.dpi} DPI
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Millimeters</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            {formatMillimeters(dimensions.widthMm)} × {formatMillimeters(dimensions.heightMm)}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Inches</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            {formatInches(dimensions.widthIn)} × {formatInches(dimensions.heightIn)}
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Pixels</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            {dimensions.widthPx} × {dimensions.heightPx} px
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Aspect</dt>
          <dd className="mt-1 font-semibold text-slate-950">{dimensions.aspectRatio.toFixed(2)}:1</dd>
        </div>
      </dl>
    </section>
  );
}
