import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DollarSign, CheckSquare, Clock, Globe,
  TrendingUp, AlertCircle, Activity, Timer,
  RefreshCw, Wallet, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import toast from 'react-hot-toast'
import api from '../api/client'
import type { DashboardStats, DailyStats, ActivityLog, SyncAllResult } from '../api/client'
import StatCard from '../components/ui/StatCard'

function fmt(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function SyncStatusBadge({ status }: { status: string }) {
  if (status === 'never') return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <Clock size={12} /> Never synced
    </span>
  )
  if (status === 'ok') return (
    <span className="inline-flex items-center gap-1 text-xs text-green-400">
      <CheckCircle size={12} /> All sites synced
    </span>
  )
  if (status === 'partial') return (
    <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
      <AlertTriangle size={12} /> Partial sync
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-400">
      <XCircle size={12} /> Sync error
    </span>
  )
}

/** Skeleton pulse block */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-700/60 ${className}`} />
}

export default function Dashboard() {
  const qc = useQueryClient()

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: daily = [], isLoading: dailyLoading } = useQuery<DailyStats[]>({
    queryKey: ['daily-stats'],
    queryFn: () => api.get('/reports/daily?days=14').then(r => r.data),
  })

  const { data: activity = [], isLoading: activityLoading } = useQuery<ActivityLog[]>({
    queryKey: ['activity'],
    queryFn: () => api.get('/reports/activity?limit=8').then(r => r.data),
  })

  const syncMutation = useMutation<SyncAllResult>({
    mutationFn: () => api.post('/sync/all').then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['daily-stats'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      if (data.total === 0) {
        toast('No enabled websites to sync. Add a website first.')
      } else if (data.succeeded === data.total) {
        toast.success(`Synced ${data.total} site${data.total !== 1 ? 's' : ''} successfully`)
      } else {
        const failed = data.results.filter(r => r.status !== 'ok')
        const msgs = failed.map(r =>
          r.status === 'auth_required'
            ? `${r.website_name}: login required`
            : `${r.website_name}: ${r.error_message ?? 'error'}`
        )
        toast(`${data.succeeded}/${data.total} synced. Issues:\n${msgs.join('\n')}`, {
          duration: 6000,
          icon: data.succeeded > 0 ? '⚠️' : '❌',
        })
      }
    },
    onError: () => {
      toast.error('Sync failed — check server logs')
    },
  })

  const isSyncing = syncMutation.isPending

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="hidden sm:flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your microtask productivity at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="text-right">
              <SyncStatusBadge status={stats.sync_status} />
              {stats.last_sync_at && (
                <p className="text-xs text-slate-600 mt-0.5">
                  {formatDistanceToNow(new Date(stats.last_sync_at), { addSuffix: true })}
                </p>
              )}
            </div>
          )}
          <button
            onClick={() => syncMutation.mutate()}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing…' : 'Sync All'}
          </button>
        </div>
      </div>

      {/* Mobile sync bar */}
      <div className="flex sm:hidden items-center justify-between">
        <div>
          {stats && <SyncStatusBadge status={stats.sync_status} />}
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium"
        >
          <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      {/* API error banner */}
      {statsError && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          <XCircle size={16} className="shrink-0" />
          <span>Failed to load dashboard data — check that the server is running and try refreshing.</span>
        </div>
      )}

      {/* Stat Cards — 2 cols mobile → 3 cols md → 6 cols xl */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {/* Available Balance — highlighted */}
        {statsLoading ? (
          <div className="col-span-2 md:col-span-1 card flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        ) : (
          <StatCard
            label="Available Balance"
            value={`$${(stats?.available_balance ?? 0).toFixed(2)}`}
            icon={<Wallet size={18} />}
            color="yellow"
            sub={
              stats?.sync_status === 'never'
                ? 'Click Sync to fetch'
                : stats?.sync_status === 'error'
                ? 'Sync error — check sites'
                : 'From connected sites'
            }
          />
        )}

        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-3">
              <Skeleton className="w-9 h-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-12" />
              </div>
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total Earnings"
              value={`$${(stats?.total_earnings ?? 0).toFixed(2)}`}
              icon={<DollarSign size={18} />}
              color="green"
              sub="All completed tasks"
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
            <StatCard
              label="In Progress"
              value={stats?.tasks_in_progress ?? 0}
              icon={<Activity size={18} />}
              color="red"
              sub={`${stats?.tasks_skipped ?? 0} skipped`}
            />
          </>
        )}
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
            {statsLoading
              ? <Skeleton className="h-8 w-10 mt-1" />
              : <p className={`text-2xl sm:text-3xl font-bold mt-1 ${color}`}>{count}</p>
            }
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-400" /> Earnings — Last 14 Days
          </h2>
          {dailyLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
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
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity size={16} className="text-green-400" /> Tasks Completed — Last 14 Days
          </h2>
          {dailyLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
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
          )}
        </div>
      </div>

      {/* Sync Details — shown after a sync with results */}
      {syncMutation.isSuccess && syncMutation.data && syncMutation.data.total > 0 && (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <RefreshCw size={14} className="text-brand-400" /> Last Sync Details
          </h2>
          <div className="divide-y divide-slate-800">
            {syncMutation.data.results.map(r => (
              <div key={r.website_id} className="py-3 flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${
                  r.status === 'ok' ? 'text-green-400' :
                  r.status === 'auth_required' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {r.status === 'ok'
                    ? <CheckCircle size={14} />
                    : r.status === 'auth_required'
                    ? <AlertTriangle size={14} />
                    : <XCircle size={14} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 font-medium">{r.website_name}</p>
                  {r.status === 'ok' && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {r.page_title && <span className="mr-3">{r.page_title}</span>}
                      {r.available_balance != null && (
                        <span className="text-green-400 mr-3">Balance: ${r.available_balance.toFixed(2)}</span>
                      )}
                      {r.available_tasks != null && (
                        <span className="text-blue-400">{r.available_tasks} tasks available</span>
                      )}
                    </p>
                  )}
                  {r.status === 'auth_required' && (
                    <p className="text-xs text-yellow-500/80 mt-0.5">
                      Login required — open the site in your browser and log in, then sync again
                    </p>
                  )}
                  {r.status === 'error' && r.error_message && (
                    <p className="text-xs text-red-400/80 mt-0.5">{r.error_message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <AlertCircle size={16} className="text-slate-400" /> Recent Activity
        </h2>
        {activityLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-1">
                <Skeleton className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
                <Skeleton className="h-2.5 w-16 shrink-0" />
              </div>
            ))}
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-slate-500">No activity yet.</p>
            <p className="text-xs text-slate-600">
              Click <span className="text-brand-400 font-medium">Sync All</span> to fetch data from your connected sites,
              or add tasks manually on the Tasks page.
            </p>
          </div>
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
