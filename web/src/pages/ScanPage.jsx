import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startScan, getIcpProfiles, getCampaigns } from '../api/client';

/**
 * ScanPage — URL input, outreach mode selection, ICP profile dropdown, live scan progress.
 */
export default function ScanPage() {
  const navigate = useNavigate();
  const [postUrl, setPostUrl] = useState('');
  const [outreachMode, setOutreachMode] = useState('direct');
  const [icpProfile, setIcpProfile] = useState('icp');
  const [icpProfiles, setIcpProfiles] = useState(['icp']);
  const [campaigns, setCampaigns] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [currentStep, setCurrentStep] = useState(null);
  const [error, setError] = useState(null);

  // Load ICP profiles and campaigns on mount
  useEffect(() => {
    getIcpProfiles().then(setIcpProfiles).catch(console.error);
    getCampaigns().then(setCampaigns).catch(console.error);
  }, []);

  const isValidUrl = (url) => {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'www.linkedin.com' || parsed.hostname === 'linkedin.com') &&
        parsed.pathname.includes('/posts/')
      );
    } catch {
      return false;
    }
  };

  const urlValid = isValidUrl(postUrl);

  const handleScan = async () => {
    if (!urlValid || isScanning) return;

    setIsScanning(true);
    setProgress([]);
    setError(null);
    setCurrentStep(null);

    try {
      const response = await startScan({ postUrl, outreachMode, icpProfile });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              if (event.step === 'error') {
                setError(event.message || 'An error occurred during the scan.');
                setIsScanning(false);
                return;
              }

              if (event.step === 'done') {
                setIsScanning(false);
                // Navigate to results
                navigate(`/results?postUrl=${encodeURIComponent(postUrl)}`);
                return;
              }

              setCurrentStep(event);
              setProgress((prev) => [...prev, event]);
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      setIsScanning(false);
    } catch (err) {
      setError(err.message);
      setIsScanning(false);
    }
  };

  const outreachModes = [
    { value: 'direct', label: 'Direct comment reference', desc: 'Reference their specific comment (best for T1/T2)' },
    { value: 'topic', label: 'Post topic reference', desc: 'Reference the post topic without mentioning their comment' },
    { value: 'pain', label: 'Pain-point only', desc: 'Cold outreach based on title and company — no post mention' },
    { value: 'campaign', label: 'Campaign', desc: 'Use a custom campaign prompt' },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">LinkedIn Lead Scanner</h1>
        <p className="text-slate-500">
          Paste a LinkedIn post URL to scrape, enrich, and score every commenter.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        {/* URL Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            LinkedIn Post URL
          </label>
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.linkedin.com/posts/..."
            disabled={isScanning}
            className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
              postUrl && !urlValid
                ? 'border-red-300 bg-red-50'
                : 'border-slate-200 bg-white'
            }`}
          />
          {postUrl && !urlValid && (
            <p className="mt-1.5 text-xs text-red-500">
              Must be a valid LinkedIn post URL (linkedin.com/posts/...)
            </p>
          )}
        </div>

        {/* Outreach Mode */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-3">
            Outreach Angle
          </label>
          <div className="space-y-2">
            {outreachModes.map((mode) => (
              <label
                key={mode.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                  outreachMode === mode.value
                    ? 'border-blue-300 bg-blue-50/50'
                    : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
                }`}
              >
                <input
                  type="radio"
                  name="outreachMode"
                  value={mode.value}
                  checked={outreachMode === mode.value}
                  onChange={(e) => setOutreachMode(e.target.value)}
                  disabled={isScanning}
                  className="mt-0.5 w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-800">{mode.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* ICP Profile */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            ICP Profile
          </label>
          <select
            value={icpProfile}
            onChange={(e) => setIcpProfile(e.target.value)}
            disabled={isScanning}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {icpProfiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile === 'icp' ? 'Default ICP' : profile}
              </option>
            ))}
          </select>
        </div>

        {/* Scan Button */}
        <button
          onClick={handleScan}
          disabled={!urlValid || isScanning}
          className={`w-full py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-200 ${
            urlValid && !isScanning
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isScanning ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {/* Progress */}
      {isScanning && currentStep && (
        <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {currentStep.message || currentStep.step}
              </div>
              {currentStep.current != null && currentStep.total != null && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {currentStep.current} / {currentStep.total}
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {currentStep.current != null && currentStep.total != null && currentStep.total > 0 && (
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${(currentStep.current / currentStep.total) * 100}%` }}
              />
            </div>
          )}

          {/* Step log */}
          <div className="mt-4 max-h-32 overflow-y-auto">
            {progress.slice(-5).map((p, i) => (
              <div key={i} className="text-xs text-slate-400 py-0.5">
                <span className="text-slate-300 mr-2">•</span>
                {p.message || p.step}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <div className="text-sm font-semibold text-red-800">Scan Failed</div>
              <div className="text-sm text-red-600 mt-1">{error}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
