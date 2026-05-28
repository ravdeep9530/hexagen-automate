'use client';

import React, { useCallback } from 'react';
import type { ExportFormat, ExportMode } from '../../types/editor';
import { getResolvedPreset } from '../../data/photo-presets';
import { calculatePresetDimensions, FOUR_BY_SIX_SHEET, mmToPixels } from '../../lib/dimensions';
import { renderCroppedPhoto, renderPrintableSheet } from '../../lib/canvas-renderer';
import { buildExportFilename, createDownloadableExport, triggerBrowserDownload } from '../../lib/download';
import { useEditorStore } from '../../store/editor-store';
import { ExportFormatControls } from './export-format-controls';
import { DimensionSummary } from './dimension-summary';

export function ExportPanel(): React.JSX.Element {
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const preset = getResolvedPreset(selectedPresetId, customPreset);
  const outputDpi = useEditorStore((state) => state.exportConfig.dpi) || preset.dpi;
  const dimensions = calculatePresetDimensions(preset, outputDpi);
  const sheetWidthPx = mmToPixels(FOUR_BY_SIX_SHEET.widthMm, outputDpi);
  const sheetHeightPx = mmToPixels(FOUR_BY_SIX_SHEET.heightMm, outputDpi);

  const croppedAreaPixels = useEditorStore((state) => state.crop.croppedAreaPixels);
  const cropRotation = useEditorStore((state) => state.crop.rotation);
  const background = useEditorStore((state) => state.background);
  const adjustments = useEditorStore((state) => state.adjustments);
  const exportConfig = useEditorStore((state) => state.exportConfig);
  const isExporting = useEditorStore((state) => state.isExporting);
  const exportStatus = useEditorStore((state) => state.exportStatus);
  const validationMessage = useEditorStore((state) => state.validationMessage);

  const setExportConfig = useEditorStore((state) => state.setExportConfig);
  const setExportStatus = useEditorStore((state) => state.setExportStatus);
  const setIsExporting = useEditorStore((state) => state.setIsExporting);
  const setValidationMessage = useEditorStore((state) => state.setValidationMessage);

  const canExport = Boolean(uploadedImage && croppedAreaPixels && !isExporting);

  const handleFormatChange = useCallback((format: ExportFormat) => {
    setExportConfig({ format });
  }, [setExportConfig]);

  const handleQualityChange = useCallback((quality: number) => {
    setExportConfig({ quality });
  }, [setExportConfig]);

  const handleModeChange = useCallback((mode: ExportMode) => {
    if (!isExporting) {
      setExportConfig({ mode });
    }
  }, [isExporting, setExportConfig]);

  const handleExport = useCallback(async (mode: ExportMode) => {
    if (!uploadedImage || !croppedAreaPixels || isExporting) {
      return;
    }

    setExportConfig({ mode });
    setValidationMessage(null);
    setIsExporting(true);
    setExportStatus('exporting');

    try {
      const renderBackground = {
        mode: (background.mode === 'solid' ? 'solid' : 'white') as 'solid' | 'white',
        color: background.mode === 'solid' ? background.color : '#ffffff',
      };

      const commonRenderOptions = {
        image: uploadedImage.objectUrl,
        croppedAreaPixels,
        rotation: cropRotation,
        background: renderBackground,
        adjustments: {
          brightness: adjustments.brightness,
          contrast: adjustments.contrast,
        },
        format: exportConfig.format,
        jpegQuality: exportConfig.quality,
      };

      const result = mode === 'single'
        ? await renderCroppedPhoto({
            ...commonRenderOptions,
            size: {
              widthMm: preset.widthMm,
              heightMm: preset.heightMm,
              dpi: outputDpi,
            },
          })
        : await renderPrintableSheet({
            ...commonRenderOptions,
            photoSize: {
              widthMm: preset.widthMm,
              heightMm: preset.heightMm,
              dpi: outputDpi,
            },
            sheet: {
              dpi: outputDpi,
              marginMm: FOUR_BY_SIX_SHEET.marginMm,
              gapMm: FOUR_BY_SIX_SHEET.gapMm,
              sheetWidthMm: FOUR_BY_SIX_SHEET.widthMm,
              sheetHeightMm: FOUR_BY_SIX_SHEET.heightMm,
            },
          });

      const filename = buildExportFilename({
        baseName: uploadedImage.metadata.name,
        presetLabel: preset.label,
        mode,
        format: exportConfig.format,
        timestamp: new Date(),
      });
      const downloadable = createDownloadableExport(result.blob, filename);
      triggerBrowserDownload(downloadable);
      downloadable.revoke();
      setExportStatus('success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Export failed. Please try again.';
      setValidationMessage(errorMessage);
      setExportStatus('error');
    } finally {
      setIsExporting(false);
    }
  }, [uploadedImage, croppedAreaPixels, isExporting, background, adjustments, exportConfig, preset, outputDpi, cropRotation, setExportConfig, setExportStatus, setIsExporting, setValidationMessage]);

  return (
    <section aria-labelledby="export-panel-title" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="export-panel-title" className="text-base font-semibold text-slate-950">Export photo</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Download your cropped photo or a printable 4×6 sheet.</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{preset.label}</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)]">
        <div className="space-y-4">
          <ExportFormatControls
            format={exportConfig.format}
            quality={exportConfig.quality}
            disabled={isExporting}
            onFormatChange={handleFormatChange}
            onQualityChange={handleQualityChange}
          />

          <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4" disabled={isExporting}>
            <legend className="px-1 text-sm font-semibold text-slate-950">Export mode</legend>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Export mode">
              <label className={modeOptionClass(exportConfig.mode === 'single', isExporting)}>
                <input type="radio" name="export-mode" value="single" checked={exportConfig.mode === 'single'} disabled={isExporting} onChange={() => handleModeChange('single')} className="sr-only" />
                <span className="text-sm font-semibold">Single photo</span>
                <span className="text-xs text-slate-500">One high-resolution image at preset size</span>
              </label>
              <label className={modeOptionClass(exportConfig.mode === 'sheet', isExporting)}>
                <input type="radio" name="export-mode" value="sheet" checked={exportConfig.mode === 'sheet'} disabled={isExporting} onChange={() => handleModeChange('sheet')} className="sr-only" />
                <span className="text-sm font-semibold">4×6 sheet</span>
                <span className="text-xs text-slate-500">Multiple photos on a printable sheet</span>
              </label>
            </div>
            {exportConfig.mode === 'sheet' ? (
              <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm">
                Fits <span className="font-semibold text-slate-950">{exportConfig.sheetColumns * exportConfig.sheetRows}</span> photos on a 4×6 in sheet
              </p>
            ) : null}
          </fieldset>

          <div className="space-y-3">
            <button type="button" onClick={() => handleExport('single')} disabled={!canExport} className={exportButtonClass(!canExport)} aria-describedby={canExport ? undefined : 'export-help-text'}>
              {isExporting && exportConfig.mode === 'single' ? 'Exporting...' : 'Export single photo'}
            </button>
            <button type="button" onClick={() => handleExport('sheet')} disabled={!canExport} className={exportButtonClass(!canExport)} aria-describedby={canExport ? undefined : 'export-help-text'}>
              {isExporting && exportConfig.mode === 'sheet' ? 'Exporting sheet...' : `Export 4×6 sheet (${exportConfig.sheetColumns * exportConfig.sheetRows} photos)`}
            </button>
            {!canExport && (
              <p id="export-help-text" className="text-sm text-slate-500" aria-live="polite">Upload an image and crop it to enable export.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <DimensionSummary preset={preset} />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Output preview</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <OutputFact label="Mode" value={exportConfig.mode === 'single' ? 'Single photo' : '4×6 sheet'} />
              <OutputFact label="Format" value={exportConfig.format === 'png' ? 'PNG' : 'JPEG'} />
              <OutputFact label="Single pixels" value={`${dimensions.widthPx} × ${dimensions.heightPx} px`} />
              <OutputFact label="Sheet pixels" value={`${sheetWidthPx} × ${sheetHeightPx} px`} />
              <OutputFact label="DPI" value={`${outputDpi} DPI`} />
              <OutputFact label="Sheet grid" value={`${exportConfig.sheetColumns} × ${exportConfig.sheetRows}`} />
            </div>
          </div>

          {validationMessage ? (
            <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-800">Export error</p>
              <p className="mt-1 text-sm text-red-700">{validationMessage}</p>
            </div>
          ) : null}

          {isExporting ? (
            <div role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-800">{exportStatus === 'preparing' ? 'Preparing export...' : 'Exporting...'}</p>
              <p className="mt-1 text-sm text-blue-700">Your photo is being rendered and prepared for download.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function OutputFact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

const modeOptionClass = (selected: boolean, disabled: boolean): string =>
  [
    'flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600',
    selected ? 'border-blue-500 bg-blue-50 text-blue-950 shadow-sm' : 'border-slate-200 bg-white text-slate-800',
    disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-blue-300',
  ].join(' ');

const exportButtonClass = (disabled: boolean): string =>
  [
    'w-full rounded-xl px-4 py-3 text-sm font-semibold transition focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-600',
    disabled ? 'cursor-not-allowed bg-slate-200 text-slate-500' : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
  ].join(' ');
