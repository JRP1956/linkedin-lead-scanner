import React, { useState, useEffect } from 'react';
import { updateDraft } from '../api/client';

const MODES = [
  { key: 'direct', label: 'Direct Comment Ref' },
  { key: 'topic', label: 'Post Topic Ref' },
  { key: 'pain', label: 'Pain-Point Only' },
  { key: 'campaign', label: 'Campaign' },
];

/**
 * DraftEditor — Tabbed textarea for editing outreach drafts across 4 modes.
 * Shows unsaved indicator, character counter, copy-to-clipboard, and save on blur.
 */
export default function DraftEditor({ drafts, leadId, onSave }) {
  const [activeMode, setActiveMode] = useState('direct');
  const [editedDrafts, setEditedDrafts] = useState({});
  const [unsaved, setUnsaved] = useState({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Initialize edited drafts from props
  useEffect(() => {
    setEditedDrafts({
      direct: drafts?.outreach_draft_direct || drafts?.direct || '',
      topic: drafts?.outreach_draft_topic || drafts?.topic || '',
      pain: drafts?.outreach_draft_pain || drafts?.pain || '',
      campaign: drafts?.outreach_draft_campaign || drafts?.campaign || '',
    });
    setUnsaved({});
  }, [drafts]);

  const currentText = editedDrafts[activeMode] || '';

  const handleChange = (e) => {
    const newText = e.target.value;
    setEditedDrafts((prev) => ({ ...prev, [activeMode]: newText }));
    setUnsaved((prev) => ({ ...prev, [activeMode]: true }));
  };

  const handleSave = async () => {
    if (!unsaved[activeMode]) return;
    setSaving(true);
    try {
      await updateDraft(leadId, activeMode, editedDrafts[activeMode]);
      setUnsaved((prev) => ({ ...prev, [activeMode]: false }));
      if (onSave) onSave(activeMode, editedDrafts[activeMode]);
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement('textarea');
      textarea.value = currentText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-slate-50">
        {MODES.map((mode) => (
          <button
            key={mode.key}
            onClick={() => setActiveMode(mode.key)}
            className={`relative flex-1 px-3 py-3 text-xs font-medium transition-colors duration-200 ${
              activeMode === mode.key
                ? 'bg-white text-blue-700 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
            }`}
          >
            {mode.label}
            {unsaved[mode.key] && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-amber-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <div className="p-4">
        <textarea
          value={currentText}
          onChange={handleChange}
          onBlur={handleSave}
          rows={8}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
          placeholder="No draft generated for this mode yet..."
        />

        {/* Footer bar */}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-400">
            {currentText.length} characters
            {saving && <span className="ml-2 text-blue-500">Saving...</span>}
          </span>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
