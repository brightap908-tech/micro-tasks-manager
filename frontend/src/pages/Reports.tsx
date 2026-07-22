import { useQuery } from '@tanstack/react-query'
import { Download, TrendingUp, BarChart2, PieChart } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getDailyStats, getEarningsByWebsite, getEarningsByCategory } from '../db/tasks'
import { getWebsites } from '../db/websites'

const COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316','#a855f7']

function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function ReportsPage() {
  const { data: websites = [] } = useQuery({
    queryKey: ['websites'],
    queryFn: getWebsites,
  })

  const { data: daily30 = [] } = useQuery({
    queryKey: ['daily-30'],
    queryFn: () => getDailyStats(30),
  })

  const { data: byWebsite = [] } = useQuery({
    queryKey: ['earnings-by-website', websites.map(w => w.id)],
    queryFn: () => getEarningsByWebsite(websites),
    enabled: websites.length > 0,
  })

  const { data: byCategory = [] } = useQuery({
    queryKey: ['earnings-by-category'],
    queryFn: getEarningsByCategory,
  })

  const totalEarnings = daily30.reduce((s, d) => s + d.earnings, 0)
  const totalTasks = daily30.reduce((s, d) => s + d.tasks_completed, 0)
  const totalTime = daily30.reduce((s, d) => s + d.time_spent_seconds, 0)

  const exportCSV = () => {
    const header = 'Date,Earnings,Tasks Completed,Time (seconds)\n'
    const rows = daily30.map(d => `${d.date},${d.earnings},${d.tasks_completed},${d.time_spent_seconds}`).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `microtask-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJSON = () => {
    const data = { daily30, byWebsite, byCategory, exported_at: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `microtask-report-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Reports</h1>
          <p className="text-sm text-slate-500">Earnings, productivity, and completion statistics</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={15} /> CSV
          </button>
          <button className="btn-secondary" onClick={exportJSON}>
            <Download size={15} /> JSON
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {[
          { icon: <TrendingUp size={16} />, label: 'Total Earnings (30d)', value: `$${totalEarnings.toFixed(2)}` },
          { icon: <BarChart2 size={16} />, label: 'Tasks Completed (30d)', value: String(totalTasks) },
          { icon: <PieChart size={16} />, label: 'Time Worked (30d)', value: fmt(totalTime) },
        ].map(({ icon, label, value }) => (
          <div key={label} className="card flex items-center gap-4">
            <div className="text-brand-400">{icon}</div>
            <div>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-xl font-bold text-slate-100">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 30-day earnings trend */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Earnings — Last 30 Days</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={daily30}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => v.slice(5)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, 'Earnings']}
            />
            <Area type="monotone" dataKey="earnings" stroke="#6366f1" fill="url(#g1)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* By website + By category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Earnings by Website</h2>
          {byWebsite.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No data yet. Complete some tasks first.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byWebsite} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="website_name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={90} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, 'Earnings']}
                />
                <Bar dataKey="total_earnings" fill="#6366f1" radius={[0, 4, 4, 0]} name="Earnings" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Earnings by Category</h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No data yet. Complete some tasks first.</p>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={180}>
                <RechartsPie>
                  <Pie
                    data={byCategory}
                    dataKey="total_earnings"
                    nameKey="category"
                    cx="50%" cy="50%"
                    outerRadius={70}
                    strokeWidth={2}
                    stroke="#0f172a"
                  >
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, 'Earnings']}
                  />
                </RechartsPie>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {byCategory.slice(0, 6).map((c, i) => (
                  <div key={c.category} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 capitalize flex-1 truncate">{c.category.replace('_', ' ')}</span>
                    <span className="text-slate-300 font-medium">${c.total_earnings.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Website breakdown table */}
      {byWebsite.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Website Breakdown</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                <th className="pb-2 pr-4">Website</th>
                <th className="pb-2 pr-4 text-right">Tasks</th>
                <th className="pb-2 pr-4 text-right">Completed</th>
                <th className="pb-2 text-right">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {byWebsite.map(w => (
                <tr key={w.website_id}>
                  <td className="py-2 pr-4 text-slate-200 font-medium">{w.website_name}</td>
                  <td className="py-2 pr-4 text-right text-slate-400">{w.task_count}</td>
                  <td className="py-2 pr-4 text-right text-slate-400">{w.completed_count}</td>
                  <td className="py-2 text-right text-green-400 font-medium">${w.total_earnings.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
