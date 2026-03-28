import React from 'react';

const CONFIDENCE_CONFIG = {
  full: { label: 'Full', bg: 'bg-green-100', text: 'text-green-800' },
  partial: { label: 'Partial', bg: 'bg-amber-100', text: 'text-amber-800' },
  low: { label: 'Low', bg: 'bg-red-100', text: 'text-red-700' },
};

/**
 * DataConfidencePill — Displays data confidence level as a colored pill.
 * full=green, partial=amber, low=red
 */
export default function DataConfidencePill({ confidence }) {
  const config = CONFIDENCE_CONFIG[confidence] || CONFIDENCE_CONFIG.low;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  );
}
