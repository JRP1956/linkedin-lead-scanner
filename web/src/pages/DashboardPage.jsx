import React, { useState, useEffect } from 'react';
import { getDashboardData, getCampaignAnalytics } from '../api/client';

const STAGE_COLORS = {
  new: { bg: 'bg-slate-100', text: 'text-slate-700', bar: 'bg-slate-400' },
  contacted: { bg: 'bg-blue-100', text: 'text-blue-700', bar: 'bg-blue-500' },
  replied: { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  meeting_booked: { bg: 'bg-purple-100', text: 'text-purple-700', bar: 'bg-purple-500' },
  converted: { bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500' },
  dead: { bg: 'bg-red-100', text: 'text-red-700', bar: 'bg-red-400' },
};

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getDashboardData(), getCampaignAnalytics()])
      .then(([d, c]) => { setDashboard(d); setCampaigns(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  if (!dashboard) return <p className="text-slate-500 text-center py-12">Failed to load dashboard data</p>;

  const { pipeline } = dashboard;
  const maxStageCount = Math.max(...(pipeline?.stages || []).map(s => s.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <span className="text-sm text-slate-500">Last updated: {new Date().toLocaleTimeString()}</span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Leads', value: dashboard.totalLeads, icon: '👥', color: 'from-blue-500 to-blue-600' },
          { label: 'Campaigns', value: dashboard.totalCampaigns, icon: '📣', color: 'from-indigo-500 to-indigo-600' },
          { label: 'Active', value: dashboard.activeCampaigns, icon: '🚀', color: 'from-emerald-500 to-emerald-600' },
          { label: 'Signals (7d)', value: dashboard.recentSignals, icon: '📡', color: 'from-amber-500 to-amber-600' },
          { label: 'Meetings', value: dashboard.meetingsBooked, icon: '📅', color: 'from-purple-500 to-purple-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center text-lg`}>
                {card.icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{card.value}</p>
                <p className="text-xs text-slate-500">{card.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Funnel */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Pipeline Funnel</h2>
        <div className="space-y-3">
          {(pipeline?.stages || []).map(stage => {
            const colors = STAGE_COLORS[stage.stage] || STAGE_COLORS.new;
            const width = (stage.count / maxStageCount) * 100;
            return (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className={`text-xs font-medium w-28 text-right ${colors.text}`}>
                  {stage.stage.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
                <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${colors.bar} rounded-lg transition-all duration-700 ease-out`}
                    style={{ width: `${Math.max(width, 2)}%` }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-700">
                    {stage.count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Conversion rate: <span className="font-bold text-emerald-600">{pipeline?.conversionRate || '0'}%</span>
        </p>
      </div>

      {/* Campaign Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Campaign Performance</h2>
        {campaigns.length === 0 ? (
          <p className="text-slate-500 text-sm">No campaigns yet. Create one in the Campaigns tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 text-slate-600 font-medium">Campaign</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Status</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Leads</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Sent</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Replied</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Reply Rate</th>
                  <th className="text-center py-2 px-3 text-slate-600 font-medium">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-slate-800">{c.name}</td>
                    <td className="py-2 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        c.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{c.status}</span>
                    </td>
                    <td className="py-2 px-3 text-center text-slate-600">{c.total_leads}</td>
                    <td className="py-2 px-3 text-center text-slate-600">{c.sent}</td>
                    <td className="py-2 px-3 text-center text-slate-600">{c.replied}</td>
                    <td className="py-2 px-3 text-center font-medium text-blue-600">{c.reply_rate}%</td>
                    <td className="py-2 px-3 text-center text-slate-600">{c.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
