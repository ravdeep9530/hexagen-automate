import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Hero from './hero';

describe('Hero', () => {
  const mockStartCreating = vi.fn();

  it('renders the main headline', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    expect(screen.getByText(/Create Perfect/i)).toBeInTheDocument();
    expect(screen.getByText(/Passport Photos/i)).toBeInTheDocument();
  });

  it('renders the primary CTA button', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    const ctaButton = screen.getByRole('button', { name: /Upload Photo & Start/i });
    expect(ctaButton).toBeInTheDocument();
  });

  it('calls onStartCreating when CTA is clicked', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    const ctaButton = screen.getByRole('button', { name: /Upload Photo & Start/i });
    fireEvent.click(ctaButton);
    
    expect(mockStartCreating).toHaveBeenCalledTimes(1);
  });

  it('renders the Learn More link', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    const learnMoreLink = screen.getByRole('link', { name: /Learn More/i });
    expect(learnMoreLink).toHaveAttribute('href', '#features');
  });

  it('displays trust indicators', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    expect(screen.getByText(/Private & Secure/i)).toBeInTheDocument();
    expect(screen.getByText(/Works on Mobile/i)).toBeInTheDocument();
    expect(screen.getByText(/Print-Ready Output/i)).toBeInTheDocument();
  });

  it('renders the badge text', () => {
    render(<Hero onStartCreating={mockStartCreating} />);
    
    expect(screen.getByText(/Free to use/i)).toBeInTheDocument();
  });
});
