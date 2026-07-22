import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import api from '../api/client'
import type { Notification } from '../api/client'
import EmptyState from '../components/ui/EmptyState'

const typeStyles: Record<string, string> = {
  info:    'border-l-blue-500 bg-blue-500/5',
  success: 'border-l-green-500 bg-green-500/5',
  warning: 'border-l-yellow-500 bg-yellow-500/5',
  error:   'border-l-red-500 bg-red-500/5',
}

export default function NotificationsPage() {
  const qc = useQueryClient()

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 15_000,
  })

  const markRead = useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      toast.success('All notifications marked as read')
    },
  })

  const deleteNotif = useMutation({
    mutationFn: (id: number) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearAll = useMutation({
    mutationFn: () => api.delete('/notifications'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      toast.success('Notifications cleared')
    },
  })

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Notifications</h1>
          <p className="text-sm text-slate-500">{unread} unread</p>
        </div>
        {(unread > 0 || notifications.length > 0) && (
          <div className="flex gap-2 flex-wrap">
            {unread > 0 && (
              <button className="btn-secondary flex items-center gap-2" onClick={() => markAllRead.mutate()}>
                <CheckCheck size={15} /> Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button className="btn-danger flex items-center gap-2" onClick={() => clearAll.mutate()}>
                <Trash2 size={15} /> Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell size={24} />}
          title="No notifications"
          description="Notifications about your tasks and websites will appear here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={clsx(
                'card border-l-4 py-4 flex items-start gap-3 transition-opacity',
                typeStyles[n.type] ?? 'border-l-slate-600',
                n.is_read && 'opacity-60',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-100">{n.title}</p>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                  )}
                </div>
                <p className="text-sm text-slate-400 mt-0.5">{n.message}</p>
                <p className="text-xs text-slate-600 mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!n.is_read && (
                  <button
                    className="p-1.5 rounded-lg text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors touch-manipulation"
                    title="Mark as read"
                    onClick={() => markRead.mutate(n.id)}
                  >
                    <Check size={14} />
                  </button>
                )}
                <button
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
                  title="Delete"
                  onClick={() => deleteNotif.mutate(n.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
