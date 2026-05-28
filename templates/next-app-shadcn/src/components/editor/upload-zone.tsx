'use client';

import type { JSX } from 'react';
import { ChangeEvent, DragEvent, KeyboardEvent, useId, useRef, useState } from 'react';
import { DEFAULT_MAX_IMAGE_SIZE_BYTES, validateImageFile } from '../../lib/upload-validation';
import { useEditorStore } from '../../store/editor-store';
import type { UploadedImage } from '../../types/editor';

export interface UploadZoneProps {
  maxSizeBytes?: number;
}

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

const fileSizeInMb = (bytes: number): string => Number.parseFloat((bytes / (1024 * 1024)).toFixed(1)).toString();

export default function UploadZone({ maxSizeBytes = DEFAULT_MAX_IMAGE_SIZE_BYTES }: UploadZoneProps): JSX.Element {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const setUploadedImage = useEditorStore((state) => state.setUploadedImage);
  const setValidationMessage = useEditorStore((state) => state.setValidationMessage);
  const validationMessage = useEditorStore((state) => state.validationMessage);

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      setValidationMessage('Choose a JPG, PNG, or WEBP image to continue.');
      return;
    }

    setValidationMessage('Checking your image…');
    const result = await validateImageFile(file, { maxSizeBytes });

    if (!result.valid) {
      setValidationMessage(result.error);
      return;
    }

    const uploadedImage: UploadedImage = {
      file: result.file,
      objectUrl: result.objectUrl,
      metadata: {
        name: result.file.name,
        size: result.file.size,
        type: result.file.type,
        lastModified: result.file.lastModified,
        width: result.naturalWidth,
        height: result.naturalHeight,
      },
    };

    setUploadedImage(uploadedImage);
    setValidationMessage(
      `Image ready: ${result.file.name}, ${result.naturalWidth} by ${result.naturalHeight} pixels.`,
    );
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await handleFile(event.dataTransfer.files?.[0]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  };

  return (
    <section aria-labelledby={`${inputId}-heading`} className="w-full">
      <div
        role="button"
        tabIndex={0}
        aria-describedby={`${inputId}-help ${inputId}-status`}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
          isDragging ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-500 hover:bg-slate-50'
        }`}
      >
        <div className="space-y-3">
          <h2 id={`${inputId}-heading`} className="text-xl font-semibold text-slate-950">
            Upload your passport photo
          </h2>
          <p id={`${inputId}-help`} className="text-sm text-slate-600">
            Drag and drop an image here, or browse from your device. JPG, PNG, and WEBP files up to{' '}
            {fileSizeInMb(maxSizeBytes)} MB are supported.
          </p>
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2"
            onClick={(event) => event.stopPropagation()}
          >
            Browse or take a photo
          </label>
          <input
            ref={fileInputRef}
            id={inputId}
            name="passport-photo"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            capture="environment"
            inputMode="none"
            className="sr-only"
            aria-label="Choose a JPG, PNG, or WEBP image"
            onChange={handleInputChange}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </div>
      <p id={`${inputId}-status`} role="status" aria-live="polite" className="mt-3 text-sm text-slate-700">
        {validationMessage ?? 'No image selected yet.'}
      </p>
    </section>
  );
}
