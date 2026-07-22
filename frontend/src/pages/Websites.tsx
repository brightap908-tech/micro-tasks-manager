import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Globe, Trash2, ExternalLink, ChevronDown,
  KeyRound, Eye, EyeOff, Copy, Folder, RefreshCw, Cookie, CheckCircle2, AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import {
  getWebsites, createWebsite, updateWebsite, deleteWebsite,
  getFolders, createFolder, deleteFolder,
} from '../db/websites'
import {
  getCredentials, createCredential, deleteCredential, revealCredentialPassword,
} from '../db/credentials'
import {
  saveSessionCookie, getSessionCookieValue, hasSessionCookie,
  deleteSessionCookie, getSessionCookieUpdatedAt,
} from '../db/session-cookies'
import { getLatestSnapshot, saveSnapshot } from '../db/snapshots'
import { syncWebsite as syncWebsiteProxy } from '../api/client'
import { logActivity } from '../db/activity'
import type { Website, WebsiteFolder, StoredCredential } from '../db/index'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'

const defaultWebsiteForm = {
  name: '', login_url: '', dashboard_url: '', description: '',
  plugin_id: 'generic', is_enabled: true, folder_id: '' as string | number,
  favicon_url: '',
}

const defaultCred = { username: '', password: '', notes: '' }

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
        <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Appen" />
      </div>
      <div>
        <label className="label">Login URL *</label>
        <input className="input" required type="url" value={form.login_url} onChange={e => set('login_url', e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className="label">Dashboard URL</label>
        <input className="input" type="url" value={form.dashboard_url} onChange={e => set('dashboard_url', e.target.value)} placeholder="https://... (for sync)" />
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

function SessionCookiePanel({ websiteId }: { websiteId: number }) {
  const qc = useQueryClient()
  const [showHelp, setShowHelp] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cookieInput, setCookieInput] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: hasCookie, refetch } = useQuery({
    queryKey: ['session-cookie-exists', websiteId],
    queryFn: () => hasSessionCookie(websiteId),
  })

  const { data: updatedAt } = useQuery({
    queryKey: ['session-cookie-updated', websiteId],
    queryFn: () => getSessionCookieUpdatedAt(websiteId),
  })

  const handleSave = async () => {
    if (!cookieInput.trim()) return
    setSaving(true)
    try {
      await saveSessionCookie(websiteId, cookieInput.trim())
      await refetch()
      qc.invalidateQueries({ queryKey: ['session-cookie-exists', websiteId] })
      qc.invalidateQueries({ queryKey: ['session-cookie-updated', websiteId] })
      setEditing(false)
      setCookieInput('')
      toast.success('Session cookie saved — sync will now use it')
    } catch (e) {
      toast.error(`Failed to save cookie: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    await deleteSessionCookie(websiteId)
    await refetch()
    qc.invalidateQueries({ queryKey: ['session-cookie-exists', websiteId] })
    qc.invalidateQueries({ queryKey: ['session-cookie-updated', websiteId] })
    toast.success('Session cookie removed')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Cookie size={14} /> Session Cookie
        </h3>
        <div className="flex gap-1">
          <button
            className="btn-secondary py-1 px-2 text-xs"
            onClick={() => setShowHelp(p => !p)}
          >
            {showHelp ? 'Hide help' : 'How to get it'}
          </button>
          <button
            className="btn-secondary py-1 px-2 text-xs"
            onClick={() => { setEditing(p => !p); setCookieInput('') }}
          >
            {hasCookie ? 'Update' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Status indicator */}
      {hasCookie ? (
        <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={13} className="text-green-400 shrink-0" />
            <span className="text-xs text-green-300">Cookie saved — sync is authenticated</span>
          </div>
          <div className="flex items-center gap-2">
            {updatedAt && (
              <span className="text-xs text-slate-600">{new Date(updatedAt).toLocaleDateString()}</span>
            )}
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 px-1"
              title="Remove cookie"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-yellow-400 shrink-0" />
          <span className="text-xs text-yellow-300">No session cookie — sync will show "login required"</span>
        </div>
      )}

      {/* How-to instructions */}
      {showHelp && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2 text-xs text-slate-400">
          <p className="font-semibold text-slate-300">How to copy your session cookie:</p>
          <ol className="space-y-1.5 list-decimal list-inside">
            <li>Open the website in your browser and log in normally.</li>
            <li>Press <kbd className="bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-xs">F12</kbd> to open DevTools.</li>
            <li>Go to <strong className="text-slate-300">Application</strong> → <strong className="text-slate-300">Cookies</strong> → select the site.</li>
            <li>Find the main session cookie (usually named <code className="text-brand-400">session</code>, <code className="text-brand-400">PHPSESSID</code>, <code className="text-brand-400">auth_token</code>, or similar).</li>
            <li>Copy its <strong className="text-slate-300">value</strong> and paste it below.</li>
            <li className="text-slate-500">Tip: you can also copy all cookies at once — right-click the site in the cookie list and choose "Copy all cookies as header value".</li>
          </ol>
          <p className="text-slate-600 text-xs mt-1">The cookie is encrypted and stored only in your browser. It is never sent anywhere except back to the site itself via the sync proxy.</p>
        </div>
      )}

      {/* Cookie input */}
      {editing && (
        <div className="space-y-2">
          <textarea
            className="input text-xs font-mono resize-none h-20"
            placeholder="Paste your session cookie here, e.g.: session=abc123xyz; other_cookie=value"
            value={cookieInput}
            onChange={e => setCookieInput(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary text-xs py-1 px-2"
              onClick={() => { setEditing(false); setCookieInput('') }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-xs py-1 px-2"
              disabled={!cookieInput.trim() || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save Cookie'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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
    mutationFn: (d: typeof defaultCred) =>
      createCredential({ website_id: websiteId, ...d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials', websiteId] })
      setForm(defaultCred)
      setShowAdd(false)
      toast.success('Credential saved')
    },
  })

  const deleteCred = useMutation({
    mutationFn: (id: number) => deleteCredential(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials', websiteId] }),
  })

  const revealPassword = async (credId: number) => {
    if (revealed[credId] !== undefined) {
      setRevealed(p => { const n = { ...p }; delete n[credId]; return n })
      return
    }
    setLoadingReveal(credId)
    try {
      const pw = await revealCredentialPassword(credId)
      setRevealed(p => ({ ...p, [credId]: pw }))
    } catch (e) {
      toast.error(`Failed to reveal: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoadingReveal(null) }
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
        <button className="btn-secondary py-1 px-2 text-xs" onClick={() => setShowAdd(p => !p)}>
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
        <div key={c.id} className="bg-slate-800/40 rounded-lg px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 font-medium flex-1 truncate">{c.username}</span>
            <button
              onClick={() => copyToClipboard(c.username, 'Username')}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title="Copy username"
            >
              <Copy size={11} />
            </button>
            <button
              onClick={() => revealPassword(c.id)}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
              title={revealed[c.id] !== undefined ? 'Hide' : 'Reveal'}
              disabled={loadingReveal === c.id}
            >
              {revealed[c.id] !== undefined ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <button
              onClick={() => deleteCred.mutate(c.id)}
              className="p-1 text-slate-500 hover:text-red-400 transition-colors"
              title="Delete credential"
            >
              <Trash2 size={11} />
            </button>
          </div>
          {revealed[c.id] !== undefined && (
            <div className="flex items-center gap-2">
              <code className="text-xs text-yellow-300 bg-slate-900 px-2 py-1 rounded flex-1 truncate">
                {revealed[c.id]}
              </code>
              <button
                onClick={() => copyToClipboard(revealed[c.id], 'Password')}
                className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                title="Copy password"
              >
                <Copy size={11} />
              </button>
            </div>
          )}
          {c.notes && <p className="text-xs text-slate-600">{c.notes}</p>}
        </div>
      ))}
    </div>
  )
}

export default function WebsitesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editSite, setEditSite] = useState<Website | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderName, setFolderName] = useState('')

  const { data: websites = [] } = useQuery({
    queryKey: ['websites'],
    queryFn: getWebsites,
  })

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: getFolders,
  })

  const folderMap = Object.fromEntries(folders.map(f => [f.id, f]))

  const create = useMutation({
    mutationFn: (d: typeof defaultWebsiteForm) => createWebsite({
      name: d.name,
      login_url: d.login_url,
      dashboard_url: d.dashboard_url || undefined,
      description: d.description || undefined,
      plugin_id: d.plugin_id,
      is_enabled: d.is_enabled,
      folder_id: d.folder_id ? Number(d.folder_id) : undefined,
      favicon_url: d.favicon_url || undefined,
    }),
    onSuccess: (site) => {
      qc.invalidateQueries({ queryKey: ['websites'] })
      setShowModal(false)
      toast.success('Website added')
      logActivity(`Website added: ${site.name}`, site.login_url, 'website', site.id)
    },
    onError: (e) => toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof defaultWebsiteForm }) =>
      updateWebsite(id, {
        name: data.name,
        login_url: data.login_url,
        dashboard_url: data.dashboard_url || undefined,
        description: data.description || undefined,
        plugin_id: data.plugin_id,
        is_enabled: data.is_enabled,
        folder_id: data.folder_id ? Number(data.folder_id) : undefined,
        favicon_url: data.favicon_url || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['websites'] })
      setEditSite(null)
      toast.success('Website updated')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWebsite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['websites'] })
      setDeleteId(null)
      toast.success('Website deleted')
    },
  })

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      updateWebsite(id, { is_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['websites'] }),
  })

  const createFolderMut = useMutation({
    mutationFn: () => createFolder({ name: folderName, color: '#6366f1' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      setShowFolderModal(false)
      setFolderName('')
      toast.success('Folder created')
    },
  })

  const syncOne = async (site: Website) => {
    const url = site.dashboard_url || site.login_url
    setSyncingId(site.id)
    try {
      // Retrieve stored session cookie (if any) to forward to the proxy
      const cookieValue = await getSessionCookieValue(site.id)
      const result = await syncWebsiteProxy(url, site.name, cookieValue)

      await saveSnapshot({
        website_id: site.id,
        status: result.status,
        available_balance: result.available_balance ?? undefined,
        available_tasks: result.available_tasks ?? undefined,
        pending_tasks: result.pending_tasks ?? undefined,
        completed_tasks: result.completed_tasks ?? undefined,
        total_earnings: result.total_earnings ?? undefined,
        page_title: result.page_title ?? undefined,
        error_message: result.error_message ?? undefined,
      })
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      qc.invalidateQueries({ queryKey: ['snapshots', site.id] })

      if (result.status === 'ok') {
        const parts: string[] = []
        if (result.available_balance !== null) parts.push(`$${result.available_balance!.toFixed(2)} balance`)
        if (result.pending_tasks !== null) parts.push(`${result.pending_tasks} pending`)
        if (result.completed_tasks !== null) parts.push(`${result.completed_tasks} completed`)
        toast.success(`${site.name}: ${parts.length ? parts.join(' · ') : 'synced'}`)
      } else if (result.status === 'auth_required') {
        const hasCookie = await hasSessionCookie(site.id)
        if (hasCookie) {
          toast(`${site.name}: session expired — update your cookie in the site settings`, { icon: '🔐', duration: 6000 })
        } else {
          toast(`${site.name}: no session cookie — add it in the site settings to sync`, { icon: '🔐', duration: 6000 })
        }
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

  const SyncStatus = ({ siteId }: { siteId: number }) => {
    const { data: snap } = useQuery({
      queryKey: ['snapshots', siteId],
      queryFn: () => getLatestSnapshot(siteId),
    })
    if (!snap) return <span className="text-xs text-slate-600">Never synced</span>
    if (snap.status === 'ok') {
      const parts: string[] = []
      if (snap.available_balance !== undefined) parts.push(`$${snap.available_balance.toFixed(2)}`)
      if (snap.pending_tasks !== undefined) parts.push(`${snap.pending_tasks} pending`)
      if (snap.completed_tasks !== undefined) parts.push(`${snap.completed_tasks} done`)
      if (snap.total_earnings !== undefined) parts.push(`$${snap.total_earnings.toFixed(2)} earned`)
      return (
        <span className="text-xs text-green-400">
          {parts.length ? parts.join(' · ') : '✓ synced'}
        </span>
      )
    }
    if (snap.status === 'auth_required') return (
      <span className="text-xs text-yellow-400" title={snap.error_message ?? ''}>
        🔐 {snap.error_message ?? 'Login required'}
      </span>
    )
    return (
      <span className="text-xs text-red-400" title={snap.error_message ?? ''}>
        Error: {(snap.error_message ?? 'sync failed').slice(0, 40)}
      </span>
    )
  }

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
          action={
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={15} /> Add Website
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {websites.map(site => {
            const isExpanded = expandedId === site.id
            const folder = site.folder_id ? folderMap[site.folder_id] : undefined

            return (
              <div key={site.id} className="card hover:border-slate-700 transition-colors">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : site.id)}
                >
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
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                          style={{ borderLeft: `3px solid ${folder.color}` }}>
                          {folder.name}
                        </span>
                      )}
                      <span className={clsx(
                        'text-xs px-1.5 py-0.5 rounded',
                        site.is_enabled ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-500',
                      )}>
                        {site.is_enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                    <SyncStatus siteId={site.id} />
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                      onClick={() => syncOne(site)}
                      disabled={syncingId === site.id}
                      title="Sync now"
                    >
                      <RefreshCw size={14} className={syncingId === site.id ? 'animate-spin' : ''} />
                    </button>
                    <a
                      href={site.login_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                      title="Open site"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <ChevronDown
                      size={14}
                      className={clsx('text-slate-500 transition-transform ml-1', isExpanded && 'rotate-180')}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
                    {site.description && (
                      <p className="text-sm text-slate-400">{site.description}</p>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs">
                      <a href={site.login_url} target="_blank" rel="noopener noreferrer"
                        className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                        <ExternalLink size={11} /> Login page
                      </a>
                      {site.dashboard_url && (
                        <a href={site.dashboard_url} target="_blank" rel="noopener noreferrer"
                          className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                          <ExternalLink size={11} /> Dashboard
                        </a>
                      )}
                    </div>

                    {/* Session cookie for authenticated sync */}
                    <SessionCookiePanel websiteId={site.id} />

                    {/* Credentials */}
                    <CredentialPanel websiteId={site.id} websiteName={site.name} />

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <button
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => toggleEnabled.mutate({ id: site.id, enabled: !site.is_enabled })}
                      >
                        {site.is_enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => setEditSite(site)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-secondary text-xs py-1 px-2 text-red-400 hover:text-red-300 ml-auto"
                        onClick={() => setDeleteId(site.id)}
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

      {/* Add/edit website modals */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Website" size="lg">
        <WebsiteForm
          initial={defaultWebsiteForm}
          folders={folders}
          onSave={d => create.mutate(d)}
          onCancel={() => setShowModal(false)}
          loading={create.isPending}
        />
      </Modal>

      {editSite && (
        <Modal open={!!editSite} onClose={() => setEditSite(null)} title="Edit Website" size="lg">
          <WebsiteForm
            initial={{
              name: editSite.name,
              login_url: editSite.login_url,
              dashboard_url: editSite.dashboard_url ?? '',
              description: editSite.description ?? '',
              plugin_id: editSite.plugin_id,
              is_enabled: editSite.is_enabled,
              folder_id: editSite.folder_id ?? '',
              favicon_url: editSite.favicon_url ?? '',
            }}
            folders={folders}
            onSave={d => update.mutate({ id: editSite.id, data: d })}
            onCancel={() => setEditSite(null)}
            loading={update.isPending}
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
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId !== null && deleteMut.mutate(deleteId)}
        title="Delete Website"
        message="This will also delete all saved credentials for this site. Tasks linked to it will remain but will be unlinked."
        confirmLabel="Delete"
        danger
        loading={deleteMut.isPending}
      />
    </div>
  )
}
