import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, CheckSquare, Globe, BarChart3,
  Bell, Settings, Zap, UserCircle, Wallet, LogOut, X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import api from '../api/client'
import toast from 'react-hot-toast'

const mainLinks = [
  { to: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/tasks',          label: 'Tasks',          icon: CheckSquare },
  { to: '/websites',       label: 'Websites',       icon: Globe },
  { to: '/reports',        label: 'Reports',        icon: BarChart3 },
  { to: '/notifications',  label: 'Notifications',  icon: Bell },
  { to: '/settings',       label: 'Settings',       icon: Settings },
]

// Extra items shown only in the mobile slide-out menu
const mobileExtras = [
  { label: 'Profile',  icon: UserCircle, to: '/settings' },
  { label: 'Wallet',   icon: Wallet,     to: '/reports' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function Sidebar({ isOpen, onClose }: Props) {
  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.count as number),
    refetchInterval: 30_000,
  })

  const handleLogout = () => {
    toast('No authentication configured.', { icon: 'ℹ️' })
    onClose()
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative touch-manipulation',
      isActive
        ? 'bg-brand-600/20 text-brand-400'
        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800 active:bg-slate-700',
    )

  return (
    <aside
      className={clsx(
        // Base styles shared between mobile and desktop
        'flex flex-col bg-slate-900 border-r border-slate-800 h-full',
        // Mobile: fixed overlay, slides in/out
        'fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: static in flow, always visible, no transform
        'md:relative md:static md:translate-x-0 md:w-64 md:shrink-0 md:z-auto md:transition-none',
      )}
    >
      {/* Logo row */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shrink-0">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100 leading-tight">Microtask</p>
            <p className="text-xs text-slate-500 leading-tight">Manager</p>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button
          className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors touch-manipulation"
          onClick={onClose}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {mainLinks.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={navLinkClass}
            onClick={onClose}
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

        {/* Mobile-only extra links */}
        <div className="md:hidden pt-3 mt-3 border-t border-slate-800 space-y-0.5">
          {mobileExtras.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              className={navLinkClass}
              onClick={onClose}
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
            onClick={handleLogout}
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-800 shrink-0">
        <p className="text-xs text-slate-600 leading-tight">
          Productivity tool only.<br />
          No task automation.
        </p>
      </div>
    </aside>
  )
}
