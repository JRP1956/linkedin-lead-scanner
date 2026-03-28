import React from 'react';

const TIER_CONFIG = {
  T1: { label: 'T1 Buyer', bg: 'bg-green-100', text: 'text-green-800' },
  T2: { label: 'T2 Pain', bg: 'bg-teal-100', text: 'text-teal-800' },
  T3: { label: 'T3 Engaged', bg: 'bg-blue-100', text: 'text-blue-800' },
  T4: { label: 'T4 Generic', bg: 'bg-gray-100', text: 'text-gray-700' },
  T5: { label: 'T5 Noise', bg: 'bg-red-100', text: 'text-red-700' },
};

/**
 * IntentTierBadge — Displays an intent tier (T1-T5) as a colored pill with label.
 */
export default function IntentTierBadge({ tier }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.T4;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  );
}
