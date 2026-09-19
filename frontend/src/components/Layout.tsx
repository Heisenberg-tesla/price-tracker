import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, LayoutDashboard, ShieldCheck, Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();

  const {
    data: health,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15000,
  });

  const getSystemStatus = () => {
    if (isLoading) return 'loading';
    if (isError || !health) return 'error';
    return health.status;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-900/40 group-hover:bg-emerald-500 transition-colors">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <span className="font-semibold text-lg tracking-tight text-white block leading-tight">
                  Price<span className="text-emerald-400">Tracker</span>
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                  Enterprise Monitor
                </span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              <Link
                to="/"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                  location.pathname === '/'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 border border-slate-800 rounded-lg px-3 py-1.5 bg-slate-900/50">
              <Activity className="w-3.5 h-3.5 text-slate-500" />
              <span>API Status:</span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
                  getSystemStatus() === 'ok'
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                    : getSystemStatus() === 'loading'
                      ? 'bg-slate-800 text-slate-400 border border-slate-700'
                      : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    getSystemStatus() === 'ok'
                      ? 'bg-emerald-400 animate-pulse'
                      : getSystemStatus() === 'loading'
                        ? 'bg-slate-400'
                        : 'bg-rose-400'
                  }`}
                />
                {getSystemStatus() === 'ok'
                  ? 'Online'
                  : getSystemStatus() === 'loading'
                    ? 'Checking…'
                    : 'Degraded'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>v1.0.0</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>Price Tracker System — Monorepo Architecture</p>
          <p className="font-mono text-slate-600">React 18 + Vite · Express + TypeScript</p>
        </div>
      </footer>
    </div>
  );
};
