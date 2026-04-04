import React, { useState, useEffect } from 'react';
import { getCampaigns, createCampaign, updateCampaign, deleteCampaign, addCampaignVariant, getCampaignById } from '../api/client';

export default function CampaignPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '' });
  const [newVariant, setNewVariant] = useState({ name: '', messageTemplate: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await getCampaigns();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch { setCampaigns([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCampaign.name.trim()) return;
    try {
      await createCampaign(newCampaign);
      setNewCampaign({ name: '', description: '' });
      setShowCreate(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this campaign?')) return;
    await deleteCampaign(id);
    setSelectedCampaign(null);
    load();
  };

  const handleStatusToggle = async (campaign) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    await updateCampaign(campaign.id, { status: newStatus });
    load();
  };

  const handleAddVariant = async (campaignId) => {
    if (!newVariant.name.trim()) return;
    await addCampaignVariant(campaignId, newVariant);
    setNewVariant({ name: '', messageTemplate: '' });
    const updated = await getCampaignById(campaignId);
    setSelectedCampaign(updated);
    load();
  };

  const selectCampaign = async (id) => {
    try {
      const data = await getCampaignById(id);
      setSelectedCampaign(data);
    } catch (err) { console.error(err); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Campaigns</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-sm"
        >
          + New Campaign
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
          <input
            type="text" placeholder="Campaign name" value={newCampaign.name}
            onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            placeholder="Description (optional)" value={newCampaign.description}
            onChange={e => setNewCampaign({ ...newCampaign, description: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign List */}
        <div className="lg:col-span-1 space-y-3">
          {campaigns.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
              <p className="text-slate-500 text-sm">No campaigns yet</p>
            </div>
          ) : campaigns.map(c => (
            <div
              key={c.id}
              onClick={() => selectCampaign(c.id)}
              className={`bg-white rounded-xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                selectedCampaign?.id === c.id ? 'border-blue-400 shadow-md' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-800">{c.name}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  c.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  c.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-600'
                }`}>{c.status}</span>
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span>{c.lead_count || 0} leads</span>
                <span>{c.variants?.length || 0} variants</span>
              </div>
            </div>
          ))}
        </div>

        {/* Campaign Detail */}
        <div className="lg:col-span-2">
          {selectedCampaign ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{selectedCampaign.name}</h2>
                  {selectedCampaign.description && (
                    <p className="text-sm text-slate-500 mt-1">{selectedCampaign.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStatusToggle(selectedCampaign)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                      selectedCampaign.status === 'active'
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    }`}
                  >
                    {selectedCampaign.status === 'active' ? '⏸ Pause' : '▶ Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(selectedCampaign.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200"
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>

              {/* Metrics */}
              {selectedCampaign.metrics && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Leads', value: selectedCampaign.metrics.total_leads, color: 'text-slate-700' },
                    { label: 'Sent', value: selectedCampaign.metrics.sent, color: 'text-blue-600' },
                    { label: 'Replied', value: selectedCampaign.metrics.replied, color: 'text-emerald-600' },
                    { label: 'Reply Rate', value: `${selectedCampaign.metrics.reply_rate}%`, color: 'text-purple-600' },
                  ].map(m => (
                    <div key={m.label} className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                      <p className="text-xs text-slate-500">{m.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Variants */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">A/B Test Variants</h3>
                <div className="space-y-2">
                  {(selectedCampaign.variants || []).map(v => (
                    <div key={v.id} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-slate-700">{v.name}</span>
                        {v.is_control ? (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">Control</span>
                        ) : null}
                      </div>
                      {v.message_template && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{v.message_template}</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text" placeholder="Variant name" value={newVariant.name}
                    onChange={e => setNewVariant({ ...newVariant, name: e.target.value })}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={() => handleAddVariant(selectedCampaign.id)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 text-lg">Select a campaign to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
