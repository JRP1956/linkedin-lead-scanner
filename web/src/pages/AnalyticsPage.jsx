import React, { useState, useEffect } from 'react';
import { getCampaignAnalytics, getSignalAnalytics, getReplyRateAnalytics, getPipelineAnalytics, getUsage } from '../api/client';

export default function AnalyticsPage() {
  const [tab, setTab] = useState('campaigns');
  const [campaignData, setCampaignData] = useState([]);
  const [signalData, setSignalData] = useState([]);
  const [replyData, setReplyData] = useState({ byCampaign: [], byIntentTier: [] });
  const [pipelineData, setPipelineData] = useState({ stages: [], totalLeads: 0 });
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getCampaignAnalytics().catch(() => []),
      getSignalAnalytics().catch(() => []),
      getReplyRateAnalytics().catch(() => ({ byCampaign: [], byIntentTier: [] })),
      getPipelineAnalytics().catch(() => ({ stages: [], totalLeads: 0 })),
      getUsage().catch(() => null),
    ]).then(([c, s, r, p, u]) => {
      setUsage(u);
      setCampaignData(c);
      setSignalData(s);
      setReplyData(r);
      setPipelineData(p);
    }).finally(() => setLoading(false));
  }, []);

  const tabs = [
    { key: 'campaigns', label: '📊 Campaigns', icon: '📣' },
    { key: 'signals', label: '📡 Signals', icon: '📡' },
    { key: 'replies', label: '💬 Reply Rates', icon: '💬' },
    { key: 'pipeline', label: '🔄 Pipeline', icon: '🔄' },
    { key: 'usage', label: '💲 Usage & Cost', icon: '💲' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Campaign Analytics */}
      {tab === 'campaigns' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Campaign Performance</h2>
          {campaignData.length === 0 ? (
            <p className="text-slate-500 text-sm">No campaign data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-slate-600">Campaign</th>
                    <th className="text-center py-2 px-3 text-slate-600">Status</th>
                    <th className="text-center py-2 px-3 text-slate-600">Leads</th>
                    <th className="text-center py-2 px-3 text-slate-600">Sent</th>
                    <th className="text-center py-2 px-3 text-slate-600">Replied</th>
                    <th className="text-center py-2 px-3 text-slate-600">Reply Rate</th>
                    <th className="text-center py-2 px-3 text-slate-600">Meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignData.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium">{c.name}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}>{c.status}</span>
                      </td>
                      <td className="py-2 px-3 text-center">{c.total_leads}</td>
                      <td className="py-2 px-3 text-center">{c.sent}</td>
                      <td className="py-2 px-3 text-center">{c.replied}</td>
                      <td className="py-2 px-3 text-center font-bold text-blue-600">{c.reply_rate}%</td>
                      <td className="py-2 px-3 text-center">{c.meetings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Signal Analytics */}
      {tab === 'signals' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Signal-to-Conversion</h2>
          {signalData.length === 0 ? (
            <p className="text-slate-500 text-sm">No signal data available. Signals are detected during the monitor job.</p>
          ) : (
            <div className="space-y-4">
              {signalData.map(s => {
                const maxVal = Math.max(...signalData.map(x => x.total_signals), 1);
                return (
                  <div key={s.type} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 capitalize">
                        {s.type.replace(/_/g, ' ')}
                      </span>
                      <div className="flex gap-3 text-xs text-slate-500">
                        <span>{s.total_signals} signals</span>
                        <span>{s.unique_leads} leads</span>
                        <span className="text-emerald-600 font-medium">{s.meetings_from_signal} meetings</span>
                      </div>
                    </div>
                    <div className="h-6 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg transition-all"
                        style={{ width: `${(s.total_signals / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Reply Rate Analytics */}
      {tab === 'replies' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Reply Rates by Campaign</h2>
            {replyData.byCampaign.length === 0 ? (
              <p className="text-slate-500 text-sm">No reply data yet</p>
            ) : (
              <div className="space-y-3">
                {replyData.byCampaign.map(c => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="w-40 text-sm text-slate-700 truncate">{c.name}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-lg"
                        style={{ width: `${Math.max(c.reply_rate, 2)}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-emerald-600 w-16 text-right">{c.reply_rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Reply Rates by Intent Tier</h2>
            {replyData.byIntentTier.length === 0 ? (
              <p className="text-slate-500 text-sm">No intent tier data</p>
            ) : (
              <div className="space-y-3">
                {replyData.byIntentTier.map(t => (
                  <div key={t.intent_tier} className="flex items-center gap-3">
                    <span className="w-28 text-sm text-slate-700 capitalize">{t.intent_tier}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-lg"
                        style={{ width: `${Math.max(t.reply_rate, 2)}%` }}
                      />
                    </div>
                    <span className="text-sm text-slate-500 w-24 text-right">
                      {t.replied}/{t.total} ({t.reply_rate}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pipeline Analytics */}
      {tab === 'pipeline' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            Pipeline Overview <span className="text-sm font-normal text-slate-500">({pipelineData.totalLeads} total leads)</span>
          </h2>
          <div className="space-y-3">
            {pipelineData.stages.map((s, i) => {
              const maxCount = Math.max(...pipelineData.stages.map(x => x.count), 1);
              const percentage = pipelineData.totalLeads > 0 ? ((s.count / pipelineData.totalLeads) * 100).toFixed(1) : '0';
              const colors = ['bg-slate-400', 'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-red-400'];
              return (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className="w-32 text-sm text-slate-700 capitalize text-right">
                    {s.stage.replace('_', ' ')}
                  </span>
                  <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden relative">
                    <div
                      className={`h-full ${colors[i] || 'bg-slate-400'} rounded-lg transition-all duration-500`}
                      style={{ width: `${(s.count / maxCount) * 100}%` }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-700">
                      {s.count} ({percentage}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Usage & Cost */}
      {tab === 'usage' && (
        <div className="space-y-6">
          {!usage ? (
            <p className="text-slate-500 text-sm">Usage data unavailable.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  ['Scans today', `${usage.today.scans} / ${usage.today.scanLimit || '∞'}`],
                  ['Spend (30 days)', `$${usage.byDay.reduce((sum, d) => sum + d.cost_usd, 0).toFixed(2)}`],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <div className="text-sm text-slate-500">{label}</div>
                    <div className="text-2xl font-semibold text-slate-800 mt-1 tabular-nums">{value}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">Cost per Scan</h2>
                <p className="text-xs text-slate-500 mb-4">
                  Claude cost is exact. Apollo is $0 unless you set APOLLO_COST_PER_CREDIT.
                </p>
                {usage.byScan.length === 0 ? (
                  <p className="text-slate-500 text-sm">No scans in the last 30 days</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 px-3 text-slate-600">Post</th>
                          <th className="text-right py-2 px-3 text-slate-600">Leads</th>
                          <th className="text-right py-2 px-3 text-slate-600">Apollo credits</th>
                          <th className="text-right py-2 px-3 text-slate-600">Claude tokens</th>
                          <th className="text-right py-2 px-3 text-slate-600">Cost</th>
                          <th className="text-right py-2 px-3 text-slate-600">Cost / lead</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.byScan.map((scan) => (
                          <tr key={scan.post_url} className="border-b border-slate-100 hover:bg-slate-50 tabular-nums">
                            <td className="py-2 px-3 max-w-xs truncate" title={scan.post_url}>{scan.post_url.replace(/^https:\/\/(www\.)?linkedin\.com\/posts\//, '')}</td>
                            <td className="py-2 px-3 text-right">{scan.leads}</td>
                            <td className="py-2 px-3 text-right">{scan.apollo_credits}</td>
                            <td className="py-2 px-3 text-right">{scan.claude_tokens.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right font-medium">${scan.cost_usd.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{scan.leads ? `$${(scan.cost_usd / scan.leads).toFixed(3)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
