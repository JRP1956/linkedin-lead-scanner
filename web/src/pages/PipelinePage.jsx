import React, { useState, useEffect } from 'react';
import { getPipelineAnalytics, updateLeadStatus, getLeads } from '../api/client';

const STAGES = [
  { key: 'new', label: 'New', color: 'border-slate-300', bg: 'bg-slate-50', icon: '🆕' },
  { key: 'contacted', label: 'Contacted', color: 'border-blue-300', bg: 'bg-blue-50', icon: '📧' },
  { key: 'replied', label: 'Replied', color: 'border-emerald-300', bg: 'bg-emerald-50', icon: '💬' },
  { key: 'meeting_booked', label: 'Meeting', color: 'border-purple-300', bg: 'bg-purple-50', icon: '📅' },
  { key: 'converted', label: 'Converted', color: 'border-amber-300', bg: 'bg-amber-50', icon: '🎉' },
  { key: 'dead', label: 'Dead', color: 'border-red-300', bg: 'bg-red-50', icon: '💀' },
];

export default function PipelinePage() {
  const [leadsByStage, setLeadsByStage] = useState({});
  const [loading, setLoading] = useState(true);
  const [draggedLead, setDraggedLead] = useState(null);

  const loadLeads = async () => {
    setLoading(true);
    try {
      // Get all leads (we'll need a post URL or use a general leads endpoint)
      // For now, fetch all leads grouped by status
      const grouped = {};
      STAGES.forEach(s => { grouped[s.key] = []; });

      // Fetch leads from recent scans
      const res = await fetch('/api/leads?postUrl=*');
      // Use pipeline analytics to know counts, but we need actual leads
      // Let's use a direct query approach
      for (const stage of STAGES) {
        try {
          const stageRes = await fetch(`/api/leads?postUrl=&status=${stage.key}&sortBy=total_score`);
          if (stageRes.ok) {
            const data = await stageRes.json();
            grouped[stage.key] = Array.isArray(data) ? data.slice(0, 50) : [];
          }
        } catch {
          grouped[stage.key] = [];
        }
      }

      setLeadsByStage(grouped);
    } catch (err) {
      console.error('Failed to load pipeline:', err);
    }
    setLoading(false);
  };

  useEffect(() => { loadLeads(); }, []);

  const handleDragStart = (e, lead, fromStage) => {
    setDraggedLead({ lead, fromStage });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, toStage) => {
    e.preventDefault();
    if (!draggedLead || draggedLead.fromStage === toStage) return;

    const { lead, fromStage } = draggedLead;
    
    // Optimistic update
    setLeadsByStage(prev => {
      const updated = { ...prev };
      updated[fromStage] = prev[fromStage].filter(l => l.id !== lead.id);
      updated[toStage] = [{ ...lead, lead_status: toStage }, ...prev[toStage]];
      return updated;
    });

    try {
      await updateLeadStatus(lead.id, toStage);
    } catch (err) {
      console.error('Failed to update status:', err);
      loadLeads(); // Revert on failure
    }
    setDraggedLead(null);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Pipeline</h1>
        <button onClick={loadLeads} className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
          ↻ Refresh
        </button>
      </div>

      <p className="text-sm text-slate-500">Drag and drop leads between columns to update their status.</p>

      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
        {STAGES.map(stage => (
          <div
            key={stage.key}
            className={`flex-shrink-0 w-64 ${stage.bg} rounded-xl border-2 ${stage.color} p-3`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage.key)}
          >
            <div className="flex items-center gap-2 mb-3">
              <span>{stage.icon}</span>
              <h3 className="font-semibold text-sm text-slate-700">{stage.label}</h3>
              <span className="ml-auto text-xs font-medium bg-white px-2 py-0.5 rounded-full text-slate-600 shadow-sm">
                {leadsByStage[stage.key]?.length || 0}
              </span>
            </div>

            <div className="space-y-2 min-h-[100px]">
              {(leadsByStage[stage.key] || []).map(lead => (
                <div
                  key={lead.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, lead, stage.key)}
                  className="bg-white rounded-lg p-3 shadow-sm border border-slate-200 cursor-move hover:shadow-md transition-all hover:-translate-y-0.5"
                >
                  <p className="font-medium text-sm text-slate-800 truncate">{lead.name || 'Unknown'}</p>
                  <p className="text-xs text-slate-500 truncate">{lead.title || 'No title'}</p>
                  <p className="text-xs text-slate-400 truncate">{lead.company || ''}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      lead.total_score >= 70 ? 'bg-emerald-100 text-emerald-700' :
                      lead.total_score >= 40 ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {lead.total_score || 0} pts
                    </span>
                    {lead.email && <span className="text-xs text-blue-500">📧</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
