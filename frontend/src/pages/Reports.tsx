import { useQuery } from '@tanstack/react-query'
import { Download, TrendingUp, BarChart2, PieChart } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import api from '../api/client'
import type { DailyStats, EarningsByWebsite, EarningsByCategory } from '../api/client'

const COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316','#a855f7']

function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function ReportsPage() {
  const { data: daily30 = [] } = useQuery<DailyStats[]>({
    queryKey: ['daily-30'],
    queryFn: () => api.get('/reports/daily?days=30').then(r => r.data),
  })

  const { data: byWebsite = [] } = useQuery<EarningsByWebsite[]>({
    queryKey: ['earnings-by-website'],
    queryFn: () => api.get('/reports/earnings/by-website').then(r => r.data),
  })

  const { data: byCategory = [] } = useQuery<EarningsByCategory[]>({
    queryKey: ['earnings-by-category'],
    queryFn: () => api.get('/reports/earnings/by-category').then(r => r.data),
  })

  const totalEarnings = daily30.reduce((s, d) => s + d.earnings, 0)
  const totalTasks = daily30.reduce((s, d) => s + d.tasks_completed, 0)
  const totalTime = daily30.reduce((s, d) => s + d.time_spent_seconds, 0)

  const exportCSV = () => { window.open('/api/reports/export/csv', '_blank') }
  const exportXLSX = () => { window.open('/api/reports/export/excel', '_blank') }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Reports</h1>
          <p className="text-sm text-slate-500">Earnings, productivity, and completion statistics</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={15} /> CSV
          </button>
          <button className="btn-secondary" onClick={exportXLSX}>
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      {/* Summary — 1 col on mobile, 3 on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: 'Earnings (30d)', value: `$${totalEarnings.toFixed(2)}` },
          { label: 'Tasks (30d)',    value: totalTasks },
          { label: 'Time (30d)',     value: fmt(totalTime) },
        ].map(({ label, value }) => (
          <div key={label} className="card flex sm:block items-center gap-4">
            <p className="text-xs text-slate-500 sm:text-center">{label}</p>
            <p className="text-2xl font-bold text-slate-100 sm:mt-1 sm:text-center">{value}</p>
          </div>
        ))}
      </div>

      {/* Earnings trend */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-400" /> Earnings — Last 30 Days
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={daily30} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="e30" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Earnings']}
            />
            <Area type="monotone" dataKey="earnings" stroke="#6366f1" fill="url(#e30)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts side by side on lg, stacked on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Earnings by website */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <BarChart2 size={16} className="text-green-400" /> Earnings by Website
          </h2>
          {byWebsite.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byWebsite} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="website_name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Earnings']}
                />
                <Bar dataKey="total_earnings" fill="#22c55e" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Earnings by category */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <PieChart size={16} className="text-yellow-400" /> Earnings by Category
          </h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <RechartsPie>
                <Pie
                  data={byCategory}
                  dataKey="total_earnings"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={false}
                  labelLine={{ stroke: '#475569' }}
                >
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v: unknown) => [`$${(v as number).toFixed(2)}`, 'Earnings']}
                />
              </RechartsPie>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-website table — horizontally scrollable on mobile */}
      {byWebsite.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300">Website Performance</h2>
          </div>
          <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-800">
                  <th className="text-left px-4 sm:px-5 py-3">Website</th>
                  <th className="text-right px-4 sm:px-5 py-3">Total Tasks</th>
                  <th className="text-right px-4 sm:px-5 py-3">Completed</th>
                  <th className="text-right px-4 sm:px-5 py-3">Rate</th>
                  <th className="text-right px-4 sm:px-5 py-3">Earnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {byWebsite.map(w => (
                  <tr key={w.website_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 sm:px-5 py-3 font-medium text-slate-200">{w.website_name}</td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-400">{w.task_count}</td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-400">{w.completed_count}</td>
                    <td className="px-4 sm:px-5 py-3 text-right text-slate-400">
                      {w.task_count > 0 ? `${Math.round(w.completed_count / w.task_count * 100)}%` : '—'}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-green-400 font-semibold">${w.total_earnings.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
