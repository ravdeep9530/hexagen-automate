import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SupportedCountries from './supported-countries';

describe('SupportedCountries', () => {
  it('renders the section heading', () => {
    render(<SupportedCountries />);
    
    expect(screen.getByText(/Supported Countries & Regions/i)).toBeInTheDocument();
  });

  it('renders country cards', () => {
    render(<SupportedCountries />);
    
    const expectedCountries = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany'];
    
    expectedCountries.forEach((country) => {
      expect(screen.getByText(country)).toBeInTheDocument();
    });
  });

  it('displays help text for custom sizes', () => {
    render(<SupportedCountries />);
    
    expect(screen.getByText(/Don't see your country/i)).toBeInTheDocument();
  });

  it('has correct section id', () => {
    render(<SupportedCountries />);
    
    const section = document.getElementById('countries');
    expect(section).toBeInTheDocument();
  });
});
