import { useQuery } from '@tanstack/react-query'
import {
  DollarSign, CheckSquare, Clock, Globe,
  TrendingUp, AlertCircle, Activity, Timer,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import api from '../api/client'
import type { DashboardStats, DailyStats, ActivityLog } from '../api/client'
import StatCard from '../components/ui/StatCard'

function fmt(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Dashboard() {
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: daily = [] } = useQuery<DailyStats[]>({
    queryKey: ['daily-stats'],
    queryFn: () => api.get('/reports/daily?days=14').then(r => r.data),
  })

  const { data: activity = [] } = useQuery<ActivityLog[]>({
    queryKey: ['activity'],
    queryFn: () => api.get('/reports/activity?limit=8').then(r => r.data),
  })

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header — hidden on mobile (shown in MobileHeader) */}
      <div className="hidden sm:block">
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your microtask productivity at a glance</p>
      </div>

      {/* Stat Cards — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Total Earnings"
          value={`$${(stats?.total_earnings ?? 0).toFixed(2)}`}
          icon={<DollarSign size={18} />}
          color="green"
          sub="All time completed tasks"
        />
        <StatCard
          label="Tasks Completed"
          value={stats?.tasks_completed ?? 0}
          icon={<CheckSquare size={18} />}
          color="indigo"
          sub={`${stats?.tasks_pending ?? 0} pending`}
        />
        <StatCard
          label="Time Today"
          value={fmt(stats?.time_spent_today_seconds ?? 0)}
          icon={<Timer size={18} />}
          color="blue"
          sub={`${fmt(stats?.time_spent_week_seconds ?? 0)} this week`}
        />
        <StatCard
          label="Connected Sites"
          value={stats?.connected_websites ?? 0}
          icon={<Globe size={18} />}
          color="purple"
          sub={`${stats?.active_websites ?? 0} active`}
        />
      </div>

      {/* Task Status Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pending',     count: stats?.tasks_pending ?? 0,     color: 'text-slate-300',  bg: 'bg-slate-800' },
          { label: 'In Progress', count: stats?.tasks_in_progress ?? 0, color: 'text-blue-400',   bg: 'bg-blue-500/10' },
          { label: 'Completed',   count: stats?.tasks_completed ?? 0,   color: 'text-green-400',  bg: 'bg-green-500/10' },
          { label: 'Skipped',     count: stats?.tasks_skipped ?? 0,     color: 'text-slate-500',  bg: 'bg-slate-800/50' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 border border-slate-800`}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-2xl sm:text-3xl font-bold mt-1 ${color}`}>{count}</p>
          </div>
        ))}
      </div>

      {/* Charts — stack on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-400" /> Earnings — Last 14 Days
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
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
              <Area type="monotone" dataKey="earnings" stroke="#6366f1" fill="url(#earn)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity size={16} className="text-green-400" /> Tasks Completed — Last 14 Days
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Bar dataKey="tasks_completed" name="Tasks" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <AlertCircle size={16} className="text-slate-400" /> Recent Activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">No activity yet. Start adding websites and tasks!</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {activity.map(a => (
              <div key={a.id} className="py-3 flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200">{a.action}</p>
                  {a.details && <p className="text-xs text-slate-500 truncate">{a.details}</p>}
                </div>
                <span className="text-xs text-slate-600 shrink-0">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
