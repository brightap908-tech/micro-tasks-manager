import { ReactNode } from 'react'
import { clsx } from 'clsx'

interface Props {
  label: string
  value: string | number
  icon: ReactNode
  color?: 'indigo' | 'green' | 'yellow' | 'blue' | 'red' | 'purple'
  sub?: string
}

const colors = {
  indigo: 'bg-indigo-500/10 text-indigo-400',
  green:  'bg-green-500/10 text-green-400',
  yellow: 'bg-yellow-500/10 text-yellow-400',
  blue:   'bg-blue-500/10 text-blue-400',
  red:    'bg-red-500/10 text-red-400',
  purple: 'bg-purple-500/10 text-purple-400',
}

export default function StatCard({ label, value, icon, color = 'indigo', sub }: Props) {
  return (
    <div className="card flex items-start gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', colors[color])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-slate-100 leading-tight truncate">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
