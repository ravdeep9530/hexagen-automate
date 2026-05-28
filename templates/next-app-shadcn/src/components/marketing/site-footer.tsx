'use client';

import type { JSX } from 'react';

export default function SiteFooter(): JSX.Element {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <span className="text-lg font-bold text-slate-900">PassportPhoto</span>
            </div>
            <p className="text-sm text-slate-600">
              Create professional passport photos right in your browser. 
              Private, secure, and completely free.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Product</h3>
            <ul className="space-y-3">
              <li>
                <a href="#create" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Create Photo
                </a>
              </li>
              <li>
                <a href="#features" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Features
                </a>
              </li>
              <li>
                <a href="#countries" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Supported Countries
                </a>
              </li>
              <li>
                <a href="#faq" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Resources</h3>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Photo Guidelines
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Printing Tips
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Size Requirements
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Help Center
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Legal</h3>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-600 transition-colors hover:text-blue-600">
                  Disclaimer
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-8 sm:flex-row">
          <p className="text-sm text-slate-500">
            &copy; {currentYear} PassportPhoto. All rights reserved.
          </p>
          
          <p className="text-center text-xs text-slate-400 sm:text-right">
            This tool provides user assistance for creating passport photos. 
            Requirements vary by country and authority. Always verify with your local 
            passport office before submitting photos.
          </p>
        </div>
      </div>
    </footer>
  );
}
