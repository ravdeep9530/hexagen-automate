// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CropEditor } from './crop-editor';
import { createDefaultEditorState, useEditorStore } from '@/store/editor-store';
import type { UploadedImage } from '@/types/editor';

vi.mock('react-easy-crop', () => ({
  default: ({
    image,
    crop,
    zoom,
    rotation,
    aspect,
    onCropChange,
    onZoomChange,
    onRotationChange,
    onCropComplete,
  }: {
    image: string;
    crop: { x: number; y: number };
    zoom: number;
    rotation: number;
    aspect: number;
    onCropChange: (point: { x: number; y: number }) => void;
    onZoomChange: (zoom: number) => void;
    onRotationChange: (rotation: number) => void;
    onCropComplete: (area: unknown, pixels: { x: number; y: number; width: number; height: number }) => void;
  }) => (
    <div
      data-testid="mock-cropper"
      data-image={image}
      data-crop={`${crop.x},${crop.y}`}
      data-zoom={zoom}
      data-rotation={rotation}
      data-aspect={aspect}
    >
      <button type="button" onClick={() => onCropChange({ x: 12, y: -8 })}>
        pan
      </button>
      <button type="button" onClick={() => onZoomChange(1.7)}>
        gesture zoom
      </button>
      <button type="button" onClick={() => onRotationChange(15)}>
        gesture rotate
      </button>
      <button
        type="button"
        onClick={() => onCropComplete({}, { x: 1, y: 2, width: 300, height: 400 })}
      >
        complete
      </button>
    </div>
  ),
}));

const createUploadedImage = (objectUrl = 'blob:photo'): UploadedImage => ({
  file: new File(['photo'], 'photo.png', { type: 'image/png' }),
  objectUrl,
  metadata: {
    name: 'photo.png',
    size: 5,
    type: 'image/png',
    lastModified: 1,
  },
});

describe('CropEditor', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...createDefaultEditorState() }, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders only when an uploaded image object URL exists', () => {
    const { rerender } = render(<CropEditor />);

    expect(screen.queryByTestId('mock-cropper')).not.toBeInTheDocument();

    useEditorStore.getState().setUploadedImage(createUploadedImage());
    rerender(<CropEditor />);

    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-image', 'blob:photo');
  });

  it('uses selected preset dimensions for crop aspect ratio', () => {
    useEditorStore.getState().setUploadedImage(createUploadedImage());
    useEditorStore.getState().setSelectedPresetId('uk-passport');

    render(<CropEditor />);

    expect(Number(screen.getByTestId('mock-cropper').getAttribute('data-aspect'))).toBeCloseTo(35 / 45);
  });

  it('uses custom dimensions for crop aspect ratio', () => {
    useEditorStore.getState().setUploadedImage(createUploadedImage());
    useEditorStore.getState().setSelectedPresetId('custom-size');
    useEditorStore.getState().setCustomPreset({ widthMm: 40, heightMm: 50 });

    render(<CropEditor />);

    expect(Number(screen.getByTestId('mock-cropper').getAttribute('data-aspect'))).toBeCloseTo(40 / 50);
  });

  it('persists crop gestures and crop completion pixels to the store', async () => {
    useEditorStore.getState().setUploadedImage(createUploadedImage());
    render(<CropEditor />);

    screen.getByRole('button', { name: 'pan' }).click();
    screen.getByRole('button', { name: 'gesture zoom' }).click();
    screen.getByRole('button', { name: 'gesture rotate' }).click();
    screen.getByRole('button', { name: 'complete' }).click();

    await waitFor(() => {
      expect(useEditorStore.getState().crop).toMatchObject({
        crop: { x: 12, y: -8 },
        zoom: 1.7,
        rotation: 15,
        croppedAreaPixels: { x: 1, y: 2, width: 300, height: 400 },
      });
    });
  });

  it('keeps crop state stable while switching presets except aspect changes', () => {
    useEditorStore.getState().setUploadedImage(createUploadedImage());
    useEditorStore.getState().setCropState({ crop: { x: 4, y: 5 }, zoom: 1.4, rotation: 9 });
    const { rerender } = render(<CropEditor />);

    const firstAspect = Number(screen.getByTestId('mock-cropper').getAttribute('data-aspect'));

    useEditorStore.getState().setSelectedPresetId('canada-passport');
    rerender(<CropEditor />);

    expect(useEditorStore.getState().crop).toMatchObject({ crop: { x: 4, y: 5 }, zoom: 1.4, rotation: 9 });
    expect(Number(screen.getByTestId('mock-cropper').getAttribute('data-aspect'))).not.toBe(firstAspect);
    expect(Number(screen.getByTestId('mock-cropper').getAttribute('data-aspect'))).toBeCloseTo(50 / 70);
  });
});
