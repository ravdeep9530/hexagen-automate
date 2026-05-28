export type PhotoPresetCategory = 'passport' | 'visa' | 'residency' | 'license' | 'custom';

export type PresetBackground = 'white' | 'off-white' | 'light-gray' | 'custom';

export type ExportFormat = 'png' | 'jpeg';

export type ExportMode = 'single' | 'sheet';

export type ExportStatus = 'idle' | 'preparing' | 'exporting' | 'success' | 'error';

export const EDITOR_STEPS = {
  UPLOAD: 'upload',
  CROP: 'crop',
  PREVIEW: 'preview',
  EXPORT: 'export',
} as const;

export type EditorStep = (typeof EDITOR_STEPS)[keyof typeof EDITOR_STEPS];

export interface PhotoPreset {
  id: string;
  label: string;
  category: PhotoPresetCategory;
  country: string | null;
  widthMm: number;
  heightMm: number;
  dpi: number;
  background: PresetBackground;
  headHeightRatio?: {
    min: number;
    max: number;
  } | null;
  eyeLineRatio?: number | null;
  notes: string[];
}

export interface UploadedImageMetadata {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  width?: number;
  height?: number;
}

export interface UploadedImage {
  file: File;
  objectUrl: string;
  metadata: UploadedImageMetadata;
}

export interface CustomPresetValues {
  widthMm: number;
  heightMm: number;
  dpi: number;
}

export interface CropPoint {
  x: number;
  y: number;
}

export interface CropAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropState {
  crop: CropPoint;
  zoom: number;
  rotation: number;
  croppedAreaPixels: CropAreaPixels | null;
  showGrid: boolean;
  showFaceGuide: boolean;
}

export type BackgroundMode = 'original' | 'white' | 'solid';

export interface BackgroundSettings {
  mode: BackgroundMode;
  color: string;
  removeBackground: boolean;
}

export interface AdjustmentSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
}

export interface ExportConfig {
  format: ExportFormat;
  mode: ExportMode;
  quality: number;
  dpi: number;
  includeBleed: boolean;
  sheetColumns: number;
  sheetRows: number;
}

export interface EditorState {
  uploadedImage: UploadedImage | null;
  selectedPresetId: string;
  customPreset: CustomPresetValues;
  crop: CropState;
  background: BackgroundSettings;
  adjustments: AdjustmentSettings;
  exportConfig: ExportConfig;
  validationMessage: string | null;
  exportStatus: ExportStatus;
  isExporting: boolean;
  currentStep: EditorStep;
}
