/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LivePreview, buildAdjustmentFilter } from './live-preview';
import { useEditorStore } from '../../store/editor-store';

vi.mock('../../store/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

describe('buildAdjustmentFilter', () => {
  it('builds filter string with brightness and contrast', () => {
    expect(buildAdjustmentFilter(0, 0)).toBe('brightness(100%) contrast(100%)');
    expect(buildAdjustmentFilter(20, 30)).toBe('brightness(120%) contrast(130%)');
    expect(buildAdjustmentFilter(-20, -10)).toBe('brightness(80%) contrast(90%)');
  });

  it('clamps values to valid range', () => {
    expect(buildAdjustmentFilter(200, 200)).toBe('brightness(200%) contrast(200%)');
    expect(buildAdjustmentFilter(-200, -200)).toBe('brightness(0%) contrast(0%)');
    expect(buildAdjustmentFilter(NaN, NaN)).toBe('brightness(100%) contrast(100%)');
  });
});

describe('LivePreview', () => {
  const baseMockStore = {
    uploadedImage: null,
    selectedPresetId: 'us-passport',
    customPreset: { widthMm: 51, heightMm: 51, dpi: 300 },
    background: { mode: 'white' as const, color: '#ffffff', removeBackground: false },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 },
    exportConfig: { dpi: 300 },
  };

  beforeEach(() => {
    vi.mocked(useEditorStore).mockImplementation((selector) => selector(baseMockStore as any));
  });

  it('renders empty state when no image uploaded', () => {
    render(<LivePreview />);
    expect(screen.getByTestId('live-preview-empty')).toBeInTheDocument();
    expect(screen.getByText(/upload a photo to see the live preview/i)).toBeInTheDocument();
  });

  it('renders preview when image is uploaded', () => {
    const mockStore = {
      ...baseMockStore,
      uploadedImage: {
        file: {} as File,
        objectUrl: 'blob:test-image',
        metadata: { name: 'test.jpg', size: 1, type: 'image/jpeg', lastModified: 1, width: 1200, height: 800 },
      },
    };
    vi.mocked(useEditorStore).mockImplementation((selector) => selector(mockStore as any));

    render(<LivePreview />);
    expect(screen.getByAltText(/preview.*test\.jpg/i)).toBeInTheDocument();
    expect(screen.getByTestId('live-preview-frame')).toBeInTheDocument();
  });

  it('displays preset label', () => {
    render(<LivePreview />);
    expect(screen.getByText(/united states passport/i)).toBeInTheDocument();
  });

  it('shows background mode in preview settings', () => {
    render(<LivePreview />);
    expect(screen.getByText(/plain white background/i)).toBeInTheDocument();
  });

  it('shows custom background mode', () => {
    vi.mocked(useEditorStore).mockImplementation((selector) =>
      selector({ ...baseMockStore, background: { mode: 'solid', color: '#ff0000', removeBackground: false } } as any),
    );

    render(<LivePreview />);
    expect(screen.getByText(/solid color background/i)).toBeInTheDocument();
    expect(screen.getByText(/#ff0000/i)).toBeInTheDocument();
  });

  it('shows adjustment values', () => {
    vi.mocked(useEditorStore).mockImplementation((selector) =>
      selector({ ...baseMockStore, adjustments: { brightness: 10, contrast: 20, saturation: 0, sharpness: 0 } } as any),
    );

    render(<LivePreview />);
    expect(screen.getByText(/10% \/ 20%/i)).toBeInTheDocument();
  });

  it('displays dimension summary', () => {
    render(<LivePreview />);
    expect(screen.getByText(/output dimensions/i)).toBeInTheDocument();
    expect(screen.getByText(/300 DPI/i)).toBeInTheDocument();
  });
});
