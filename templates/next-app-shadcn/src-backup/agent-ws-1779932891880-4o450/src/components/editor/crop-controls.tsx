'use client';

import React, { useId } from 'react';
import { useEditorStore } from '../../store/editor-store';

interface CropControlsProps {
  onResetCrop?: () => void;
}

export function CropControls({ onResetCrop }: CropControlsProps): React.JSX.Element {
  const crop = useEditorStore((state) => state.crop);
  const setCropState = useEditorStore((state) => state.setCropState);
  const baseId = useId();

  const handleZoomChange = (value: number) => {
    setCropState({ zoom: clamp(value, 1, 3) });
  };

  const handleRotationChange = (value: number) => {
    setCropState({ rotation: clamp(value, -180, 180) });
  };

  const toggleGrid = () => {
    setCropState({ showGrid: !crop.showGrid });
  };

  const toggleFaceGuide = () => {
    setCropState({ showFaceGuide: !crop.showFaceGuide });
  };

  const resetCrop = () => {
    setCropState({
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
    });
    onResetCrop?.();
  };

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      role="region"
      aria-labelledby={`${baseId}-title`}
    >
      <h2 id={`${baseId}-title`} className="text-base font-semibold text-slate-950">
        Crop Controls
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Adjust zoom, rotation, and guide visibility.
      </p>

      <div className="mt-4 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${baseId}-zoom`} className="text-xs font-medium text-slate-700">
              Zoom
            </label>
            <output
              htmlFor={`${baseId}-zoom`}
              aria-live="polite"
              className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              {Math.round(crop.zoom * 100)}%
            </output>
          </div>
          <input
            id={`${baseId}-zoom`}
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={crop.zoom}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={Math.round(crop.zoom * 100) / 100}
            aria-valuetext={`${Math.round(crop.zoom * 100)}% zoom`}
            onChange={(event) => handleZoomChange(Number(event.currentTarget.value))}
            className="w-full accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>100%</span>
            <span>300%</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${baseId}-rotation`} className="text-xs font-medium text-slate-700">
              Rotation
            </label>
            <output
              htmlFor={`${baseId}-rotation`}
              aria-live="polite"
              className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm"
            >
              {Math.round(crop.rotation)}°
            </output>
          </div>
          <input
            id={`${baseId}-rotation`}
            type="range"
            min={-180}
            max={180}
            step={1}
            value={crop.rotation}
            aria-valuemin={-180}
            aria-valuemax={180}
            aria-valuenow={crop.rotation}
            aria-valuetext={`${crop.rotation} degrees rotation`}
            onChange={(event) => handleRotationChange(Number(event.currentTarget.value))}
            className="w-full accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>-180°</span>
            <span>0°</span>
            <span>180°</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={toggleGrid}
            aria-pressed={crop.showGrid}
            aria-label={crop.showGrid ? 'Hide grid' : 'Show grid'}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
              crop.showGrid
                ? 'border border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span aria-hidden="true">⊞</span>
            <span>Grid</span>
          </button>

          <button
            type="button"
            onClick={toggleFaceGuide}
            aria-pressed={crop.showFaceGuide}
            aria-label={crop.showFaceGuide ? 'Hide face guide' : 'Show face guide'}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
              crop.showFaceGuide
                ? 'border border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span aria-hidden="true">◎</span>
            <span>Face Guide</span>
          </button>
        </div>

        <button
          type="button"
          onClick={resetCrop}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <span aria-hidden="true">↺</span>
          Reset crop position
        </button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
