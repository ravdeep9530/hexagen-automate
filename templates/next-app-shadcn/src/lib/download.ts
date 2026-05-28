import type { ExportFormat, ExportMode } from '../types/editor';

export interface DownloadableExport {
  blob: Blob;
  filename: string;
  objectUrl: string;
  revoke: () => void;
}

export interface BuildFilenameOptions {
  baseName?: string | null;
  presetLabel?: string | null;
  mode?: ExportMode;
  format?: ExportFormat;
  timestamp?: Date;
}

export interface ObjectUrlApi {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

const DEFAULT_BASENAME = 'passport-photo';
const MAX_FILENAME_STEM_LENGTH = 80;

export const sanitizeFilenamePart = (value: string | null | undefined, fallback = DEFAULT_BASENAME): string => {
  const cleaned = (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/\.-+/g, '.')
    .replace(/^[ ._-]+|[ ._-]+$/g, '')
    .toLowerCase();

  const safe = cleaned || fallback;
  return safe.slice(0, MAX_FILENAME_STEM_LENGTH).replace(/[ ._-]+$/g, '') || fallback;
};

export const extensionForFormat = (format: ExportFormat = 'png'): 'png' | 'jpg' => (format === 'jpeg' ? 'jpg' : 'png');

export const buildExportFilename = ({
  baseName,
  presetLabel,
  mode = 'single',
  format = 'png',
  timestamp,
}: BuildFilenameOptions = {}): string => {
  const date = timestamp ? formatDateStamp(timestamp) : undefined;
  const parts = [
    sanitizeFilenamePart(baseName, DEFAULT_BASENAME),
    presetLabel ? sanitizeFilenamePart(presetLabel, '') : undefined,
    mode === 'sheet' ? '4x6-sheet' : undefined,
    date,
  ].filter(Boolean);

  return `${parts.join('-')}.${extensionForFormat(format)}`;
};

export const createDownloadableExport = (
  blob: Blob,
  filename: string,
  urlApi: ObjectUrlApi = URL,
): DownloadableExport => {
  const safeFilename = sanitizeCompleteFilename(filename);
  const objectUrl = urlApi.createObjectURL(blob);
  let revoked = false;

  return {
    blob,
    filename: safeFilename,
    objectUrl,
    revoke: () => {
      if (!revoked) {
        urlApi.revokeObjectURL(objectUrl);
        revoked = true;
      }
    },
  };
};

export const triggerBrowserDownload = (download: Pick<DownloadableExport, 'filename' | 'objectUrl'>): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = download.objectUrl;
  anchor.download = sanitizeCompleteFilename(download.filename);
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const sanitizeCompleteFilename = (filename: string): string => {
  const dotIndex = filename.lastIndexOf('.');
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : 'png';
  const safeExtension = extension === 'jpg' || extension === 'jpeg' || extension === 'png' ? extension : 'png';

  return `${sanitizeFilenamePart(stem, DEFAULT_BASENAME)}.${safeExtension}`;
};

const formatDateStamp = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};
