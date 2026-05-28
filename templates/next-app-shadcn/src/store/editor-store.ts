import type {
  AdjustmentSettings,
  BackgroundSettings,
  CropState,
  CustomPresetValues,
  EditorState,
  EditorStep,
  ExportConfig,
  ExportStatus,
  UploadedImage,
} from '../types/editor';
import { EDITOR_STEPS } from '../types/editor';

export const DEFAULT_SELECTED_PRESET_ID = 'us-passport';

export const DEFAULT_CUSTOM_PRESET: CustomPresetValues = {
  widthMm: 35,
  heightMm: 45,
  dpi: 300,
};

export const DEFAULT_CROP_STATE: CropState = {
  crop: { x: 0, y: 0 },
  zoom: 1,
  rotation: 0,
  croppedAreaPixels: null,
  showGrid: true,
  showFaceGuide: true,
};

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  mode: 'white',
  color: '#ffffff',
  removeBackground: false,
};

export const DEFAULT_ADJUSTMENT_SETTINGS: AdjustmentSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  format: 'png',
  mode: 'single',
  quality: 0.92,
  dpi: 300,
  includeBleed: false,
  sheetColumns: 2,
  sheetRows: 3,
};

const cloneCropState = (): CropState => ({
  crop: { ...DEFAULT_CROP_STATE.crop },
  zoom: DEFAULT_CROP_STATE.zoom,
  rotation: DEFAULT_CROP_STATE.rotation,
  croppedAreaPixels: DEFAULT_CROP_STATE.croppedAreaPixels,
  showGrid: DEFAULT_CROP_STATE.showGrid,
  showFaceGuide: DEFAULT_CROP_STATE.showFaceGuide,
});

export const createDefaultEditorState = (): EditorState => ({
  uploadedImage: null,
  selectedPresetId: DEFAULT_SELECTED_PRESET_ID,
  customPreset: { ...DEFAULT_CUSTOM_PRESET },
  crop: cloneCropState(),
  background: { ...DEFAULT_BACKGROUND_SETTINGS },
  adjustments: { ...DEFAULT_ADJUSTMENT_SETTINGS },
  exportConfig: { ...DEFAULT_EXPORT_CONFIG },
  validationMessage: null,
  exportStatus: 'idle',
  isExporting: false,
  currentStep: EDITOR_STEPS.UPLOAD,
});

export interface EditorActions {
  setUploadedImage: (image: UploadedImage | null) => void;
  setSelectedPresetId: (presetId: string) => void;
  setCustomPreset: (values: Partial<CustomPresetValues>) => void;
  setCropState: (crop: Partial<CropState>) => void;
  setBackgroundSettings: (settings: Partial<BackgroundSettings>) => void;
  setAdjustments: (settings: Partial<AdjustmentSettings>) => void;
  setExportConfig: (config: Partial<ExportConfig>) => void;
  setValidationMessage: (message: string | null) => void;
  setExportStatus: (status: ExportStatus) => void;
  setIsExporting: (isExporting: boolean) => void;
  setCurrentStep: (step: EditorStep) => void;
  resetEditor: () => void;
  cleanupUploadedImage: () => void;
}

export type EditorStore = EditorState & EditorActions;

type Listener = () => void;
type StorePartial = Partial<EditorStore>;
type StoreUpdater = StorePartial | ((state: EditorStore) => StorePartial);

class Store {
  private state: EditorStore;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      ...createDefaultEditorState(),
      ...this.newActions(),
    };
  }

  private newActions(): EditorActions {
    return {
      setUploadedImage: (image: UploadedImage | null) => {
        const previous = this.state.uploadedImage;
        if (previous?.objectUrl && previous.objectUrl !== image?.objectUrl) {
          revokeObjectUrl(previous.objectUrl);
        }
        this.setState({ uploadedImage: image });
      },
      setSelectedPresetId: (presetId: string) => this.setState({ selectedPresetId: presetId }),
      setCustomPreset: (values: Partial<CustomPresetValues>) => {
        this.setState((state) => ({
          customPreset: sanitizeCustomPresetUpdate(state.customPreset, values),
        }));
      },
      setCropState: (crop: Partial<CropState>) => {
        this.setState((state) => ({
          crop: {
            ...state.crop,
            ...crop,
            crop: crop.crop ? { ...state.crop.crop, ...crop.crop } : state.crop.crop,
            croppedAreaPixels:
              crop.croppedAreaPixels === undefined ? state.crop.croppedAreaPixels : crop.croppedAreaPixels,
          },
        }));
      },
      setBackgroundSettings: (settings: Partial<BackgroundSettings>) => {
        this.setState((state) => ({
          background: { ...state.background, ...settings },
        }));
      },
      setAdjustments: (settings: Partial<AdjustmentSettings>) => {
        this.setState((state) => ({
          adjustments: { ...state.adjustments, ...settings },
        }));
      },
      setExportConfig: (config: Partial<ExportConfig>) => {
        this.setState((state) => ({
          exportConfig: { ...state.exportConfig, ...config },
        }));
      },
      setValidationMessage: (message: string | null) => {
        this.setState({ validationMessage: message });
      },
      setExportStatus: (status: ExportStatus) => {
        this.setState({ exportStatus: status });
      },
      setIsExporting: (isExporting: boolean) => {
        this.setState({ isExporting });
      },
      setCurrentStep: (step: EditorStep) => {
        this.setState({ currentStep: step });
      },
      resetEditor: () => {
        revokeObjectUrl(this.state.uploadedImage?.objectUrl);
        this.replaceState({ ...createDefaultEditorState(), ...this.newActions() });
      },
      cleanupUploadedImage: () => {
        revokeObjectUrl(this.state.uploadedImage?.objectUrl);
        this.setState({ uploadedImage: null, currentStep: EDITOR_STEPS.UPLOAD });
      },
    };
  }

  getState(): EditorStore {
    return this.state;
  }

  setState(partial: StoreUpdater): void {
    const nextPartial = typeof partial === 'function' ? partial(this.state) : partial;
    this.state = { ...this.state, ...nextPartial };
    this.emitChange();
  }

  replaceState(nextState: EditorStore): void {
    this.state = nextState;
    this.emitChange();
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const store = new Store();

type UseEditorStore = {
  (): EditorStore;
  <TSelected>(selector: (state: EditorStore) => TSelected): TSelected;
  getState: () => EditorStore;
  setState: (partial: StoreUpdater, replace?: boolean) => void;
  subscribe: (listener: Listener) => () => void;
};

const useEditorStoreHook = (<TSelected>(
  selector?: (state: EditorStore) => TSelected,
): EditorStore | TSelected => {
  if (typeof window === 'undefined') {
    return selector ? selector(store.getState()) : store.getState();
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useSyncExternalStore } = require('react') as typeof import('react');
  return useSyncExternalStore(
    (cb: Listener) => store.subscribe(cb),
    () => (selector ? selector(store.getState()) : store.getState()),
    () => (selector ? selector(store.getState()) : store.getState()),
  );
}) as UseEditorStore;

useEditorStoreHook.getState = () => store.getState();
useEditorStoreHook.setState = (partial: StoreUpdater, replace = false) => {
  if (replace) {
    store.replaceState({ ...createDefaultEditorState(), ...store.getState(), ...partial });
  } else {
    store.setState(partial);
  }
};
useEditorStoreHook.subscribe = (listener: Listener) => store.subscribe(listener);

export const useEditorStore = useEditorStoreHook;

const revokeObjectUrl = (objectUrl?: string | null): void => {
  if (!objectUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  URL.revokeObjectURL(objectUrl);
};

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const sanitizeCustomPresetUpdate = (
  current: CustomPresetValues,
  values: Partial<CustomPresetValues>,
): CustomPresetValues => ({
  widthMm: isPositiveNumber(values.widthMm) ? values.widthMm : current.widthMm,
  heightMm: isPositiveNumber(values.heightMm) ? values.heightMm : current.heightMm,
  dpi: isPositiveNumber(values.dpi) ? values.dpi : current.dpi,
});
