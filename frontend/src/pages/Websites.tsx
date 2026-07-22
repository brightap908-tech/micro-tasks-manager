import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Globe, ExternalLink, Trash2, Power,
  Folder, FolderPlus, KeyRound, Eye, EyeOff, Copy,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import api from '../api/client'
import type { Website, WebsiteFolder, Credential } from '../api/client'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'

const defaultSite = {
  name: '', login_url: '', dashboard_url: '', description: '',
  plugin_id: 'generic', is_enabled: true, folder_id: '' as string | number,
}

const defaultCred = { username: '', password: '', notes: '' }

function SiteForm({
  initial, folders, onSave, onCancel, loading,
}: {
  initial: typeof defaultSite
  folders: WebsiteFolder[]
  onSave: (d: typeof defaultSite) => void
  onCancel: () => void
  loading: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }))
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-4">
      <div>
        <label className="label">Website Name *</label>
        <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. PicoWorkers" />
      </div>
      <div>
        <label className="label">Login URL *</label>
        <input className="input" required value={form.login_url} onChange={e => set('login_url', e.target.value)} placeholder="https://example.com/login" />
      </div>
      <div>
        <label className="label">Dashboard URL</label>
        <input className="input" value={form.dashboard_url} onChange={e => set('dashboard_url', e.target.value)} placeholder="https://example.com/dashboard" />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional notes about this website" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Folder</label>
          <select className="select" value={form.folder_id} onChange={e => set('folder_id', e.target.value ? parseInt(e.target.value) : '')}>
            <option value="">No folder</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Plugin</label>
          <input className="input" value={form.plugin_id} onChange={e => set('plugin_id', e.target.value)} placeholder="generic" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="enabled" checked={form.is_enabled} onChange={e => set('is_enabled', e.target.checked)} className="rounded" />
        <label htmlFor="enabled" className="text-sm text-slate-300 cursor-pointer">Enabled</label>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Website'}</button>
      </div>
    </form>
  )
}

function CredentialPanel({ websiteId, websiteName }: { websiteId: number; websiteName: string }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(defaultCred)
  const [revealed, setRevealed] = useState<Record<number, string>>({})
  const [loadingReveal, setLoadingReveal] = useState<number | null>(null)

  const { data: creds = [] } = useQuery<Credential[]>({
    queryKey: ['credentials', websiteId],
    queryFn: () => api.get(`/credentials?website_id=${websiteId}`).then(r => r.data),
  })

  const create = useMutation({
    mutationFn: (d: typeof defaultCred) => api.post('/credentials', { ...d, website_id: websiteId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials', websiteId] })
      setForm(defaultCred)
      setShowAdd(false)
      toast.success('Credential saved')
    },
  })

  const deleteCred = useMutation({
    mutationFn: (id: number) => api.delete(`/credentials/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials', websiteId] }),
  })

  const revealPassword = async (credId: number) => {
    if (revealed[credId]) { setRevealed(p => { const n = { ...p }; delete n[credId]; return n }); return }
    setLoadingReveal(credId)
    try {
      const { data } = await api.get(`/credentials/${credId}/reveal`)
      setRevealed(p => ({ ...p, [credId]: data.password }))
    } catch { toast.error('Failed to reveal password') }
    finally { setLoadingReveal(null) }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <KeyRound size={14} /> Saved Credentials
        </h3>
        <button className="btn-secondary py-1 px-2 text-xs flex items-center gap-1" onClick={() => setShowAdd(p => !p)}>
          <Plus size={12} /> Add
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={e => { e.preventDefault(); create.mutate(form) }}
          className="bg-slate-800/60 rounded-lg p-3 space-y-2 border border-slate-700"
        >
          <input className="input text-xs py-1.5" required placeholder="Username / Email" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
          <input className="input text-xs py-1.5" type="password" required placeholder="Password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
          <input className="input text-xs py-1.5" placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs py-1 px-2" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn-primary text-xs py-1 px-2" disabled={create.isPending}>Save</button>
          </div>
        </form>
      )}

      {creds.length === 0 && !showAdd && (
        <p className="text-xs text-slate-600 py-2 text-center">No credentials saved yet</p>
      )}

      {creds.map(c => (
        <div key={c.id} className="bg-slate-800/40 rounded-lg p-3 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300 font-medium">{c.username}</span>
              <button className="p-0.5 text-slate-600 hover:text-slate-400" onClick={() => copyToClipboard(c.username, 'Username')}>
                <Copy size={11} />
              </button>
            </div>
            <button className="p-1 text-slate-600 hover:text-red-400 transition-colors" onClick={() => deleteCred.mutate(c.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">
              {revealed[c.id] ? revealed[c.id] : '••••••••'}
            </span>
            {revealed[c.id] && (
              <button className="p-0.5 text-slate-600 hover:text-slate-400" onClick={() => copyToClipboard(revealed[c.id], 'Password')}>
                <Copy size={11} />
              </button>
            )}
            <button
              className="ml-auto p-0.5 text-slate-600 hover:text-slate-400"
              onClick={() => revealPassword(c.id)}
              disabled={loadingReveal === c.id}
            >
              {revealed[c.id] ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          {c.notes && <p className="text-xs text-slate-600">{c.notes}</p>}
          {c.last_used && (
            <p className="text-xs text-slate-700">
              Last used: {new Date(c.last_used).toLocaleDateString()}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function WebsiteCard({
  website, onEdit, onDelete, onToggle,
}: {
  website: Website
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const [showCreds, setShowCreds] = useState(false)

  const openUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={clsx('card space-y-3 transition-opacity', !website.is_enabled && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
            <Globe size={16} className="text-slate-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{website.name}</p>
            <p className="text-xs text-slate-500 truncate">{website.login_url}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className={clsx('p-1.5 rounded-lg transition-colors text-xs', website.is_enabled
              ? 'text-green-400 hover:bg-green-500/10'
              : 'text-slate-600 hover:bg-slate-700'
            )}
            title={website.is_enabled ? 'Disable' : 'Enable'}
            onClick={onToggle}
          >
            <Power size={14} />
          </button>
          <button className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors" onClick={onEdit}>✏️</button>
          <button className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {website.description && (
        <p className="text-xs text-slate-500">{website.description}</p>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span>{website.task_count ?? 0} tasks</span>
        <span>{website.completed_tasks ?? 0} completed</span>
        {(website.total_earnings ?? 0) > 0 && (
          <span className="text-green-400">${(website.total_earnings ?? 0).toFixed(2)} earned</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <button
          className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          onClick={() => openUrl(website.login_url)}
        >
          <ExternalLink size={12} /> Login
        </button>
        {website.dashboard_url && (
          <button
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            onClick={() => openUrl(website.dashboard_url!)}
          >
            <ExternalLink size={12} /> Dashboard
          </button>
        )}
        <button
          className={clsx(
            'text-xs py-1.5 px-3 flex items-center gap-1.5 rounded-lg border transition-colors',
            showCreds
              ? 'bg-brand-600/20 text-brand-400 border-brand-700/50'
              : 'btn-secondary',
          )}
          onClick={() => setShowCreds(p => !p)}
        >
          <KeyRound size={12} /> Credentials
        </button>
      </div>

      {showCreds && (
        <div className="border-t border-slate-800 pt-3">
          <CredentialPanel websiteId={website.id} websiteName={website.name} />
        </div>
      )}
    </div>
  )
}

export default function WebsitesPage() {
  const qc = useQueryClient()
  const [showSite, setShowSite] = useState(false)
  const [editSite, setEditSite] = useState<Website | null>(null)
  const [deleteSiteId, setDeleteSiteId] = useState<number | null>(null)
  const [showFolder, setShowFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [activeFolder, setActiveFolder] = useState<number | 'all'>('all')

  const { data: websites = [] } = useQuery<Website[]>({
    queryKey: ['websites'],
    queryFn: () => api.get('/websites').then(r => r.data),
  })

  const { data: folders = [] } = useQuery<WebsiteFolder[]>({
    queryKey: ['folders'],
    queryFn: () => api.get('/websites/folders').then(r => r.data),
  })

  const createSite = useMutation({
    mutationFn: (d: typeof defaultSite) => api.post('/websites', {
      ...d, folder_id: d.folder_id || null, dashboard_url: d.dashboard_url || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setShowSite(false); toast.success('Website added') },
  })

  const updateSite = useMutation({
    mutationFn: ({ id, d }: { id: number; d: typeof defaultSite }) => api.put(`/websites/${id}`, {
      ...d, folder_id: d.folder_id || null, dashboard_url: d.dashboard_url || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setEditSite(null); toast.success('Website updated') },
  })

  const deleteSite = useMutation({
    mutationFn: (id: number) => api.delete(`/websites/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setDeleteSiteId(null); toast.success('Website deleted') },
  })

  const toggleSite = useMutation({
    mutationFn: (id: number) => api.post(`/websites/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['websites'] }),
  })

  const createFolder = useMutation({
    mutationFn: (name: string) => api.post('/websites/folders', { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); setShowFolder(false); setFolderName(''); toast.success('Folder created') },
  })

  const deleteFolder = useMutation({
    mutationFn: (id: number) => api.delete(`/websites/folders/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); qc.invalidateQueries({ queryKey: ['websites'] }) },
  })

  const filtered = activeFolder === 'all'
    ? websites
    : websites.filter(w => w.folder_id === activeFolder)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Websites</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {websites.length} sites · {websites.filter(w => w.is_enabled).length} active
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-2" onClick={() => setShowFolder(true)}>
            <FolderPlus size={15} /> New Folder
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowSite(true)}>
            <Plus size={15} /> Add Website
          </button>
        </div>
      </div>

      {/* Folder tabs */}
      {folders.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            className={clsx('badge px-3 py-1.5 text-sm cursor-pointer transition-colors', activeFolder === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200')}
            onClick={() => setActiveFolder('all')}
          >
            All ({websites.length})
          </button>
          {folders.map(f => (
            <div key={f.id} className="flex items-center gap-1">
              <button
                className={clsx('badge px-3 py-1.5 text-sm cursor-pointer transition-colors', activeFolder === f.id ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200')}
                onClick={() => setActiveFolder(f.id)}
                style={activeFolder === f.id ? {} : { borderLeft: `3px solid ${f.color}` }}
              >
                <Folder size={12} className="mr-1" />
                {f.name} ({websites.filter(w => w.folder_id === f.id).length})
              </button>
              <button className="text-slate-600 hover:text-red-400 transition-colors p-0.5" onClick={() => deleteFolder.mutate(f.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Globe size={24} />}
          title="No websites added"
          description="Add microtask websites to manage them from one place."
          action={
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowSite(true)}>
              <Plus size={15} /> Add Website
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(w => (
            <WebsiteCard
              key={w.id}
              website={w}
              onEdit={() => setEditSite(w)}
              onDelete={() => setDeleteSiteId(w.id)}
              onToggle={() => toggleSite.mutate(w.id)}
            />
          ))}
        </div>
      )}

      {/* Add site modal */}
      <Modal open={showSite} onClose={() => setShowSite(false)} title="Add Website" size="md">
        <SiteForm
          initial={defaultSite}
          folders={folders}
          onSave={d => createSite.mutate(d)}
          onCancel={() => setShowSite(false)}
          loading={createSite.isPending}
        />
      </Modal>

      {/* Edit site modal */}
      {editSite && (
        <Modal open={!!editSite} onClose={() => setEditSite(null)} title="Edit Website" size="md">
          <SiteForm
            initial={{
              name: editSite.name,
              login_url: editSite.login_url,
              dashboard_url: editSite.dashboard_url ?? '',
              description: editSite.description ?? '',
              plugin_id: editSite.plugin_id,
              is_enabled: editSite.is_enabled,
              folder_id: editSite.folder_id ?? '',
            }}
            folders={folders}
            onSave={d => updateSite.mutate({ id: editSite.id, d })}
            onCancel={() => setEditSite(null)}
            loading={updateSite.isPending}
          />
        </Modal>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteSiteId !== null}
        onClose={() => setDeleteSiteId(null)}
        onConfirm={() => deleteSiteId !== null && deleteSite.mutate(deleteSiteId)}
        title="Delete Website"
        message="Delete this website? Associated credentials will also be deleted. Tasks will remain."
        confirmLabel="Delete"
        danger
        loading={deleteSite.isPending}
      />

      {/* New folder modal */}
      <Modal open={showFolder} onClose={() => setShowFolder(false)} title="New Folder" size="sm">
        <form onSubmit={e => { e.preventDefault(); createFolder.mutate(folderName) }} className="space-y-4">
          <div>
            <label className="label">Folder Name</label>
            <input className="input" required value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="e.g. Social Media" />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setShowFolder(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createFolder.isPending}>Create</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
