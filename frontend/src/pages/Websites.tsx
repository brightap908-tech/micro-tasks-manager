import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Globe, Trash2, ExternalLink, ChevronDown,
  KeyRound, Eye, EyeOff, Copy, Folder, RefreshCw,
  LogIn, CheckCircle2, LogOut, AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import {
  getWebsites, createWebsite, updateWebsite, deleteWebsite,
  getFolders, createFolder,
} from '../db/websites'
import {
  getCredentials, createCredential, deleteCredential, revealCredentialPassword,
} from '../db/credentials'
import { getLatestSnapshot, saveSnapshot } from '../db/snapshots'
import { syncWebsite as syncWebsiteProxy } from '../api/client'
import { getAuthStatus, logout as apiLogout } from '../api/auth'
import { logActivity } from '../db/activity'
import type { Website, WebsiteFolder, StoredCredential } from '../db/index'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import LoginBrowserModal from '../components/LoginBrowserModal'

const defaultWebsiteForm = {
  name: '', login_url: '', dashboard_url: '', description: '',
  plugin_id: 'generic', is_enabled: true, folder_id: '' as string | number,
  favicon_url: '',
}
const defaultCred = { username: '', password: '', notes: '' }

// ── Website form ──────────────────────────────────────────────────────────────
function WebsiteForm({
  initial, folders, onSave, onCancel, loading,
}: {
  initial: typeof defaultWebsiteForm
  folders: WebsiteFolder[]
  onSave: (d: typeof defaultWebsiteForm) => void
  onCancel: () => void
  loading: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-4">
      <div>
        <label className="label">Name *</label>
        <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. eTrendGigs" />
      </div>
      <div>
        <label className="label">Login URL *</label>
        <input className="input" required type="url" value={form.login_url} onChange={e => set('login_url', e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className="label">Dashboard URL</label>
        <input className="input" type="url" value={form.dashboard_url} onChange={e => set('dashboard_url', e.target.value)} placeholder="https://... (used for sync)" />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="label">Folder</label>
        <select className="select" value={form.folder_id} onChange={e => set('folder_id', e.target.value ? parseInt(e.target.value) : '')}>
          <option value="">No folder</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="enabled" checked={form.is_enabled} onChange={e => set('is_enabled', e.target.checked)} className="rounded" />
        <label htmlFor="enabled" className="text-sm text-slate-300 cursor-pointer">Enabled (include in sync)</label>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save Website'}</button>
      </div>
    </form>
  )
}

// ── Auth status panel ──────────────────────────────────────────────────────────
function AuthPanel({
  site, onLoginStart,
}: {
  site: Website
  onLoginStart: () => void
}) {
  const qc = useQueryClient()

  const { data: authStatus, isLoading } = useQuery({
    queryKey: ['auth-status', site.id],
    queryFn: () => getAuthStatus(site.id),
    staleTime: 30_000,
  })

  const logoutMut = useMutation({
    mutationFn: () => apiLogout(site.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-status', site.id] })
      qc.invalidateQueries({ queryKey: ['snapshots', site.id] })
      toast.success(`Logged out of ${site.name}`)
    },
  })

  if (isLoading) return (
    <div className="h-10 bg-slate-800/40 rounded-lg animate-pulse" />
  )

  const authenticated = authStatus?.authenticated ?? false
  const savedAt = authStatus?.saved_at

  return (
    <div className={clsx(
      'rounded-lg px-3 py-2.5 border flex items-center gap-3',
      authenticated
        ? 'bg-green-500/10 border-green-500/20'
        : 'bg-yellow-500/10 border-yellow-500/20',
    )}>
      {authenticated ? (
        <CheckCircle2 size={16} className="text-green-400 shrink-0" />
      ) : (
        <AlertCircle size={16} className="text-yellow-400 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className={clsx(
          'text-xs font-medium',
          authenticated ? 'text-green-300' : 'text-yellow-300',
        )}>
          {authenticated ? 'Authenticated — sync is active' : 'Not logged in — sync disabled'}
        </p>
        {authenticated && savedAt && (
          <p className="text-xs text-slate-500 mt-0.5">
            Session saved {new Date(savedAt).toLocaleDateString()}
          </p>
        )}
        {!authenticated && (
          <p className="text-xs text-slate-500 mt-0.5">
            Log in to start syncing your account data
          </p>
        )}
      </div>

      {authenticated ? (
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={onLoginStart}
            className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
            title="Re-authenticate"
          >
            <RefreshCw size={11} />
          </button>
          <button
            onClick={() => logoutMut.mutate()}
            disabled={logoutMut.isPending}
            className="px-2.5 py-1 text-xs bg-slate-800 text-red-400 rounded-lg hover:bg-slate-700 flex items-center gap-1"
          >
            <LogOut size={11} /> Log out
          </button>
        </div>
      ) : (
        <button
          onClick={onLoginStart}
          className="btn-primary text-xs py-1.5 px-3 gap-1.5 shrink-0"
        >
          <LogIn size={13} /> Log In
        </button>
      )}
    </div>
  )
}

// ── Credential panel ──────────────────────────────────────────────────────────
function CredentialPanel({ websiteId, websiteName }: { websiteId: number; websiteName: string }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(defaultCred)
  const [revealed, setRevealed] = useState<Record<number, string>>({})
  const [loadingReveal, setLoadingReveal] = useState<number | null>(null)

  const { data: creds = [] } = useQuery<StoredCredential[]>({
    queryKey: ['credentials', websiteId],
    queryFn: () => getCredentials(websiteId),
  })

  const create = useMutation({
    mutationFn: (d: typeof defaultCred) => createCredential({ website_id: websiteId, ...d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials', websiteId] })
      setForm(defaultCred); setShowAdd(false)
      toast.success('Credential saved')
    },
  })

  const deleteCred = useMutation({
    mutationFn: (id: number) => deleteCredential(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials', websiteId] }),
  })

  const revealPassword = async (credId: number) => {
    if (revealed[credId] !== undefined) {
      setRevealed(p => { const n = { ...p }; delete n[credId]; return n }); return
    }
    setLoadingReveal(credId)
    try {
      const pw = await revealCredentialPassword(credId)
      setRevealed(p => ({ ...p, [credId]: pw }))
    } catch (e) {
      toast.error(`Failed to reveal: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setLoadingReveal(null) }
  }

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} copied`) }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <KeyRound size={14} /> Saved Credentials
        </h3>
        <button className="btn-secondary py-1 px-2 text-xs" onClick={() => setShowAdd(p => !p)}>
          <Plus size={12} /> Add
        </button>
      </div>

      {showAdd && (
        <form onSubmit={e => { e.preventDefault(); create.mutate(form) }}
          className="bg-slate-800/60 rounded-lg p-3 space-y-2 border border-slate-700">
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
        <div key={c.id} className="bg-slate-800/40 rounded-lg px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 font-medium flex-1 truncate">{c.username}</span>
            <button onClick={() => copy(c.username, 'Username')} className="p-1 text-slate-500 hover:text-slate-300"><Copy size={11} /></button>
            <button onClick={() => revealPassword(c.id)} className="p-1 text-slate-500 hover:text-slate-300" disabled={loadingReveal === c.id}>
              {revealed[c.id] !== undefined ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <button onClick={() => deleteCred.mutate(c.id)} className="p-1 text-slate-500 hover:text-red-400"><Trash2 size={11} /></button>
          </div>
          {revealed[c.id] !== undefined && (
            <div className="flex items-center gap-2">
              <code className="text-xs text-yellow-300 bg-slate-900 px-2 py-1 rounded flex-1 truncate">{revealed[c.id]}</code>
              <button onClick={() => copy(revealed[c.id], 'Password')} className="p-1 text-slate-500 hover:text-slate-300"><Copy size={11} /></button>
            </div>
          )}
          {c.notes && <p className="text-xs text-slate-600">{c.notes}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WebsitesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal]         = useState(false)
  const [editSite, setEditSite]           = useState<Website | null>(null)
  const [deleteId, setDeleteId]           = useState<number | null>(null)
  const [expandedId, setExpandedId]       = useState<number | null>(null)
  const [syncingId, setSyncingId]         = useState<number | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderName, setFolderName]       = useState('')
  const [loginSite, setLoginSite]         = useState<Website | null>(null)

  const { data: websites = [] } = useQuery({ queryKey: ['websites'], queryFn: getWebsites })
  const { data: folders  = [] } = useQuery({ queryKey: ['folders'],  queryFn: getFolders  })
  const folderMap = Object.fromEntries(folders.map(f => [f.id, f]))

  // ── Mutations ──────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: (d: typeof defaultWebsiteForm) => createWebsite({
      name: d.name, login_url: d.login_url,
      dashboard_url: d.dashboard_url || undefined,
      description: d.description || undefined,
      plugin_id: d.plugin_id, is_enabled: d.is_enabled,
      folder_id: d.folder_id ? Number(d.folder_id) : undefined,
      favicon_url: d.favicon_url || undefined,
    }),
    onSuccess: site => {
      qc.invalidateQueries({ queryKey: ['websites'] })
      setShowModal(false); toast.success('Website added')
      logActivity(`Website added: ${site.name}`, site.login_url, 'website', site.id)
    },
    onError: e => toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof defaultWebsiteForm }) =>
      updateWebsite(id, {
        name: data.name, login_url: data.login_url,
        dashboard_url: data.dashboard_url || undefined,
        description: data.description || undefined,
        plugin_id: data.plugin_id, is_enabled: data.is_enabled,
        folder_id: data.folder_id ? Number(data.folder_id) : undefined,
        favicon_url: data.favicon_url || undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setEditSite(null); toast.success('Website updated') },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWebsite(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['websites'] }); setDeleteId(null); toast.success('Website deleted') },
  })

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateWebsite(id, { is_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['websites'] }),
  })

  const createFolderMut = useMutation({
    mutationFn: () => createFolder({ name: folderName, color: '#6366f1' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      setShowFolderModal(false); setFolderName(''); toast.success('Folder created')
    },
  })

  // ── Sync ───────────────────────────────────────────────────────────────────
  const syncOne = async (site: Website) => {
    const url = site.dashboard_url || site.login_url
    setSyncingId(site.id)
    try {
      // website_id tells the backend to use its stored server-side session cookies
      const result = await syncWebsiteProxy(url, site.name, site.id)

      await saveSnapshot({
        website_id: site.id,
        status: result.status,
        available_balance: result.available_balance ?? undefined,
        pending_balance: result.pending_balance ?? undefined,
        available_tasks: result.available_tasks ?? undefined,
        pending_tasks: result.pending_tasks ?? undefined,
        completed_tasks: result.completed_tasks ?? undefined,
        in_progress_tasks: result.in_progress_tasks ?? undefined,
        skipped_tasks: result.skipped_tasks ?? undefined,
        total_earnings: result.total_earnings ?? undefined,
        page_title: result.page_title ?? undefined,
        error_message: result.error_message ?? undefined,
      })
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      qc.invalidateQueries({ queryKey: ['snapshots', site.id] })

      if (result.status === 'ok') {
        const parts: string[] = []
        if (result.available_balance !== null) parts.push(`$${result.available_balance!.toFixed(2)}`)
        if (result.pending_balance !== null) parts.push(`$${result.pending_balance!.toFixed(2)} pending balance`)
        if (result.pending_tasks !== null) parts.push(`${result.pending_tasks} pending`)
        if (result.completed_tasks !== null) parts.push(`${result.completed_tasks} done`)
        if (result.in_progress_tasks !== null) parts.push(`${result.in_progress_tasks} in progress`)
        if (result.skipped_tasks !== null) parts.push(`${result.skipped_tasks} skipped`)
        toast.success(`${site.name}: ${parts.length ? parts.join(' · ') : 'synced'}`)
      } else if (result.status === 'auth_required') {
        toast(`${site.name}: ${result.error_message ?? 'Login required'}`, { icon: '🔐', duration: 5000 })
        // Invalidate auth status so panel updates
        qc.invalidateQueries({ queryKey: ['auth-status', site.id] })
      } else {
        toast.error(`${site.name}: ${result.error_message ?? 'sync failed'}`, { duration: 6000 })
        if (result.error_detail) console.error(`[Sync] ${site.name}:\n${result.error_detail}`)
      }
    } catch (e) {
      toast.error(`${site.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncingId(null)
    }
  }

  // ── Sync status badge ──────────────────────────────────────────────────────
  const SyncStatus = ({ siteId }: { siteId: number }) => {
    const { data: snap } = useQuery({
      queryKey: ['snapshots', siteId],
      queryFn: () => getLatestSnapshot(siteId),
    })
    if (!snap) return <span className="text-xs text-slate-600">Never synced</span>
    if (snap.status === 'ok') {
      const parts: string[] = []
      if (snap.available_balance !== undefined) parts.push(`$${snap.available_balance.toFixed(2)}`)
      if (snap.pending_balance !== undefined) parts.push(`$${snap.pending_balance.toFixed(2)} pending balance`)
      if (snap.pending_tasks !== undefined) parts.push(`${snap.pending_tasks} pending`)
      if (snap.completed_tasks !== undefined) parts.push(`${snap.completed_tasks} done`)
      if (snap.in_progress_tasks !== undefined) parts.push(`${snap.in_progress_tasks} in progress`)
      if (snap.skipped_tasks !== undefined) parts.push(`${snap.skipped_tasks} skipped`)
      if (snap.total_earnings !== undefined) parts.push(`$${snap.total_earnings.toFixed(2)} earned`)
      return <span className="text-xs text-green-400">{parts.length ? parts.join(' · ') : '✓ synced'}</span>
    }
    if (snap.status === 'auth_required') return (
      <span className="text-xs text-yellow-400 flex items-center gap-1">
        🔐 {(snap.error_message ?? 'Login required').slice(0, 45)}
      </span>
    )
    return <span className="text-xs text-red-400" title={snap.error_message ?? ''}>{(snap.error_message ?? 'Error').slice(0, 40)}</span>
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="hidden sm:block text-2xl font-bold text-slate-100">Websites</h1>
          <p className="text-sm text-slate-500">
            {websites.length} site{websites.length !== 1 ? 's' : ''}
            {' · '}{websites.filter(w => w.is_enabled).length} enabled
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button className="btn-secondary" onClick={() => setShowFolderModal(true)}>
            <Folder size={15} /> Folder
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} /> Add Site
          </button>
        </div>
      </div>

      {websites.length === 0 ? (
        <EmptyState
          icon={<Globe size={32} />}
          title="No websites added"
          description="Add the microtask websites you work on to start tracking tasks and syncing data."
          action={<button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> Add Website</button>}
        />
      ) : (
        <div className="space-y-2">
          {websites.map(site => {
            const isExpanded = expandedId === site.id
            const folder = site.folder_id ? folderMap[site.folder_id] : undefined

            return (
              <div key={site.id} className="card hover:border-slate-700 transition-colors">
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : site.id)}>
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    {site.favicon_url ? (
                      <img src={site.favicon_url} alt="" className="w-5 h-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <Globe size={16} className="text-slate-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-100">{site.name}</span>
                      {folder && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400" style={{ borderLeft: `3px solid ${folder.color}` }}>
                          {folder.name}
                        </span>
                      )}
                      <span className={clsx('text-xs px-1.5 py-0.5 rounded', site.is_enabled ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-500')}>
                        {site.is_enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                    <SyncStatus siteId={site.id} />
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                      onClick={() => syncOne(site)} disabled={syncingId === site.id} title="Sync now">
                      <RefreshCw size={14} className={syncingId === site.id ? 'animate-spin' : ''} />
                    </button>
                    <a href={site.login_url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors" title="Open site">
                      <ExternalLink size={14} />
                    </a>
                    <ChevronDown size={14} className={clsx('text-slate-500 transition-transform ml-1', isExpanded && 'rotate-180')} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
                    {site.description && <p className="text-sm text-slate-400">{site.description}</p>}

                    <div className="flex flex-wrap gap-2 text-xs">
                      <a href={site.login_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                        <ExternalLink size={11} /> Login page
                      </a>
                      {site.dashboard_url && (
                        <a href={site.dashboard_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                          <ExternalLink size={11} /> Dashboard
                        </a>
                      )}
                    </div>

                    {/* Authentication — replaces the old manual cookie panel */}
                    <AuthPanel site={site} onLoginStart={() => setLoginSite(site)} />

                    {/* Saved credentials (username/password reference) */}
                    <CredentialPanel websiteId={site.id} websiteName={site.name} />

                    <div className="flex gap-2 pt-1">
                      <button className="btn-secondary text-xs py-1 px-2" onClick={() => toggleEnabled.mutate({ id: site.id, enabled: !site.is_enabled })}>
                        {site.is_enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn-secondary text-xs py-1 px-2" onClick={() => setEditSite(site)}>Edit</button>
                      <button className="btn-secondary text-xs py-1 px-2 text-red-400 hover:text-red-300 ml-auto" onClick={() => setDeleteId(site.id)}>
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

      {/* Add / edit website modals */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Website" size="lg">
        <WebsiteForm initial={defaultWebsiteForm} folders={folders} onSave={d => create.mutate(d)} onCancel={() => setShowModal(false)} loading={create.isPending} />
      </Modal>

      {editSite && (
        <Modal open={!!editSite} onClose={() => setEditSite(null)} title="Edit Website" size="lg">
          <WebsiteForm
            initial={{ name: editSite.name, login_url: editSite.login_url, dashboard_url: editSite.dashboard_url ?? '', description: editSite.description ?? '', plugin_id: editSite.plugin_id, is_enabled: editSite.is_enabled, folder_id: editSite.folder_id ?? '', favicon_url: editSite.favicon_url ?? '' }}
            folders={folders} onSave={d => update.mutate({ id: editSite.id, data: d })} onCancel={() => setEditSite(null)} loading={update.isPending}
          />
        </Modal>
      )}

      {/* Folder modal */}
      <Modal open={showFolderModal} onClose={() => setShowFolderModal(false)} title="Create Folder">
        <form onSubmit={e => { e.preventDefault(); createFolderMut.mutate() }} className="space-y-4">
          <div>
            <label className="label">Folder name *</label>
            <input className="input" required value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="e.g. Social Tasks" />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setShowFolderModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={createFolderMut.isPending}>Create</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null} onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId !== null && deleteMut.mutate(deleteId)}
        title="Delete Website"
        message="This will also delete all saved credentials for this site. Tasks linked to it will remain but will be unlinked."
        confirmLabel="Delete" danger loading={deleteMut.isPending}
      />

      {/* In-app login browser */}
      {loginSite && (
        <LoginBrowserModal
          open={!!loginSite}
          websiteId={loginSite.id}
          loginUrl={loginSite.login_url}
          websiteName={loginSite.name}
          onSuccess={() => {
            setLoginSite(null)
            qc.invalidateQueries({ queryKey: ['auth-status', loginSite.id] })
            toast.success(`Logged in to ${loginSite.name} — ready to sync!`)
          }}
          onClose={() => setLoginSite(null)}
        />
      )}
    </div>
  )
}
