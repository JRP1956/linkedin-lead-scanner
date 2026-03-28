import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ScoreBadge from './ScoreBadge';
import IntentTierBadge from './IntentTierBadge';
import DataConfidencePill from './DataConfidencePill';
import StatusBadge from './StatusBadge';
import { updateLeadStatus } from '../api/client';

/**
 * LeadTable — Sortable, filterable table with batch selection for leads.
 */
export default function LeadTable({ leads, selectedIds, onSelect, onSelectAll }) {
  const navigate = useNavigate();
  const [sortColumn, setSortColumn] = useState('total_score');
  const [sortDirection, setSortDirection] = useState('desc');

  // Client-side sorting
  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];

      // Handle null/undefined
      if (valA == null) valA = '';
      if (valB == null) valB = '';

      // Numeric columns
      if (typeof valA === 'number' || ['total_score', 'intent_score', 'icp_score', 'appearance_count'].includes(sortColumn)) {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [leads, sortColumn, sortDirection]);

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const allSelected = leads.length > 0 && selectedIds.size === leads.length;

  const SortIcon = ({ column }) => {
    if (sortColumn !== column) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const truncate = (text, maxLen) => {
    if (!text) return '';
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onSelectAll(!allSelected)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-10">
                #
              </th>
              <th
                onClick={() => handleSort('name')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Name <SortIcon column="name" />
              </th>
              <th
                onClick={() => handleSort('title')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Title <SortIcon column="title" />
              </th>
              <th
                onClick={() => handleSort('company')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Company <SortIcon column="company" />
              </th>
              <th
                onClick={() => handleSort('total_score')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Score <SortIcon column="total_score" />
              </th>
              <th
                onClick={() => handleSort('intent_tier')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Intent <SortIcon column="intent_tier" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Comment
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Status
              </th>
              <th
                onClick={() => handleSort('appearance_count')}
                className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700"
              >
                Signals <SortIcon column="appearance_count" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedLeads.map((lead, index) => (
              <tr
                key={lead.id}
                onClick={() => navigate(`/leads/${lead.id}`)}
                className="hover:bg-blue-50/50 cursor-pointer transition-colors duration-150"
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => onSelect(lead.id)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                  {index + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{lead.name || 'Unknown'}</div>
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                  <span className="truncate block">{truncate(lead.title, 40)}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {lead.company || '—'}
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={lead.total_score} />
                </td>
                <td className="px-4 py-3">
                  <IntentTierBadge tier={lead.intent_tier} />
                </td>
                <td className="px-4 py-3 text-slate-500 max-w-[200px]">
                  <span className="truncate block text-xs">{truncate(lead.comment_text, 60)}</span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={lead.lead_status || 'new'}
                    onChange={async (e) => {
                      try {
                        await updateLeadStatus(lead.id, e.target.value);
                        lead.lead_status = e.target.value;
                      } catch (err) {
                        console.error('Status update failed:', err);
                      }
                    }}
                    className="text-xs border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="replied">Replied</option>
                    <option value="meeting_booked">Meeting</option>
                    <option value="converted">Converted</option>
                    <option value="dead">Dead</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-sm">
                    {(lead.appearance_count || 1) > 1 && <span title="Multi-signal lead">🔥</span>}
                    <span className="text-slate-600 font-medium">{lead.appearance_count || 1}</span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <DataConfidencePill confidence={lead.data_confidence} />
                </td>
              </tr>
            ))}
            {sortedLeads.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                  No leads found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
