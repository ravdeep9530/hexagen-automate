// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CropControls } from './crop-controls';
import { createDefaultEditorState, useEditorStore } from '@/store/editor-store';

describe('CropControls', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...createDefaultEditorState() }, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('updates zoom and rotation in the editor store', async () => {
    render(<CropControls />);

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2.2' } });
    fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '45' } });

    await waitFor(() => {
      expect(useEditorStore.getState().crop.zoom).toBe(2.2);
      expect(useEditorStore.getState().crop.rotation).toBe(45);
    });
  });

  it('toggles grid and face guide visibility', async () => {
    render(<CropControls />);

    fireEvent.click(screen.getByRole('button', { name: /hide grid/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide face guide/i }));

    await waitFor(() => {
      expect(useEditorStore.getState().crop.showGrid).toBe(false);
      expect(useEditorStore.getState().crop.showFaceGuide).toBe(false);
    });

    expect(screen.getByRole('button', { name: /show grid/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /show face guide/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('resets crop position without changing guide toggles', async () => {
    useEditorStore.getState().setCropState({
      crop: { x: 25, y: -15 },
      zoom: 2,
      rotation: 33,
      showGrid: false,
      showFaceGuide: true,
    });

    render(<CropControls />);
    fireEvent.click(screen.getByRole('button', { name: /reset crop position/i }));

    await waitFor(() => {
      expect(useEditorStore.getState().crop).toMatchObject({
        crop: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
        showGrid: false,
        showFaceGuide: true,
      });
    });
  });
});
