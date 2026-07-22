import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, CheckSquare, Globe, BarChart3,
  Bell, Settings, Zap,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { clsx } from 'clsx'

const links = [
  { to: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/tasks',          label: 'Tasks',          icon: CheckSquare },
  { to: '/websites',       label: 'Websites',       icon: Globe },
  { to: '/reports',        label: 'Reports',        icon: BarChart3 },
  { to: '/notifications',  label: 'Notifications',  icon: Bell },
  { to: '/settings',       label: 'Settings',       icon: Settings },
]

export default function Sidebar() {
  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.count as number),
    refetchInterval: 30_000,
  })

  return (
    <aside className="w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shrink-0">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100 leading-tight">Microtask</p>
            <p className="text-xs text-slate-500 leading-tight">Manager</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
              isActive
                ? 'bg-brand-600/20 text-brand-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800',
            )}
          >
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {label === 'Notifications' && unread ? (
              <span className="bg-brand-600 text-white text-xs font-semibold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-800">
        <p className="text-xs text-slate-600 leading-tight">
          Productivity tool only.<br />
          No task automation.
        </p>
      </div>
    </aside>
  )
}
