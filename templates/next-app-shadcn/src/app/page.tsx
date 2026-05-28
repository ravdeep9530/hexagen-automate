'use client';

import type { JSX, RefObject } from 'react';
import { lazy, Suspense, useRef } from 'react';
import { motion } from 'framer-motion';
import { useEditorStore } from '../store/editor-store';
import { EDITOR_STEPS } from '../types/editor';
import Hero from '../components/marketing/hero';
import Features from '../components/marketing/features';

const EditorShell = lazy(() => import('../components/editor/editor-shell'));
const SupportedCountries = lazy(() => import('../components/marketing/supported-countries'));
const BeforeAfter = lazy(() => import('../components/marketing/before-after'));
const FAQ = lazy(() => import('../components/marketing/faq'));
const SiteFooter = lazy(() => import('../components/marketing/site-footer'));

function EditorSection({ editorRef }: { editorRef: RefObject<HTMLDivElement | null> }): JSX.Element {
  const currentStep = useEditorStore((state) => state.currentStep);
  const hasImage = useEditorStore((state) => state.uploadedImage !== null);

  return (
    <motion.section
      id="create"
      ref={editorRef}
      className="py-12 lg:py-20"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Your <span className="text-blue-600">Passport Photo</span> Made Easy
            </h2>
            <p className="mt-3 text-slate-600">
              Upload an image, choose a sizing preset, adjust the crop, and download your print-ready photo. Works right in your browser—no account needed.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <Suspense
              fallback={
                <div className="flex min-h-64 items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
                  <div className="text-center">
                    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                    <p className="text-sm text-slate-600">Loading editor…</p>
                  </div>
                </div>
              }
            >
              <EditorShell />
            </Suspense>
          </div>

          <div className="mt-6 text-center text-sm text-slate-500">
            <p>
              {currentStep === EDITOR_STEPS.UPLOAD && !hasImage ? (
                <span>Need help? Most document photos work best with a plain background and direct lighting.</span>
              ) : null}
              {currentStep === EDITOR_STEPS.CROP && hasImage ? (
                <span>Tip: Adjust the grid to position your eyes roughly one-third down from the top. Use the preset guides as practical assistance.</span>
              ) : null}
              {currentStep === EDITOR_STEPS.PREVIEW && hasImage ? (
                <span>Preview shows how your photo may appear when printed. Always verify current photo rules with the requesting authority before submitting.</span>
              ) : null}
              {currentStep === EDITOR_STEPS.EXPORT && hasImage ? (
                <span>Export includes a single photo and an optional print sheet formatted for 4×6 photo paper.</span>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

export default function HomePage(): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);
  const setCurrentStep = useEditorStore((state) => state.setCurrentStep);

  const handleStartCreating = () => {
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentStep(EDITOR_STEPS.UPLOAD);
  };

  return (
    <main className="min-h-screen bg-white">
      <Hero onStartCreating={handleStartCreating} />
      <EditorSection editorRef={editorRef} />
      <Features />
      <Suspense fallback={null}><SupportedCountries /></Suspense>
      <Suspense fallback={null}><BeforeAfter /></Suspense>
      <Suspense fallback={null}><FAQ /></Suspense>
      <Suspense fallback={null}><SiteFooter /></Suspense>
    </main>
  );
}
