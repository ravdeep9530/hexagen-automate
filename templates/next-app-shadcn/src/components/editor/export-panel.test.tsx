// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../store/editor-store';
import { ExportPanel } from './export-panel';
import type { UploadedImage } from '../../types/editor';

const mockCanvasRenderer = {
  renderCroppedPhoto: vi.fn(),
  renderPrintableSheet: vi.fn(),
};

const mockDownload = {
  buildExportFilename: vi.fn(),
  createDownloadableExport: vi.fn(),
  triggerBrowserDownload: vi.fn(),
};

vi.mock('../../lib/canvas-renderer', () => ({
  renderCroppedPhoto: (...args: unknown[]) => mockCanvasRenderer.renderCroppedPhoto(...args),
  renderPrintableSheet: (...args: unknown[]) => mockCanvasRenderer.renderPrintableSheet(...args),
}));

vi.mock('../../lib/download', () => ({
  buildExportFilename: (...args: unknown[]) => mockDownload.buildExportFilename(...args),
  createDownloadableExport: (...args: unknown[]) => mockDownload.createDownloadableExport(...args),
  triggerBrowserDownload: (...args: unknown[]) => mockDownload.triggerBrowserDownload(...args),
}));

const createUploadedImage = (name = 'test.png'): UploadedImage => ({
  file: { name, size: 1000, type: 'image/png', lastModified: Date.now() } as File,
  objectUrl: 'blob:test-image',
  metadata: { name, size: 1000, type: 'image/png', lastModified: Date.now(), width: 1200, height: 1600 },
});

const readyCrop = { x: 0, y: 0, width: 100, height: 100 };

describe('ExportPanel', () => {
  beforeEach(() => {
    cleanup();
    useEditorStore.setState({
      uploadedImage: null,
      selectedPresetId: 'us-passport',
      customPreset: { widthMm: 35, heightMm: 45, dpi: 300 },
      crop: { crop: { x: 0, y: 0 }, zoom: 1, rotation: 0, croppedAreaPixels: null, showGrid: true, showFaceGuide: true },
      background: { mode: 'white', color: '#ffffff', removeBackground: false },
      adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 },
      exportConfig: { format: 'png', mode: 'single', quality: 0.92, dpi: 300, includeBleed: false, sheetColumns: 2, sheetRows: 3 },
      validationMessage: null,
      exportStatus: 'idle',
      isExporting: false,
    }, true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('disables export actions until an image is uploaded', () => {
    render(<ExportPanel />);
    expect(screen.getByRole('button', { name: /export single photo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /export 4×6 sheet/i })).toBeDisabled();
  });

  it('disables export actions when image is uploaded but croppedAreaPixels is not available', () => {
    useEditorStore.setState({ uploadedImage: createUploadedImage() });
    render(<ExportPanel />);
    expect(screen.getByRole('button', { name: /export single photo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /export 4×6 sheet/i })).toBeDisabled();
  });

  it('enables export actions when image and croppedAreaPixels are available', () => {
    useEditorStore.setState({
      uploadedImage: createUploadedImage(),
      crop: { ...useEditorStore.getState().crop, croppedAreaPixels: readyCrop },
    });
    render(<ExportPanel />);
    expect(screen.getByRole('button', { name: /export single photo/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /export 4×6 sheet/i })).toBeEnabled();
  });

  it('enables format switching and JPEG quality control', () => {
    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /jpeg/i }));

    expect(useEditorStore.getState().exportConfig.format).toBe('jpeg');
    expect(screen.getByLabelText('JPEG quality')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.8' } });
    expect(useEditorStore.getState().exportConfig.quality).toBe(0.8);
  });

  it('allows switching between single photo and sheet export modes', () => {
    render(<ExportPanel />);
    const sheetRadio = screen.getByRole('radio', { name: /4×6 sheet$/i });
    fireEvent.click(sheetRadio);
    expect(useEditorStore.getState().exportConfig.mode).toBe('sheet');
  });

  it('exports a single photo, toggles status, downloads, and revokes the URL', async () => {
    const revoke = vi.fn();
    useEditorStore.setState({
      uploadedImage: createUploadedImage('unsafe <name>.png'),
      crop: { ...useEditorStore.getState().crop, croppedAreaPixels: readyCrop },
    });
    mockCanvasRenderer.renderCroppedPhoto.mockResolvedValue({
      blob: new Blob(['photo']),
      widthPx: 602,
      heightPx: 602,
      mimeType: 'image/png' as const,
    });
    mockDownload.buildExportFilename.mockReturnValue('safe.png');
    mockDownload.createDownloadableExport.mockReturnValue({
      blob: new Blob(['photo']),
      filename: 'safe.png',
      objectUrl: 'blob:safe',
      revoke,
    });

    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: /export single photo/i }));

    await waitFor(() => expect(mockCanvasRenderer.renderCroppedPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useEditorStore.getState().isExporting).toBe(false));
    expect(useEditorStore.getState().exportStatus).toBe('success');
    expect(mockDownload.buildExportFilename).toHaveBeenCalled();
    expect(mockDownload.triggerBrowserDownload).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('exports a 4x6 sheet and prevents duplicate clicks while exporting', async () => {
    useEditorStore.setState({
      uploadedImage: createUploadedImage(),
      crop: { ...useEditorStore.getState().crop, croppedAreaPixels: readyCrop },
    });
    render(<ExportPanel />);

    // Click sheet radio first
    fireEvent.click(screen.getByRole('radio', { name: /4×6 sheet$/i }));

    let resolveExport: (value: unknown) => void = () => undefined;
    mockCanvasRenderer.renderPrintableSheet.mockReturnValue(new Promise((resolve) => { resolveExport = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: /export 4×6 sheet/i }));

    await waitFor(() => expect(useEditorStore.getState().isExporting).toBe(true));

    // Clicking while exporting should not trigger additional renders
    mockCanvasRenderer.renderPrintableSheet.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /exporting sheet\.\.\./i }));

    expect(mockCanvasRenderer.renderPrintableSheet).not.toHaveBeenCalled();

    resolveExport({ blob: new Blob(['sheet']), widthPx: 1200, heightPx: 1800, mimeType: 'image/png' as const });
    await waitFor(() => expect(useEditorStore.getState().isExporting).toBe(false));
  });

  it('surfaces export errors through accessible alert text', async () => {
    useEditorStore.setState({
      uploadedImage: createUploadedImage(),
      crop: { ...useEditorStore.getState().crop, croppedAreaPixels: readyCrop },
    });
    mockCanvasRenderer.renderCroppedPhoto.mockRejectedValue(new Error('Canvas failed'));

    render(<ExportPanel />);
    fireEvent.click(screen.getByRole('button', { name: /export single photo/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Canvas failed');
    expect(useEditorStore.getState().exportStatus).toBe('error');
    expect(useEditorStore.getState().isExporting).toBe(false);
  });

  it('displays exact output dimensions before export', () => {
    render(<ExportPanel />);
    // Use getAllByText since there are multiple instances of these dimensions
    expect(screen.getAllByText('602 × 602 px')[0]).toBeInTheDocument();
    expect(screen.getAllByText('1200 × 1800 px')[0]).toBeInTheDocument();
    expect(screen.getAllByText('300 DPI').length).toBeGreaterThan(0);
  });

  it('clears previous validation message before export', async () => {
    const revoke = vi.fn();
    useEditorStore.setState({
      uploadedImage: createUploadedImage(),
      crop: { ...useEditorStore.getState().crop, croppedAreaPixels: readyCrop },
      validationMessage: 'Previous error',
    });
    mockCanvasRenderer.renderCroppedPhoto.mockResolvedValue({
      blob: new Blob(['photo']),
      widthPx: 602,
      heightPx: 602,
      mimeType: 'image/png' as const,
    });
    mockDownload.buildExportFilename.mockReturnValue('safe.png');
    mockDownload.createDownloadableExport.mockReturnValue({
      blob: new Blob(['photo']),
      filename: 'safe.png',
      objectUrl: 'blob:safe',
      revoke,
    });

    render(<ExportPanel />);
    expect(useEditorStore.getState().validationMessage).toBe('Previous error');

    fireEvent.click(screen.getByRole('button', { name: /export single photo/i }));
    expect(useEditorStore.getState().validationMessage).toBeNull();

    await waitFor(() => expect(useEditorStore.getState().exportStatus).toBe('success'));
  });
});
