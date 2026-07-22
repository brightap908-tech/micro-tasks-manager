import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, ExternalLink, Trash2,
  CheckCircle2, Clock, SkipForward, PlayCircle,
  ChevronDown, DollarSign,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { getTasks, createTask, updateTask, deleteTask } from '../db/tasks'
import { getWebsites } from '../db/websites'
import type { Task, Website, TaskStatus, TaskCategory } from '../db/index'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import { StatusBadge, CategoryBadge } from '../components/ui/Badge'

const CATEGORIES: TaskCategory[] = [
  'instagram','facebook','tiktok','youtube','telegram','x',
  'linkedin','discord','website_visit','survey','app_install','other',
]
const STATUSES: TaskStatus[] = ['pending','in_progress','completed','skipped']

const defaultForm = {
  title: '', description: '', url: '', category: 'other' as TaskCategory,
  status: 'pending' as TaskStatus, reward: 0, currency: 'USD',
  website_id: '' as string | number, notes: '',
}

function TaskForm({
  initial, websites, onSave, onCancel, loading,
}: {
  initial: typeof defaultForm
  websites: Website[]
  onSave: (data: typeof defaultForm) => void
  onCancel: () => void
  loading: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-4">
      <div>
        <label className="label">Title *</label>
        <input className="input" required value={form.title} onChange={e => set('title', e.target.value)} placeholder="Task title" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="select" value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Reward</label>
          <input className="input" type="number" step="0.01" min="0" value={form.reward} onChange={e => set('reward', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className="label">Currency</label>
          <input className="input" value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="USD" />
        </div>
      </div>
      <div>
        <label className="label">Website</label>
        <select className="select" value={form.website_id} onChange={e => set('website_id', e.target.value ? parseInt(e.target.value) : '')}>
          <option value="">None</option>
          {websites.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Task URL</label>
        <input className="input" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Private notes" />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Task'}</button>
      </div>
    </form>
  )
}

const STATUS_ACTIONS: Record<TaskStatus, { next: TaskStatus; label: string; icon: React.ReactNode; color: string }> = {
  pending:     { next: 'in_progress', label: 'Start',    icon: <PlayCircle size={14} />,    color: 'text-blue-400' },
  in_progress: { next: 'completed',   label: 'Complete', icon: <CheckCircle2 size={14} />,  color: 'text-green-400' },
  completed:   { next: 'pending',     label: 'Reopen',   icon: <Clock size={14} />,          color: 'text-slate-400' },
  skipped:     { next: 'pending',     label: 'Reopen',   icon: <Clock size={14} />,          color: 'text-slate-400' },
}

export default function TasksPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | ''>('')
  const [filterCategory, setFilterCategory] = useState<TaskCategory | ''>('')
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterCategory, search],
    queryFn: () => getTasks({
      status: filterStatus || undefined,
      category: filterCategory || undefined,
      search: search || undefined,
    }),
  })

  const { data: websites = [] } = useQuery({
    queryKey: ['websites'],
    queryFn: getWebsites,
  })

  const websiteMap = Object.fromEntries(websites.map(w => [w.id, w]))

  const create = useMutation({
    mutationFn: (d: typeof defaultForm) => createTask({
      title: d.title,
      description: d.description || undefined,
      url: d.url || undefined,
      category: d.category,
      status: d.status,
      reward: d.reward,
      currency: d.currency,
      website_id: d.website_id ? Number(d.website_id) : undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-stats'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setShowModal(false)
      toast.success('Task created')
    },
    onError: (e) => toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Task> }) => updateTask(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-stats'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setEditTask(null)
    },
    onError: (e) => toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-stats'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setDeleteId(null)
      toast.success('Task deleted')
    },
  })

  const quickStatus = (task: Task) => {
    const action = STATUS_ACTIONS[task.status]
    update.mutate({ id: task.id, data: { status: action.next } })
  }

  const totalEarnings = tasks
    .filter(t => t.status === 'completed')
    .reduce((s, t) => s + t.reward, 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Tasks</h1>
          <p className="text-sm text-slate-500">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            {filterStatus || filterCategory || search ? ' (filtered)' : ''}
            {totalEarnings > 0 && ` · $${totalEarnings.toFixed(2)} earned`}
          </p>
        </div>
        <button className="btn-primary self-start sm:self-auto" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-8 text-sm"
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="select sm:w-36 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value as TaskStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="select sm:w-36 text-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value as TaskCategory | '')}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card animate-pulse flex items-center gap-3">
              <div className="w-16 h-5 bg-slate-700 rounded" />
              <div className="flex-1 h-4 bg-slate-700 rounded" />
              <div className="w-12 h-4 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={32} />}
          title="No tasks yet"
          description={search || filterStatus || filterCategory
            ? 'No tasks match your filters. Try changing the search or filters.'
            : 'Add your first task to start tracking your microtask work.'}
          action={!search && !filterStatus && !filterCategory ? (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} /> Add Task
            </button>
          ) : undefined}
        />
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isExpanded = expandedId === task.id
            const action = STATUS_ACTIONS[task.status]
            const site = task.website_id ? websiteMap[task.website_id] : undefined

            return (
              <div
                key={task.id}
                className="card hover:border-slate-700 transition-colors cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : task.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <StatusBadge status={task.status} />
                      <CategoryBadge category={task.category} />
                      {site && (
                        <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                          {site.name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-100 truncate">{task.title}</p>
                    {task.description && !isExpanded && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{task.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {task.reward > 0 && (
                      <span className="text-xs text-green-400 font-medium flex items-center gap-0.5">
                        <DollarSign size={11} />{task.reward.toFixed(2)}
                      </span>
                    )}
                    <ChevronDown
                      size={14}
                      className={clsx('text-slate-500 transition-transform', isExpanded && 'rotate-180')}
                    />
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div
                    className="mt-3 pt-3 border-t border-slate-800 space-y-3"
                    onClick={e => e.stopPropagation()}
                  >
                    {task.description && (
                      <p className="text-sm text-slate-400">{task.description}</p>
                    )}
                    {task.notes && (
                      <p className="text-xs text-slate-500 bg-slate-800/60 rounded-lg px-3 py-2">{task.notes}</p>
                    )}
                    {task.url && (
                      <a
                        href={task.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={11} /> Open task URL
                      </a>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        className={clsx('btn-secondary text-xs py-1 px-2.5 flex items-center gap-1', action.color)}
                        onClick={() => quickStatus(task)}
                        disabled={update.isPending}
                      >
                        {action.icon} {action.label}
                      </button>
                      {task.status !== 'skipped' && (
                        <button
                          className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 text-slate-400"
                          onClick={() => update.mutate({ id: task.id, data: { status: 'skipped' } })}
                          disabled={update.isPending}
                        >
                          <SkipForward size={14} /> Skip
                        </button>
                      )}
                      <button
                        className="btn-secondary text-xs py-1 px-2.5"
                        onClick={() => setEditTask(task)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-secondary text-xs py-1 px-2.5 text-red-400 hover:text-red-300 ml-auto"
                        onClick={() => setDeleteId(task.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Task" size="lg">
        <TaskForm
          initial={defaultForm}
          websites={websites}
          onSave={d => create.mutate(d)}
          onCancel={() => setShowModal(false)}
          loading={create.isPending}
        />
      </Modal>

      {/* Edit modal */}
      {editTask && (
        <Modal open={!!editTask} onClose={() => setEditTask(null)} title="Edit Task" size="lg">
          <TaskForm
            initial={{
              title: editTask.title,
              description: editTask.description ?? '',
              url: editTask.url ?? '',
              category: editTask.category,
              status: editTask.status,
              reward: editTask.reward,
              currency: editTask.currency,
              website_id: editTask.website_id ?? '',
              notes: editTask.notes ?? '',
            }}
            websites={websites}
            onSave={d => update.mutate({ id: editTask.id, data: {
              title: d.title,
              description: d.description || undefined,
              url: d.url || undefined,
              category: d.category,
              status: d.status,
              reward: d.reward,
              currency: d.currency,
              website_id: d.website_id ? Number(d.website_id) : undefined,
              notes: d.notes || undefined,
            }})}
            onCancel={() => setEditTask(null)}
            loading={update.isPending}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId !== null && deleteMut.mutate(deleteId)}
        title="Delete Task"
        message="Are you sure you want to delete this task? This action cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleteMut.isPending}
      />
    </div>
  )
}
