import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getLeads, pushBatchToHubspot, pushBatchToApolloSequence, getApolloSequences, getExportCsvUrl } from '../api/client';
import LeadTable from '../components/LeadTable';

/**
 * ResultsPage — Summary stats, filterable/sortable lead table, batch actions.
 */
export default function ResultsPage() {
  const [searchParams] = useSearchParams();
  const postUrl = searchParams.get('postUrl') || '';

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filters
  const [minScore, setMinScore] = useState(0);
  const [tierFilter, setTierFilter] = useState(new Set());
  const [confidenceFilter, setConfidenceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  // Batch action state
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);

  useEffect(() => {
    if (!postUrl) return;
    setLoading(true);
    getLeads(postUrl)
      .then(setLeads)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [postUrl]);

  // Apply client-side filters
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if ((lead.total_score || 0) < minScore) return false;
      if (tierFilter.size > 0 && !tierFilter.has(lead.intent_tier)) return false;
      if (confidenceFilter && lead.data_confidence !== confidenceFilter) return false;
      if (statusFilter && (lead.lead_status || 'new') !== statusFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const searchable = `${lead.name} ${lead.title} ${lead.company} ${lead.comment_text}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [leads, minScore, tierFilter, confidenceFilter, statusFilter, searchText]);

  // Stats
  const stats = useMemo(() => ({
    total: leads.length,
    enriched: leads.filter((l) => l.email).length,
    above60: leads.filter((l) => (l.total_score || 0) >= 60).length,
    above80: leads.filter((l) => (l.total_score || 0) >= 80).length,
  }), [leads]);

  const handleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (selectAll) => {
    if (selectAll) {
      setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleBatchPush = async () => {
    if (selectedIds.size === 0) return;
    setPushing(true);
    setPushResult(null);
    try {
      const result = await pushBatchToHubspot([...selectedIds]);
      setPushResult(result);
    } catch (err) {
      setPushResult({ error: err.message });
    } finally {
      setPushing(false);
    }
  };

  const toggleTier = (tier) => {
    setTierFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  if (!postUrl) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">📊</div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">No results to show</h2>
        <p className="text-slate-500">Run a scan first, then your results will appear here.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Scan Results</h1>
        <p className="text-sm text-slate-500 mt-1 truncate">
          {postUrl}
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Commenters', value: stats.total, icon: '👥', color: 'blue' },
          { label: 'Enriched', value: stats.enriched, icon: '✉️', color: 'indigo' },
          { label: 'Score 60+', value: stats.above60, icon: '⭐', color: 'green' },
          { label: 'Score 80+', value: stats.above80, icon: '🔥', color: 'teal' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
          >
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold text-slate-800">{stat.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name, title, company..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Min score slider */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">Min Score:</label>
            <input
              type="range"
              min="0"
              max="100"
              value={minScore}
              onChange={(e) => setMinScore(parseInt(e.target.value))}
              className="w-24 accent-blue-600"
            />
            <span className="text-xs font-mono text-slate-600 w-8">{minScore}</span>
          </div>

          {/* Intent tier filter */}
          <div className="flex items-center gap-1">
            {['T1', 'T2', 'T3', 'T4', 'T5'].map((tier) => (
              <button
                key={tier}
                onClick={() => toggleTier(tier)}
                className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                  tierFilter.has(tier)
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>

          {/* Confidence filter */}
          <select
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="">All Confidence</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
            <option value="low">Low</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="meeting_booked">Meeting Booked</option>
            <option value="converted">Converted</option>
            <option value="dead">Dead</option>
          </select>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} lead{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchPush}
              disabled={pushing}
              className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {pushing ? 'Pushing...' : `Push ${selectedIds.size} to HubSpot`}
            </button>
            <a
              href={getExportCsvUrl(postUrl)}
              className="px-4 py-2 text-xs font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Export CSV
            </a>
          </div>
        </div>
      )}

      {/* Push result notification */}
      {pushResult && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          pushResult.error
            ? 'bg-red-50 border border-red-200 text-red-700'
            : 'bg-green-50 border border-green-200 text-green-700'
        }`}>
          {pushResult.error
            ? `Error: ${pushResult.error}`
            : `✅ Pushed ${pushResult.pushed} leads to HubSpot. ${pushResult.failed > 0 ? `${pushResult.failed} failed.` : ''}`
          }
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-slate-400">
          Loading leads...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Lead Table */}
      {!loading && !error && (
        <LeadTable
          leads={filteredLeads}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
        />
      )}

      {/* Export button (bottom) */}
      {leads.length > 0 && (
        <div className="mt-4 flex justify-end">
          <a
            href={getExportCsvUrl(postUrl)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export All as CSV
          </a>
        </div>
      )}
    </div>
  );
}
