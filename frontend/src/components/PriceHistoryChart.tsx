import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import { BarChart3, Table as TableIcon, Calendar, Info } from 'lucide-react';
import { PriceHistory } from '../types';
import { formatMoney, formatAbsoluteDateTime } from '../lib/formatters';

interface PriceHistoryChartProps {
  history: PriceHistory[];
  range: '24h' | '7d' | '30d' | 'all';
  onRangeChange: (range: '24h' | '7d' | '30d' | 'all') => void;
  currency?: string;
}

export const PriceHistoryChart: React.FC<PriceHistoryChartProps> = ({
  history,
  range,
  onRangeChange,
  currency = 'INR',
}) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  // Format history points for Recharts
  const chartData = history.map((item) => ({
    timestamp: new Date(item.scraped_at).getTime(),
    scrapedAt: item.scraped_at,
    priceCents: item.price_cents,
    inStock: item.in_stock,
    stockText: item.stock_text,
  }));

  const prices = chartData.map((d) => d.priceCents);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 10000;
  const padding = Math.max(1000, Math.round((maxPrice - minPrice) * 0.15));
  const yDomain = [Math.max(0, minPrice - padding), maxPrice + padding];

  // Identify out-of-stock intervals for reference shading
  const outOfStockIntervals: Array<{ start: number; end: number }> = [];
  let currentStart: number | null = null;

  for (let i = 0; i < chartData.length; i++) {
    const point = chartData[i];
    if (point && !point.inStock) {
      if (currentStart === null) currentStart = point.timestamp;
    } else if (currentStart !== null) {
      const prev = chartData[i - 1];
      if (prev) {
        outOfStockIntervals.push({ start: currentStart, end: prev.timestamp });
      }
      currentStart = null;
    }
  }
  if (currentStart !== null && chartData.length > 0) {
    const lastPoint = chartData[chartData.length - 1];
    if (lastPoint) {
      outOfStockIntervals.push({ start: currentStart, end: lastPoint.timestamp });
    }
  }

  // Format tick labels based on active range
  const formatXAxisTick = (time: number) => {
    const date = new Date(time);
    if (range === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Chart Controls Bar */}
      <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            Price History
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            ({history.length} records)
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Range Selector */}
          <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs">
            {(['24h', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  range === r
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          {/* View Toggle (Chart vs Table) */}
          <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'chart'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Chart View"
              aria-label="Chart View"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'table'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Table View"
              aria-label="Table View"
            >
              <TableIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4 sm:p-6">
        {history.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 space-y-2">
            <Info className="w-6 h-6 text-slate-500 mx-auto" />
            <p className="text-slate-300 font-medium">No price history points recorded yet</p>
            <p className="text-slate-500 text-[11px]">
              Trigger a manual scrape or wait for the scheduled cycle to record the first price point.
            </p>
          </div>
        ) : history.length === 1 && viewMode === 'chart' ? (
          <div className="py-8 text-center text-xs text-slate-400 space-y-3">
            <div className="inline-block p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono">
              <span className="text-slate-400 block text-[11px] uppercase tracking-wider mb-1">
                Baseline Recorded Price
              </span>
              <span className="text-2xl font-bold text-emerald-400">
                {formatMoney(history[0]?.price_cents, currency)}
              </span>
              <span className="text-slate-500 block text-[11px] mt-1">
                {formatAbsoluteDateTime(history[0]?.scraped_at)}
              </span>
            </div>
            <p className="text-slate-400 text-xs">
              Single data point recorded. Additional data points will plot trend lines automatically.
            </p>
          </div>
        ) : viewMode === 'chart' ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={formatXAxisTick}
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(val) => formatMoney(val, currency)}
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0]?.payload;
                      if (!data) return null;
                      return (
                        <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 shadow-xl text-xs font-sans">
                          <p className="font-semibold text-white text-sm font-mono">
                            {formatMoney(data.priceCents, currency)}
                          </p>
                          <p className="text-slate-400 text-[11px] mt-0.5">
                            {formatAbsoluteDateTime(data.scrapedAt)}
                          </p>
                          <div className="mt-2 flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                data.inStock ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                            <span className="text-[11px] text-slate-300">
                              {data.inStock ? 'In Stock' : 'Out of Stock'}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Shaded bands for out of stock periods */}
                {outOfStockIntervals.map((interval, idx) => (
                  <ReferenceArea
                    key={idx}
                    x1={interval.start}
                    x2={interval.end}
                    strokeOpacity={0.3}
                    fill="#f43f5e"
                    fillOpacity={0.15}
                  />
                ))}

                <Line
                  type="monotone"
                  dataKey="priceCents"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#34d399' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-medium uppercase text-[11px]">
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Price</th>
                  <th className="py-2.5 px-3">Stock State</th>
                  <th className="py-2.5 px-3 font-mono">Run ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-normal">
                {history
                  .slice()
                  .reverse()
                  .map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-300">
                        {formatAbsoluteDateTime(item.scraped_at)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-white">
                        {formatMoney(item.price_cents, currency)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                            item.in_stock
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {item.in_stock ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px]">
                        {item.scrape_run_id || '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
