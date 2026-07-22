import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DollarSign, CheckSquare, Clock, Globe,
  AlertCircle, Timer, RefreshCw, Wallet,
  CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts'
import toast from 'react-hot-toast'
import { getTaskStats, getDailyStats } from '../db/tasks'
import { getWebsites } from '../db/websites'
import { getActivityLogs } from '../db/activity'
import { getSyncStatus, saveSnapshot } from '../db/snapshots'
import { syncWebsite } from '../api/client'
import type { SyncResult } from '../api/client'
import type { Website } from '../db/index'
import StatCard from '../components/ui/StatCard'
import { logActivity } from '../db/activity'
import { createNotification } from '../db/notifications'

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

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-700/60 ${className}`} />
}

async function runSyncAll(websites: Website[]) {
  const enabled = websites.filter(w => w.is_enabled)
  if (enabled.length === 0) return { total: 0, succeeded: 0, results: [] }

  const results: Array<{ website: Website; result: SyncResult }> = []

  for (const site of enabled) {
    const url = site.dashboard_url || site.login_url
    try {
      const result = await syncWebsite(url, site.name)
      await saveSnapshot({
        website_id: site.id,
        status: result.status,
        available_balance: result.available_balance ?? undefined,
        available_tasks: result.available_tasks ?? undefined,
        page_title: result.page_title ?? undefined,
        error_message: result.error_message ?? undefined,
      })
      results.push({ website: site, result })
    } catch (err) {
      const errorDetail = err instanceof Error ? err.message : String(err)
      await saveSnapshot({
        website_id: site.id,
        status: 'error',
        error_message: `Network error: ${errorDetail}`,
      })
      results.push({
        website: site,
        result: {
          status: 'error',
          available_balance: null,
          available_tasks: null,
          pending_tasks: null,
          completed_tasks: null,
          total_earnings: null,
          page_title: null,
          error_message: `Network error: ${errorDetail}`,
          error_detail: errorDetail,
          synced_at: new Date().toISOString(),
          http_status: null,
        },
      })
    }
  }

  const succeeded = results.filter(r => r.result.status === 'ok').length
  await logActivity(
    `Synced ${succeeded}/${enabled.length} websites`,
    results
      .filter(r => r.result.status !== 'ok')
      .map(r => `${r.website.name}: ${r.result.error_message ?? r.result.status}`)
      .join('; ') || undefined,
  )

  // Create notifications for errors
  for (const { website, result } of results) {
    if (result.status === 'error') {
      await createNotification({
        title: `Sync failed: ${website.name}`,
        message: result.error_message ?? 'Unknown error',
        type: 'error',
        website_id: website.id,
      })
    } else if (result.status === 'auth_required') {
      await createNotification({
        title: `Login required: ${website.name}`,
        message: result.error_message ?? 'Redirected to login page',
        type: 'warning',
        website_id: website.id,
      })
    }
  }

  return { total: enabled.length, succeeded, results }
}

export default function Dashboard() {
  const qc = useQueryClient()

  const { data: websites = [] } = useQuery({
    queryKey: ['websites'],
    queryFn: getWebsites,
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['task-stats'],
    queryFn: getTaskStats,
    refetchInterval: 60_000,
  })

  const { data: syncInfo } = useQuery({
    queryKey: ['sync-status', websites.map(w => w.id)],
    queryFn: () => getSyncStatus(websites.filter(w => w.is_enabled).map(w => w.id)),
    enabled: websites.length > 0,
  })

  const { data: daily = [], isLoading: dailyLoading } = useQuery({
    queryKey: ['daily-stats'],
    queryFn: () => getDailyStats(14),
  })

  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: () => getActivityLogs(8),
  })

  const syncMutation = useMutation({
    mutationFn: () => runSyncAll(websites),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      qc.invalidateQueries({ queryKey: ['task-stats'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })

      if (data.total === 0) {
        toast('No enabled websites to sync. Add a website first.')
      } else if (data.succeeded === data.total) {
        toast.success(`Synced ${data.total} site${data.total !== 1 ? 's' : ''} successfully`)
      } else {
        const failed = data.results.filter(r => r.result.status !== 'ok')
        const msgs = failed.map(r =>
          r.result.status === 'auth_required'
            ? `${r.website.name}: login required`
            : `${r.website.name}: ${r.result.error_message ?? 'error'}`
        )
        toast(`${data.succeeded}/${data.total} synced.\n${msgs.join('\n')}`, {
          duration: 8000,
          icon: data.succeeded > 0 ? '⚠️' : '❌',
        })
        // Show detailed errors in console for debugging
        for (const { website, result } of failed) {
          if (result.error_detail) {
            console.error(`[Sync] ${website.name}:\n${result.error_detail}`)
          }
        }
      }
    },
    onError: (err) => {
      console.error('[Sync] Fatal error:', err)
      toast.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
    },
  })

  const isSyncing = syncMutation.isPending
  const activeWebsites = websites.filter(w => w.is_enabled)
  const totalBalance = (syncInfo?.available_balance ?? 0)
  const syncStatus = syncInfo?.status ?? 'never'
  const lastSync = syncInfo?.last_sync_at

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="hidden sm:flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your microtask productivity at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <SyncStatusBadge status={syncStatus} />
            {lastSync && (
              <p className="text-xs text-slate-600 mt-0.5">
                {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
              </p>
            )}
          </div>
          <button
            className="btn-primary"
            onClick={() => syncMutation.mutate()}
            disabled={isSyncing}
          >
            <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing…' : 'Sync All'}
          </button>
        </div>
      </div>

      {/* Mobile sync button */}
      <div className="sm:hidden flex items-center justify-between">
        <SyncStatusBadge status={syncStatus} />
        <button
          className="btn-primary text-xs py-1.5 px-3"
          onClick={() => syncMutation.mutate()}
          disabled={isSyncing}
        >
          <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Syncing…' : 'Sync All'}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {statsLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              icon={<Wallet size={18} />}
              label="Available Balance"
              value={`$${totalBalance.toFixed(2)}`}
              sub="Click Sync to fetch"
              color="yellow"
            />
            <StatCard
              icon={<DollarSign size={18} />}
              label="Total Earnings"
              value={`$${(stats?.total_earnings ?? 0).toFixed(2)}`}
              sub="All completed tasks"
              color="green"
            />
            <StatCard
              icon={<CheckSquare size={18} />}
              label="Tasks Completed"
              value={String(stats?.tasks_completed ?? 0)}
              sub={`${stats?.tasks_pending ?? 0} pending`}
              color="blue"
            />
            <StatCard
              icon={<Timer size={18} />}
              label="Time Today"
              value={fmt(stats?.time_spent_today_seconds ?? 0)}
              sub={fmt(stats?.time_spent_week_seconds ?? 0) + ' this week'}
              color="purple"
            />
            <StatCard
              icon={<Globe size={18} />}
              label="Connected Sites"
              value={String(activeWebsites.length)}
              sub={`${activeWebsites.length} active`}
              color="indigo"
            />
            <StatCard
              icon={<AlertCircle size={18} />}
              label="In Progress"
              value={String(stats?.tasks_in_progress ?? 0)}
              sub={`${stats?.tasks_skipped ?? 0} skipped`}
              color="red"
            />
          </>
        )}
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {(['pending', 'in_progress', 'completed', 'skipped'] as const).map(s => {
          const count = stats
            ? s === 'pending' ? stats.tasks_pending
            : s === 'in_progress' ? stats.tasks_in_progress
            : s === 'completed' ? stats.tasks_completed
            : stats.tasks_skipped
            : 0
          const colors: Record<string, string> = {
            pending: 'text-slate-300',
            in_progress: 'text-blue-400',
            completed: 'text-green-400',
            skipped: 'text-slate-500',
          }
          return (
            <div key={s} className="card">
              <p className="text-xs text-slate-500 capitalize">{s.replace('_', ' ')}</p>
              <p className={`text-3xl font-bold mt-1 ${colors[s]}`}>{statsLoading ? '…' : count}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Earnings — Last 14 Days</h2>
          {dailyLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, 'Earnings']}
                />
                <Area type="monotone" dataKey="earnings" stroke="#6366f1" fill="url(#earn)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Tasks Completed — Last 14 Days</h2>
          {dailyLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="tasks_completed" fill="#22c55e" radius={[3, 3, 0, 0]} name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

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
