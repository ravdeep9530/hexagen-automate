import { describe, expect, it, vi } from 'vitest';
import { buildExportFilename, createDownloadableExport, extensionForFormat, sanitizeFilenamePart } from './download';

describe('sanitizeFilenamePart', () => {
  it('removes markup, path separators, and shell-hostile characters', () => {
    expect(sanitizeFilenamePart('../<img src=x onerror=alert(1)> My Photo?.jpg')).toBe(
      'img-src-x-onerror-alert-1-my-photo.jpg',
    );
  });

  it('falls back when the user supplied value has no safe characters', () => {
    expect(sanitizeFilenamePart('<>:/\\|?*', 'safe-name')).toBe('safe-name');
  });
});

describe('buildExportFilename', () => {
  it('builds deterministic safe names without raw HTML injection', () => {
    const filename = buildExportFilename({
      baseName: '<script>alert(1)</script> Jane Doe',
      presetLabel: 'United States Passport',
      mode: 'sheet',
      format: 'jpeg',
      timestamp: new Date(Date.UTC(2025, 0, 2)),
    });

    expect(filename).toBe('script-alert-1-script-jane-doe-united-states-passport-4x6-sheet-20250102.jpg');
    expect(filename).not.toContain('<');
    expect(filename).not.toContain('>');
  });

  it('uses png and jpg extensions for export formats', () => {
    expect(extensionForFormat('png')).toBe('png');
    expect(extensionForFormat('jpeg')).toBe('jpg');
  });
});

describe('createDownloadableExport', () => {
  it('returns a caller-revokable object URL', () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:photo'),
      revokeObjectURL: vi.fn(),
    };

    const downloadable = createDownloadableExport(blob, '<b>unsafe</b>.png', urlApi);
    expect(downloadable.objectUrl).toBe('blob:photo');
    expect(downloadable.filename).toBe('b-unsafe-b.png');

    downloadable.revoke();
    downloadable.revoke();

    expect(urlApi.createObjectURL).toHaveBeenCalledWith(blob);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
});
