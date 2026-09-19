import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getFollowUps, updateFollowUp, markFollowUpSent, skipFollowUp } from '../api/client';

/**
 * FollowUpsPage — review queue for follow-up messages drafted by the sequence engine.
 * Nothing is sent automatically: copy the message, send it on LinkedIn, then mark it sent.
 */
export default function FollowUpsPage() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    getFollowUps()
      .then(setDrafts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Follow-ups</h1>
        <p className="text-sm text-slate-500 mt-1">
          Due follow-ups are drafted for you. Edit, send it yourself, then mark it sent. The next step is spaced from when you send.
        </p>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {drafts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm">
          <p className="text-slate-600 font-medium">Nothing to send right now</p>
          <p className="text-sm text-slate-500 mt-1">
            Drafts appear here when a sequence step is due. They're written on each monitor run.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <FollowUpCard key={draft.id} draft={draft} onDone={() => setDrafts((d) => d.filter((x) => x.id !== draft.id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpCard({ draft, onDone }) {
  const [message, setMessage] = useState(draft.message_content || '');
  const [saved, setSaved] = useState(draft.message_content || '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    if (message === saved || !message.trim()) return;
    await updateFollowUp(draft.id, message);
    setSaved(message);
  };

  const act = async (action) => {
    setBusy(true);
    try {
      await save();
      await action(draft.id);
      onDone();
    } catch (err) {
      alert(err.message);
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Could not copy — select the text and copy it manually.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <Link to={`/leads/${draft.lead_id}`} className="font-semibold text-slate-800 hover:text-blue-700">
            {draft.lead_name}
          </Link>
          <p className="text-xs text-slate-500">
            {[draft.lead_title, draft.lead_company].filter(Boolean).join(' @ ')}
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {draft.campaign_name} · Step {draft.step_number} of {draft.total_steps}
        </span>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onBlur={() => save().catch((err) => alert(err.message))}
        rows={4}
        aria-label={`Follow-up message for ${draft.lead_name}`}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <p className="text-xs text-slate-400 mt-1 tabular-nums">{message.length} characters</p>

      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={copy} className="px-3 py-1.5 text-xs font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
          {copied ? 'Copied' : 'Copy'}
        </button>
        {draft.lead_linkedin_url && (
          <a href={draft.lead_linkedin_url} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
            Open LinkedIn profile
          </a>
        )}
        <div className="flex-1" />
        <button onClick={() => act(skipFollowUp)} disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-50">
          Skip this step
        </button>
        <button onClick={() => act(markFollowUpSent)} disabled={busy}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          I sent it
        </button>
      </div>
    </div>
  );
}
