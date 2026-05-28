'use client';

import type { JSX } from 'react';
import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface Country {
  code: string;
  name: string;
  flag: string;
}

const supportedCountries: Country[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
];

export default function SupportedCountries(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="countries" className="bg-slate-50 py-16 lg:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="mb-4 inline-block rounded-full bg-blue-100 px-4 py-1 text-sm font-semibold text-blue-700">
            Wide Coverage
          </span>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Supported Countries & Regions
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Precise dimension presets for passports, visas, and official documents 
            across {supportedCountries.length}+ countries worldwide.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {supportedCountries.map((country, index) => (
            <motion.div
              key={country.code}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, delay: index * 0.03 }}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              <span className="text-2xl">{country.flag}</span>
              <div>
                <p className="font-medium text-slate-900">{country.name}</p>
                <p className="text-xs text-slate-500">Passport & ID</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-slate-500">
            Don&apos;t see your country? Custom sizes are available directly in the editor.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
