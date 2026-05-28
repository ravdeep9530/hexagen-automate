'use client';

import { getResolvedPreset } from '../../data/photo-presets';
import { calculatePresetDimensions } from '../../lib/dimensions';
import { useEditorStore } from '../../store/editor-store';
import type { BackgroundMode } from '../../types/editor';
import { DimensionSummary } from './dimension-summary';

const BACKGROUND_MODE_LABELS: Record<BackgroundMode, string> = {
  original: 'Original photo background',
  white: 'Plain white background',
  solid: 'Solid color background',
};

const getPreviewBackground = (mode: BackgroundMode, color: string): string => {
  if (mode === 'solid') {
    return color || '#ffffff';
  }

  if (mode === 'white') {
    return '#ffffff';
  }

  return 'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)';
};

export const buildAdjustmentFilter = (brightness: number, contrast: number): string => {
  const safeBrightness = Number.isFinite(brightness) ? Math.min(100, Math.max(-100, brightness)) : 0;
  const safeContrast = Number.isFinite(contrast) ? Math.min(100, Math.max(-100, contrast)) : 0;

  return `brightness(${100 + safeBrightness}%) contrast(${100 + safeContrast}%)`;
};

export function LivePreview(): React.JSX.Element {
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const background = useEditorStore((state) => state.background);
  const adjustments = useEditorStore((state) => state.adjustments);
  const preset = getResolvedPreset(selectedPresetId, customPreset);
  const dimensions = calculatePresetDimensions(preset);
  const filter = buildAdjustmentFilter(adjustments.brightness, adjustments.contrast);
  const previewBackground = getPreviewBackground(background.mode, background.color);

  return (
    <section aria-labelledby="live-preview-title" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="live-preview-title" className="text-base font-semibold text-slate-950">Live preview</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Preview the selected crop size, background, and export adjustments.</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {preset.label}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)]">
        <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:min-h-[340px]">
          {uploadedImage ? (
            <div className="w-full max-w-[min(100%,360px)]" aria-label="Uploaded image preview">
              <div
                data-testid="live-preview-frame"
                className="relative mx-auto overflow-hidden rounded-xl border border-slate-300 shadow-lg ring-8 ring-white"
                style={{
                  aspectRatio: `${dimensions.widthMm} / ${dimensions.heightMm}`,
                  background: previewBackground,
                  backgroundColor: background.mode === 'original' ? undefined : background.mode === 'solid' ? background.color : '#ffffff',
                  backgroundSize: background.mode === 'original' ? '20px 20px' : undefined,
                  backgroundPosition: background.mode === 'original' ? '0 0, 0 10px, 10px -10px, -10px 0px' : undefined,
                }}
              >
                <img
                  src={uploadedImage.objectUrl}
                  alt={uploadedImage.metadata.name ? `Preview of ${uploadedImage.metadata.name}` : 'Uploaded photo preview'}
                  className="h-full w-full object-cover"
                  style={{ filter }}
                />
                <div className="pointer-events-none absolute inset-0 border border-white/70" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <div className="max-w-sm text-center" data-testid="live-preview-empty">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm" aria-hidden="true">📷</div>
              <p className="mt-4 text-sm font-semibold text-slate-950">Upload a photo to see the live preview</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">The preview will match the selected preset or custom aspect ratio before export.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <DimensionSummary preset={preset} />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Preview settings</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Background</dt>
                <dd className="flex items-center gap-2 font-semibold text-slate-950">
                  <span
                    className="h-4 w-4 rounded-full border border-slate-300"
                    style={{ background: background.mode === 'solid' ? background.color : background.mode === 'white' ? '#ffffff' : '#e2e8f0' }}
                    aria-hidden="true"
                  />
                  {BACKGROUND_MODE_LABELS[background.mode]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Color</dt>
                <dd className="font-mono text-xs font-semibold text-slate-950">{background.mode === 'solid' ? background.color : background.mode === 'white' ? '#ffffff' : 'original'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Brightness / contrast</dt>
                <dd className="font-semibold text-slate-950">{adjustments.brightness}% / {adjustments.contrast}%</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
