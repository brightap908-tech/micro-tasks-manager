import { clsx } from 'clsx'
import type { TaskStatus, TaskCategory } from '../../db/index'

const statusStyles: Record<TaskStatus, string> = {
  pending:     'bg-slate-700 text-slate-300',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed:   'bg-green-500/20 text-green-400',
  skipped:     'bg-slate-600/40 text-slate-500',
}

const statusLabels: Record<TaskStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  skipped:     'Skipped',
}

const categoryStyles: Record<string, string> = {
  instagram:     'bg-pink-500/20 text-pink-400',
  facebook:      'bg-blue-500/20 text-blue-400',
  tiktok:        'bg-slate-500/20 text-slate-300',
  youtube:       'bg-red-500/20 text-red-400',
  telegram:      'bg-sky-500/20 text-sky-400',
  x:             'bg-slate-500/20 text-slate-300',
  linkedin:      'bg-blue-600/20 text-blue-400',
  discord:       'bg-indigo-500/20 text-indigo-400',
  website_visit: 'bg-teal-500/20 text-teal-400',
  survey:        'bg-amber-500/20 text-amber-400',
  app_install:   'bg-purple-500/20 text-purple-400',
  other:         'bg-slate-600/30 text-slate-400',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={clsx('badge', statusStyles[status])}>
      {statusLabels[status]}
    </span>
  )
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={clsx('badge', categoryStyles[category] ?? 'bg-slate-600/30 text-slate-400')}>
      {category.replace('_', ' ')}
    </span>
  )
}
