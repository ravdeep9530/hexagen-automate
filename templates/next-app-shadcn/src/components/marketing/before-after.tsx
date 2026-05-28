'use client';

import type { JSX } from 'react';
import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface Example {
  id: string;
  title: string;
  description: string;
}

const examples: Example[] = [
  {
    id: 'alignment',
    title: 'Perfect Alignment',
    description: 'Grid guides help position your face with eyes at the correct height and centered properly.',
  },
  {
    id: 'cropping',
    title: 'Precise Cropping',
    description: 'Automatic aspect ratio maintenance ensures your photo meets official document requirements.',
  },
  {
    id: 'background',
    title: 'Background Control',
    description: 'Adjust brightness and composite with professional solid colors for a clean look.',
  },
];

function ExampleCard({ example, index }: { example: Example; index: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"
    >
      {/* Visual placeholder representing the transformation */}
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
        <div className="absolute inset-0 flex items-center justify-center">
          {example.id === 'alignment' && (
            <div className="relative">
              {/* Face outline */}
              <div className="h-24 w-20 rounded-full border-2 border-dashed border-slate-400 bg-slate-100" />
              {/* Grid lines */}
              <div className="absolute -left-4 -right-4 top-1/3 h-px bg-blue-400/50" />
              <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-blue-400/50" />
              {/* Checkmark */}
              <div className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
          {example.id === 'cropping' && (
            <div className="relative">
              {/* Photo border */}
              <div className="h-32 w-24 rounded-lg border-2 border-blue-500 bg-white p-1">
                <div className="h-full w-full rounded bg-slate-200" />
              </div>
              {/* Crop handles */}
              <div className="absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-blue-500" />
              <div className="absolute -right-1 -top-1 h-3 w-3 border-r-2 border-t-2 border-blue-500" />
              <div className="absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2 border-blue-500" />
              <div className="absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-blue-500" />
            </div>
          )}
          {example.id === 'background' && (
            <div className="flex items-center gap-2">
              <div className="relative h-28 w-20 rounded-lg border border-slate-300 bg-gradient-to-br from-gray-200 to-gray-300">
                <span className="absolute bottom-1 left-1 text-[10px] text-slate-500">Before</span>
              </div>
              <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className="relative h-28 w-20 rounded-lg border border-slate-300 bg-white">
                <div className="absolute inset-0 rounded-lg bg-blue-50" />
                <span className="absolute bottom-1 left-1 text-[10px] text-slate-500">After</span>
              </div>
            </div>
          )}
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-blue-600/0 transition-colors group-hover:bg-blue-600/10">
          <span className="translate-y-4 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
            <span className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white">
              Try Now
            </span>
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="mb-2 text-lg font-semibold text-slate-900">{example.title}</h3>
        <p className="text-sm text-slate-600">{example.description}</p>
      </div>
    </motion.div>
  );
}

export default function BeforeAfter(): JSX.Element {
  const headerRef = useRef<HTMLDivElement>(null);
  const isHeaderInView = useInView(headerRef, { once: true, margin: '-100px' });

  return (
    <section id="showcase" className="py-16 lg:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          ref={headerRef}
          initial={{ opacity: 0, y: 20 }}
          animate={isHeaderInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="mb-4 inline-block rounded-full bg-indigo-100 px-4 py-1 text-sm font-semibold text-indigo-700">
            See the Difference
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From Any Photo to
            <span className="text-blue-600"> Passport Ready</span>
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            See how our tools transform ordinary photos into professional passport photos 
            that meet official guidelines.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {examples.map((example, index) => (
            <ExampleCard key={example.id} example={example} index={index} />
          ))}
        </div>

        {/* Demo prompt */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isHeaderInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-12 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"
        >
          <p className="text-slate-700">
            <span className="font-medium">Ready to create your own?</span>{' '}
            Upload a photo above and see the transformation in real-time.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
