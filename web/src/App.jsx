import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { getToken, login, logout } from './api/client';
import ScanPage from './pages/ScanPage';
import ResultsPage from './pages/ResultsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import MonitorPage from './pages/MonitorPage';
import SuppressionPage from './pages/SuppressionPage';
import DashboardPage from './pages/DashboardPage';
import CampaignPage from './pages/CampaignPage';
import PipelinePage from './pages/PipelinePage';
import AnalyticsPage from './pages/AnalyticsPage';
import ToolsPage from './pages/ToolsPage';
import FollowUpsPage from './pages/FollowUpsPage';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/scan', label: 'Scan' },
  { to: '/results', label: 'Results' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/follow-ups', label: 'Follow-ups' },
  { to: '/monitor', label: 'Monitor' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/tools', label: 'AI Tools' },
  { to: '/suppress', label: 'Suppress' },
];

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onLogin();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Sign in to Lead Scanner</h1>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
          Sign in
        </button>
      </form>
    </div>
  );
}

export default function App() {
  // Shown only when the server rejects a request (auth enabled via JWT_SECRET)
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    const onAuthRequired = () => setNeedsLogin(true);
    window.addEventListener('auth-required', onAuthRequired);
    return () => window.removeEventListener('auth-required', onAuthRequired);
  }, []);

  if (needsLogin) {
    // Remount the app after login so pages refetch their data
    return <LoginPage onLogin={() => { setNeedsLogin(false); window.location.reload(); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <span className="text-lg font-semibold text-slate-800">Lead Scanner</span>
            </div>
            <div className="flex gap-0.5 overflow-x-auto">
              {NAV_ITEMS.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {getToken() && (
                <button onClick={logout} className="px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 whitespace-nowrap">
                  Log out
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/campaigns" element={<CampaignPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/follow-ups" element={<FollowUpsPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/suppress" element={<SuppressionPage />} />
        </Routes>
      </main>
    </div>
  );
}
