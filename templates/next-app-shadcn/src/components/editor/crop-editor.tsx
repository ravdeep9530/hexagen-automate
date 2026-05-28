'use client';

import { useMemo } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import { getResolvedPreset } from '@/data/photo-presets';
import { calculateAspectRatio } from '@/lib/dimensions';
import { useEditorStore } from '@/store/editor-store';
import { CropControls } from './crop-controls';
import { CropGuides } from './crop-guides';

export function CropEditor(): JSX.Element | null {
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const customPreset = useEditorStore((state) => state.customPreset);
  const cropState = useEditorStore((state) => state.crop);
  const setCropState = useEditorStore((state) => state.setCropState);

  const preset = useMemo(
    () => getResolvedPreset(selectedPresetId, customPreset),
    [selectedPresetId, customPreset],
  );

  const aspectRatio = useMemo(
    () => calculateAspectRatio(preset.widthMm, preset.heightMm),
    [preset.widthMm, preset.heightMm],
  );

  if (!uploadedImage?.objectUrl) {
    return null;
  }

  const handleCropChange = (nextCrop: Point) => {
    setCropState({ crop: nextCrop });
  };

  const handleZoomChange = (nextZoom: number) => {
    setCropState({ zoom: nextZoom });
  };

  const handleRotationChange = (nextRotation: number) => {
    setCropState({ rotation: nextRotation });
  };

  const handleCropComplete = (_croppedArea: Area, croppedAreaPixels: Area) => {
    setCropState({ croppedAreaPixels });
  };

  return (
    <section
      aria-labelledby="crop-editor-title"
      className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="min-w-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="crop-editor-title" className="text-base font-semibold text-slate-950">
              Crop photo
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Drag the image, pinch or scroll to zoom, and use the controls to rotate and align the face.
            </p>
          </div>
          <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            {preset.widthMm} × {preset.heightMm} mm
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
          <div
            className="relative h-[420px] w-full sm:h-[520px]"
            role="img"
            aria-label={`Interactive crop area for ${uploadedImage.metadata.name}`}
            data-testid="cropper-shell"
          >
            <Cropper
              image={uploadedImage.objectUrl}
              crop={cropState.crop}
              zoom={cropState.zoom}
              rotation={cropState.rotation}
              aspect={aspectRatio}
              onCropChange={handleCropChange}
              onZoomChange={handleZoomChange}
              onRotationChange={handleRotationChange}
              onCropComplete={handleCropComplete}
              showGrid={false}
              restrictPosition
              cropShape="rect"
              objectFit="contain"
            />
            <CropGuides
              showGrid={cropState.showGrid}
              showFaceGuide={cropState.showFaceGuide}
              headHeightRatio={preset.headHeightRatio}
              eyeLineRatio={preset.eyeLineRatio}
            />
          </div>
        </div>
      </div>

      <CropControls />
    </section>
  );
}
