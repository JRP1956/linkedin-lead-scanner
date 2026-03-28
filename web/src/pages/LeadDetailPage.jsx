import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getLeadById, pushToHubspot, updateLeadStatus, getLeadHistory, getLeadAppearances, pushToApolloSequence, getApolloSequences } from '../api/client';
import ScoreBadge from '../components/ScoreBadge';
import IntentTierBadge from '../components/IntentTierBadge';
import DataConfidencePill from '../components/DataConfidencePill';
import StatusBadge from '../components/StatusBadge';
import DraftEditor from '../components/DraftEditor';

/**
 * LeadDetailPage — Full enriched profile, intent analysis, and outreach draft editor.
 */
export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pushStatus, setPushStatus] = useState('idle');
  const [pushError, setPushError] = useState(null);

  // Feature 2: Lead Status
  const [statusHistory, setStatusHistory] = useState([]);

  // Feature 3: Appearances
  const [appearances, setAppearances] = useState([]);

  // Feature 4: Apollo Sequences
  const [sequences, setSequences] = useState([]);
  const [selectedSequence, setSelectedSequence] = useState('');
  const [apolloStatus, setApolloStatus] = useState('idle');

  useEffect(() => {
    getLeadById(id)
      .then((data) => {
        setLead(data);
        if (data.hubspot_contact_id) {
          setPushStatus('pushed');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Load additional data
    getLeadHistory(id).then(setStatusHistory).catch(() => {});
    getLeadAppearances(id).then(setAppearances).catch(() => {});
    getApolloSequences().then((seqs) => {
      setSequences(seqs);
      if (seqs.length > 0) setSelectedSequence(seqs[0].id);
    }).catch(() => {});
  }, [id]);

  const handlePushToHubspot = async () => {
    setPushStatus('pushing');
    setPushError(null);
    try {
      const result = await pushToHubspot(id);
      setPushStatus('pushed');
      setLead((prev) => ({
        ...prev,
        hubspot_contact_id: result.hubspotContactId,
        hubspot_pushed_at: new Date().toISOString(),
      }));
    } catch (err) {
      setPushStatus('error');
      setPushError(err.message);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      const updated = await updateLeadStatus(id, newStatus);
      setLead(updated);
      getLeadHistory(id).then(setStatusHistory).catch(() => {});
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  const handlePushToApollo = async () => {
    if (!selectedSequence) return;
    setApolloStatus('pushing');
    try {
      await pushToApolloSequence(id, selectedSequence);
      setApolloStatus('pushed');
      setLead((prev) => ({ ...prev, apollo_sequenced_at: new Date().toISOString(), apollo_sequence_id: selectedSequence }));
    } catch (err) {
      setApolloStatus('error');
      console.error('Apollo push failed:', err);
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-slate-400">Loading lead details...</div>;
  }

  if (error || !lead) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">😕</div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Lead Not Found</h2>
        <p className="text-slate-500">{error || 'Could not find this lead.'}</p>
      </div>
    );
  }

  // Parse intent signals from JSON string
  let intentSignals = [];
  try {
    intentSignals = JSON.parse(lead.intent_signals || '[]');
  } catch {
    intentSignals = [];
  }

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Results
      </button>

      <div className="grid grid-cols-3 gap-6">
        {/* Left Panel — Profile */}
        <div className="col-span-1 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm h-fit">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {(lead.first_name || lead.name || '?')[0]}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{lead.name || 'Unknown'}</h2>
              <p className="text-sm text-slate-500">{lead.title || 'No title'}</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <InfoRow label="Company" value={lead.company} />
            <InfoRow label="Email" value={lead.email} isEmail />
            <InfoRow label="Industry" value={lead.industry} />
            <InfoRow label="Headcount" value={lead.headcount_range} />
            <InfoRow label="Funding" value={lead.funding_stage} />
            <InfoRow label="Domain" value={lead.company_domain} />

            {lead.linkedin_url && (
              <div className="pt-3 border-t border-slate-100">
                <a
                  href={lead.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                  </svg>
                  View LinkedIn Profile
                </a>
              </div>
            )}
          </div>

          {/* Score summary */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xs text-slate-500 mb-1">Total</div>
                <ScoreBadge score={lead.total_score} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Intent</div>
                <span className="text-sm font-semibold text-slate-700">{lead.intent_score || 0}</span>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">ICP</div>
                <span className="text-sm font-semibold text-slate-700">{lead.icp_score || 0}</span>
              </div>
            </div>
            <div className="flex justify-center mt-3">
              <DataConfidencePill confidence={lead.data_confidence} />
            </div>
          </div>

          {/* Status */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 mb-2">Pipeline Status</div>
            <select
              value={lead.lead_status || 'new'}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="replied">Replied</option>
              <option value="meeting_booked">Meeting Booked</option>
              <option value="converted">Converted</option>
              <option value="dead">Dead</option>
            </select>
          </div>

          {/* Appearances */}
          {(lead.appearance_count || 1) > 1 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 mb-2">
                🔥 Multi-Signal Lead ({lead.appearance_count} posts)
              </div>
            </div>
          )}
        </div>

        {/* Center Panel — Comment + Intent */}
        <div className="col-span-1 space-y-4">
          {/* Comment */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Comment</h3>
            <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-4">
              {lead.comment_text || 'No comment text available'}
            </div>
            {lead.comment_date && (
              <div className="text-xs text-slate-400 mt-2">{lead.comment_date}</div>
            )}
          </div>

          {/* Intent Analysis */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Intent Analysis</h3>
            <div className="flex items-center gap-3 mb-3">
              <IntentTierBadge tier={lead.intent_tier} />
              <span className="text-sm text-slate-600">Score: {lead.intent_score || 0}/45</span>
            </div>
            {lead.intent_reasoning && (
              <p className="text-sm text-slate-600 mb-3">{lead.intent_reasoning}</p>
            )}
            {intentSignals.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">Signals</div>
                <div className="flex flex-wrap gap-1.5">
                  {intentSignals.map((signal, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded-md"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel — Outreach Drafts */}
        <div className="col-span-1 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Outreach Drafts</h3>
            <DraftEditor drafts={lead} leadId={lead.id} />
          </div>

          {/* Push to HubSpot */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">HubSpot</h3>
            {pushStatus === 'pushed' ? (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pushed to HubSpot
                {lead.hubspot_contact_id && (
                  <span className="text-xs text-slate-400 ml-1">ID: {lead.hubspot_contact_id}</span>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={handlePushToHubspot}
                  disabled={pushStatus === 'pushing'}
                  className="w-full py-2.5 px-4 text-sm font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {pushStatus === 'pushing' ? 'Pushing...' : 'Push to HubSpot'}
                </button>
                {pushStatus === 'error' && pushError && (
                  <p className="mt-2 text-xs text-red-600">{pushError}</p>
                )}
              </>
            )}
          </div>

          {/* Push to Apollo Sequence */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Apollo Sequence</h3>
            {lead.apollo_sequenced_at || apolloStatus === 'pushed' ? (
              <div className="text-sm text-green-700 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Added to sequence
              </div>
            ) : !lead.email ? (
              <p className="text-xs text-slate-400">No email — cannot add to sequence</p>
            ) : (
              <>
                {sequences.length > 0 && (
                  <select
                    value={selectedSequence}
                    onChange={(e) => setSelectedSequence(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {sequences.map((seq) => (
                      <option key={seq.id} value={seq.id}>{seq.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handlePushToApollo}
                  disabled={apolloStatus === 'pushing' || !selectedSequence}
                  className="w-full py-2.5 px-4 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {apolloStatus === 'pushing' ? 'Adding...' : 'Push to Apollo Sequence'}
                </button>
              </>
            )}
          </div>

          {/* Status History */}
          {statusHistory.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Status History</h3>
              <div className="space-y-2">
                {statusHistory.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">{h.old_status || '—'}</span>
                      <span className="text-slate-300">→</span>
                      <StatusBadge status={h.new_status} />
                    </div>
                    <span className="text-slate-400">
                      {new Date(h.changed_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Appearance History */}
          {appearances.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Appearance History ({appearances.length} posts)
              </h3>
              <div className="space-y-2">
                {appearances.map((a, i) => (
                  <div key={i} className="text-xs">
                    <a
                      href={a.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 truncate block"
                    >
                      {a.post_url.replace('https://www.linkedin.com/posts/', '/posts/')}
                    </a>
                    <span className="text-slate-400">{new Date(a.seen_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, isEmail }) {
  if (!value) {
    return (
      <div className="flex justify-between">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">—</span>
      </div>
    );
  }

  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      {isEmail ? (
        <a href={`mailto:${value}`} className="text-blue-600 hover:text-blue-700 font-medium">
          {value}
        </a>
      ) : (
        <span className="text-slate-800 font-medium">{value}</span>
      )}
    </div>
  );
}
