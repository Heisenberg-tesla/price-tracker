import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';
import { API_BASE_URL } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import {
  Activity,
  Server,
  Database,
  Clock,
  RefreshCw,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const mockPriceTrend = [
  { time: '04:00', price: 17263 },
  { time: '05:00', price: 17263 },
  { time: '06:00', price: 16210 },
  { time: '07:00', price: 16210 },
  { time: '08:00', price: 17263 },
  { time: '09:00', price: 17967 },
];

export const DashboardPage: React.FC = () => {
  const {
    data: health,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10000,
  });

  const formatUptime = (seconds?: number) => {
    if (seconds === undefined) return '--';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}h ${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-8">
      {/* Hero Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            System Overview & Health
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time monitoring of Price Tracker microservices and target catalog connectivity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: API Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Backend Health
            </span>
            <div className="p-2 rounded-lg bg-slate-800/80 text-emerald-400">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <StatusBadge
              status={isLoading ? 'loading' : isError ? 'error' : health?.status || 'error'}
            />
            <span className="text-xs text-slate-500 font-mono">
              {isLoading ? 'Checking...' : isError ? 'Unavailable' : 'Express v4'}
            </span>
          </div>
        </div>

        {/* Card 2: Uptime */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Process Uptime
            </span>
            <div className="p-2 rounded-lg bg-slate-800/80 text-cyan-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xl font-bold font-mono text-white">{formatUptime(health?.uptime)}</p>
            <p className="text-xs text-slate-500 mt-1">Continuous operation</p>
          </div>
        </div>

        {/* Card 3: Database Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Database Connection
            </span>
            <div className="p-2 rounded-lg bg-slate-800/80 text-indigo-400">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span
              className={`text-sm font-semibold font-mono ${
                health?.dbConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {health?.dbConnected ? 'CONNECTED' : 'STANDBY (Phase 1)'}
            </span>
            <span className="text-xs text-slate-500">Persistence</span>
          </div>
        </div>

        {/* Card 4: Version */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Service Version
            </span>
            <div className="p-2 rounded-lg bg-slate-800/80 text-purple-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xl font-bold font-mono text-white">v{health?.version || '1.0.0'}</p>
            <p className="text-xs text-slate-500 mt-1">Target: demo.inelabteamdev.com</p>
          </div>
        </div>
      </div>

      {/* API Endpoint & Connection Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
          <Server className="w-5 h-5 text-emerald-400" />
          API Configuration & Environment
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-mono bg-slate-950/70 p-4 rounded-lg border border-slate-800/80">
          <div>
            <span className="text-slate-500 block text-xs uppercase mb-1">
              Active API Base URL:
            </span>
            <span className="text-emerald-400 break-all">{API_BASE_URL}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs uppercase mb-1">Health Endpoint:</span>
            <span className="text-slate-300 break-all">{API_BASE_URL}/health</span>
          </div>
        </div>

        {isError && (
          <div className="mt-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-rose-300">
                Failed to communicate with Backend Service
              </p>
              <p className="text-xs text-rose-400/80 mt-1">
                {(error as Error)?.message ||
                  'Make sure the backend server is running on ' + API_BASE_URL}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Chart Verification Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Historical Price Chart Preview
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Sample chart component verifying Recharts integration for upcoming tracker phases.
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 px-2.5 py-1 rounded text-slate-300">
            Recharts v2
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockPriceTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} />
              <YAxis
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                domain={['auto', 'auto']}
                tickFormatter={(val) => `₹${val.toLocaleString()}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                }}
                itemStyle={{ color: '#34d399' }}
                formatter={(val: number) => [`₹${val.toLocaleString()}`, 'Price']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#priceGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
