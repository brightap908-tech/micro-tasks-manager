import { Menu, Bell, Zap } from 'lucide-react'
import { useLocation, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':     'Dashboard',
  '/tasks':         'Tasks',
  '/websites':      'Websites',
  '/reports':       'Reports',
  '/notifications': 'Notifications',
  '/settings':      'Settings',
}

interface Props {
  onMenuToggle: () => void
}

export default function MobileHeader({ onMenuToggle }: Props) {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Microtask Manager'

  const { data: unread = 0 } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.count as number),
    refetchInterval: 30_000,
  })

  return (
    <header className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 active:bg-slate-700 transition-colors touch-manipulation"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center shrink-0">
            <Zap size={13} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-100">{title}</span>
        </div>
      </div>

      <Link
        to="/notifications"
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 active:bg-slate-700 transition-colors touch-manipulation"
        aria-label="Notifications"
      >
        <Bell size={22} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-brand-500 rounded-full ring-2 ring-slate-900" />
        )}
      </Link>
    </header>
  )
}
