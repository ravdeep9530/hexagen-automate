// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadedImage } from '@/types/editor';
import { createDefaultEditorState, useEditorStore } from './editor-store';

const mockRevokeObjectURL = () => {
  const revokeMock = vi.fn();
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: revokeMock,
    writable: true,
    configurable: true,
  });
  return revokeMock;
};

const createFileStub = (name: string): File =>
  ({
    name,
    size: 11,
    type: 'image/png',
    lastModified: 1_700_000_000_000,
  }) as File;

const createUploadedImage = (objectUrl: string, name = 'photo.png'): UploadedImage => {
  const file = createFileStub(name);
  return {
    file,
    objectUrl,
    metadata: {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      width: 1200,
      height: 1600,
    },
  };
};

describe('editor store', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...createDefaultEditorState() }, true);
    mockRevokeObjectURL();
  });

  it('initializes with default preset, crop, background, adjustment, and export settings', () => {
    const state = useEditorStore.getState();
    expect(state.uploadedImage).toBeNull();
    expect(state.selectedPresetId).toBe('us-passport');
    expect(state.crop.croppedAreaPixels).toBeNull();
    expect(state.exportConfig.format).toBe('png');
    expect(state.exportConfig.mode).toBe('single');
    expect(state.validationMessage).toBeNull();
    expect(state.exportStatus).toBe('idle');
    expect(state.isExporting).toBe(false);
  });

  it('exposes typed actions for primary editor state updates', () => {
    const image = createUploadedImage('blob:current');

    useEditorStore.getState().setUploadedImage(image);
    useEditorStore.getState().setSelectedPresetId('uk-passport');
    useEditorStore.getState().setExportConfig({ format: 'jpeg', mode: 'sheet', quality: 0.8 });
    useEditorStore.getState().setValidationMessage('Use a front-facing photo.');
    useEditorStore.getState().setExportStatus('exporting');
    useEditorStore.getState().setIsExporting(true);

    const state = useEditorStore.getState();
    expect(state.uploadedImage).toBe(image);
    expect(state.selectedPresetId).toBe('uk-passport');
    expect(state.exportConfig.format).toBe('jpeg');
    expect(state.exportConfig.mode).toBe('sheet');
    expect(state.validationMessage).toBe('Use a front-facing photo.');
    expect(state.exportStatus).toBe('exporting');
    expect(state.isExporting).toBe(true);
  });

  it('resets all state and revokes the current uploaded image object URL', () => {
    const revokeSpy = vi.mocked(URL.revokeObjectURL);

    useEditorStore.getState().setUploadedImage(createUploadedImage('blob:reset-me'));
    useEditorStore.getState().setSelectedPresetId('custom-size');
    useEditorStore.getState().setValidationMessage('Invalid background');
    useEditorStore.getState().setExportStatus('error');
    useEditorStore.getState().setIsExporting(true);

    useEditorStore.getState().resetEditor();

    expect(revokeSpy).toHaveBeenCalledWith('blob:reset-me');
    expect(useEditorStore.getState().uploadedImage).toBeNull();
    expect(useEditorStore.getState().selectedPresetId).toBe('us-passport');
    expect(useEditorStore.getState().validationMessage).toBeNull();
    expect(useEditorStore.getState().exportStatus).toBe('idle');
    expect(useEditorStore.getState().isExporting).toBe(false);
  });

  it('revokes the prior image object URL when uploaded image is replaced or cleaned up', () => {
    const revokeSpy = vi.mocked(URL.revokeObjectURL);

    useEditorStore.getState().setUploadedImage(createUploadedImage('blob:first'));
    useEditorStore.getState().setUploadedImage(createUploadedImage('blob:second'));

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:first');
    expect(useEditorStore.getState().uploadedImage?.objectUrl).toBe('blob:second');

    useEditorStore.getState().cleanupUploadedImage();

    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenLastCalledWith('blob:second');
    expect(useEditorStore.getState().uploadedImage).toBeNull();
  });

  describe('isExporting state', () => {
    it('setIsExporting should update the isExporting state', () => {
      expect(useEditorStore.getState().isExporting).toBe(false);

      useEditorStore.getState().setIsExporting(true);
      expect(useEditorStore.getState().isExporting).toBe(true);

      useEditorStore.getState().setIsExporting(false);
      expect(useEditorStore.getState().isExporting).toBe(false);
    });

    it('isExporting should be reset when resetEditor is called', () => {
      useEditorStore.getState().setIsExporting(true);
      expect(useEditorStore.getState().isExporting).toBe(true);

      useEditorStore.getState().resetEditor();
      expect(useEditorStore.getState().isExporting).toBe(false);
    });
  });
});
