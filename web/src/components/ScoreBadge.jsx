import React from 'react';

/**
 * ScoreBadge — Displays a total score (0-100) as a colored pill.
 * 0-39: red, 40-59: amber, 60-79: green, 80-100: teal
 */
export default function ScoreBadge({ score }) {
  const value = score != null ? score : 0;

  let bgColor, textColor;
  if (value >= 80) {
    bgColor = 'bg-teal-100';
    textColor = 'text-teal-800';
  } else if (value >= 60) {
    bgColor = 'bg-green-100';
    textColor = 'text-green-800';
  } else if (value >= 40) {
    bgColor = 'bg-amber-100';
    textColor = 'text-amber-800';
  } else {
    bgColor = 'bg-red-100';
    textColor = 'text-red-800';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${bgColor} ${textColor}`}
    >
      {value}
    </span>
  );
}
