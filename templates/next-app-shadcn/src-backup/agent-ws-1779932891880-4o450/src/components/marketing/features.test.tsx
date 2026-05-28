import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Features from './features';

describe('Features', () => {
  it('renders the section heading', () => {
    render(<Features />);
    
    expect(screen.getByText(/Everything You Need for/i)).toBeInTheDocument();
    expect(screen.getByText(/Perfect Photos/i)).toBeInTheDocument();
  });

  it('renders all feature cards', () => {
    render(<Features />);
    
    const expectedFeatures = [
      'Smart Crop Tools',
      'Country Presets',
      'Print Sheets',
      'Background Adjustments',
      'Export Options',
      'Privacy First',
    ];
    
    expectedFeatures.forEach((feature) => {
      expect(screen.getByText(feature)).toBeInTheDocument();
    });
  });

  it('renders feature descriptions', () => {
    render(<Features />);
    
    expect(screen.getByText(/Precise crop controls with visual guides/i)).toBeInTheDocument();
    expect(screen.getByText(/Pre-configured dimensions for passports/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate a 4×6 print sheet/i)).toBeInTheDocument();
  });

  it('has correct section id', () => {
    render(<Features />);
    
    const section = document.getElementById('features');
    expect(section).toBeInTheDocument();
  });
});
