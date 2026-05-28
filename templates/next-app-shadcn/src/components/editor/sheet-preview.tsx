'use client';

import { getResolvedPreset } from '../../data/photo-presets';
import { calculateSheetLayout, formatMillimeters, FOUR_BY_SIX_SHEET } from '../../lib/dimensions';
import { useEditorStore } from '../../store/editor-store';

export function SheetPreview(): React.JSX.Element {
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const background = useEditorStore((state) => state.background);
  const adjustments = useEditorStore((state) => state.adjustments);
  const preset = getResolvedPreset(selectedPresetId, customPreset);
  const layout = calculateSheetLayout(preset);
  const photoBackground = background.mode === 'solid' ? background.color : '#ffffff';
  const filter = `brightness(${100 + adjustments.brightness}%) contrast(${100 + adjustments.contrast}%)`;
  const cells = Array.from({ length: layout.count }, (_, index) => index);

  return (
    <section aria-labelledby="sheet-preview-title" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="sheet-preview-title" className="text-base font-semibold text-slate-950">4×6 sheet preview</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Scaled layout using current photo dimensions, margins, and gaps.</p>
        </div>
        <span className="w-fit rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700" aria-live="polite">
          {layout.count} photos fit
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1fr)]">
        <div className="flex justify-center rounded-2xl bg-slate-50 p-4">
          <div
            data-testid="sheet-preview-page"
            className="relative w-full max-w-[280px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg"
            style={{ aspectRatio: `${layout.sheetWidthMm} / ${layout.sheetHeightMm}` }}
            aria-label={`4 by 6 inch sheet with ${layout.count} photos`}
          >
            <div
              className="absolute grid"
              style={{
                left: `${(layout.marginMm / layout.sheetWidthMm) * 100}%`,
                top: `${(layout.marginMm / layout.sheetHeightMm) * 100}%`,
                width: `${(layout.usedWidthMm / layout.sheetWidthMm) * 100}%`,
                height: `${(layout.usedHeightMm / layout.sheetHeightMm) * 100}%`,
                gridTemplateColumns: `repeat(${Math.max(layout.columns, 1)}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${Math.max(layout.rows, 1)}, minmax(0, 1fr))`,
                gap: `${Math.max(2, (layout.gapMm / layout.sheetWidthMm) * 220)}px`,
              }}
            >
              {cells.length > 0 ? cells.map((cell) => (
                <div
                  key={cell}
                  className="overflow-hidden border border-blue-300 bg-blue-50"
                  style={{ aspectRatio: `${layout.photoWidthMm} / ${layout.photoHeightMm}`, backgroundColor: photoBackground }}
                >
                  {uploadedImage ? (
                    <img src={uploadedImage.objectUrl} alt="" className="h-full w-full object-cover" style={{ filter }} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-slate-400">Photo</div>
                  )}
                </div>
              )) : (
                <div className="rounded border border-dashed border-red-300 bg-red-50 p-2 text-center text-xs font-semibold text-red-700">No fit</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Sheet calculation</h3>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Sheet</dt>
              <dd className="mt-1 font-semibold text-slate-950">4 × 6 in</dd>
              <dd className="text-xs text-slate-500">{formatMillimeters(FOUR_BY_SIX_SHEET.widthMm)} × {formatMillimeters(FOUR_BY_SIX_SHEET.heightMm)}</dd>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Photo size</dt>
              <dd className="mt-1 font-semibold text-slate-950">{formatMillimeters(layout.photoWidthMm)} × {formatMillimeters(layout.photoHeightMm)}</dd>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Margins</dt>
              <dd className="mt-1 font-semibold text-slate-950">{formatMillimeters(layout.marginMm)}</dd>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Gap</dt>
              <dd className="mt-1 font-semibold text-slate-950">{formatMillimeters(layout.gapMm)}</dd>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Grid</dt>
              <dd className="mt-1 font-semibold text-slate-950">{layout.columns} × {layout.rows}</dd>
            </div>
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Total</dt>
              <dd className="mt-1 font-semibold text-slate-950">{layout.count} photos</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
