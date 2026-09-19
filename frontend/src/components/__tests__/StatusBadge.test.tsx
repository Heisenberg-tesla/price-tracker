import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge Component Suite', () => {
  it('renders "Up to date" for outcome="success"', () => {
    render(<StatusBadge outcome="success" />);
    const badge = screen.getByTestId('status-badge-success');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Up to date');
  });

  it('renders "Up to date (after retry)" with attempt count for outcome="success_after_retry"', () => {
    render(<StatusBadge outcome="success_after_retry" retryCount={2} />);
    const badge = screen.getByTestId('status-badge-success_after_retry');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Up to date (after retry)');
    expect(badge).toHaveTextContent('2x');
  });

  it('renders "Failed" with error type for outcome="failed"', () => {
    render(<StatusBadge outcome="failed" errorType="timeout" />);
    const badge = screen.getByTestId('status-badge-failed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Failed');
    expect(badge).toHaveTextContent('timeout');
  });

  it('renders "Interrupted" for outcome="abandoned" with distinct styling and tooltip', () => {
    render(<StatusBadge outcome="abandoned" />);
    const badge = screen.getByTestId('status-badge-abandoned');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Interrupted');
    expect(badge).toHaveAttribute(
      'title',
      expect.stringContaining('Run was abandoned'),
    );
  });

  it('renders "Scraping now…" spinner when isRunning=true and no prior outcome', () => {
    render(<StatusBadge isRunning={true} outcome={null} />);
    const badge = screen.getByTestId('status-badge-pending');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Scraping now…');
  });

  it('layers live running overlay without hiding last completed outcome', () => {
    render(<StatusBadge outcome="success" isRunning={true} showRunningOverlay={true} />);
    // The previous outcome remains visible
    expect(screen.getByTestId('status-badge-success')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();

    // The running overlay is rendered alongside
    expect(screen.getByTestId('status-badge-running-overlay')).toBeInTheDocument();
    expect(screen.getByText('Scraping…')).toBeInTheDocument();
  });
});
