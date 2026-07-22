import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, ExternalLink, Trash2,
  CheckCircle2, Clock, SkipForward, PlayCircle,
  ChevronDown, DollarSign,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import api from '../api/client'
import type { Task, Website, TaskStatus, TaskCategory } from '../api/client'
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
      {/* Stack on mobile, 2 cols on sm+ */}
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
        <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Your notes" />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Task'}</button>
      </div>
    </form>
  )
}

function StatusButton({ task, onUpdate }: { task: Task; onUpdate: (status: TaskStatus) => void }) {
  const [open, setOpen] = useState(false)
  const options: { status: TaskStatus; label: string; icon: typeof CheckCircle2 }[] = [
    { status: 'pending',     label: 'Pending',     icon: Clock },
    { status: 'in_progress', label: 'In Progress', icon: PlayCircle },
    { status: 'completed',   label: 'Completed',   icon: CheckCircle2 },
    { status: 'skipped',     label: 'Skipped',     icon: SkipForward },
  ]
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 text-xs touch-manipulation"
        onClick={() => setOpen(p => !p)}
      >
        <StatusBadge status={task.status} />
        <ChevronDown size={12} className="text-slate-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-7 z-20 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[140px]">
            {options.map(({ status, label, icon: Icon }) => (
              <button
                key={status}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-slate-700 transition-colors touch-manipulation',
                  task.status === status ? 'text-brand-400' : 'text-slate-300',
                )}
                onClick={() => { onUpdate(status); setOpen(false) }}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Mobile card view for a single task */
function TaskCard({
  task, onEdit, onDelete, onUpdateStatus,
}: {
  task: Task
  onEdit: () => void
  onDelete: () => void
  onUpdateStatus: (s: TaskStatus) => void
}) {
  return (
    <div className="card space-y-3">
      {/* Title + actions */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100 leading-snug flex-1">{task.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors touch-manipulation"
            >
              <ExternalLink size={14} />
            </a>
          )}
          <button
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors touch-manipulation"
            onClick={onEdit}
          >
            ✏️
          </button>
          <button
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {task.description && (
        <p className="text-xs text-slate-500">{task.description}</p>
      )}

      {/* Badges + meta */}
      <div className="flex items-center flex-wrap gap-2">
        <CategoryBadge category={task.category} />
        <StatusButton task={task} onUpdate={onUpdateStatus} />
        {task.website?.name && (
          <span className="text-xs text-slate-500">{task.website.name}</span>
        )}
      </div>

      {/* Reward + time */}
      <div className="flex items-center gap-4 text-xs">
        {task.reward > 0 ? (
          <span className="text-green-400 font-semibold flex items-center gap-1">
            <DollarSign size={11} />{task.reward.toFixed(2)}
          </span>
        ) : null}
        {task.time_spent_seconds > 0 && (
          <span className="text-slate-500">{Math.round(task.time_spent_seconds / 60)}m</span>
        )}
      </div>
    </div>
  )
}

export default function TasksPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterWebsite, setFilterWebsite] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (filterStatus) params.set('status', filterStatus)
  if (filterCategory) params.set('category', filterCategory)
  if (filterWebsite) params.set('website_id', filterWebsite)
  params.set('sort_by', sortBy)
  params.set('sort_order', sortOrder)
  params.set('limit', '200')

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', params.toString()],
    queryFn: () => api.get(`/tasks?${params}`).then(r => r.data),
  })

  const { data: websites = [] } = useQuery<Website[]>({
    queryKey: ['websites'],
    queryFn: () => api.get('/websites').then(r => r.data),
  })

  const create = useMutation({
    mutationFn: (data: typeof defaultForm) => api.post('/tasks', {
      ...data, website_id: data.website_id || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setShowModal(false); toast.success('Task created') },
    onError: () => toast.error('Failed to create task'),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof defaultForm> }) =>
      api.put(`/tasks/${id}`, { ...data, website_id: data.website_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setEditTask(null); toast.success('Task updated') },
    onError: () => toast.error('Failed to update task'),
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) =>
      api.patch(`/tasks/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setDeleteId(null); toast.success('Task deleted') },
  })

  const totalEarnings = tasks
    .filter(t => t.status === 'completed')
    .reduce((s, t) => s + t.reward, 0)

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Tasks</h1>
          <p className="text-sm text-slate-500">
            {tasks.length} tasks · ${totalEarnings.toFixed(2)} earned
          </p>
        </div>
        <button className="btn-primary ml-auto sm:ml-0" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* Filters */}
      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {/* Search — full width on its own row */}
          <div className="w-full relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input pl-8"
              placeholder="Search tasks…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Selects — 2 per row on mobile */}
          <select className="select flex-1 min-w-[calc(50%-4px)]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select className="select flex-1 min-w-[calc(50%-4px)]" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <select className="select flex-1 min-w-[calc(50%-4px)]" value={filterWebsite} onChange={e => setFilterWebsite(e.target.value)}>
            <option value="">All websites</option>
            {websites.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="flex gap-2 flex-1 min-w-[calc(50%-4px)]">
            <select className="select flex-1" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="created_at">Date</option>
              <option value="reward">Reward</option>
              <option value="title">Title</option>
              <option value="status">Status</option>
            </select>
            <button
              className="btn-secondary px-3 shrink-0"
              onClick={() => setSortOrder(p => p === 'desc' ? 'asc' : 'desc')}
              title="Toggle sort order"
            >
              {sortOrder === 'desc' ? '↓' : '↑'}
            </button>
          </div>
        </div>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={24} />}
          title="No tasks found"
          description="Add your first task or adjust the filters."
          action={
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} /> Add Task
            </button>
          }
        />
      ) : (
        <>
          {/* Mobile card list (< md) */}
          <div className="md:hidden space-y-3">
            {tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={() => setEditTask(task)}
                onDelete={() => setDeleteId(task.id)}
                onUpdateStatus={status => updateStatus.mutate({ id: task.id, status })}
              />
            ))}
          </div>

          {/* Desktop table (md+) */}
          <div className="hidden md:block card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 bg-slate-800/60 border-b border-slate-800">
                    <th className="text-left px-4 py-3">Task</th>
                    <th className="text-left px-4 py-3">Category</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Website</th>
                    <th className="text-right px-4 py-3">Reward</th>
                    <th className="text-right px-4 py-3">Time</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {tasks.map(task => (
                    <tr key={task.id} className="hover:bg-slate-800/30 transition-colors group">
                      <td className="px-4 py-3">
                        <p className="text-slate-200 font-medium truncate max-w-xs">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-slate-500 truncate max-w-xs mt-0.5">{task.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CategoryBadge category={task.category} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusButton
                          task={task}
                          onUpdate={status => updateStatus.mutate({ id: task.id, status })}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {task.website?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {task.reward > 0 ? (
                          <span className="text-green-400 font-semibold">${task.reward.toFixed(2)}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs">
                        {task.time_spent_seconds > 0
                          ? `${Math.round(task.time_spent_seconds / 60)}m`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {task.url && (
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                              title="Open task URL"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <button
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                            title="Edit"
                            onClick={() => setEditTask(task)}
                          >
                            ✏️
                          </button>
                          <button
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                            onClick={() => setDeleteId(task.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
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
            onSave={d => update.mutate({ id: editTask.id, data: d })}
            onCancel={() => setEditTask(null)}
            loading={update.isPending}
          />
        </Modal>
      )}

      {/* Delete confirm */}
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
