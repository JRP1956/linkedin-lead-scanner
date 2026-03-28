import React from 'react';

const STATUS_CONFIG = {
  new: { label: 'New', bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  contacted: { label: 'Contacted', bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  replied: { label: 'Replied', bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  meeting_booked: { label: 'Meeting', bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  converted: { label: 'Converted', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  dead: { label: 'Dead', bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
};

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
      {config.label}
    </span>
  );
}

export { STATUS_CONFIG };
