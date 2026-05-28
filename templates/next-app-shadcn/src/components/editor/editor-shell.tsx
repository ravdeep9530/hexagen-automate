'use client';

import type { JSX } from 'react';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UploadZone from './upload-zone';
import { CropEditor } from './crop-editor';
import { PresetSelector } from './preset-selector';
import { BackgroundAdjustmentControls } from './background-adjustment-controls';
import { LivePreview } from './live-preview';
import { SheetPreview } from './sheet-preview';
import { ExportPanel } from './export-panel';
import { useEditorStore } from '../../store/editor-store';
import { EDITOR_STEPS, type EditorStep } from '../../types/editor';

function StepIndicator({ currentStep }: { currentStep: EditorStep }): JSX.Element {
  const steps: Array<{ id: EditorStep; label: string }> = [
    { id: EDITOR_STEPS.UPLOAD, label: 'Upload' },
    { id: EDITOR_STEPS.CROP, label: 'Crop' },
    { id: EDITOR_STEPS.PREVIEW, label: 'Preview' },
    { id: EDITOR_STEPS.EXPORT, label: 'Export' },
  ];

  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <nav aria-label="Editor progress" className="mb-6">
      <ol className="flex items-center justify-center gap-2 sm:gap-4">
        {steps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = index < currentIndex;

          return (
            <li
              key={step.id}
              className={`flex items-center gap-2 text-sm ${
                isActive ? 'font-medium text-blue-600' : isCompleted ? 'text-slate-700' : 'text-slate-400'
              }`}
            >
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isCompleted
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
              {index < steps.length - 1 ? <span className="ml-2 h-px w-4 bg-slate-300 sm:w-6" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function EditorStatus(): JSX.Element {
  const currentStep = useEditorStore((state) => state.currentStep);
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const selectedPresetId = useEditorStore((state) => state.selectedPresetId);
  const exportStatus = useEditorStore((state) => state.exportStatus);
  const validationMessage = useEditorStore((state) => state.validationMessage);

  return (
    <aside className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="Editor status">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step</p>
          <p className="mt-1 font-medium capitalize text-slate-900">{currentStep}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Image</p>
          <p className="mt-1 font-medium text-slate-900">{uploadedImage ? uploadedImage.metadata.name : 'Waiting for upload'}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preset</p>
          <p className="mt-1 font-medium text-slate-900">{selectedPresetId.replace(/-/g, ' ')}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Export</p>
          <p className="mt-1 font-medium capitalize text-slate-900">{exportStatus}</p>
        </div>
      </div>
      {validationMessage ? <p className="mt-3 text-sm text-blue-800" role="status" aria-live="polite">{validationMessage}</p> : null}
    </aside>
  );
}

function EmptyEditorState(): JSX.Element {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <svg className="mx-auto mb-4 h-12 w-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <h3 className="text-sm font-medium text-slate-900">No image selected</h3>
      <p className="mt-1 text-xs text-slate-500">Upload a photo to begin editing.</p>
    </div>
  );
}

function WorkflowActions(): JSX.Element {
  const currentStep = useEditorStore((state) => state.currentStep);
  const setCurrentStep = useEditorStore((state) => state.setCurrentStep);

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <button type="button" onClick={() => setCurrentStep(EDITOR_STEPS.CROP)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        Edit crop
      </button>
      <button type="button" onClick={() => setCurrentStep(EDITOR_STEPS.PREVIEW)} disabled={currentStep === EDITOR_STEPS.PREVIEW} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        Preview
      </button>
      <button type="button" onClick={() => setCurrentStep(EDITOR_STEPS.EXPORT)} disabled={currentStep === EDITOR_STEPS.EXPORT} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        Export
      </button>
    </div>
  );
}

function ActiveEditor(): JSX.Element {
  const currentStep = useEditorStore((state) => state.currentStep);
  const uploadedImage = useEditorStore((state) => state.uploadedImage);

  if (!uploadedImage) {
    return <EmptyEditorState />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-12">
        <motion.div className="order-2 space-y-4 lg:order-1 lg:col-span-4 xl:col-span-3" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}>
          <PresetSelector />
          <BackgroundAdjustmentControls />
        </motion.div>

        <motion.div className="order-1 space-y-4 lg:order-2 lg:col-span-8 xl:col-span-9" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: 0.05 }}>
          <CropEditor />

          <div className="grid gap-4 xl:grid-cols-2">
            <AnimatePresence mode="wait">
              {(currentStep === EDITOR_STEPS.PREVIEW || currentStep === EDITOR_STEPS.EXPORT) ? (
                <motion.div key="live-preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                  <LivePreview />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {currentStep === EDITOR_STEPS.EXPORT ? (
                <motion.div key="sheet-preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, delay: 0.05 }}>
                  <SheetPreview />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            {currentStep === EDITOR_STEPS.EXPORT ? (
              <motion.div key="export-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, delay: 0.1 }}>
                <ExportPanel />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </div>
      <WorkflowActions />
    </div>
  );
}

export default function EditorShell(): JSX.Element {
  const currentStep = useEditorStore((state) => state.currentStep);
  const uploadedImage = useEditorStore((state) => state.uploadedImage);
  const setCurrentStep = useEditorStore((state) => state.setCurrentStep);

  useEffect(() => {
    if (uploadedImage && currentStep === EDITOR_STEPS.UPLOAD) {
      setCurrentStep(EDITOR_STEPS.CROP);
    }
  }, [uploadedImage, currentStep, setCurrentStep]);

  return (
    <div className="w-full pb-20 sm:pb-0">
      <EditorStatus />
      {uploadedImage ? <StepIndicator currentStep={currentStep} /> : null}

      <AnimatePresence mode="wait">
        {currentStep === EDITOR_STEPS.UPLOAD && !uploadedImage ? (
          <motion.div key="upload" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.2 }}>
            <UploadZone />
          </motion.div>
        ) : (
          <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
            <details className="group rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                <span>Upload a different image</span>
                <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="mt-3"><UploadZone /></div>
            </details>
            <ActiveEditor />
          </motion.div>
        )}
      </AnimatePresence>

      {uploadedImage ? (
        <div className="fixed inset-x-0 bottom-0 z-40 p-4 sm:hidden">
          <div className="mx-auto flex max-w-md items-center justify-center gap-3 rounded-full border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
            <button type="button" onClick={() => setCurrentStep(EDITOR_STEPS.PREVIEW)} className="flex-1 rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">Preview</button>
            <button type="button" onClick={() => setCurrentStep(EDITOR_STEPS.EXPORT)} className="flex-1 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white">Export</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
