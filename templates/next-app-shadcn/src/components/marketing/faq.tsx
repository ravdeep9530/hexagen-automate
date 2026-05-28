'use client';

import type { JSX } from 'react';
import { useRef, useState } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';

interface FAQ {
  question: string;
  answer: string;
}

const faqs: FAQ[] = [
  {
    question: 'Is this service completely free?',
    answer:
      'Yes, the basic passport photo creation is free to use. You can upload, crop, adjust, and download photos without any cost or account signup.',
  },
  {
    question: 'Do I need to create an account?',
    answer:
      'No account is required. The entire process works in your browser without needing to sign up or log in.',
  },
  {
    question: 'Is my photo data secure?',
    answer:
      'Absolutely. All image processing happens directly in your browser. Your photos never leave your device or get uploaded to any server.',
  },
  {
    question: 'What file formats are supported?',
    answer:
      'We support JPG, PNG, and WEBP images. You can export your edited photos as JPEG or PNG in your preferred quality.',
  },
  {
    question: 'Can I use this on my phone?',
    answer:
      'Yes! The editor is fully responsive and works on mobile devices, tablets, and desktop computers.',
  },
  {
    question: 'How do I print my passport photos?',
    answer:
      'Download the 4×6 print sheet option. This arranges multiple photos on standard photo paper that any home printer or photo lab can handle.',
  },
  {
    question: 'What countries are supported?',
    answer:
      'We have presets for 20+ countries including the US, UK, Canada, Australia, and many more. You can also set custom dimensions for any country.',
  },
  {
    question: 'Are the photos guaranteed to be accepted?',
    answer:
      'While we provide tools based on common requirements, we cannot guarantee acceptance. Always check with your local passport office or embassy for the most current specifications.',
  },
];

function FAQItem({ faq, index }: { faq: FAQ; index: number }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="border-b border-slate-200 last:border-b-0"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-5 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-expanded={isOpen}
      >
        <span className="pr-4 text-base font-medium text-slate-900 sm:text-lg">{faq.question}</span>
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 transition-colors ${
            isOpen ? 'bg-blue-100' : ''
          }`}
        >
          <svg
            className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180 text-blue-600' : 'text-slate-500'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-slate-600">{faq.answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQ(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="faq" className="bg-slate-50 py-16 lg:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl"
        >
          <div className="text-center">
            <span className="mb-4 inline-block rounded-full bg-blue-100 px-4 py-1 text-sm font-semibold text-blue-700">
              Common Questions
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Frequently Asked Questions
            </h2>
            <p className="mt-4 text-lg text-slate-600">
              Everything you need to know about creating passport photos with our tool.
            </p>
          </div>

          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            {faqs.map((faq, index) => (
              <FAQItem key={index} faq={faq} index={index} />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
