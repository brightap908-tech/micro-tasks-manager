import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
  deleteNotification, clearAllNotifications,
} from '../db/notifications'
import type { Notification } from '../db/index'
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
    queryFn: getNotifications,
    refetchInterval: 15_000,
  })

  const markRead = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      toast.success('All notifications marked as read')
    },
  })

  const deleteNotif = useMutation({
    mutationFn: (id: number) => deleteNotification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })

  const clearAll = useMutation({
    mutationFn: () => clearAllNotifications(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
      toast.success('Notifications cleared')
    },
  })

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Notifications</h1>
          <p className="text-sm text-slate-500">
            {unread > 0 ? `${unread} unread notification${unread !== 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        {notifications.length > 0 && (
          <div className="flex gap-2">
            {unread > 0 && (
              <button className="btn-secondary text-xs" onClick={() => markAllRead.mutate()}>
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
            <button
              className="btn-secondary text-xs text-red-400 hover:text-red-300"
              onClick={() => clearAll.mutate()}
            >
              <Trash2 size={13} /> Clear all
            </button>
          </div>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell size={32} />}
          title="No notifications"
          description="Notifications from sync results and task updates will appear here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={clsx(
                'card border-l-4 flex items-start gap-3 transition-opacity',
                typeStyles[n.type] ?? typeStyles.info,
                n.is_read && 'opacity-60',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <p className={clsx('text-sm font-medium', n.is_read ? 'text-slate-400' : 'text-slate-100')}>
                    {n.title}
                  </p>
                  {!n.is_read && (
                    <span className="inline-block w-2 h-2 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                <p className="text-xs text-slate-600 mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {!n.is_read && (
                  <button
                    onClick={() => markRead.mutate(n.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                    title="Mark as read"
                  >
                    <Check size={14} />
                  </button>
                )}
                <button
                  onClick={() => deleteNotif.mutate(n.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete"
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
