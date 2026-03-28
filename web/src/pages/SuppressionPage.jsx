import React, { useState, useEffect } from 'react';
import { getSuppressionList, addToSuppressionList, bulkImportSuppression, removeFromSuppressionList } from '../api/client';

const REASON_LABELS = {
  manual_exclude: 'Manual Exclude',
  in_pipeline: 'In Pipeline',
  already_contacted: 'Already Contacted',
};

export default function SuppressionPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterReason, setFilterReason] = useState('');
  const [search, setSearch] = useState('');

  // Add form
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [addReason, setAddReason] = useState('manual_exclude');
  const [addError, setAddError] = useState('');

  // Bulk import
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);

  useEffect(() => {
    loadItems();
  }, [filterReason, search]);

  async function loadItems() {
    setLoading(true);
    try {
      const data = await getSuppressionList({ reason: filterReason || undefined, search: search || undefined });
      setItems(data);
    } catch (err) {
      console.error('Failed to load suppression list:', err);
    }
    setLoading(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setAddError('');
    if (!addUrl.trim()) {
      setAddError('LinkedIn URL is required');
      return;
    }
    try {
      await addToSuppressionList({ linkedinUrl: addUrl.trim(), name: addName.trim() || undefined, reason: addReason });
      setAddUrl('');
      setAddName('');
      loadItems();
    } catch (err) {
      setAddError(err.message);
    }
  }

  async function handleBulkImport() {
    setBulkResult(null);
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const entries = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return { linkedinUrl: parts[0], name: parts[1] || undefined };
    });

    if (entries.length === 0) {
      setBulkResult({ error: 'No valid entries found' });
      return;
    }

    try {
      const result = await bulkImportSuppression(entries);
      setBulkResult(result);
      setBulkText('');
      loadItems();
    } catch (err) {
      setBulkResult({ error: err.message });
    }
  }

  async function handleRemove(id) {
    try {
      await removeFromSuppressionList(id);
      setItems(items.filter((i) => i.id !== id));
    } catch (err) {
      console.error('Failed to remove:', err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suppression List</h1>
          <p className="text-sm text-slate-500 mt-1">
            People on this list are excluded from future scans and outreach.
          </p>
        </div>
        <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm font-medium">
          {items.length} suppressed
        </span>
      </div>

      {/* Add Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Add to Suppression List</h2>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">LinkedIn URL *</label>
            <input
              type="text"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1">Name</label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1">Reason</label>
            <select
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="manual_exclude">Manual Exclude</option>
              <option value="in_pipeline">In Pipeline</option>
              <option value="already_contacted">Already Contacted</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            Add
          </button>
        </form>
        {addError && <p className="text-red-500 text-xs mt-2">{addError}</p>}

        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            onClick={() => setShowBulk(!showBulk)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {showBulk ? '▾ Hide Bulk Import' : '▸ Bulk Import (CSV)'}
          </button>
          {showBulk && (
            <div className="mt-2 space-y-2">
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'Paste LinkedIn URLs (one per line, optionally followed by comma and name):\nhttps://linkedin.com/in/john-doe, John Doe\nhttps://linkedin.com/in/jane-smith'}
                rows={5}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkImport}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Import
                </button>
                {bulkResult && !bulkResult.error && (
                  <span className="text-sm text-green-600">
                    ✓ Added {bulkResult.added}, skipped {bulkResult.skipped} duplicates
                  </span>
                )}
                {bulkResult?.error && (
                  <span className="text-sm text-red-500">{bulkResult.error}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or URL..."
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filterReason}
          onChange={(e) => setFilterReason(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All reasons</option>
          <option value="manual_exclude">Manual Exclude</option>
          <option value="in_pipeline">In Pipeline</option>
          <option value="already_contacted">Already Contacted</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No suppressed leads. Add LinkedIn URLs above to prevent re-contact.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-3 px-4 font-medium text-slate-600">Name</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">LinkedIn URL</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Reason</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Source</th>
                <th className="text-left py-3 px-4 font-medium text-slate-600">Added</th>
                <th className="text-right py-3 px-4 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-slate-900 font-medium">{item.name || '—'}</td>
                  <td className="py-3 px-4">
                    <a
                      href={item.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 truncate block max-w-xs"
                    >
                      {item.linkedin_url.replace('https://www.linkedin.com/in/', '/in/')}
                    </a>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.reason === 'in_pipeline' ? 'bg-blue-100 text-blue-700' :
                      item.reason === 'already_contacted' ? 'bg-green-100 text-green-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {REASON_LABELS[item.reason] || item.reason}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{item.source || '—'}</td>
                  <td className="py-3 px-4 text-slate-500 text-xs">
                    {item.added_at ? new Date(item.added_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleRemove(item.id)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
