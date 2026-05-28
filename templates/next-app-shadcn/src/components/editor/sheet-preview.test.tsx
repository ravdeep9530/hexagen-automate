/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SheetPreview } from './sheet-preview';
import { useEditorStore } from '../../store/editor-store';

vi.mock('../../store/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

describe('SheetPreview', () => {
  const baseMockStore = {
    uploadedImage: null,
    selectedPresetId: 'us-passport',
    customPreset: { widthMm: 51, heightMm: 51, dpi: 300 },
    background: { mode: 'white' as const, color: '#ffffff', removeBackground: false },
    adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0 },
  };

  beforeEach(() => {
    vi.mocked(useEditorStore).mockImplementation((selector) => selector(baseMockStore as any));
  });

  it('renders with title and description', () => {
    render(<SheetPreview />);
    expect(screen.getByRole('heading', { name: /4×6 sheet preview/i })).toBeInTheDocument();
    expect(screen.getByText(/scaled layout/i)).toBeInTheDocument();
  });

  it('displays sheet layout calculation', () => {
    render(<SheetPreview />);
    expect(screen.getByText(/sheet calculation/i)).toBeInTheDocument();
    expect(screen.getByText(/photo size/i)).toBeInTheDocument();
    expect(screen.getByText(/margins/i)).toBeInTheDocument();
    expect(screen.getByText(/gap/i)).toBeInTheDocument();
    expect(screen.getByText(/grid/i)).toBeInTheDocument();
    expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('displays photo count badge', () => {
    render(<SheetPreview />);
    expect(screen.getByText(/2 photos fit/i)).toBeInTheDocument();
  });

  it('renders sheet preview area', () => {
    render(<SheetPreview />);
    expect(screen.getByTestId('sheet-preview-page')).toBeInTheDocument();
    expect(screen.getByLabelText(/4 by 6 inch sheet/i)).toBeInTheDocument();
  });

  it('shows photo cells when uploaded', () => {
    const mockStore = {
      ...baseMockStore,
      uploadedImage: {
        file: {} as File,
        objectUrl: 'blob:test-photo',
        metadata: { name: 'photo.jpg', size: 1, type: 'image/jpeg', lastModified: 1, width: 800, height: 800 },
      },
    };
    vi.mocked(useEditorStore).mockImplementation((selector) => selector(mockStore as any));

    render(<SheetPreview />);
    const images = screen.queryAllByRole('img', { hidden: true });
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0]).toHaveAttribute('src', 'blob:test-photo');
  });

  it('displays correct grid dimensions for preset', () => {
    render(<SheetPreview />);
    expect(screen.getByText(/1 × 2/i)).toBeInTheDocument();
  });

  it('handles custom preset dimensions', () => {
    vi.mocked(useEditorStore).mockImplementation((selector) =>
      selector({ ...baseMockStore, selectedPresetId: 'custom-size', customPreset: { widthMm: 25, heightMm: 35, dpi: 300 } } as any),
    );

    render(<SheetPreview />);
    expect(screen.getByText(/12 photos fit/i)).toBeInTheDocument();
    expect(screen.getByText(/3 × 4/i)).toBeInTheDocument();
  });

  it('displays printable dimensions in millimeters', () => {
    render(<SheetPreview />);
    expect(screen.getAllByText(/mm/i).length).toBeGreaterThanOrEqual(1);
  });
});
