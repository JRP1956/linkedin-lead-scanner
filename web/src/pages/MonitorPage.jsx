import React, { useState, useEffect } from 'react';
import { getMonitoredAccounts, addMonitoredAccount, deleteMonitoredAccount } from '../api/client';

/**
 * MonitorPage — Manage monitored LinkedIn accounts for automated scanning.
 */
export default function MonitorPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form state
  const [profileUrl, setProfileUrl] = useState('');
  const [label, setLabel] = useState('');
  const [frequency, setFrequency] = useState(6);
  const [adding, setAdding] = useState(false);

  const loadAccounts = () => {
    setLoading(true);
    getMonitoredAccounts()
      .then(setAccounts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!profileUrl) return;

    setAdding(true);
    try {
      await addMonitoredAccount({
        linkedinProfileUrl: profileUrl,
        label,
        checkFrequencyHours: frequency,
      });
      setProfileUrl('');
      setLabel('');
      setFrequency(6);
      loadAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMonitoredAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const getStatusIndicator = (account) => {
    if (!account.last_checked_at) {
      return { color: 'bg-slate-300', label: 'Never checked' };
    }

    const lastCheck = new Date(account.last_checked_at);
    const hoursAgo = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
    const freqHours = account.check_frequency_hours || 6;

    if (hoursAgo <= freqHours * 1.1) {
      return { color: 'bg-green-400', label: 'Checked recently' };
    } else if (hoursAgo <= freqHours * 2) {
      return { color: 'bg-amber-400', label: 'Due for check' };
    } else {
      return { color: 'bg-red-400', label: 'Overdue' };
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Monitor Accounts</h1>
        <p className="text-slate-500 text-sm mt-1">
          Watch LinkedIn profiles for new posts. When a new post is detected, a scan runs automatically.
        </p>
      </div>

      {/* Add Account Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Add Account to Monitor</h3>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">LinkedIn Profile URL</label>
            <input
              type="url"
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/profile-name"
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Competitor"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs text-slate-500 mb-1">Check every</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(parseInt(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={adding || !profileUrl}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Accounts Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-10">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Profile
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Label
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Frequency
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Last Checked
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Last Post
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((account) => {
              const status = getStatusIndicator(account);
              return (
                <tr key={account.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2" title={status.label}>
                      <span className={`w-2.5 h-2.5 rounded-full ${status.color}`} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={account.linkedin_profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 truncate block max-w-[250px]"
                    >
                      {account.linkedin_profile_url.replace('https://www.linkedin.com/', '')}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {account.label || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    Every {account.check_frequency_hours}h
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {account.last_checked_at
                      ? new Date(account.last_checked_at).toLocaleString()
                      : <span className="text-slate-300">Never</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {account.last_post_id
                      ? <span className="text-slate-500 truncate block max-w-[150px]" title={account.last_post_id}>Detected</span>
                      : <span className="text-slate-300">None</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(account.id)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && accounts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                  No accounts being monitored. Add one above to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
