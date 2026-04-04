import React, { useState } from 'react';
import { analyzeMessage, generateContent, generateICPProfile } from '../api/client';

export default function ToolsPage() {
  const [tab, setTab] = useState('icp');
  const tabs = [
    { key: 'icp', label: '🎯 ICP Generator' },
    { key: 'message', label: '📝 Message Analyzer' },
    { key: 'content', label: '✍️ Content Generator' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">AI Tools</h1>
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'icp' && <ICPGen />}
      {tab === 'message' && <MsgAnalyzer />}
      {tab === 'content' && <ContentGen />}
    </div>
  );
}

function ICPGen() {
  const [input, setInput] = useState({ productDescription: '', targetMarket: '', existingCustomers: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const go = async (e) => {
    e.preventDefault(); if (!input.productDescription.trim()) return;
    setLoading(true);
    try { setResult(await generateICPProfile(input)); } catch (err) { alert(err.message); }
    setLoading(false);
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Generate ICP</h2>
        <form onSubmit={go} className="space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Product Description *</label>
            <textarea value={input.productDescription} onChange={e => setInput({...input, productDescription: e.target.value})}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" rows={4} placeholder="Describe your product..." /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Target Market</label>
            <input type="text" value={input.targetMarket} onChange={e => setInput({...input, targetMarket: e.target.value})}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. B2B SaaS" /></div>
          <button type="submit" disabled={loading}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-lg disabled:opacity-50">
            {loading ? '⏳ Generating...' : '🎯 Generate ICP'}</button>
        </form>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Result</h2>
        {result ? <pre className="text-xs bg-slate-50 rounded-lg p-4 overflow-auto max-h-[500px]">{JSON.stringify(result.icp || result, null, 2)}</pre>
          : <p className="text-slate-400 text-sm">Generate an ICP to see results</p>}
      </div>
    </div>
  );
}

function MsgAnalyzer() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const go = async (e) => {
    e.preventDefault(); if (!message.trim()) return;
    setLoading(true);
    try { setResult(await analyzeMessage(message)); } catch (err) { alert(err.message); }
    setLoading(false);
  };
  const scores = result?.analysis?.scores;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Analyze Message</h2>
        <form onSubmit={go} className="space-y-4">
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" rows={6} placeholder="Paste your outreach message..." />
          <button type="submit" disabled={loading}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-lg disabled:opacity-50">
            {loading ? '⏳ Analyzing...' : '📝 Analyze'}</button>
        </form>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Analysis</h2>
        {scores ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(scores).map(([k,v]) => (
                <div key={k} className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className={`text-xl font-bold ${v>=7?'text-emerald-600':v>=4?'text-amber-600':'text-red-500'}`}>{v}/10</p>
                  <p className="text-xs text-slate-500 capitalize">{k.replace('_',' ')}</p>
                </div>
              ))}
            </div>
            {result.analysis.improvements && <div><h3 className="text-sm font-semibold text-amber-700 mb-1">💡 Improvements</h3>
              <ul className="text-xs text-slate-600 space-y-1">{result.analysis.improvements.map((s,i)=><li key={i}>• {s}</li>)}</ul></div>}
            {result.analysis.rewritten && <div><h3 className="text-sm font-semibold text-blue-700 mb-1">✨ Improved</h3>
              <p className="text-sm bg-blue-50 rounded-lg p-3">{result.analysis.rewritten}</p></div>}
          </div>
        ) : <p className="text-slate-400 text-sm">Analyze a message to see scores</p>}
      </div>
    </div>
  );
}

function ContentGen() {
  const [input, setInput] = useState({ topic: '', tone: 'professional', format: 'story' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const go = async (e) => {
    e.preventDefault(); if (!input.topic.trim()) return;
    setLoading(true);
    try { setResult(await generateContent(input)); } catch (err) { alert(err.message); }
    setLoading(false);
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Generate Content</h2>
        <form onSubmit={go} className="space-y-4">
          <input type="text" value={input.topic} onChange={e => setInput({...input, topic: e.target.value})}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Topic..." />
          <div className="grid grid-cols-2 gap-3">
            <select value={input.tone} onChange={e => setInput({...input, tone: e.target.value})}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="professional">Professional</option><option value="casual">Casual</option>
              <option value="inspirational">Inspirational</option><option value="educational">Educational</option>
            </select>
            <select value={input.format} onChange={e => setInput({...input, format: e.target.value})}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
              <option value="story">Story</option><option value="listicle">Listicle</option>
              <option value="question">Question</option><option value="short">Short</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium rounded-lg disabled:opacity-50">
            {loading ? '⏳ Generating...' : '✍️ Generate'}</button>
        </form>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Generated Post</h2>
        {result?.content ? (
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm whitespace-pre-line">{result.content.post}</p>
            </div>
            {result.content.hashtags && <div className="flex flex-wrap gap-2">
              {result.content.hashtags.map((h,i) => <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">#{h}</span>)}
            </div>}
            <button onClick={() => navigator.clipboard.writeText(result.content.post)}
              className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs rounded-lg hover:bg-slate-200">📋 Copy</button>
          </div>
        ) : <p className="text-slate-400 text-sm">Generate content to see results</p>}
      </div>
    </div>
  );
}
